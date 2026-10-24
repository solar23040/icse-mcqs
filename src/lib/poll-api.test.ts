import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPollResults, removePollVote, submitPollVote } from './poll-api';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('poll API client', () => {
  it('normalises totals and ignores unknown fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          configured: true,
          totals: { physics: 3, chemistry: '4', biology: -2, unknown: 99 },
          total: 999,
          myVote: 'physics',
        }),
      ) as unknown as typeof fetch,
    );

    const results = await loadPollResults();

    expect(results).not.toBeNull();
    expect(results?.totals.physics).toBe(3);
    expect(results?.totals.chemistry).toBe(0);
    expect(results?.totals.biology).toBe(0);
    expect(results?.total).toBe(3);
    expect(results?.myVote).toBe('physics');
  });

  it('rejects an invalid myVote value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ totals: { physics: 1 }, myVote: 'astrology' })) as unknown as typeof fetch,
    );

    const results = await loadPollResults();

    expect(results?.myVote).toBeNull();
  });

  it('returns null on HTTP errors and network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: 'storage_unavailable' }, 502)) as unknown as typeof fetch,
    );
    expect(await loadPollResults()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    );
    expect(await loadPollResults()).toBeNull();
  });

  it('posts a vote as JSON', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      response({ totals: { hindi: 1 }, myVote: 'hindi' }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const results = await submitPollVote('hindi');

    expect(results?.myVote).toBe('hindi');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/poll',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ option: 'hindi' }),
      }),
    );
  });

  it('sends DELETE when removing a vote', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      response({ totals: {}, myVote: null }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await removePollVote();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/poll',
      expect.objectContaining({ method: 'DELETE', body: undefined }),
    );
  });
});
