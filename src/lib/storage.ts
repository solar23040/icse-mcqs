import { DAILY_GOAL_OPTIONS } from './config';
import { defaultGameState, type GameState } from './gamification';
import type { Subject } from './types';

interface Stats {
  attempted: number;
  correct: number;
}

/**
 * Mirrors every read/write so the app keeps working when localStorage is
 * missing (SSR, privacy mode) or throws. `removedKeys` marks values that were
 * deliberately reset, so stale memory data is not resurrected.
 */
const memory = new Map<string, string>();
const removedKeys = new Set<string>();

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  const storage = getStorage();

  if (storage) {
    try {
      const value = storage.getItem(key);
      if (value !== null) {
        memory.set(key, value);
        removedKeys.delete(key);
        return value;
      }
    } catch {
      // Fall through to the in-memory copy.
    }
  }

  if (removedKeys.has(key)) return null;
  return memory.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  memory.set(key, value);
  removedKeys.delete(key);

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(key, value);
  } catch {
    // The memory copy above is the fallback.
  }
}

function removeRaw(key: string): void {
  memory.delete(key);
  removedKeys.add(key);

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(key);
  } catch {
    // The memory tombstone above is the fallback.
  }
}

function seenKey(subject: Subject): string {
  return `mcq:${subject}:seen`;
}

function statsKey(subject: Subject): string {
  return `mcq:${subject}:stats`;
}

function wrongKey(subject: Subject): string {
  return `mcq:${subject}:wrong`;
}

function emptyStats(): Stats {
  return { attempted: 0, correct: 0 };
}

function parseSeen(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

function parseStats(raw: string): Stats {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyStats();

    const { attempted, correct } = parsed as { attempted?: unknown; correct?: unknown };
    return {
      attempted: toCount(attempted),
      correct: toCount(correct),
    };
  } catch {
    return emptyStats();
  }
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function getSeen(subject: Subject): string[] {
  const raw = readRaw(seenKey(subject));
  return raw === null ? [] : parseSeen(raw);
}

export function getWrong(subject: Subject): string[] {
  const raw = readRaw(wrongKey(subject));
  return raw === null ? [] : parseSeen(raw);
}

export function markSeen(subject: Subject, id: string): void {
  const seen = getSeen(subject);
  if (seen.includes(id)) return;

  seen.push(id);
  writeRaw(seenKey(subject), JSON.stringify(seen));
}

export function resetSeen(subject: Subject): void {
  removeRaw(seenKey(subject));
}

export function markWrong(subject: Subject, id: string): void {
  const wrong = getWrong(subject);
  if (wrong.includes(id)) return;

  wrong.push(id);
  writeRaw(wrongKey(subject), JSON.stringify(wrong));
}

export function unmarkWrong(subject: Subject, id: string): void {
  const wrong = getWrong(subject);
  if (!wrong.includes(id)) return;

  const remaining = wrong.filter((value) => value !== id);
  if (remaining.length === 0) {
    removeRaw(wrongKey(subject));
    return;
  }

  writeRaw(wrongKey(subject), JSON.stringify(remaining));
}

export function resetWrong(subject: Subject): void {
  removeRaw(wrongKey(subject));
}

export function getStats(subject: Subject): Stats {
  const raw = readRaw(statsKey(subject));
  return raw === null ? emptyStats() : parseStats(raw);
}

export function recordAnswer(subject: Subject, correct: boolean): void {
  const stats = getStats(subject);
  stats.attempted += 1;
  if (correct) stats.correct += 1;

  writeRaw(statsKey(subject), JSON.stringify(stats));
}

export function saveSeen(subject: Subject, ids: readonly string[]): void {
  writeRaw(seenKey(subject), JSON.stringify([...ids]));
}

export function saveStats(subject: Subject, stats: { attempted: number; correct: number }): void {
  writeRaw(
    statsKey(subject),
    JSON.stringify({ attempted: Math.max(0, stats.attempted), correct: Math.max(0, stats.correct) }),
  );
}

const GAME_KEY = 'icse:game:v1';

function toDay(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function parseGame(raw: string): GameState {
  const fallback = defaultGameState();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;

    const record = parsed as Record<string, unknown>;
    // Unknown versions are migrated to defaults rather than trusted.
    if (record.v !== 1) return fallback;

    const streakRaw =
      typeof record.streak === 'object' && record.streak !== null
        ? (record.streak as Record<string, unknown>)
        : {};
    const dailyRaw =
      typeof record.daily === 'object' && record.daily !== null
        ? (record.daily as Record<string, unknown>)
        : {};

    const dailyGoal = DAILY_GOAL_OPTIONS.includes(record.dailyGoal as never)
      ? (record.dailyGoal as GameState['dailyGoal'])
      : fallback.dailyGoal;

    const badges: Record<string, string> = {};
    if (typeof record.badges === 'object' && record.badges !== null) {
      for (const [key, value] of Object.entries(record.badges as Record<string, unknown>)) {
        if (typeof value === 'string') badges[key] = value;
      }
    }

    const boxes: GameState['boxes'] = {};
    if (typeof record.boxes === 'object' && record.boxes !== null) {
      for (const [key, value] of Object.entries(record.boxes as Record<string, unknown>)) {
        if (value === 0 || value === 1 || value === 2 || value === 3) boxes[key] = value;
      }
    }

    const missed: GameState['missed'] = {};
    if (typeof record.missed === 'object' && record.missed !== null) {
      for (const [key, value] of Object.entries(record.missed as Record<string, unknown>)) {
        if (value === true) missed[key] = true;
      }
    }

    const counters: Record<string, number> = {};
    if (typeof record.counters === 'object' && record.counters !== null) {
      for (const [key, value] of Object.entries(record.counters as Record<string, unknown>)) {
        counters[key] = toCount(value);
      }
    }

    return {
      v: 1,
      xp: toCount(record.xp),
      streak: {
        count: toCount(streakRaw.count),
        lastDay: toDay(streakRaw.lastDay),
        freezes: Math.min(2, toCount(streakRaw.freezes)),
        best: toCount(streakRaw.best),
      },
      dailyGoal,
      daily: {
        day: toDay(dailyRaw.day),
        answered: toCount(dailyRaw.answered),
      },
      badges,
      boxes,
      missed,
      counters,
    };
  } catch {
    return fallback;
  }
}

export function getGame(): GameState {
  const raw = readRaw(GAME_KEY);
  return raw === null ? defaultGameState() : parseGame(raw);
}

/** Persist game state. Callers own the pure state; this only writes it. */
export function saveGame(state: GameState): void {
  writeRaw(GAME_KEY, JSON.stringify(state));
}

/** Reset game progress only. Seen ids and stats are deliberately untouched. */
export function resetGame(): void {
  removeRaw(GAME_KEY);
}
/* Friendly aliases for callers that prefer the plural/question wording. */
export const getWrongIds = getWrong;
export const getWrongQuestions = getWrong;
export const addWrong = markWrong;
export const recordWrong = markWrong;
export const removeWrong = unmarkWrong;
export const resetWrongQuestions = resetWrong;
export const clearWrong = resetWrong;
