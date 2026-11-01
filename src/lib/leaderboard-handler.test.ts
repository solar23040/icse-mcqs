import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST, isoWeek } from '../../api/leaderboard';

type Command = (string | number)[];

interface FakeRedis {
  scores: Map<string, Map<string, number>>;
  values: Map<string, string>;
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
    case 'ZREVRANGE': {
      const page = scoreRange(redis, key, Number(args[1]), Number(args[2]), true);
      return String(args[3] ?? '').toUpperCase() === 'WITHSCORES'
        ? page.flatMap(([member, score]) => [member, String(score)])
        : page.map(([member]) => member);
    }
    case 'ZRANGE': {
      const page = scoreRange(redis, key, Number(args[1]), Number(args[2]), false);
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

function apiRequest(
  method: string,
  options: { body?: unknown; cookie?: string; origin?: string; path?: string } = {},
): Request {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', `icse_lb_id=${options.cookie}`);
  if (options.origin) headers.set('origin', options.origin);

  return new Request(`https://icse.example${options.path ?? '/api/leaderboard'}`, {
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

function meOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.me as Record<string, unknown>;
}

function topOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return body.top as Array<Record<string, unknown>>;
}

let redis: FakeRedis;

beforeEach(() => {
  redis = { scores: new Map(), values: new Map() };
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  vi.stubGlobal('fetch', makeFetch(redis));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('leaderboard API', () => {
  it('returns configured false when Redis is not configured', async () => {
    vi.unstubAllEnvs();

    const response = await GET(apiRequest('GET'));

    expect(response.status).toBe(503);
    expect((await payload(response)).configured).toBe(false);
  });

  it('rejects invalid weekly XP values', async () => {
    for (const body of [{ weeklyXp: -1 }, { weeklyXp: 1.5 }, { weeklyXp: '10' }, {}]) {
      const response = await POST(apiRequest('POST', { body }));
      expect(response.status).toBe(400);
    }
  });

  it('creates an anonymous entry and sets an HttpOnly cookie', async () => {
    const response = await POST(apiRequest('POST', { body: { weeklyXp: 120 } }));

    expect(response.status).toBe(200);
    const body = await payload(response);
    const me = meOf(body);

    expect(body.week).toMatch(/^\d{4}-W\d{2}$/);
    expect(me.xp).toBe(120);
    expect(me.rank).toBe(1);
    expect(me.percentile).toBe(100);
    expect(topOf(body)[0]?.name).toBe(me.name);

    const token = cookieToken(response);
    expect(token).toMatch(/^[a-f0-9-]{36}$/i);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('generates the same display name for the same browser', async () => {
    const first = await POST(apiRequest('POST', { body: { weeklyXp: 10 } }));
    const token = cookieToken(first);

    const second = await GET(apiRequest('GET', { cookie: token }));

    expect(meOf(await payload(first)).name).toBe(meOf(await payload(second)).name);
  });

  it('accepts and persists a custom display name', async () => {
    const first = await POST(
      apiRequest('POST', { body: { weeklyXp: 50, name: 'Aryan <coder> Sharma' } }),
    );
    const body1 = await payload(first);
    expect(meOf(body1).name).toBe('Aryan coder Sharma');
    expect(topOf(body1)[0]?.name).toBe('Aryan coder Sharma');

    const token = cookieToken(first);
    const second = await GET(apiRequest('GET', { cookie: token }));
    const body2 = await payload(second);
    expect(meOf(body2).name).toBe('Aryan coder Sharma');
    expect(topOf(body2)[0]?.name).toBe('Aryan coder Sharma');
  });

  it('caps a single submission', async () => {
    const response = await POST(apiRequest('POST', { body: { weeklyXp: 5000 } }));

    expect(meOf(await payload(response)).xp).toBe(500);
  });

  it('caps the total submitted per day', async () => {
    let token = '';

    for (let index = 1; index <= 5; index += 1) {
      const response = await POST(
        apiRequest('POST', {
          body: { weeklyXp: index * 500 },
          cookie: token || undefined,
        }),
      );
      if (!token) token = cookieToken(response);
    }

    const response = await GET(apiRequest('GET', { cookie: token }));

    expect(meOf(await payload(response)).xp).toBe(2000);
  });

  it('ignores negative deltas after a local reset', async () => {
    const first = await POST(apiRequest('POST', { body: { weeklyXp: 300 } }));
    const token = cookieToken(first);

    const second = await POST(
      apiRequest('POST', { body: { weeklyXp: 100 }, cookie: token }),
    );

    expect(meOf(await payload(second)).xp).toBe(300);
  });

  it('returns the top 10 and the caller rank', async () => {
    let token = '';

    for (let index = 1; index <= 12; index += 1) {
      const response = await POST(apiRequest('POST', { body: { weeklyXp: index * 10 } }));
      if (index === 1) token = cookieToken(response);
    }

    const response = await GET(apiRequest('GET', { cookie: token }));
    const body = await payload(response);

    expect(topOf(body)).toHaveLength(10);
    expect(meOf(body).rank).toBe(12);
    expect(meOf(body).percentile).toBe(100);
  });

  it('removes the caller and clears the cookie', async () => {
    const first = await POST(apiRequest('POST', { body: { weeklyXp: 40 } }));
    const token = cookieToken(first);

    const response = await DELETE(apiRequest('DELETE', { cookie: token }));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(topOf(body)).toHaveLength(0);
    expect(body.me).toBeNull();
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(Array.from(redis.scores.values()).every((set) => !set.has(token))).toBe(true);
  });

  it('rejects cross-origin submissions', async () => {
    const response = await POST(
      apiRequest('POST', { body: { weeklyXp: 10 }, origin: 'https://evil.example' }),
    );

    expect(response.status).toBe(403);
  });

  it('returns 502 when Redis is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );

    const response = await GET(apiRequest('GET'));

    expect(response.status).toBe(502);
    expect((await payload(response)).configured).toBe(true);
  });

  it('stores achievements and practice history in a public profile', async () => {
    const first = await POST(
      apiRequest('POST', {
        body: {
          weeklyXp: 50,
          name: 'Aryan',
          profile: {
            badges: ['first-steps', 'century', 'not-a-badge'],
            subjects: [
              { subject: 'maths', lastPracticed: '2026-10-30T12:00:00.000Z', attempts: 4 },
              { subject: 'history', lastPracticed: '2026-10-31T12:00:00.000Z', attempts: 7 },
              { subject: 'not-a-subject', lastPracticed: '2026-10-31T12:00:00.000Z', attempts: 1 },
            ],
          },
        },
      }),
    );

    const me = meOf(await payload(first));
    const id = String(me.id);
    expect(id).toMatch(/^[a-f0-9]{16}$/);

    const response = await GET(apiRequest('GET', { path: `/api/leaderboard?profile=${id}` }));
    const body = await payload(response);
    const profile = body.profile as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(profile.id).toBe(id);
    expect(profile.name).toBe('Aryan');
    expect(profile.badges).toEqual(['first-steps', 'century']);
    expect(profile.subjects).toEqual([
      { subject: 'history', lastPracticed: '2026-10-31T12:00:00.000Z', attempts: 7 },
      { subject: 'maths', lastPracticed: '2026-10-30T12:00:00.000Z', attempts: 4 },
    ]);
    expect(typeof profile.lastOnline).toBe('string');
  });

  it('returns 400 or 404 for bad profile ids', async () => {
    const invalid = await GET(apiRequest('GET', { path: '/api/leaderboard?profile=bad' }));
    const missing = await GET(
      apiRequest('GET', { path: '/api/leaderboard?profile=0123456789abcdef' }),
    );

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it('falls back to the leaderboard entry when no profile is stored', async () => {
    const first = await POST(apiRequest('POST', { body: { weeklyXp: 75, name: 'Legacy Player' } }));
    const me = meOf(await payload(first));

    const response = await GET(apiRequest('GET', { path: `/api/leaderboard?profile=${me.id}` }));
    const body = await payload(response);
    const profile = body.profile as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(profile.id).toBe(me.id);
    expect(profile.name).toBe('Legacy Player');
    expect(profile.lastOnline).toBeNull();
    expect(profile.badges).toEqual([]);
    expect(profile.subjects).toEqual([]);
  });

  it('removes the public profile when leaving the leaderboard', async () => {
    const first = await POST(
      apiRequest('POST', {
        body: {
          weeklyXp: 40,
          profile: { badges: ['first-steps'], subjects: [] },
        },
      }),
    );
    const token = cookieToken(first);
    const id = String(meOf(await payload(first)).id);

    await DELETE(apiRequest('DELETE', { cookie: token }));
    const response = await GET(apiRequest('GET', { path: `/api/leaderboard?profile=${id}` }));

    expect(response.status).toBe(404);
  });

  it('uses ISO week keys across year boundaries', () => {
    expect(isoWeek(new Date('2025-12-29T12:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(new Date('2026-01-04T12:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(new Date('2026-01-05T12:00:00Z'))).toBe('2026-W02');
  });
});
