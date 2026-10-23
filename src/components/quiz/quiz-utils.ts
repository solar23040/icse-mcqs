import type { SessionQuestion } from '../../lib/types';

/** How many questions a practice session should try to use. */
export type SessionLength = 10 | 20 | 30 | 'all';

export interface MissedQuestion {
  question: SessionQuestion;
  chosenIndex: number;
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
