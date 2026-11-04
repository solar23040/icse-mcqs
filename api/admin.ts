import { createHash, randomBytes } from 'node:crypto';

/**
 * Developer account manager.
 *
 * Deployed as a single unbundled Node ESM file, so it must not import from
 * src/ (extensionless imports fail at runtime on Vercel). The storage keys,
 * sanitizers and credential hashes are therefore kept local to this file and
 * must stay in sync with api/leaderboard.ts and src/lib/dev.ts.
 *
 * Login accepts the same credentials as /dev and issues a short-lived bearer
 * token stored in Redis. The token is required for list, update and delete.
 */
export const config = { runtime: 'nodejs' };

const WEEK_KEY_PREFIX = 'leaderboard:week:';
const NAME_KEY_PREFIX = 'leaderboard:name:';
const PROFILE_KEY_PREFIX = 'leaderboard:profile:';
const FOLLOWERS_KEY_PREFIX = 'leaderboard:followers:';
const WEEK_TTL_SECONDS = 60 * 60 * 24 * 14;
const NAME_TTL_SECONDS = 60 * 60 * 24 * 90;
const PROFILE_TTL_SECONDS = 60 * 60 * 24 * 90;
const SESSION_KEY_PREFIX = 'admin:session:';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MAX_ADMIN_XP = 1_000_000_000;
const MAX_PROFILE_BADGES = 40;
const MAX_PROFILE_SUBJECTS = 10;

const DEV_SALT = 'icse-dev-v1:';
const DEV_USERNAME_HASH = '1280903e5653cb53a3ea2fb8594d41634dab58afbcb6de938c6b105846289fd7';
const DEV_PASSWORD_HASH = 'a04aa5bc8f5dd88c50abe4f60214b4e3f928bd0ee5955bbb06f41a4be55b4ade';

const BADGE_IDS = new Set([
  'first-steps',
  'perfect-ten',
  'week-warrior',
  'subject-sweep',
  'comeback',
  'all-rounder',
  'century',
  'dedicated',
  'marathon',
  'sharpshooter',
  'flawless-twenty',
  'mastermind',
  'specialist',
  'comeback-king',
  'grand-slam',
  'fortnight',
  'daily-devotee',
  'speed-demon',
  'goal-getter',
  'night-owl',
  'early-bird',
  'collector',
]);

const SUBJECT_SLUGS = new Set([
  'history',
  'economics',
  'geography',
  'maths',
  'english-lit',
  'physics',
  'chemistry',
  'computer-applications',
  'physical-education',
]);

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

interface ProfileSubject {
  subject: string;
  lastPracticed: string;
  attempts: number;
}

interface StoredProfile {
  id?: string;
  name?: string;
  lastOnline?: string | null;
  badges?: string[];
  subjects?: ProfileSubject[];
  token?: string;
}

export interface AdminUser {
  id: string;
  name: string;
  xp: number;
  lastOnline: string | null;
  badges: string[];
  subjects: ProfileSubject[];
  week: string;
}

interface InternalUser extends AdminUser {
  token: string | null;
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(value);
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isPublicId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value);
}

function sanitiseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 20);
  return clean.length >= 1 ? clean : null;
}

function toCount(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(number)));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function sanitiseBadges(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const badges: string[] = [];
  for (const badge of value) {
    if (typeof badge !== 'string' || !BADGE_IDS.has(badge)) continue;
    if (!badges.includes(badge)) badges.push(badge);
  }
  return badges.slice(0, MAX_PROFILE_BADGES);
}

function sanitiseSubjects(value: unknown, now: Date): ProfileSubject[] {
  if (!Array.isArray(value)) return [];

  const subjects: ProfileSubject[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;

    const { subject, lastPracticed, attempts } = item as {
      subject?: unknown;
      lastPracticed?: unknown;
      attempts?: unknown;
    };
    if (typeof subject !== 'string' || !SUBJECT_SLUGS.has(subject)) continue;
    if (!isTimestamp(lastPracticed) || seen.has(subject)) continue;

    const timestamp = new Date(lastPracticed);
    const safeTimestamp =
      timestamp.getTime() > now.getTime() ? now.toISOString() : timestamp.toISOString();
    seen.add(subject);
    subjects.push({
      subject,
      lastPracticed: safeTimestamp,
      attempts: toCount(attempts),
    });
  }

  return subjects
    .sort((left, right) => Date.parse(right.lastPracticed) - Date.parse(left.lastPracticed))
    .slice(0, MAX_PROFILE_SUBJECTS);
}

function isoWeek(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);

  const year = target.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((target.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function weekKey(week: string): string {
  return `${WEEK_KEY_PREFIX}${week}`;
}

function nameKey(token: string): string {
  return `${NAME_KEY_PREFIX}${token}`;
}

function profileKey(id: string): string {
  return `${PROFILE_KEY_PREFIX}${id}`;
}

function followersKey(id: string): string {
  return `${FOLLOWERS_KEY_PREFIX}${id}`;
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
  const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length] ?? 'Owl';
  return `${adjective} ${animal} ${(hash % 99) + 1}`;
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, '0');
}

function publicIdFor(token: string): string {
  return hex8(hashToken(`${token}:profile:a`)) + hex8(hashToken(`${token}:profile:b`));
}

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function redisPipeline(commands: RedisCommand[]): Promise<unknown[]> {
  const config = redisConfig();
  if (!config) throw new Error('admin_storage_not_configured');

  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`admin_storage_${response.status}`);

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('admin_storage_bad_response');

  return payload.map((entry) => {
    if (typeof entry !== 'object' || entry === null || !('result' in entry)) {
      throw new Error('admin_storage_command_failed');
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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fixedEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function verifyCredentials(username: unknown, password: unknown): boolean {
  if (typeof username !== 'string' || typeof password !== 'string') return false;

  const expectedUsername = process.env.DEV_USERNAME ?? process.env.PUBLIC_DEV_USERNAME ?? '';
  const expectedPassword = process.env.DEV_PASSWORD ?? process.env.PUBLIC_DEV_PASSWORD ?? '';

  if (expectedUsername && expectedPassword) {
    return (
      fixedEqual(username.trim(), expectedUsername) && fixedEqual(password, expectedPassword)
    );
  }

  return (
    fixedEqual(sha256Hex(DEV_SALT + username.trim()), DEV_USERNAME_HASH) &&
    fixedEqual(sha256Hex(DEV_SALT + password), DEV_PASSWORD_HASH)
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !isSessionId(token)) return null;
  return token;
}

async function sessionValid(token: string): Promise<boolean> {
  const [value] = await redisPipeline([['GET', `${SESSION_KEY_PREFIX}${token}`]]);
  return value === '1';
}

function unauthorised(): Response {
  return json({ configured: true, error: 'unauthorised' }, 401);
}

function unconfigured(): Response {
  return json({ configured: false, error: 'not_configured' }, 503);
}

function storageFailure(): Response {
  return json({ configured: true, error: 'storage_unavailable' }, 502);
}

function badRequest(error: string): Response {
  return json({ configured: true, error }, 400);
}

function extractTokenScores(raw: unknown): Array<{ token: string; xp: number }> {
  if (!Array.isArray(raw)) return [];

  const entries: Array<{ token: string; xp: number }> = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const token = raw[index];
    if (!isToken(token)) continue;
    entries.push({ token, xp: toCount(raw[index + 1]) });
  }
  return entries;
}

function parseStoredProfile(raw: unknown): StoredProfile | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as StoredProfile;
  } catch {
    return null;
  }
}

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';

  for (let page = 0; page < 100; page += 1) {
    const [scanResult] = await redisPipeline([
      ['SCAN', cursor, 'MATCH', pattern, 'COUNT', 200],
    ]);
    if (!Array.isArray(scanResult)) break;

    const [next, batch] = scanResult;
    if (typeof next === 'string') cursor = next;
    else if (typeof next === 'number') cursor = String(next);

    if (Array.isArray(batch)) {
      for (const key of batch) {
        if (typeof key === 'string') keys.push(key);
      }
    }

    if (cursor === '0') break;
  }

  return keys;
}

async function fetchStrings(keys: string[]): Promise<Array<unknown>> {
  if (keys.length === 0) return [];

  const values: unknown[] = [];
  for (let start = 0; start < keys.length; start += 100) {
    const chunk = keys.slice(start, start + 100);
    const results = await redisPipeline(chunk.map((key) => ['GET', key]));
    values.push(...results);
  }
  return values;
}

async function loadProfiles(): Promise<Map<string, StoredProfile>> {
  const profiles = new Map<string, StoredProfile>();

  const keys = await scanKeys(`${PROFILE_KEY_PREFIX}*`);
  if (keys.length === 0) return profiles;

  const values = await fetchStrings(keys);
  for (let index = 0; index < keys.length; index += 1) {
    const id = keys[index]!.slice(PROFILE_KEY_PREFIX.length);
    if (!isPublicId(id)) continue;

    const profile = parseStoredProfile(values[index]);
    if (profile) profiles.set(id, profile);
  }

  return profiles;
}

async function listUsers(week: string): Promise<InternalUser[]> {
  const key = weekKey(week);
  const [scoresRaw, profiles] = await Promise.all([
    redisPipeline([['ZRANGE', key, 0, -1, 'WITHSCORES']]).then((results) => results[0]),
    loadProfiles(),
  ]);

  const entries = extractTokenScores(scoresRaw);
  const nameValues = await fetchStrings(entries.map(({ token }) => nameKey(token)));

  const users: InternalUser[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const { token, xp } = entries[index]!;
    const id = publicIdFor(token);
    const profile = profiles.get(id);
    const storedName = nameValues[index];
    const name =
      (typeof storedName === 'string' && storedName.length > 0 ? storedName : null) ??
      (typeof profile?.name === 'string' && profile.name.length > 0 ? profile.name : null) ??
      nameFor(token);

    users.push({
      id,
      name,
      xp,
      lastOnline: profile && isTimestamp(profile.lastOnline) ? profile.lastOnline : null,
      badges: Array.isArray(profile?.badges) ? sanitiseBadges(profile.badges) : [],
      subjects: Array.isArray(profile?.subjects)
        ? sanitiseSubjects(profile.subjects, new Date())
        : [],
      week,
      token,
    });
    seen.add(id);
  }

  for (const [id, profile] of profiles) {
    if (seen.has(id)) continue;

    const name =
      typeof profile.name === 'string' && sanitiseName(profile.name)
        ? sanitiseName(profile.name)!
        : `Player ${id.slice(0, 4)}`;

    users.push({
      id,
      name,
      xp: 0,
      lastOnline: isTimestamp(profile.lastOnline) ? profile.lastOnline : null,
      badges: Array.isArray(profile.badges) ? sanitiseBadges(profile.badges) : [],
      subjects: Array.isArray(profile.subjects)
        ? sanitiseSubjects(profile.subjects, new Date())
        : [],
      week,
      token: isToken(profile.token) ? profile.token : null,
    });
  }

  users.sort(
    (left, right) => right.xp - left.xp || left.name.localeCompare(right.name),
  );
  return users;
}

async function resolveToken(id: string, week: string): Promise<string | null> {
  const [raw] = await redisPipeline([['GET', profileKey(id)]]);
  const profile = parseStoredProfile(raw);
  if (isToken(profile?.token)) return profile.token;

  const [members] = await redisPipeline([['ZRANGE', weekKey(week), 0, -1]]);
  if (Array.isArray(members)) {
    for (const member of members) {
      if (isToken(member) && publicIdFor(member) === id) return member;
    }
  }
  return null;
}

function publicUser(user: InternalUser): AdminUser {
  const { token: _token, ...rest } = user;
  return rest;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function login(body: Record<string, unknown>): Promise<Response> {
  if (!verifyCredentials(body.username, body.password)) {
    return json({ configured: true, error: 'invalid_credentials' }, 401);
  }

  const token = randomBytes(32).toString('hex');
  await redisPipeline([
    ['SET', `${SESSION_KEY_PREFIX}${token}`, '1', 'EX', SESSION_TTL_SECONDS],
  ]);

  return json({ configured: true, token, expiresIn: SESSION_TTL_SECONDS });
}

async function updateUser(body: Record<string, unknown>): Promise<Response> {
  if (!isPublicId(body.id)) return badRequest('invalid_id');

  const id = body.id;
  const now = new Date();
  const week = isoWeek(now);
  const token = await resolveToken(id, week);

  const [raw] = await redisPipeline([['GET', profileKey(id)]]);
  const existing = parseStoredProfile(raw);

  let name: string | null = null;
  if (body.name !== undefined) {
    name = sanitiseName(body.name);
    if (!name) return badRequest('invalid_name');
  }

  let xp: number | null = null;
  if (body.xp !== undefined) {
    xp = toCount(body.xp, MAX_ADMIN_XP);
  }

  const commands: RedisCommand[] = [];
  const xpApplied = xp !== null && Boolean(token);

  if (xpApplied && token && xp !== null) {
    commands.push(
      ['ZADD', weekKey(week), xp, token],
      ['EXPIRE', weekKey(week), WEEK_TTL_SECONDS],
    );
  }

  if (name && token) {
    commands.push(['SET', nameKey(token), name, 'EX', NAME_TTL_SECONDS]);
  }

  const profile: StoredProfile = {
    id,
    name: name ?? (typeof existing?.name === 'string' ? existing.name : (token ? nameFor(token) : `Player ${id.slice(0, 4)}`)),
    lastOnline: now.toISOString(),
    badges:
      body.badges === undefined
        ? Array.isArray(existing?.badges)
          ? sanitiseBadges(existing.badges)
          : []
        : sanitiseBadges(body.badges),
    subjects:
      body.subjects === undefined
        ? Array.isArray(existing?.subjects)
          ? sanitiseSubjects(existing.subjects, now)
          : []
        : sanitiseSubjects(body.subjects, now),
    ...(token ? { token } : {}),
  };

  commands.push([
    'SET',
    profileKey(id),
    JSON.stringify(profile),
    'EX',
    PROFILE_TTL_SECONDS,
  ]);

  await redisPipeline(commands);

  return json({
    configured: true,
    xpApplied,
    user: publicUser({
      id,
      name: profile.name!,
      xp: xpApplied && xp !== null ? xp : 0,
      lastOnline: profile.lastOnline ?? null,
      badges: profile.badges!,
      subjects: profile.subjects!,
      week,
      token,
    }),
  });
}

async function deleteUser(body: Record<string, unknown>): Promise<Response> {
  if (!isPublicId(body.id)) return badRequest('invalid_id');

  const id = body.id;
  const week = isoWeek(new Date());
  const token = await resolveToken(id, week);

  const commands: RedisCommand[] = [['DEL', profileKey(id)], ['DEL', followersKey(id)]];

  if (token) {
    const weekKeys = await scanKeys(`${WEEK_KEY_PREFIX}*`);
    for (const key of weekKeys) commands.push(['ZREM', key, token]);
    commands.push(['DEL', nameKey(token)]);
  }

  await redisPipeline(commands);
  return json({ configured: true, ok: true });
}

export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!redisConfig()) return unconfigured();

  const token = bearerToken(request);
  if (!token) return unauthorised();

  try {
    if (!(await sessionValid(token))) return unauthorised();

    const week = isoWeek(new Date());
    const users = await listUsers(week);
    return json({ configured: true, week, users: users.map(publicUser) });
  } catch {
    return storageFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!redisConfig()) return unconfigured();

  const body = await readBody(request);
  if (!body) return badRequest('invalid_json');

  const action = body.action;
  if (action === 'login') {
    try {
      return await login(body);
    } catch {
      return storageFailure();
    }
  }

  const token = bearerToken(request);
  if (!token) return unauthorised();

  try {
    if (!(await sessionValid(token))) return unauthorised();

    if (action === 'logout') {
      await redisPipeline([['DEL', `${SESSION_KEY_PREFIX}${token}`]]);
      return json({ configured: true, ok: true });
    }
    if (action === 'update') return await updateUser(body);
    if (action === 'delete') return await deleteUser(body);

    return badRequest('unknown_action');
  } catch {
    return storageFailure();
  }
}
