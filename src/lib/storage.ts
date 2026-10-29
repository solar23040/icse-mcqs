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

/* Friendly aliases for callers that prefer the plural/question wording. */
export const getWrongIds = getWrong;
export const getWrongQuestions = getWrong;
export const addWrong = markWrong;
export const recordWrong = markWrong;
export const removeWrong = unmarkWrong;
export const resetWrongQuestions = resetWrong;
export const clearWrong = resetWrong;
