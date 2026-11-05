import { DAILY_GOAL_OPTIONS } from './config';
import { defaultGameState, levelFromXp, type GameState } from './gamification';
import {
  getGame,
  getSeen,
  getStats,
  getWrong,
  getWrongTimestamps,
  getUserDescription,
  getUserName,
  saveGame,
  saveSeen,
  saveStats,
  saveWrongState,
  setUserDescription,
  setUserName,
} from './storage';
import { SUBJECTS } from './subjects';
import type { Subject } from './types';

export const SYNC_DATA_VERSION = 1;

type SubjectStats = { attempted: number; correct: number };

/**
 * Everything that travels between devices. XP is deliberately merged by
 * maximum, never summed, so syncing the same account twice cannot inflate it.
 */
export interface SyncData {
  v: 1;
  updatedAt: number;
  game: GameState;
  seen: Partial<Record<Subject, string[]>>;
  stats: Partial<Record<Subject, SubjectStats>>;
  wrong: Partial<Record<Subject, string[]>>;
  /** When each wrong question entered the Wrong box (epoch ms). */
  wrongAt: Partial<Record<Subject, Record<string, number>>>;
  username: string | null;
  description: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function toDay(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

function normaliseGame(value: unknown): GameState {
  const fallback = defaultGameState();
  if (!isRecord(value) || value.v !== 1) return fallback;

  const streak = isRecord(value.streak) ? value.streak : {};
  const daily = isRecord(value.daily) ? value.daily : {};

  const badges: Record<string, string> = {};
  if (isRecord(value.badges)) {
    for (const [key, badge] of Object.entries(value.badges)) {
      if (typeof badge === 'string') badges[key] = badge;
    }
  }

  const boxes: GameState['boxes'] = {};
  if (isRecord(value.boxes)) {
    for (const [key, box] of Object.entries(value.boxes)) {
      if (box === 0 || box === 1 || box === 2 || box === 3) boxes[key] = box;
    }
  }

  const missed: GameState['missed'] = {};
  if (isRecord(value.missed)) {
    for (const [key, flag] of Object.entries(value.missed)) {
      if (flag === true) missed[key] = true;
    }
  }

  const counters: Record<string, number> = {};
  if (isRecord(value.counters)) {
    for (const [key, count] of Object.entries(value.counters)) {
      counters[key] = toCount(count);
    }
  }

  const xp = toCount(value.xp);
  const totalEarnedXP = Math.max(toCount(value.totalEarnedXP), xp);

  return {
    v: 1,
    xp,
    totalEarnedXP,
    highestLevelReached: Math.max(
      1,
      toCount(value.highestLevelReached),
      levelFromXp(totalEarnedXP),
      levelFromXp(xp),
    ),
    streak: {
      count: toCount(streak.count),
      lastDay: toDay(streak.lastDay),
      freezes: Math.min(2, toCount(streak.freezes)),
      best: toCount(streak.best),
    },
    dailyGoal: DAILY_GOAL_OPTIONS.includes(value.dailyGoal as never)
      ? (value.dailyGoal as GameState['dailyGoal'])
      : fallback.dailyGoal,
    daily: {
      day: toDay(daily.day),
      answered: toCount(daily.answered),
    },
    badges,
    boxes,
    missed,
    counters,
  };
}

function normaliseStats(value: unknown): SubjectStats {
  if (!isRecord(value)) return { attempted: 0, correct: 0 };
  const attempted = toCount(value.attempted);
  return { attempted, correct: Math.min(attempted, toCount(value.correct)) };
}

function normaliseTimestamps(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const timestamps: Record<string, number> = {};
  for (const [key, timestamp] of Object.entries(value)) {
    const clean = toCount(timestamp);
    if (clean > 0) timestamps[key] = clean;
  }
  return timestamps;
}

function normaliseSubjectMap<T>(
  value: unknown,
  parse: (entry: unknown) => T,
): Partial<Record<Subject, T>> {
  const map: Partial<Record<Subject, T>> = {};
  if (!isRecord(value)) return map;

  for (const { slug } of SUBJECTS) {
    if (slug in value) map[slug] = parse(value[slug]);
  }
  return map;
}

export function normaliseSyncData(value: unknown): SyncData | null {
  if (!isRecord(value) || value.v !== SYNC_DATA_VERSION) return null;
  if (!isRecord(value.game)) return null;

  return {
    v: 1,
    updatedAt: toCount(value.updatedAt),
    game: normaliseGame(value.game),
    seen: normaliseSubjectMap(value.seen, stringList),
    stats: normaliseSubjectMap(value.stats, normaliseStats),
    wrong: normaliseSubjectMap(value.wrong, stringList),
    wrongAt: normaliseSubjectMap(value.wrongAt, normaliseTimestamps),
    username:
      typeof value.username === 'string' && value.username.trim().length > 0
        ? value.username.trim().slice(0, 20)
        : null,
    description:
      typeof value.description === 'string' && value.description.trim().length > 0
        ? value.description.trim().slice(0, 250)
        : null,
  };
}

/** Reads the active account's full local state into a portable snapshot. */
export function captureSyncData(updatedAt = Date.now()): SyncData {
  const seen: SyncData['seen'] = {};
  const stats: SyncData['stats'] = {};
  const wrong: SyncData['wrong'] = {};
  const wrongAt: SyncData['wrongAt'] = {};

  for (const { slug } of SUBJECTS) {
    seen[slug] = getSeen(slug);
    stats[slug] = getStats(slug);
    wrong[slug] = getWrong(slug);
    wrongAt[slug] = getWrongTimestamps(slug);
  }

  return {
    v: 1,
    updatedAt,
    game: getGame(),
    seen,
    stats,
    wrong,
    wrongAt,
    username: getUserName(),
    description: getUserDescription(),
  };
}

/** Replaces the active account's local state with a validated snapshot. */
export function applySyncData(value: unknown): boolean {
  const data = normaliseSyncData(value);
  if (!data) return false;

  saveGame(data.game);

  for (const { slug } of SUBJECTS) {
    saveSeen(slug, data.seen[slug] ?? []);
    saveStats(slug, data.stats[slug] ?? { attempted: 0, correct: 0 });
    saveWrongState(slug, data.wrong[slug] ?? [], data.wrongAt[slug] ?? {});
  }

  if (data.username) setUserName(data.username);
  if (data.description) setUserDescription(data.description);
  return true;
}

function unionStrings(a: readonly string[] = [], b: readonly string[] = []): string[] {
  return [...new Set([...a, ...b])];
}

function laterDay(a: string, b: string): string {
  return a >= b ? a : b;
}

function maxBox(
  a: GameState['boxes'][string] | undefined,
  b: GameState['boxes'][string] | undefined,
): GameState['boxes'][string] {
  return (Math.max(a ?? 0, b ?? 0) || 0) as GameState['boxes'][string];
}

function mergeGame(a: GameState, b: GameState): GameState {
  const daily =
    a.daily.day === b.daily.day
      ? { day: a.daily.day, answered: Math.max(a.daily.answered, b.daily.answered) }
      : a.daily.day > b.daily.day
        ? { ...a.daily }
        : { ...b.daily };

  const badges: Record<string, string> = { ...b.badges, ...a.badges };
  const boxes: GameState['boxes'] = {};
  for (const key of new Set([...Object.keys(a.boxes), ...Object.keys(b.boxes)])) {
    boxes[key] = maxBox(a.boxes[key], b.boxes[key]);
  }

  const counters: Record<string, number> = {};
  for (const key of new Set([...Object.keys(a.counters), ...Object.keys(b.counters)])) {
    counters[key] = Math.max(a.counters[key] ?? 0, b.counters[key] ?? 0);
  }

  return {
    v: 1,
    xp: Math.max(a.xp, b.xp),
    totalEarnedXP: Math.max(a.totalEarnedXP, b.totalEarnedXP),
    highestLevelReached: Math.max(a.highestLevelReached, b.highestLevelReached),
    streak: {
      count: Math.max(a.streak.count, b.streak.count),
      lastDay: laterDay(a.streak.lastDay, b.streak.lastDay),
      freezes: Math.min(2, Math.max(a.streak.freezes, b.streak.freezes)),
      best: Math.max(a.streak.best, b.streak.best),
    },
    dailyGoal: a.totalEarnedXP >= b.totalEarnedXP ? a.dailyGoal : b.dailyGoal,
    daily,
    badges,
    boxes,
    missed: { ...b.missed, ...a.missed },
    counters,
  };
}

function mergeStats(a: SubjectStats | undefined, b: SubjectStats | undefined): SubjectStats {
  const attempted = Math.max(a?.attempted ?? 0, b?.attempted ?? 0);
  return {
    attempted,
    correct: Math.min(attempted, Math.max(a?.correct ?? 0, b?.correct ?? 0)),
  };
}

function mergeTimestamps(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> {
  const timestamps: Record<string, number> = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    timestamps[key] = Math.max(a?.[key] ?? 0, b?.[key] ?? 0);
  }
  return timestamps;
}

/**
 * Combines two snapshots without doubling progress. `local` wins ties such as
 * the display name; published answers and mistakes are unioned.
 */
export function mergeSyncData(local: SyncData, remote: SyncData, updatedAt = Date.now()): SyncData {
  const seen: SyncData['seen'] = {};
  const stats: SyncData['stats'] = {};
  const wrong: SyncData['wrong'] = {};
  const wrongAt: SyncData['wrongAt'] = {};

  for (const { slug } of SUBJECTS) {
    seen[slug] = unionStrings(local.seen[slug], remote.seen[slug]);
    stats[slug] = mergeStats(local.stats[slug], remote.stats[slug]);
    wrong[slug] = unionStrings(local.wrong[slug], remote.wrong[slug]);
    wrongAt[slug] = mergeTimestamps(local.wrongAt[slug], remote.wrongAt[slug]);
  }

  return {
    v: 1,
    updatedAt,
    game: mergeGame(local.game, remote.game),
    seen,
    stats,
    wrong,
    wrongAt,
    username: local.username ?? remote.username,
    description: local.description ?? remote.description,
  };
}
