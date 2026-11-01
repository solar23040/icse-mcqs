import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  leaveLeaderboard,
  loadLeaderboard,
  loadProfile,
  normaliseLeaderboard,
  normaliseProfile,
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
        body: JSON.stringify({ weeklyXp: 42, profile: { badges: [], subjects: [] } }),
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

describe('profile API client', () => {
  it('normalises a valid public profile and sorts recent subjects', () => {
    const profile = normaliseProfile({
      configured: true,
      profile: {
        id: '0123456789abcdef',
        name: 'Brave Owl 42',
        lastOnline: '2026-10-31T12:00:00.000Z',
        badges: ['first-steps', 'century', 'first-steps', 7],
        subjects: [
          { subject: 'maths', lastPracticed: '2026-10-30T12:00:00.000Z', attempts: 5 },
          { subject: 'history', lastPracticed: '2026-10-31T12:00:00.000Z', attempts: 12.9 },
          { subject: 'geography', lastPracticed: 'not a date', attempts: 3 },
        ],
      },
    });

    expect(profile).not.toBeNull();
    expect(profile?.badges).toEqual(['first-steps', 'century']);
    expect(profile?.subjects).toEqual([
      { subject: 'history', lastPracticed: '2026-10-31T12:00:00.000Z', attempts: 12 },
      { subject: 'maths', lastPracticed: '2026-10-30T12:00:00.000Z', attempts: 5 },
    ]);
  });

  it('rejects malformed profiles', () => {
    expect(normaliseProfile({ configured: false })).toBeNull();
    expect(
      normaliseProfile({
        configured: true,
        profile: {
          id: 'not-a-profile',
          name: 'Brave Owl 42',
          lastOnline: '2026-10-31T12:00:00.000Z',
          badges: [],
          subjects: [],
        },
      }),
    ).toBeNull();
  });

  it('loads a profile by public id', async () => {
    const fetchMock = vi.fn(async () =>
      response({
        configured: true,
        profile: {
          id: '0123456789abcdef',
          name: 'Brave Owl 42',
          lastOnline: '2026-10-31T12:00:00.000Z',
          badges: ['first-steps'],
          subjects: [],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const profile = await loadProfile('0123456789abcdef');

    expect(profile?.name).toBe('Brave Owl 42');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leaderboard?profile=0123456789abcdef',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(await loadProfile('bad id')).toBeNull();
  });
});
