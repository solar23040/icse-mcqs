import { BADGES } from './badges';
import {
  advanceWeeklyXp,
  currentIsoWeek,
  getLeaderboardState,
  saveLeaderboardState,
  type LeaderboardEntry,
  type LeaderboardMe,
  type LeaderboardSnapshot,
} from './leaderboard';
import { getRecentSubjects } from './activity';
import { getGame, getStats, getUserName } from './storage';

const ENDPOINT = '/api/leaderboard';
const TIMEOUT_MS = 5000;
const PROFILE_ID_PATTERN = /^[a-f0-9]{16}$/;

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

export interface ProfileSubmission {
  badges: string[];
  subjects: ProfileSubject[];
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function normaliseEntry(value: unknown, rank: number): LeaderboardEntry | null {
  if (typeof value !== 'object' || value === null) return null;

  const { id, name, xp } = value as { id?: unknown; name?: unknown; xp?: unknown };
  if (typeof name !== 'string' || name.length === 0) return null;

  return {
    ...(typeof id === 'string' && PROFILE_ID_PATTERN.test(id) ? { id } : {}),
    name,
    xp: toCount(xp),
    rank,
  };
}

function normaliseMe(value: unknown): LeaderboardMe | null {
  if (typeof value !== 'object' || value === null) return null;

  const { id, name, xp, rank, percentile } = value as {
    id?: unknown;
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
    ...(typeof id === 'string' && PROFILE_ID_PATTERN.test(id) ? { id } : {}),
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

export function normaliseProfile(value: unknown): PublicProfile | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  if (record.configured !== true) return null;
  if (typeof record.profile !== 'object' || record.profile === null) return null;

  const profile = record.profile as Record<string, unknown>;
  const { id, name, lastOnline, badges, subjects } = profile;
  if (typeof id !== 'string' || !PROFILE_ID_PATTERN.test(id)) return null;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (!isTimestamp(lastOnline)) return null;

  const safeBadges = Array.isArray(badges)
    ? [...new Set(badges.filter((badge): badge is string => typeof badge === 'string'))]
    : [];

  const safeSubjects: ProfileSubject[] = [];
  if (Array.isArray(subjects)) {
    for (const item of subjects) {
      if (typeof item !== 'object' || item === null) continue;
      const { subject, lastPracticed, attempts } = item as {
        subject?: unknown;
        lastPracticed?: unknown;
        attempts?: unknown;
      };
      if (typeof subject !== 'string' || subject.length === 0) continue;
      if (!isTimestamp(lastPracticed)) continue;
      safeSubjects.push({
        subject,
        lastPracticed,
        attempts: toCount(attempts),
      });
    }
  }

  safeSubjects.sort(
    (left, right) => Date.parse(right.lastPracticed) - Date.parse(left.lastPracticed),
  );

  return {
    id,
    name,
    lastOnline,
    badges: safeBadges,
    subjects: safeSubjects,
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

/** Public profile fields submitted alongside weekly XP. */
export function buildProfileSubmission(): ProfileSubmission {
  const game = getGame();
  const badges = BADGES.filter((badge) => Boolean(game.badges[badge.id])).map(
    (badge) => badge.id,
  );
  const subjects = getRecentSubjects().map(({ subject, lastPracticed }) => ({
    subject,
    lastPracticed,
    attempts: getStats(subject).attempted,
  }));

  return { badges, subjects };
}

export function submitWeeklyXp(
  weeklyXp: number,
  profile: ProfileSubmission = buildProfileSubmission(),
): Promise<LeaderboardSnapshot | null> {
  const safeXp = Number.isFinite(weeklyXp) ? Math.max(0, Math.trunc(weeklyXp)) : 0;
  const name = getUserName();
  return request('POST', { weeklyXp: safeXp, ...(name ? { name } : {}), profile });
}

/**
 * Push the current XP, achievements and practice history to the server. Does
 * nothing unless the visitor has opted in to the weekly leaderboard.
 */
export function syncLeaderboard(now = new Date()): Promise<LeaderboardSnapshot | null> {
  const state = getLeaderboardState(now);
  if (!state.optedIn) return Promise.resolve(null);

  const advanced = advanceWeeklyXp(state, getGame().xp, currentIsoWeek(now));
  saveLeaderboardState(advanced);

  return submitWeeklyXp(advanced.weeklyXp, buildProfileSubmission());
}

export function leaveLeaderboard(): Promise<LeaderboardSnapshot | null> {
  return request('DELETE');
}

export async function loadProfile(id: string): Promise<PublicProfile | null> {
  if (!PROFILE_ID_PATTERN.test(id)) return null;

  try {
    const response = await fetch(`${ENDPOINT}?profile=${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return normaliseProfile(payload);
  } catch {
    return null;
  }
}
