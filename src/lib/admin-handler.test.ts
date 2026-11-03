import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../../api/admin';
import { POST as leaderboardPost } from '../../api/leaderboard';

type Command = (string | number)[];

interface FakeRedis {
  scores: Map<string, Map<string, number>>;
  values: Map<string, string>;
}

function globMatch(pattern: string, key: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(key);
}

function sortedScores(redis: FakeRedis, key: string): Array<[string, number]> {
  return Array.from(redis.scores.get(key)?.entries() ?? []).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

function scoreRange(
  redis: FakeRedis,
  key: string,
  start: number,
  stop: number,
  reverse: boolean,
): Array<[string, number]> {
  const list = sortedScores(redis, key);
  if (!reverse) list.reverse();
  const from = start < 0 ? Math.max(list.length + start, 0) : start;
  const to = stop < 0 ? list.length + stop : stop;
  return list.slice(from, to + 1);
}

function execute(redis: FakeRedis, command: Command): unknown {
  const [name, ...args] = command;
  const key = String(args[0]);

  switch (String(name).toUpperCase()) {
    case 'SCAN': {
      const pattern = String(args[2] ?? '*');
      const keys = new Set([...redis.scores.keys(), ...redis.values.keys()]);
      const matched = Array.from(keys).filter((candidate) => globMatch(pattern, candidate));
      return ['0', matched];
    }
    case 'ZADD': {
      const score = Number(args[1]);
      const member = String(args[2]);
      const set = redis.scores.get(key) ?? new Map<string, number>();
      redis.scores.set(key, set);
      set.set(member, score);
      return 1;
    }
    case 'ZSCORE':
      return redis.scores.get(key)?.get(String(args[1])) ?? null;
    case 'ZINCRBY': {
      const increment = Number(args[1]);
      const member = String(args[2]);
      const set = redis.scores.get(key) ?? new Map<string, number>();
      redis.scores.set(key, set);
      const next = (set.get(member) ?? 0) + increment;
      set.set(member, next);
      return next;
    }
    case 'ZRANGE': {
      const page = scoreRange(redis, key, Number(args[1]), Number(args[2]), false);
      return String(args[3] ?? '').toUpperCase() === 'WITHSCORES'
        ? page.flatMap(([member, score]) => [member, String(score)])
        : page.map(([member]) => member);
    }
    case 'ZREVRANGE': {
      const page = scoreRange(redis, key, Number(args[1]), Number(args[2]), true);
      return String(args[3] ?? '').toUpperCase() === 'WITHSCORES'
        ? page.flatMap(([member, score]) => [member, String(score)])
        : page.map(([member]) => member);
    }
    case 'ZREVRANK': {
      const index = sortedScores(redis, key).findIndex(([member]) => member === String(args[1]));
      return index === -1 ? null : index;
    }
    case 'ZCARD':
      return redis.scores.get(key)?.size ?? 0;
    case 'ZREM':
      return redis.scores.get(key)?.delete(String(args[1])) ? 1 : 0;
    case 'GET':
      return redis.values.get(key) ?? null;
    case 'SET':
      redis.values.set(key, String(args[1]));
      return 'OK';
    case 'EXPIRE':
      return 1;
    case 'DEL':
      return redis.values.delete(key) ? 1 : 0;
    default:
      throw new Error(`Unexpected Redis command: ${String(name)}`);
  }
}

function makeFetch(redis: FakeRedis): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body)) as Command[];
    const results = commands.map((command) => ({ result: execute(redis, command) }));
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function request(
  method: string,
  options: { body?: unknown; token?: string } = {},
): Request {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);

  return new Request('https://icse.example/api/admin', {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function cookieToken(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return /icse_lb_id=([^;]+)/.exec(header)?.[1] ?? '';
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function login(): Promise<string> {
  const response = await POST(
    request('POST', {
      body: { action: 'login', username: 'devansh', password: '181011' },
    }),
  );
  expect(response.status).toBe(200);
  return String((await payload(response)).token);
}

let redis: FakeRedis;

beforeEach(() => {
  redis = { scores: new Map(), values: new Map() };
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  vi.stubEnv('DEV_USERNAME', 'devansh');
  vi.stubEnv('DEV_PASSWORD', '181011');
  vi.stubGlobal('fetch', makeFetch(redis));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('admin API auth', () => {
  it('rejects a bad login and accepts the dev credentials', async () => {
    const bad = await POST(
      request('POST', {
        body: { action: 'login', username: 'devansh', password: 'wrong' },
      }),
    );
    expect(bad.status).toBe(401);

    const token = await login();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires a bearer token for listing', async () => {
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await GET(request('GET', { token: 'a'.repeat(64) }))).status).toBe(401);
  });

  it('returns not configured when Redis is missing', async () => {
    vi.unstubAllEnvs();
    expect((await GET(request('GET'))).status).toBe(503);
  });
});

describe('admin account list', () => {
  it('lists players from the shared leaderboard', async () => {
    const first = await leaderboardPost(
      new Request('https://icse.example/api/leaderboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weeklyXp: 120, name: 'Aarav' }),
      }),
    );
    const second = await leaderboardPost(
      new Request('https://icse.example/api/leaderboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weeklyXp: 80, name: 'Diya' }),
      }),
    );
    expect(cookieToken(first)).not.toBe('');
    expect(cookieToken(second)).not.toBe('');

    const token = await login();
    const response = await GET(request('GET', { token }));
    expect(response.status).toBe(200);

    const body = await payload(response);
    const users = body.users as Array<Record<string, unknown>>;
    expect(users.map((user) => user.name).sort()).toEqual(['Aarav', 'Diya']);
    expect(users.map((user) => user.xp)).toEqual([120, 80]);
  });

  it('updates a name and weekly XP, and removes a player', async () => {
    await leaderboardPost(
      new Request('https://icse.example/api/leaderboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weeklyXp: 120, name: 'Aarav' }),
      }),
    );

    const token = await login();
    const list = await payload(await GET(request('GET', { token })));
    const [player] = list.users as Array<Record<string, unknown>>;
    expect(player).toBeDefined();

    const updated = await POST(
      request('POST', {
        token,
        body: { action: 'update', id: player!.id, name: 'Aarav Kumar', xp: 999 },
      }),
    );
    expect(updated.status).toBe(200);
    const updatedBody = await payload(updated);
    expect(updatedBody.xpApplied).toBe(true);
    expect((updatedBody.user as Record<string, unknown>).name).toBe('Aarav Kumar');
    expect((updatedBody.user as Record<string, unknown>).xp).toBe(999);

    const afterUpdate = await payload(await GET(request('GET', { token })));
    const users = afterUpdate.users as Array<Record<string, unknown>>;
    expect(users[0]?.name).toBe('Aarav Kumar');
    expect(users[0]?.xp).toBe(999);

    const removed = await POST(
      request('POST', { token, body: { action: 'delete', id: player!.id } }),
    );
    expect(removed.status).toBe(200);

    const afterDelete = await payload(await GET(request('GET', { token })));
    expect(afterDelete.users).toEqual([]);
  });
});
