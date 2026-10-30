/**
 * Anonymous weekly leaderboard.
 *
 * Deployed as a single unbundled Node ESM file, so it must not import from
 * src/ (extensionless imports fail at runtime on Vercel). The display-name
 * lists and constants are therefore kept local to this file.
 */
export const config = { runtime: 'nodejs' };

const COOKIE_NAME = 'icse_lb_id';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year
const WEEK_KEY_PREFIX = 'leaderboard:week:';
const DAY_KEY_PREFIX = 'leaderboard:day:';
const WEEK_TTL_SECONDS = 60 * 60 * 24 * 14; // two weeks
const DAY_TTL_SECONDS = 60 * 60 * 24 * 3;
const TOP_LIMIT = 10;

/** Keep submissions small enough that a tampered local state cannot jump the board. */
const MAX_SUBMISSION_XP = 500;
const MAX_DAILY_XP = 2000;

const ADJECTIVES = [
  'Brave',
  'Calm',
  'Clever',
  'Curious',
  'Eager',
  'Friendly',
  'Gentle',
  'Happy',
  'Jolly',
  'Kind',
  'Lively',
  'Mighty',
  'Nimble',
  'Patient',
  'Quick',
  'Quiet',
  'Ready',
  'Sharp',
  'Swift',
  'Wise',
] as const;

const ANIMALS = [
  'Owl',
  'Fox',
  'Panda',
  'Tiger',
  'Dolphin',
  'Eagle',
  'Otter',
  'Koala',
  'Lion',
  'Rabbit',
  'Sparrow',
  'Turtle',
  'Whale',
  'Wolf',
  'Zebra',
  'Falcon',
  'Hedgehog',
  'Leopard',
  'Penguin',
  'Squirrel',
] as const;

type RedisCommand = (string | number)[];

export interface LeaderboardEntry {
  name: string;
  xp: number;
  rank: number;
}

export interface LeaderboardMe extends LeaderboardEntry {
  /** 1 means the top 1% of this week's board. */
  percentile: number;
}

export interface LeaderboardPayload {
  configured: true;
  week: string;
  top: LeaderboardEntry[];
  me: LeaderboardMe | null;
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(value);
}

function toCount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function parseTop(raw: unknown): LeaderboardEntry[] {
  if (!Array.isArray(raw)) return [];

  const top: LeaderboardEntry[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const id = raw[index];
    const score = raw[index + 1];
    if (!isToken(id)) continue;

    top.push({
      name: nameFor(id),
      xp: toCount(score),
      rank: top.length + 1,
    });
  }

  return top;
}

function buildPayload(
  week: string,
  topRaw: unknown,
  totalRaw: unknown,
  token: string | null,
  rankRaw?: unknown,
  scoreRaw?: unknown,
): LeaderboardPayload {
  const top = parseTop(topRaw);
  const total = toCount(totalRaw);

  let me: LeaderboardMe | null = null;
  if (token && rankRaw !== null && rankRaw !== undefined) {
    const rankIndex = Number(rankRaw);
    if (Number.isFinite(rankIndex) && rankIndex >= 0) {
      const rank = Math.trunc(rankIndex) + 1;
      me = {
        name: nameFor(token),
        xp: toCount(scoreRaw),
        rank,
        percentile: Math.max(1, Math.ceil((rank / Math.max(1, total)) * 100)),
      };
    }
  }

  return { configured: true, week, top, me };
}

function json(body: unknown, status = 200, setCookie?: string): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function redisPipeline(commands: RedisCommand[]): Promise<unknown[]> {
  const config = redisConfig();
  if (!config) throw new Error('leaderboard_storage_not_configured');

  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`leaderboard_storage_${response.status}`);

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('leaderboard_storage_bad_response');

  return payload.map((entry) => {
    if (typeof entry !== 'object' || entry === null || !('result' in entry)) {
      throw new Error('leaderboard_storage_command_failed');
    }
    return (entry as { result: unknown }).result;
  });
}

function readCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== COOKIE_NAME) continue;

    let value: string;
    try {
      value = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }

    return isToken(value) ? value : null;
  }

  return null;
}

function tokenCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}

function clearTokenCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function weekKey(week: string): string {
  return `${WEEK_KEY_PREFIX}${week}`;
}

function dayKey(week: string, token: string, date: Date): string {
  return `${DAY_KEY_PREFIX}${week}:${token}:${date.toISOString().slice(0, 10)}`;
}

/** ISO week in UTC, e.g. 2026-W01. UTC keeps every visitor on the same week. */
export function isoWeek(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);

  const year = target.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((target.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nameFor(token: string): string {
  const hash = hashToken(token);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length] ?? 'Brave';
  const animal =
    ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length] ?? 'Owl';
  return `${adjective} ${animal} ${(hash % 99) + 1}`;
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

function unconfigured(): Response {
  return json({ configured: false, error: 'not_configured' }, 503);
}

function storageFailure(): Response {
  return json({ configured: true, error: 'storage_unavailable' }, 502);
}

export async function GET(request: Request): Promise<Response> {
  if (!redisConfig()) return unconfigured();

  const token = readCookie(request);
  const week = isoWeek(new Date());
  const key = weekKey(week);

  try {
    const commands: RedisCommand[] = [
      ['ZREVRANGE', key, 0, TOP_LIMIT - 1, 'WITHSCORES'],
      ['ZCARD', key],
    ];
    if (token) commands.push(['ZREVRANK', key, token], ['ZSCORE', key, token]);

    const results = await redisPipeline(commands);
    return json(
      buildPayload(
        week,
        results[0],
        results[1],
        token,
        token ? results[2] : null,
        token ? results[3] : null,
      ),
    );
  } catch {
    return storageFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!redisConfig()) return unconfigured();

  let weeklyXp: unknown;
  try {
    const body: unknown = await request.json();
    weeklyXp =
      typeof body === 'object' && body !== null
        ? (body as { weeklyXp?: unknown }).weeklyXp
        : null;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (
    typeof weeklyXp !== 'number' ||
    !Number.isFinite(weeklyXp) ||
    !Number.isInteger(weeklyXp) ||
    weeklyXp < 0
  ) {
    return json({ error: 'invalid_weekly_xp' }, 400);
  }

  const existing = readCookie(request);
  const token = existing ?? crypto.randomUUID();
  const now = new Date();
  const week = isoWeek(now);
  const key = weekKey(week);
  const day = dayKey(week, token, now);

  try {
    const [currentRaw, usedRaw] = await redisPipeline([
      ['ZSCORE', key, token],
      ['GET', day],
    ]);

    const current = toCount(currentRaw);
    const requested = Math.max(0, weeklyXp - current);
    const delta = Math.min(requested, MAX_SUBMISSION_XP);
    const used = toCount(usedRaw);
    const allowed = Math.min(delta, Math.max(0, MAX_DAILY_XP - used));

    const commands: RedisCommand[] = [];
    if (allowed > 0) {
      commands.push(
        ['ZINCRBY', key, allowed, token],
        ['EXPIRE', key, WEEK_TTL_SECONDS],
        ['SET', day, used + allowed, 'EX', DAY_TTL_SECONDS],
      );
    }
    commands.push(
      ['ZREVRANGE', key, 0, TOP_LIMIT - 1, 'WITHSCORES'],
      ['ZCARD', key],
      ['ZREVRANK', key, token],
      ['ZSCORE', key, token],
    );

    const results = await redisPipeline(commands);
    const offset = results.length - 4;
    return json(
      buildPayload(week, results[offset], results[offset + 1], token, results[offset + 2], results[offset + 3]),
      200,
      existing ? undefined : tokenCookie(token, request),
    );
  } catch {
    return storageFailure();
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!redisConfig()) return unconfigured();

  const token = readCookie(request);
  const week = isoWeek(new Date());
  const key = weekKey(week);

  try {
    const commands: RedisCommand[] = [];
    if (token) commands.push(['ZREM', key, token]);
    commands.push(['ZREVRANGE', key, 0, TOP_LIMIT - 1, 'WITHSCORES'], ['ZCARD', key]);

    const results = await redisPipeline(commands);
    const offset = results.length - 2;
    return json(
      buildPayload(week, results[offset], results[offset + 1], null, null, null),
      200,
      token ? clearTokenCookie(request) : undefined,
    );
  } catch {
    return storageFailure();
  }
}
