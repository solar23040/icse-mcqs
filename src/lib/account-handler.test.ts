import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../../api/account';

type Command = (string | number)[];

function makeFetch(values: Map<string, string>): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body)) as Command[];
    const results = commands.map((command) => ({ result: execute(values, command) }));
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function execute(values: Map<string, string>, command: Command): unknown {
  const [name, ...args] = command;
  const key = String(args[0]);

  switch (String(name).toUpperCase()) {
    case 'GET':
      return values.get(key) ?? null;
    case 'SET': {
      const options = args.slice(2).map((option) => String(option).toUpperCase());
      if (options.includes('NX') && values.has(key)) return null;
      values.set(key, String(args[1]));
      return 'OK';
    }
    case 'DEL':
      return values.delete(key) ? 1 : 0;
    default:
      throw new Error(`Unexpected Redis command: ${String(name)}`);
  }
}

function apiRequest(action: string, body: Record<string, unknown> = {}, token?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);

  return new Request('https://icse.example/api/account', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...body }),
  });
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const SNAPSHOT = {
  v: 1,
  updatedAt: 1,
  game: { v: 1, xp: 40 },
  seen: { maths: ['m1'] },
  stats: { maths: { attempted: 1, correct: 1 } },
  wrong: {},
  wrongAt: {},
  username: 'Test',
};

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  vi.stubGlobal('fetch', makeFetch(values));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('account sync API', () => {
  it('reports whether sync storage is configured', async () => {
    const configured = await GET();
    expect((await payload(configured)).configured).toBe(true);

    vi.unstubAllEnvs();
    const missing = await GET();
    expect((await payload(missing)).configured).toBe(false);
  });

  it('registers, hashes the password, and returns the seed snapshot', async () => {
    const response = await POST(
      apiRequest('register', { username: 'Aryan_1', password: 'correct horse', data: SNAPSHOT }),
    );

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data).toEqual(SNAPSHOT);

    const stored = [...values.values()].join('\n');
    expect(stored).not.toContain('correct horse');
    expect(stored).toContain('"salt"');
    expect(stored).toContain('"hash"');
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    await POST(apiRequest('register', { username: 'Aryan', password: 'password1', data: SNAPSHOT }));
    const duplicate = await POST(
      apiRequest('register', { username: 'aryan', password: 'password2', data: SNAPSHOT }),
    );

    expect(duplicate.status).toBe(409);
    expect((await payload(duplicate)).error).toBe('username_taken');
  });

  it('logs in only with the right password and supports pull/push', async () => {
    await POST(apiRequest('register', { username: 'Aryan', password: 'password1', data: SNAPSHOT }));

    const wrong = await POST(apiRequest('login', { username: 'Aryan', password: 'wrong-pass' }));
    expect(wrong.status).toBe(401);
    expect((await payload(wrong)).error).toBe('invalid_credentials');

    const login = await POST(apiRequest('login', { username: 'aryan', password: 'password1' }));
    expect(login.status).toBe(200);
    const token = String((await payload(login)).token);

    const pulled = await POST(apiRequest('pull', {}, token));
    expect((await payload(pulled)).data).toEqual(SNAPSHOT);

    const updated = { ...SNAPSHOT, updatedAt: 2, username: 'Updated' };
    const pushed = await POST(apiRequest('push', { data: updated }, token));
    expect(pushed.status).toBe(200);
    expect((await payload(pushed)).rev).toBe(2);

    const afterPush = await POST(apiRequest('pull', {}, token));
    expect((await payload(afterPush)).data).toEqual(updated);

    const anonymous = await POST(apiRequest('pull'));
    expect(anonymous.status).toBe(401);
  });

  it('validates usernames, passwords and snapshots', async () => {
    for (const body of [
      { username: 'ab', password: 'password1', data: SNAPSHOT },
      { username: 'bad name', password: 'password1', data: SNAPSHOT },
      { username: 'valid_name', password: 'short', data: SNAPSHOT },
      { username: 'valid_name', password: 'password1' },
    ]) {
      const response = await POST(apiRequest('register', body));
      expect(response.status).toBe(400);
    }
  });

  it('logs a session out', async () => {
    const register = await POST(
      apiRequest('register', { username: 'Aryan', password: 'password1', data: SNAPSHOT }),
    );
    const token = String((await payload(register)).token);

    const logout = await POST(apiRequest('logout', {}, token));
    expect(logout.status).toBe(200);

    const pulled = await POST(apiRequest('pull', {}, token));
    expect(pulled.status).toBe(401);
  });
});
