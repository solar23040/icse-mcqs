import type { LeaderboardEntry, LeaderboardMe, LeaderboardSnapshot } from './leaderboard';
import { getUserName } from './storage';

const ENDPOINT = '/api/leaderboard';
const TIMEOUT_MS = 5000;

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normaliseEntry(value: unknown, rank: number): LeaderboardEntry | null {
  if (typeof value !== 'object' || value === null) return null;

  const { name, xp } = value as { name?: unknown; xp?: unknown };
  if (typeof name !== 'string' || name.length === 0) return null;

  return { name, xp: toCount(xp), rank };
}

function normaliseMe(value: unknown): LeaderboardMe | null {
  if (typeof value !== 'object' || value === null) return null;

  const { name, xp, rank, percentile } = value as {
    name?: unknown;
    xp?: unknown;
    rank?: unknown;
    percentile?: unknown;
  };
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 1) return null;

  const safePercentile =
    typeof percentile === 'number' && Number.isFinite(percentile)
      ? Math.min(100, Math.max(1, Math.trunc(percentile)))
      : 100;

  return {
    name,
    xp: toCount(xp),
    rank: Math.trunc(rank),
    percentile: safePercentile,
  };
}

export function normaliseLeaderboard(value: unknown): LeaderboardSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  if (record.configured !== true) return null;
  if (typeof record.week !== 'string' || !/^\d{4}-W\d{2}$/.test(record.week)) return null;

  const top: LeaderboardEntry[] = [];
  if (Array.isArray(record.top)) {
    for (const item of record.top) {
      const entry = normaliseEntry(item, top.length + 1);
      if (entry) top.push(entry);
    }
  }

  return {
    configured: true,
    week: record.week,
    top,
    me: normaliseMe(record.me),
  };
}

async function request(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<LeaderboardSnapshot | null> {
  try {
    const response = await fetch(ENDPOINT, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return normaliseLeaderboard(payload);
  } catch {
    return null;
  }
}

export function loadLeaderboard(): Promise<LeaderboardSnapshot | null> {
  return request('GET');
}

export function submitWeeklyXp(weeklyXp: number): Promise<LeaderboardSnapshot | null> {
  const safeXp = Number.isFinite(weeklyXp) ? Math.max(0, Math.trunc(weeklyXp)) : 0;
  const name = getUserName();
  return request('POST', { weeklyXp: safeXp, ...(name ? { name } : {}) });
}

export function leaveLeaderboard(): Promise<LeaderboardSnapshot | null> {
  return request('DELETE');
}
