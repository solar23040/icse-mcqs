import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  leaveLeaderboard,
  loadLeaderboard,
  normaliseLeaderboard,
  submitWeeklyXp,
} from './leaderboard-api';

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

describe('leaderboard API client', () => {
  it('normalises valid payloads and drops malformed entries', () => {
    const snapshot = normaliseLeaderboard({
      configured: true,
      week: '2026-W01',
      top: [
        { name: 'Brave Owl 1', xp: 50, rank: 1 },
        { name: '', xp: 10, rank: 2 },
        { xp: 5 },
      ],
      me: { name: 'Calm Fox 2', xp: 40, rank: 2, percentile: 250 },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.top).toEqual([{ name: 'Brave Owl 1', xp: 50, rank: 1 }]);
    expect(snapshot?.me).toEqual({
      name: 'Calm Fox 2',
      xp: 40,
      rank: 2,
      percentile: 100,
    });
  });

  it('rejects unconfigured or malformed payloads', () => {
    expect(normaliseLeaderboard({ configured: false })).toBeNull();
    expect(normaliseLeaderboard({ configured: true, week: 'week 1', top: [] })).toBeNull();
    expect(normaliseLeaderboard(null)).toBeNull();
    expect(
      normaliseLeaderboard({
        configured: true,
        week: '2026-W01',
        top: [],
        me: { name: 'Brave Owl 1', xp: 10, rank: 0, percentile: 10 },
      })?.me,
    ).toBeNull();
  });

  it('submits weekly XP as JSON', async () => {
    const fetchMock = vi.fn(async () =>
      response({ configured: true, week: '2026-W01', top: [], me: null }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const snapshot = await submitWeeklyXp(42.9);

    expect(snapshot?.week).toBe('2026-W01');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leaderboard',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ weeklyXp: 42 }),
        credentials: 'same-origin',
      }),
    );
  });

  it('loads and leaves through the right methods', async () => {
    const fetchMock = vi.fn(async () =>
      response({ configured: true, week: '2026-W01', top: [], me: null }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await loadLeaderboard();
    await leaveLeaderboard();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/leaderboard',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/leaderboard',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('returns null on HTTP errors and network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: 'storage_unavailable' }, 502)) as unknown as typeof fetch,
    );
    expect(await loadLeaderboard()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );
    expect(await loadLeaderboard()).toBeNull();
  });
});
