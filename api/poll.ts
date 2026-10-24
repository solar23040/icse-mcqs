/**
 * Kept in sync with POLL_OPTIONS in src/lib/poll.ts by a unit test.
 * This function is deployed as a single unbundled Node ESM file, so it must
 * not import from src/ (extensionless imports fail at runtime on Vercel).
 */
export const POLL_OPTION_IDS = [
  'mass-media',
  'physical-education',
  'computer-applications',
  'hindi',
  'physics',
  'chemistry',
  'biology',
  'commercial-studies',
  'english-language',
] as const;

export const config = { runtime: 'nodejs' };

type PollOptionId = (typeof POLL_OPTION_IDS)[number];

function isPollOptionId(value: unknown): value is PollOptionId {
  return typeof value === 'string' && (POLL_OPTION_IDS as readonly string[]).includes(value);
}

const HASH_KEY = 'poll:next-subject';
const VOTE_KEY_PREFIX = 'poll:vote:';
const COOKIE_NAME = 'icse_poll_voter';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year
const VOTE_TTL_SECONDS = COOKIE_MAX_AGE;

type RedisCommand = (string | number)[];

interface PollPayload {
  configured: true;
  totals: Record<PollOptionId, number>;
  total: number;
  myVote: PollOptionId | null;
}

function emptyTotals(): Record<PollOptionId, number> {
  return Object.fromEntries(POLL_OPTION_IDS.map((id) => [id, 0])) as Record<
    PollOptionId,
    number
  >;
}

function parseTotals(raw: unknown): Record<PollOptionId, number> {
  const totals = emptyTotals();
  if (!Array.isArray(raw)) return totals;

  for (let index = 0; index + 1 < raw.length; index += 2) {
    const id = raw[index];
    const count = Number(raw[index + 1]);
    if (!isPollOptionId(id) || !Number.isFinite(count)) continue;
    totals[id] = Math.max(0, Math.trunc(count));
  }

  return totals;
}

function buildPayload(rawHash: unknown, myVote: PollOptionId | null): PollPayload {
  const totals = parseTotals(rawHash);
  const total = Object.values(totals).reduce((sum, count) => sum + count, 0);
  return { configured: true, totals, total, myVote };
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
  if (!config) throw new Error('poll_storage_not_configured');

  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`poll_storage_${response.status}`);

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('poll_storage_bad_response');

  return payload.map((entry) => {
    if (typeof entry !== 'object' || entry === null || !('result' in entry)) {
      throw new Error('poll_storage_command_failed');
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

    return /^[a-zA-Z0-9-]{8,64}$/.test(value) ? value : null;
  }

  return null;
}

function voteCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}

function clearVoteCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function voteKey(token: string): string {
  return `${VOTE_KEY_PREFIX}${token}`;
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

  try {
    const commands: RedisCommand[] = [['HGETALL', HASH_KEY]];
    if (token) commands.push(['GET', voteKey(token)]);

    const [hash, storedVote] = await redisPipeline(commands);
    const myVote = isPollOptionId(storedVote) ? storedVote : null;

    return json(buildPayload(hash, myVote));
  } catch {
    return storageFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!redisConfig()) return unconfigured();

  let option: unknown;
  try {
    const body: unknown = await request.json();
    option = typeof body === 'object' && body !== null ? (body as { option?: unknown }).option : null;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!isPollOptionId(option)) return json({ error: 'invalid_option' }, 400);

  const existingToken = readCookie(request);
  const token = existingToken ?? crypto.randomUUID();

  try {
    const [storedVote] = await redisPipeline([['GET', voteKey(token)]]);
    const previousVote = isPollOptionId(storedVote) ? storedVote : null;

    const commands: RedisCommand[] = [];
    if (previousVote && previousVote !== option) {
      commands.push(['HINCRBY', HASH_KEY, previousVote, -1]);
    }
    if (previousVote !== option) {
      commands.push(['HINCRBY', HASH_KEY, option, 1]);
    }
    commands.push(
      ['SET', voteKey(token), option, 'EX', VOTE_TTL_SECONDS],
      ['HGETALL', HASH_KEY],
    );

    const results = await redisPipeline(commands);
    const hash = results[results.length - 1];

    return json(buildPayload(hash, option), 200, voteCookie(token, request));
  } catch {
    return storageFailure();
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!redisConfig()) return unconfigured();

  const token = readCookie(request);

  try {
    if (!token) {
      const [hash] = await redisPipeline([['HGETALL', HASH_KEY]]);
      return json(buildPayload(hash, null));
    }

    const [storedVote] = await redisPipeline([['GET', voteKey(token)]]);
    const previousVote = isPollOptionId(storedVote) ? storedVote : null;

    const commands: RedisCommand[] = [];
    if (previousVote) commands.push(['HINCRBY', HASH_KEY, previousVote, -1]);
    commands.push(['DEL', voteKey(token)], ['HGETALL', HASH_KEY]);

    const results = await redisPipeline(commands);
    const hash = results[results.length - 1];

    return json(buildPayload(hash, null), 200, clearVoteCookie(request));
  } catch {
    return storageFailure();
  }
}
