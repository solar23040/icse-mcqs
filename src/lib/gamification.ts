import {
  COMBO_STEP,
  COMBO_TIER_1,
  COMBO_TIER_2,
  COMBO_TIER_3,
  DAILY_GOAL_OPTIONS,
  XP_CORRECT_BASE,
  XP_MASTERED_CAP,
  XP_MISSED_BONUS,
  XP_SESSION_COMPLETE,
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
  /** Optional: how many questions in the subject are still unseen after this session. */
  unseenRemaining?: number;
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

function comboMultiplier(combo: number): number {
  const safeCombo = Number.isFinite(combo) ? Math.max(1, Math.floor(combo)) : 1;
  if (safeCombo >= COMBO_STEP * 2) return COMBO_TIER_3;
  if (safeCombo >= COMBO_STEP) return COMBO_TIER_2;
  return COMBO_TIER_1;
}

export function answerXp(correct: boolean, combo?: number, missed?: boolean): number;
export function answerXp(input: {
  correct: boolean;
  combo?: number;
  missed?: boolean;
  wasMissed?: boolean;
}): number;
export function answerXp(
  correctOrInput:
    | boolean
    | { correct: boolean; combo?: number; missed?: boolean; wasMissed?: boolean },
  combo = 1,
  missed = false,
): number {
  const correct = typeof correctOrInput === 'boolean' ? correctOrInput : correctOrInput.correct;
  const input = typeof correctOrInput === 'boolean' ? null : correctOrInput;
  const comboValue = input?.combo ?? combo;
  const missedValue = input ? (input.missed ?? input.wasMissed ?? false) : missed;

  if (!correct) return 0;

  const base = Math.round(XP_CORRECT_BASE * comboMultiplier(comboValue));
  return base + (missedValue ? XP_MISSED_BONUS : 0);
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1) / 86_400_000;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    streak: { ...state.streak },
    daily: { ...state.daily },
    badges: { ...state.badges },
    boxes: { ...state.boxes },
    missed: { ...state.missed },
    counters: { ...state.counters },
  };
}

/**
 * Add today to the streak. Gaps of up to one missed day are free; longer gaps
 * spend one freeze per missed day, otherwise the streak restarts at 1.
 */
function addStreakDay(state: GameState, today: string): GameState {
  if (!isDay(today)) return state;

  const previous = state.streak;
  if (previous.lastDay !== '' && today < previous.lastDay) return state;
  if (previous.lastDay === today) return state;

  const next = cloneState(state);
  let count: number;
  let freezes = previous.freezes;

  if (previous.lastDay === '') {
    count = 1;
  } else {
    const gap = dayNumber(today) - dayNumber(previous.lastDay);
    if (gap <= 0) return state;

    if (gap <= 2) {
      // Next day, or a single missed day: keep the streak alive.
      count = Math.max(1, previous.count) + 1;
    } else {
      const missedDays = gap - 1;
      if (freezes >= missedDays) {
        freezes -= missedDays;
        count = Math.max(1, previous.count) + 1;
      } else {
        count = 1;
      }
    }
  }

  next.streak = {
    count,
    lastDay: today,
    freezes,
    best: Math.max(previous.best, count),
  };

  if (count > 0 && count % 7 === 0 && next.streak.freezes < 2) {
    next.streak.freezes += 1;
  }

  return next;
}

/** Count today if the daily goal has been met. Safe to call repeatedly. */
export function touchStreak(state: GameState, today: string): GameState {
  if (!isDay(today)) return state;
  if (state.daily.day !== today) return state;
  if (state.daily.answered < state.dailyGoal) return state;
  return addStreakDay(state, today);
}

function resetDailyIfNeeded(state: GameState, today: string): GameState {
  if (!isDay(today) || state.daily.day === today) return state;
  const next = cloneState(state);
  next.daily = { day: today, answered: 0 };
  return next;
}

export function applyAnswer(state: GameState, input: AnswerInput): GameResult {
  const { questionId, subject, correct, combo, today } = input;
  const events: GameEvent[] = [];

  let next = cloneState(resetDailyIfNeeded(state, today));
  next.daily = { day: today, answered: next.daily.answered + 1 };

  const wasMissed = next.missed[questionId] === true;
  const previousBox = next.boxes[questionId] ?? 0;
  let gained = answerXp(correct, combo, wasMissed);
  if (correct && previousBox === 3) gained = Math.min(gained, XP_MASTERED_CAP);

  let masteredNow = false;
  if (correct) {
    delete next.missed[questionId];
    const nextBox = Math.min(previousBox + 1, 3) as 0 | 1 | 2 | 3;
    next.boxes[questionId] = nextBox;
    masteredNow = nextBox === 3 && previousBox < 3;
  } else {
    next.missed[questionId] = true;
    next.boxes[questionId] = 0;
  }

  if (gained > 0) {
    const oldLevel = levelFromXp(next.xp);
    next.xp += gained;
    events.push({ type: 'xp', amount: gained });

    const newLevel = levelFromXp(next.xp);
    if (newLevel > oldLevel) events.push({ type: 'levelUp', level: newLevel });
  }

  if (masteredNow) events.push({ type: 'mastered', questionId });

  const beforeStreak = next.streak.count;
  next = touchStreak(next, today);
  if (next.streak.count > beforeStreak) {
    events.push({ type: 'streak', count: next.streak.count });
  }

  if (next.daily.answered === next.dailyGoal) {
    events.push({ type: 'goalReached' });
  }

  next.counters.answered = (next.counters.answered ?? 0) + 1;
  if (correct) next.counters.correct = (next.counters.correct ?? 0) + 1;
  next.counters[`subject:${subject}`] = (next.counters[`subject:${subject}`] ?? 0) + 1;
  if (masteredNow && wasMissed) {
    next.counters.comeback = (next.counters.comeback ?? 0) + 1;
  }

  awardBadges(next, today, events);
  return { state: next, events };
}

export function applySession(state: GameState, input: SessionInput): GameResult {
  const { subject, total, correct, today, unseenRemaining } = input;
  const events: GameEvent[] = [];

  let next = cloneState(resetDailyIfNeeded(state, today));

  if (total > 0) {
    const oldLevel = levelFromXp(next.xp);
    next.xp += XP_SESSION_COMPLETE;
    events.push({ type: 'xp', amount: XP_SESSION_COMPLETE });

    const newLevel = levelFromXp(next.xp);
    if (newLevel > oldLevel) events.push({ type: 'levelUp', level: newLevel });

    next.counters.sessions = (next.counters.sessions ?? 0) + 1;
    next.counters[`subject:${subject}`] = (next.counters[`subject:${subject}`] ?? 0) + 1;
    if (total >= 10 && correct === total) {
      next.counters.perfectSessions = (next.counters.perfectSessions ?? 0) + 1;
    }
    if (unseenRemaining === 0) {
      next.counters[`sweep:${subject}`] = 1;
    }

    const beforeStreak = next.streak.count;
    next = addStreakDay(next, today);
    if (next.streak.count > beforeStreak) {
      events.push({ type: 'streak', count: next.streak.count });
    }
  }

  awardBadges(next, today, events);
  return { state: next, events };
}

export type Rank = 'Beginner' | 'Learner' | 'Scholar' | 'Topper';

/** Percentage of a subject's questions sitting in Leitner box 3 (mastered). */
export function masteryPercent(
  subjectQuestions: readonly { id: string }[],
  boxes: Record<string, 0 | 1 | 2 | 3>,
): number {
  if (subjectQuestions.length === 0) return 0;
  const mastered = subjectQuestions.reduce(
    (count, question) => count + (boxes[question.id] === 3 ? 1 : 0),
    0,
  );
  return Math.round((mastered / subjectQuestions.length) * 100);
}

export function rankFor(percent: number): Rank {
  const safe = Number.isFinite(percent) ? percent : 0;
  if (safe < 25) return 'Beginner';
  if (safe < 50) return 'Learner';
  if (safe < 75) return 'Scholar';
  return 'Topper';
}

const LIVE_SUBJECTS = [
  'history',
  'economics',
  'geography',
  'maths',
  'english-lit',
  'physics',
  'chemistry',
  'physical-education',
];

function awardBadges(state: GameState, today: string, events: GameEvent[]): void {
  for (const id of evaluateBadges(state)) {
    state.badges[id] = today;
    events.push({ type: 'badge', id });
  }
}

export function evaluateBadges(state: GameState): string[] {
  const counters = state.counters ?? {};
  const earned: string[] = [];
  const add = (id: string, condition: boolean): void => {
    if (condition && !state.badges[id]) earned.push(id);
  };

  add('first-steps', (counters.answered ?? 0) >= 10);
  add('perfect-ten', (counters.perfectSessions ?? 0) >= 1);
  add('week-warrior', Math.max(state.streak.best, state.streak.count) >= 7);
  add(
    'subject-sweep',
    Object.keys(counters).some(
      (key) =>
        (key.startsWith('sweep:') && (counters[key] ?? 0) > 0) ||
        key === 'subject-sweep' ||
        key === 'subjectSweep',
    ),
  );
  add('comeback', (counters.comeback ?? 0) >= 5);
  add('all-rounder', LIVE_SUBJECTS.every((subject) => (counters[`subject:${subject}`] ?? 0) > 0));
  add('century', (counters.correct ?? 0) >= 100);

  return earned;
}
