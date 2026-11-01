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
const NAME_KEY_PREFIX = 'leaderboard:name:';
const WEEK_TTL_SECONDS = 60 * 60 * 24 * 14; // two weeks
const DAY_TTL_SECONDS = 60 * 60 * 24 * 3;
const NAME_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const TOP_LIMIT = 10;

const PROFILE_KEY_PREFIX = 'leaderboard:profile:';
const PROFILE_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const MAX_PROFILE_BADGES = 40;
const MAX_PROFILE_SUBJECTS = 10;

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
  /** Public profile id, safe to share in profile links. */
  id: string;
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

export interface ProfileSubject {
  subject: string;
  lastPracticed: string;
  attempts: number;
}

export interface PublicProfile {
  id: string;
  name: string;
  lastOnline: string;
  badges: string[];
  subjects: ProfileSubject[];
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(value);
}

function sanitiseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 20);
  return clean.length >= 1 ? clean : null;
}

function toCount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function parseTop(raw: unknown, names: Map<string, string> = new Map()): LeaderboardEntry[] {
  if (!Array.isArray(raw)) return [];

  const top: LeaderboardEntry[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const id = raw[index];
    const score = raw[index + 1];
    if (!isToken(id)) continue;

    top.push({
      id: publicIdFor(id),
      name: names.get(id) ?? nameFor(id),
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
  names: Map<string, string> = new Map(),
): LeaderboardPayload {
  const top = parseTop(topRaw, names);
  const total = toCount(totalRaw);

  let me: LeaderboardMe | null = null;
  if (token && rankRaw !== null && rankRaw !== undefined) {
    const rankIndex = Number(rankRaw);
    if (Number.isFinite(rankIndex) && rankIndex >= 0) {
      const rank = Math.trunc(rankIndex) + 1;
      me = {
        id: publicIdFor(token),
        name: names.get(token) ?? nameFor(token),
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

function nameKey(token: string): string {
  return `${NAME_KEY_PREFIX}${token}`;
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

function hex8(value: number): string {
  return value.toString(16).padStart(8, '0');
}

/** Stable public id that does not expose the leaderboard cookie token. */
function publicIdFor(token: string): string {
  return hex8(hashToken(`${token}:profile:a`)) + hex8(hashToken(`${token}:profile:b`));
}

function isPublicId(value: string): boolean {
  return /^[a-f0-9]{16}$/.test(value);
}

function profileKey(id: string): string {
  return `${PROFILE_KEY_PREFIX}${id}`;
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

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
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
    // Ignore timestamps in the future so a tampered client cannot claim activity that has not happened.
    const safeTimestamp = timestamp.getTime() > now.getTime() ? now.toISOString() : timestamp.toISOString();
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

function parseProfile(id: string, raw: string): PublicProfile | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === 'string' ? sanitiseName(record.name) : null;
    if (!name) return null;
    if (!isTimestamp(record.lastOnline)) return null;

    return {
      id,
      name,
      lastOnline: record.lastOnline,
      badges: sanitiseBadges(record.badges),
      subjects: sanitiseSubjects(record.subjects, new Date()),
    };
  } catch {
    return null;
  }
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

/** Extract token IDs from a ZREVRANGE WITHSCORES result (alternating id/score). */
function extractTokens(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    if (isToken(raw[i])) tokens.push(raw[i] as string);
  }
  return tokens;
}

/** Fetch custom names for a list of tokens. Returns a map token→name. */
async function fetchNames(tokens: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tokens.length === 0) return map;

  const commands: RedisCommand[] = tokens.map((t) => ['GET', nameKey(t)]);
  try {
    const results = await redisPipeline(commands);
    for (let i = 0; i < tokens.length; i++) {
      const val = results[i];
      if (typeof val === 'string' && val.length > 0) {
        map.set(tokens[i]!, val);
      }
    }
  } catch {
    // Name fetch is best-effort; fall back to generated names
  }
  return map;
}

async function getProfile(id: string): Promise<Response> {
  if (!isPublicId(id)) return json({ configured: true, error: 'invalid_profile' }, 400);

  try {
    const [raw] = await redisPipeline([['GET', profileKey(id)]]);
    if (typeof raw !== 'string') return json({ configured: true, error: 'not_found' }, 404);

    const profile = parseProfile(id, raw);
    if (!profile) return json({ configured: true, error: 'not_found' }, 404);

    return json({ configured: true, profile });
  } catch {
    return storageFailure();
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!redisConfig()) return unconfigured();

  const requestedProfile = new URL(request.url).searchParams.get('profile');
  if (requestedProfile !== null) return getProfile(requestedProfile);

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

    // Collect tokens that appear in the top list + the current user
    const topTokens = extractTokens(results[0]);
    if (token && !topTokens.includes(token)) topTokens.push(token);
    const names = await fetchNames(topTokens);

    return json(
      buildPayload(
        week,
        results[0],
        results[1],
        token,
        token ? results[2] : null,
        token ? results[3] : null,
        names,
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
  let submittedName: string | null = null;
  let submittedProfile: { badges?: unknown; subjects?: unknown } | null = null;
  try {
    const body: unknown = await request.json();
    if (typeof body === 'object' && body !== null) {
      const b = body as { weeklyXp?: unknown; name?: unknown; profile?: unknown };
      weeklyXp = b.weeklyXp;
      submittedName = sanitiseName(b.name);

      if (typeof b.profile === 'object' && b.profile !== null) {
        const profile = b.profile as Record<string, unknown>;
        submittedProfile = { badges: profile.badges, subjects: profile.subjects };
      }
    } else {
      weeklyXp = null;
    }
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
    // Store custom name if provided
    if (submittedName) {
      commands.push(['SET', nameKey(token), submittedName, 'EX', NAME_TTL_SECONDS]);
    }
    if (submittedProfile) {
      const profile: PublicProfile = {
        id: publicIdFor(token),
        name: submittedName ?? nameFor(token),
        lastOnline: now.toISOString(),
        badges: sanitiseBadges(submittedProfile.badges),
        subjects: sanitiseSubjects(submittedProfile.subjects, now),
      };
      commands.push([
        'SET',
        profileKey(profile.id),
        JSON.stringify(profile),
        'EX',
        PROFILE_TTL_SECONDS,
      ]);
    }
    commands.push(
      ['ZREVRANGE', key, 0, TOP_LIMIT - 1, 'WITHSCORES'],
      ['ZCARD', key],
      ['ZREVRANK', key, token],
      ['ZSCORE', key, token],
    );

    const results = await redisPipeline(commands);
    const offset = results.length - 4;

    // Fetch names for top players
    const topTokens = extractTokens(results[offset]);
    if (!topTokens.includes(token)) topTokens.push(token);
    const names = await fetchNames(topTokens);
    if (submittedName) names.set(token, submittedName);

    return json(
      buildPayload(week, results[offset], results[offset + 1], token, results[offset + 2], results[offset + 3], names),
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
    if (token) {
      commands.push(['ZREM', key, token], ['DEL', profileKey(publicIdFor(token))]);
    }
    commands.push(['ZREVRANGE', key, 0, TOP_LIMIT - 1, 'WITHSCORES'], ['ZCARD', key]);

    const results = await redisPipeline(commands);
    const offset = results.length - 2;

    // Fetch custom names for remaining top players
    const topTokens = extractTokens(results[offset]);
    const names = await fetchNames(topTokens);

    return json(
      buildPayload(week, results[offset], results[offset + 1], null, null, null, names),
      200,
      token ? clearTokenCookie(request) : undefined,
    );
  } catch {
    return storageFailure();
  }
}
