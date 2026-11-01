import type { SessionQuestion } from '../../lib/types';

/** How many questions a practice session should try to use. */
export type SessionLength = 10 | 16 | 20 | 30 | 'all';

/** Seconds allowed per question in timed mode. */
export const SECONDS_PER_QUESTION = 30;

export interface MissedQuestion {
  question: SessionQuestion;
  /** null means the question timed out without an answer. */
  chosenIndex: number | null;
}

/** Formats a duration in seconds as m:ss, e.g. 95 -> "1:35". */
export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function scorePercent(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((correct / total) * 100);
}

/** Maps a 1-4 shortcut key to an option index. Returns null for anything else. */
export function optionIndexFromKey(key: string, optionCount: number): number | null {
  if (key.length !== 1) return null;
  const value = key.charCodeAt(0) - 48;
  if (value < 1 || value > optionCount) return null;
  return value - 1;
}

/** Keyboard shortcuts should not steal keys from editable controls. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
