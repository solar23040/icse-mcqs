export const LEADERBOARD_STORAGE_KEY = 'icse:leaderboard:v1';

export interface LeaderboardEntry {
  /** Public profile id, safe to share in profile links. */
  id?: string;
  name: string;
  xp: number;
  rank: number;
}

export interface LeaderboardMe extends LeaderboardEntry {
  /** 1 means the top 1% of this week's board. */
  percentile: number;
}

export interface LeaderboardSnapshot {
  configured: true;
  week: string;
  top: LeaderboardEntry[];
  me: LeaderboardMe | null;
}

export interface LeaderboardState {
  v: 1;
  optedIn: boolean;
  week: string;
  weeklyXp: number;
  lastTotalXp: number;
}

/** ISO week in UTC, matching the API so the whole board shares one week. */
export function currentIsoWeek(date = new Date()): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);

  const year = target.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((target.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function defaultLeaderboardState(week = currentIsoWeek()): LeaderboardState {
  return { v: 1, optedIn: false, week, weeklyXp: 0, lastTotalXp: 0 };
}

function parseState(raw: string, fallbackWeek: string): LeaderboardState {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaultLeaderboardState(fallbackWeek);

    const record = parsed as Record<string, unknown>;
    if (record.v !== 1) return defaultLeaderboardState(fallbackWeek);

    return {
      v: 1,
      optedIn: record.optedIn === true,
      week:
        typeof record.week === 'string' && /^\d{4}-W\d{2}$/.test(record.week)
          ? record.week
          : fallbackWeek,
      weeklyXp: toCount(record.weeklyXp),
      lastTotalXp: toCount(record.lastTotalXp),
    };
  } catch {
    return defaultLeaderboardState(fallbackWeek);
  }
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

let memoryValue: string | null = null;
let removed = false;

function readRaw(): string | null {
  const storage = getStorage();

  if (storage) {
    try {
      const value = storage.getItem(LEADERBOARD_STORAGE_KEY);
      if (value !== null) {
        memoryValue = value;
        removed = false;
        return value;
      }
    } catch {
      // Fall through to the in-memory copy.
    }
  }

  if (removed) return null;
  return memoryValue;
}

function writeRaw(value: string): void {
  memoryValue = value;
  removed = false;

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(LEADERBOARD_STORAGE_KEY, value);
  } catch {
    // The memory copy above is the fallback.
  }
}

export function getLeaderboardState(now = new Date()): LeaderboardState {
  const week = currentIsoWeek(now);
  const raw = readRaw();
  return raw === null ? defaultLeaderboardState(week) : parseState(raw, week);
}

export function saveLeaderboardState(state: LeaderboardState): void {
  writeRaw(JSON.stringify(state));
}

export function setLeaderboardOptedIn(optedIn: boolean, now = new Date()): LeaderboardState {
  const state = { ...getLeaderboardState(now), optedIn };
  saveLeaderboardState(state);
  return state;
}

/**
 * Enables the board without submitting XP earned before joining. Rejoining in
 * the same week keeps the XP already submitted that week.
 */
export function startLeaderboard(
  state: LeaderboardState,
  totalXp: number,
  week = currentIsoWeek(),
): LeaderboardState {
  const total = toCount(totalXp);

  if (state.week !== week) {
    return { ...defaultLeaderboardState(week), optedIn: true, lastTotalXp: total };
  }

  return { ...state, optedIn: true, week, lastTotalXp: total };
}

/**
 * Adds the positive change in total XP to the current week's bucket. A week
 * rollover starts a fresh bucket; resets and imports (a lower total) never
 * subtract XP from the leaderboard.
 */
export function advanceWeeklyXp(
  state: LeaderboardState,
  totalXp: number,
  week = currentIsoWeek(),
): LeaderboardState {
  const total = toCount(totalXp);
  const current = toCount(state.weeklyXp);

  if (state.week !== week) {
    return { ...state, week, weeklyXp: 0, lastTotalXp: total };
  }

  return {
    ...state,
    week,
    weeklyXp: current + Math.max(0, total - toCount(state.lastTotalXp)),
    lastTotalXp: total,
  };
}
