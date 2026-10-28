import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST, POLL_OPTION_IDS } from '../../api/poll';
import { POLL_OPTIONS } from './poll';

type Command = (string | number)[];

interface FakeRedis {
  hash: Map<string, number>;
  votes: Map<string, string>;
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

function execute(redis: FakeRedis, command: Command): unknown {
  const [name, ...args] = command;

  switch (String(name).toUpperCase()) {
    case 'HGETALL':
      return Array.from(redis.hash.entries()).flatMap(([field, count]) => [
        field,
        String(count),
      ]);
    case 'HINCRBY': {
      const field = String(args[1]);
      const increment = Number(args[2]);
      const next = (redis.hash.get(field) ?? 0) + increment;
      redis.hash.set(field, next);
      return next;
    }
    case 'GET':
      return redis.votes.get(String(args[0])) ?? null;
    case 'SET':
      redis.votes.set(String(args[0]), String(args[1]));
      return 'OK';
    case 'DEL':
      return redis.votes.delete(String(args[0])) ? 1 : 0;
    default:
      throw new Error(`Unexpected Redis command: ${String(name)}`);
  }
}

function apiRequest(
  method: string,
  options: { body?: unknown; cookie?: string; origin?: string } = {},
): Request {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', `icse_poll_voter=${options.cookie}`);
  if (options.origin) headers.set('origin', options.origin);

  return new Request('https://icse.example/api/poll', {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function cookieToken(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return /icse_poll_voter=([^;]+)/.exec(header)?.[1] ?? '';
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

let redis: FakeRedis;

beforeEach(() => {
  redis = { hash: new Map(), votes: new Map() };
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  vi.stubGlobal('fetch', makeFetch(redis));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('poll API', () => {
  it('keeps the API option ids in sync with the poll UI', () => {
    expect([...POLL_OPTION_IDS]).toEqual(POLL_OPTIONS.map((option) => option.id));
  });

  it('returns empty totals for a first-time visitor', async () => {
    const response = await GET(apiRequest('GET'));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.total).toBe(0);
    expect(body.myVote).toBeNull();
    expect((body.totals as Record<string, number>).biology).toBe(0);
  });

  it('counts a new vote and sets an anonymous cookie', async () => {
    const response = await POST(apiRequest('POST', { body: { option: 'biology' } }));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.total).toBe(1);
    expect(body.myVote).toBe('biology');
    expect((body.totals as Record<string, number>).biology).toBe(1);

    const token = cookieToken(response);
    expect(token).toMatch(/^[a-f0-9-]{36}$/i);
    expect(redis.votes.get(`poll:vote:${token}`)).toBe('biology');
  });

  it('moves a vote when the same browser changes its choice', async () => {
    const first = await POST(apiRequest('POST', { body: { option: 'biology' } }));
    const token = cookieToken(first);

    const second = await POST(
      apiRequest('POST', { body: { option: 'hindi' }, cookie: token }),
    );
    const body = await payload(second);

    expect(body.total).toBe(1);
    expect(body.myVote).toBe('hindi');
    expect((body.totals as Record<string, number>).biology).toBe(0);
    expect((body.totals as Record<string, number>).hindi).toBe(1);
  });

  it('keeps the same vote if it is submitted again', async () => {
    const first = await POST(apiRequest('POST', { body: { option: 'biology' } }));
    const token = cookieToken(first);

    const second = await POST(apiRequest('POST', { body: { option: 'biology' }, cookie: token }));
    const body = await payload(second);

    expect(body.total).toBe(1);
    expect((body.totals as Record<string, number>).biology).toBe(1);
  });

  it('returns the vote for the current browser cookie', async () => {
    const first = await POST(apiRequest('POST', { body: { option: 'hindi' } }));
    const token = cookieToken(first);

    const response = await GET(apiRequest('GET', { cookie: token }));
    const body = await payload(response);

    expect(body.myVote).toBe('hindi');
    expect(body.total).toBe(1);
  });

  it('removes a vote and clears the cookie', async () => {
    const first = await POST(apiRequest('POST', { body: { option: 'hindi' } }));
    const token = cookieToken(first);

    const response = await DELETE(apiRequest('DELETE', { cookie: token }));
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.myVote).toBeNull();
    expect(redis.votes.has(`poll:vote:${token}`)).toBe(false);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('counts separate browsers separately', async () => {
    await POST(apiRequest('POST', { body: { option: 'mass-media' } }));
    const second = await POST(apiRequest('POST', { body: { option: 'english-language' } }));
    const body = await payload(second);

    expect(body.total).toBe(2);
    expect((body.totals as Record<string, number>)['mass-media']).toBe(1);
    expect((body.totals as Record<string, number>)['english-language']).toBe(1);
  });

  it('rejects invalid options and malformed JSON', async () => {
    const invalidOption = await POST(apiRequest('POST', { body: { option: 'astrology' } }));
    expect(invalidOption.status).toBe(400);

    const malformed = await POST(
      new Request('https://icse.example/api/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(malformed.status).toBe(400);
  });

  it('rejects cross-origin votes', async () => {
    const response = await POST(
      apiRequest('POST', { body: { option: 'biology' }, origin: 'https://evil.example' }),
    );

    expect(response.status).toBe(403);
    expect(redis.hash.size).toBe(0);
  });

  it('reports when storage is not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');

    const response = await GET(apiRequest('GET'));

    expect(response.status).toBe(503);
    expect((await payload(response)).configured).toBe(false);
  });

  it('returns a graceful error when Redis fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    );

    const response = await GET(apiRequest('GET'));

    expect(response.status).toBe(502);
    expect((await payload(response)).error).toBe('storage_unavailable');
  });
});
