import {
  DAILY_GOAL_OPTIONS,
  XP_CORRECT_BASE,
  type DailyGoal,
} from './config';

export type { DailyGoal };

export interface GameState {
  v: 1;
  xp: number;
  streak: {
    count: number;
    lastDay: string;
    freezes: number;
    best: number;
  };
  dailyGoal: DailyGoal;
  daily: {
    day: string;
    answered: number;
  };
  badges: Record<string, string>;
  boxes: Record<string, 0 | 1 | 2 | 3>;
  missed: Record<string, true>;
  counters: Record<string, number>;
}

export type GameEvent =
  | { type: 'xp'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'badge'; id: string }
  | { type: 'streak'; count: number }
  | { type: 'goalReached' }
  | { type: 'mastered'; questionId: string };

export interface AnswerInput {
  questionId: string;
  subject: string;
  correct: boolean;
  /** Consecutive correct answers including this one. */
  combo: number;
  /** Local day as YYYY-MM-DD. */
  today: string;
}

export interface SessionInput {
  subject: string;
  total: number;
  correct: number;
  /** Local day as YYYY-MM-DD. */
  today: string;
}

export interface GameResult {
  state: GameState;
  events: GameEvent[];
}

export function defaultGameState(): GameState {
  return {
    v: 1,
    xp: 0,
    streak: { count: 0, lastDay: '', freezes: 0, best: 0 },
    dailyGoal: DAILY_GOAL_OPTIONS[0],
    daily: { day: '', answered: 0 },
    badges: {},
    boxes: {},
    missed: {},
    counters: {},
  };
}

export function levelFromXp(xp: number): number {
  const safeXp = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  return Math.floor(Math.sqrt(safeXp / 50)) + 1;
}

export function xpForLevel(level: number): number {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  return 50 * (safeLevel - 1) ** 2;
}

export function answerXp(_correct: boolean, _combo: number, _missed: boolean): number {
  return XP_CORRECT_BASE;
}

export function touchStreak(state: GameState, _today: string): GameState {
  return state;
}

export function applyAnswer(_state: GameState, _input: AnswerInput): GameResult {
  throw new Error('not implemented');
}

export function applySession(_state: GameState, _input: SessionInput): GameResult {
  throw new Error('not implemented');
}

export function evaluateBadges(_state: GameState): string[] {
  return [];
}
