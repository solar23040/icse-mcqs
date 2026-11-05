/**
 * Optional cross-device progress sync.
 *
 * Deployed as a single unbundled Node ESM file, so it must not import from
 * src/. Passwords are hashed with scrypt + a random salt and are never stored
 * or returned. Each successful sign-in creates a random bearer token; the
 * browser stores that token, not the password.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const config = { runtime: 'nodejs' };

const USER_KEY_PREFIX = 'account:user:';
const SYNC_KEY_PREFIX = 'account:sync:';
const SESSION_KEY_PREFIX = 'account:session:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_BODY_BYTES = 512 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const USERNAME_MIN = 3;
const USERNAME_MAX = 24;
const USERNAME_RE = /^[a-zA-Z0-9._-]+$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;

type RedisCommand = (string | number)[];

interface StoredUser {
  id: string;
  username: string;
  salt: string;
  hash: string;
  createdAt: number;
}

interface StoredSync {
  v: 1;
  rev: number;
  updatedAt: number;
  data: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function fail(error: string, status = 400): Response {
  return json({ ok: false, error }, status);
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function redisPipeline(commands: RedisCommand[]): Promise<unknown[]> {
  const config = redisConfig();
  if (!config) throw new Error('sync_storage_not_configured');

  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`sync_storage_${response.status}`);

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('sync_storage_bad_response');

  return payload.map((entry) => {
    if (typeof entry !== 'object' || entry === null || !('result' in entry)) {
      throw new Error('sync_storage_command_failed');
    }
    return (entry as { result: unknown }).result;
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  const host =
    request.headers.get('host') ??
    request.headers.get('x-forwarded-host') ??
    new URL(request.url).host;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function normaliseUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (clean.length < USERNAME_MIN || clean.length > USERNAME_MAX) return null;
  if (!USERNAME_RE.test(clean)) return null;
  return clean;
}

function usernameKey(username: string): string {
  return `${USER_KEY_PREFIX}${username.toLowerCase()}`;
}

function userKeyForId(id: string): string {
  return `${USER_KEY_PREFIX}${id}`;
}

function syncKey(id: string): string {
  return `${SYNC_KEY_PREFIX}${id}`;
}

function sessionKey(token: string): string {
  return `${SESSION_KEY_PREFIX}${token}`;
}

function parseUser(raw: unknown): StoredUser | null {
  if (typeof raw !== 'string') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.username !== 'string') return null;
    if (typeof record.salt !== 'string' || typeof record.hash !== 'string') return null;

    return {
      id: record.id,
      username: record.username,
      salt: record.salt,
      hash: record.hash,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    };
  } catch {
    return null;
  }
}

function parseSync(raw: unknown): StoredSync | null {
  if (typeof raw !== 'string') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 || !('data' in record)) return null;

    return {
      v: 1,
      rev: typeof record.rev === 'number' && Number.isFinite(record.rev) ? Math.trunc(record.rev) : 0,
      updatedAt:
        typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? Math.trunc(record.updatedAt)
          : 0,
      data: record.data,
    };
  } catch {
    return null;
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, user: StoredUser): boolean {
  try {
    const expected = Buffer.from(user.hash, 'hex');
    const candidate = scryptSync(password, user.salt, expected.length);
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}

function newToken(): string {
  return randomBytes(32).toString('hex');
}

function readToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const match = /^Bearer ([a-f0-9]{64})$/i.exec(header.trim());
  return match && TOKEN_RE.test(match[1]!) ? match[1]! : null;
}

async function authenticatedUser(request: Request): Promise<StoredUser | null> {
  const token = readToken(request);
  if (!token) return null;

  const [idRaw] = await redisPipeline([['GET', sessionKey(token)]]);
  if (typeof idRaw !== 'string' || idRaw.length === 0) return null;

  const [userRaw] = await redisPipeline([['GET', userKeyForId(idRaw)]]);
  return parseUser(userRaw);
}

function snapshotSize(data: unknown): number {
  try {
    return JSON.stringify(data).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function syncPayload(sync: StoredSync | null): Record<string, unknown> {
  return {
    ok: true,
    data: sync?.data ?? null,
    updatedAt: sync?.updatedAt ?? 0,
    rev: sync?.rev ?? 0,
  };
}

async function register(body: Record<string, unknown>): Promise<Response> {
  const username = normaliseUsername(body.username);
  if (!username) return fail('invalid_username');

  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return fail('weak_password');
  }

  const data = body.data;
  if (data === undefined || data === null) return fail('invalid_payload', 400);
  if (snapshotSize(data) > MAX_SNAPSHOT_BYTES) return fail('payload_too_large', 413);

  const salt = randomBytes(16).toString('hex');
  const user: StoredUser = {
    id: randomUUID(),
    username,
    salt,
    hash: hashPassword(password, salt),
    createdAt: Date.now(),
  };

  const created = await redisPipeline([
    ['SET', usernameKey(username), JSON.stringify(user), 'NX'],
  ]);

  if (created[0] !== 'OK') return fail('username_taken', 409);

  const now = Date.now();
  const sync: StoredSync = { v: 1, rev: 1, updatedAt: now, data };
  const token = newToken();

  await redisPipeline([
    // Keep an id-based copy so a session only needs to resolve the user id.
    ['SET', userKeyForId(user.id), JSON.stringify(user)],
    ['SET', syncKey(user.id), JSON.stringify(sync)],
    ['SET', sessionKey(token), user.id, 'EX', SESSION_TTL_SECONDS],
  ]);

  return json({ ok: true, token, ...syncPayload(sync) });
}

async function login(body: Record<string, unknown>): Promise<Response> {
  const username = normaliseUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || password.length === 0) return fail('invalid_credentials', 401);

  const [userRaw] = await redisPipeline([['GET', usernameKey(username)]]);
  const user = parseUser(userRaw);
  if (!user || !verifyPassword(password, user)) return fail('invalid_credentials', 401);

  const token = newToken();
  const [, syncRaw] = await redisPipeline([
    ['SET', sessionKey(token), user.id, 'EX', SESSION_TTL_SECONDS],
    ['GET', syncKey(user.id)],
  ]);

  return json({ ok: true, token, ...syncPayload(parseSync(syncRaw)) });
}

async function pull(request: Request): Promise<Response> {
  const user = await authenticatedUser(request);
  if (!user) return fail('unauthorized', 401);

  const [syncRaw] = await redisPipeline([['GET', syncKey(user.id)]]);
  return json(syncPayload(parseSync(syncRaw)));
}

async function push(request: Request, body: Record<string, unknown>): Promise<Response> {
  const user = await authenticatedUser(request);
  if (!user) return fail('unauthorized', 401);

  const data = body.data;
  if (data === undefined || data === null || snapshotSize(data) > MAX_SNAPSHOT_BYTES) {
    return fail('invalid_payload', 400);
  }

  const [existingRaw] = await redisPipeline([['GET', syncKey(user.id)]]);
  const existing = parseSync(existingRaw);
  const now = Date.now();
  const sync: StoredSync = {
    v: 1,
    rev: (existing?.rev ?? 0) + 1,
    updatedAt: Math.max(now, (existing?.updatedAt ?? 0) + 1),
    data,
  };

  await redisPipeline([['SET', syncKey(user.id), JSON.stringify(sync)]]);
  return json(syncPayload(sync));
}

async function logout(request: Request): Promise<Response> {
  const token = readToken(request);
  if (!token) return json({ ok: true });

  await redisPipeline([['DEL', sessionKey(token)]]);
  return json({ ok: true });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return fail('forbidden', 403);
  if (!redisConfig()) return fail('not_configured', 503);

  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return fail('payload_too_large', 413);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail('invalid_json', 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return fail('invalid_json', 400);
  }

  try {
    switch (body.action) {
      case 'register':
        return await register(body);
      case 'login':
        return await login(body);
      case 'pull':
        return await pull(request);
      case 'push':
        return await push(request, body);
      case 'logout':
        return await logout(request);
      default:
        return fail('unknown_action', 400);
    }
  } catch {
    return fail('storage_unavailable', 502);
  }
}

export async function GET(): Promise<Response> {
  return json({ ok: true, configured: Boolean(redisConfig()) });
}
