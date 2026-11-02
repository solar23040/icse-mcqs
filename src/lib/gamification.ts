import {
  COMBO_STEP,
  COMBO_TIER_1,
  COMBO_TIER_2,
  COMBO_TIER_3,
  DAILY_GOAL_OPTIONS,
  HINT_COST_XP,
  HINT_SECOND_EXTRA_XP,
  XP_CORRECT_BASE,
  XP_MASTERED_CAP,
  XP_MISSED_BONUS,
  XP_SESSION_COMPLETE,
  type DailyGoal,
} from './config';

export type { DailyGoal };

export interface GameState {
  v: 1;
  /** Spendable XP. Hints reduce this, never below zero. */
  xp: number;
  /** Lifetime XP earned. Rankings use this so spending never lowers a rank. */
  totalEarnedXP: number;
  /** Highest level ever reached. Spending XP never lowers the level. */
  highestLevelReached: number;
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
  /** Optional local hour (0-23) for time-of-day badges. */
  hour?: number;
}

export interface SessionInput {
  subject: string;
  total: number;
  correct: number;
  /** Local day as YYYY-MM-DD. */
  today: string;
  /** Optional: how many questions in the subject are still unseen after this session. */
  unseenRemaining?: number;
  /** Optional: longest run of correct answers inside this session. */
  bestStreak?: number;
  /** Optional: timed sprint score. */
  score?: number;
}

export interface GameResult {
  state: GameState;
  events: GameEvent[];
}

export function defaultGameState(): GameState {
  return {
    v: 1,
    xp: 0,
    totalEarnedXP: 0,
    highestLevelReached: 1,
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

/** Current level. It is monotonic: spending XP never lowers it. */
export function levelForGame(state: GameState): number {
  const stored = Number.isFinite(state.highestLevelReached)
    ? Math.max(1, Math.trunc(state.highestLevelReached))
    : 1;
  return Math.max(stored, levelFromXp(state.totalEarnedXP), levelFromXp(state.xp));
}

function grantXp(state: GameState, amount: number, events: GameEvent[]): void {
  const gained = Math.max(0, Math.trunc(amount));
  if (gained === 0) return;

  const previousLevel = levelForGame(state);
  const earnedBefore = Math.max(
    Number.isFinite(state.totalEarnedXP) ? state.totalEarnedXP : 0,
    Number.isFinite(state.xp) ? state.xp : 0,
  );

  state.xp += gained;
  state.totalEarnedXP = earnedBefore + gained;
  state.highestLevelReached = Math.max(
    previousLevel,
    levelFromXp(state.totalEarnedXP),
    levelFromXp(state.xp),
  );
  events.push({ type: 'xp', amount: gained });

  if (state.highestLevelReached > previousLevel) {
    events.push({ type: 'levelUp', level: state.highestLevelReached });
  }
}

/** Spend XP on a hint. Returns no events when the balance is already empty. */
export function spendXp(state: GameState, amount: number): GameResult {
  const cost = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
  const available = Number.isFinite(state.xp) ? Math.max(0, Math.trunc(state.xp)) : 0;
  const spent = Math.min(cost, available);
  if (spent === 0) return { state, events: [] };

  const next = cloneState(state);
  next.xp = available - spent;
  next.highestLevelReached = levelForGame(state);
  return { state: next, events: [{ type: 'xp', amount: -spent }] };
}

export interface HintQuote {
  /** XP this hint will cost, or the whole balance for the third hint of a day. */
  cost: number;
  /** Hints already used on this local day. */
  usedToday: number;
  /** True from the third hint of the day: the balance is spent down to zero. */
  allCredits: boolean;
}

export interface HintPurchase extends GameResult, HintQuote {
  purchased: boolean;
}

function availableXp(state: GameState): number {
  return Number.isFinite(state.xp) ? Math.max(0, Math.trunc(state.xp)) : 0;
}

function hintCounterKey(today: string): string {
  return `hints:${today}`;
}

/** Number of hints already used on the given local day. */
export function hintsUsedToday(state: GameState, today: string): number {
  if (!isDay(today)) return 0;
  return Math.max(0, Math.trunc(state.counters[hintCounterKey(today)] ?? 0));
}

/**
 * Price the next hint: 500 XP for the first, 750 XP for the second, then the
 * whole balance for every later hint on the same day.
 */
export function hintCost(state: GameState, today: string): HintQuote {
  const usedToday = hintsUsedToday(state, today);
  if (usedToday >= 2) {
    return { cost: availableXp(state), usedToday, allCredits: true };
  }

  const cost = usedToday === 0 ? HINT_COST_XP : HINT_COST_XP + HINT_SECOND_EXTRA_XP;
  return { cost, usedToday, allCredits: false };
}

/** Buy one hint and record it against today's count. */
export function spendHint(state: GameState, today: string): HintPurchase {
  const quote = hintCost(state, today);
  const available = availableXp(state);

  if (available < quote.cost) {
    return { state, events: [], ...quote, purchased: false };
  }

  const next = cloneState(state);
  next.xp = available - quote.cost;
  next.highestLevelReached = levelForGame(state);
  if (isDay(today)) {
    next.counters[hintCounterKey(today)] = quote.usedToday + 1;
  }

  const events: GameEvent[] = quote.cost > 0 ? [{ type: 'xp', amount: -quote.cost }] : [];
  return {
    state: next,
    events,
    cost: quote.cost,
    usedToday: quote.usedToday + 1,
    allCredits: quote.allCredits,
    purchased: true,
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
  const { questionId, subject, correct, combo, today, hour } = input;
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
    grantXp(next, gained, events);
  }

  if (masteredNow) events.push({ type: 'mastered', questionId });

  const beforeStreak = next.streak.count;
  next = touchStreak(next, today);
  if (next.streak.count > beforeStreak) {
    events.push({ type: 'streak', count: next.streak.count });
  }

  if (next.daily.answered === next.dailyGoal) {
    next.counters.goalDays = (next.counters.goalDays ?? 0) + 1;
    events.push({ type: 'goalReached' });
  }

  next.counters.answered = (next.counters.answered ?? 0) + 1;
  if (correct) next.counters.correct = (next.counters.correct ?? 0) + 1;
  next.counters[`subject:${subject}`] = (next.counters[`subject:${subject}`] ?? 0) + 1;
  if (masteredNow && wasMissed) {
    next.counters.comeback = (next.counters.comeback ?? 0) + 1;
  }
  if (masteredNow) {
    next.counters.mastered = (next.counters.mastered ?? 0) + 1;
    next.counters[`mastered:${subject}`] = (next.counters[`mastered:${subject}`] ?? 0) + 1;
  }
  if (typeof hour === 'number' && Number.isFinite(hour)) {
    if (hour >= 22 || hour < 5) next.counters.nightOwl = 1;
    else if (hour < 7) next.counters.earlyBird = 1;
  }

  awardBadges(next, today, events);
  return { state: next, events };
}

export function applySession(state: GameState, input: SessionInput): GameResult {
  const { subject, total, correct, today, unseenRemaining, bestStreak, score } = input;
  const events: GameEvent[] = [];

  let next = cloneState(resetDailyIfNeeded(state, today));

  if (total > 0) {
    grantXp(next, XP_SESSION_COMPLETE, events);

    next.counters.sessions = (next.counters.sessions ?? 0) + 1;
    next.counters[`subject:${subject}`] = (next.counters[`subject:${subject}`] ?? 0) + 1;
    if (total >= 10 && correct === total) {
      next.counters.perfectSessions = (next.counters.perfectSessions ?? 0) + 1;
    }
    if (total >= 20 && correct === total) {
      next.counters.perfectTwenty = (next.counters.perfectTwenty ?? 0) + 1;
    }
    if (typeof bestStreak === 'number' && Number.isFinite(bestStreak)) {
      next.counters.bestSessionStreak = Math.max(
        next.counters.bestSessionStreak ?? 0,
        Math.floor(bestStreak),
      );
    }
    if (typeof score === 'number' && Number.isFinite(score)) {
      next.counters.bestSprint = Math.max(next.counters.bestSprint ?? 0, Math.floor(score));
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
  const sweptSubjects = Object.keys(counters).filter(
    (key) => key.startsWith('sweep:') && (counters[key] ?? 0) > 0,
  ).length;

  add('first-steps', (counters.answered ?? 0) >= 10);
  add('perfect-ten', (counters.perfectSessions ?? 0) >= 1);
  add('week-warrior', Math.max(state.streak.best, state.streak.count) >= 7);
  add(
    'subject-sweep',
    sweptSubjects > 0 ||
      (counters['subject-sweep'] ?? 0) > 0 ||
      (counters.subjectSweep ?? 0) > 0,
  );
  add('comeback', (counters.comeback ?? 0) >= 5);
  add('all-rounder', LIVE_SUBJECTS.every((subject) => (counters[`subject:${subject}`] ?? 0) > 0));
  add('century', (counters.correct ?? 0) >= 100);

  add('dedicated', (counters.sessions ?? 0) >= 25);
  add('marathon', (counters.sessions ?? 0) >= 50);
  add('sharpshooter', (counters.bestSessionStreak ?? 0) >= 15);
  add('flawless-twenty', (counters.perfectTwenty ?? 0) >= 1);
  add('mastermind', (counters.mastered ?? 0) >= 50);
  add(
    'specialist',
    Object.keys(counters).some(
      (key) => key.startsWith('mastered:') && (counters[key] ?? 0) >= 25,
    ),
  );
  add('comeback-king', (counters.comeback ?? 0) >= 25);
  add('grand-slam', sweptSubjects >= 3);
  add('fortnight', Math.max(state.streak.best, state.streak.count) >= 14);
  add('daily-devotee', (counters.dailyChallenges ?? 0) >= 7);
  add('speed-demon', (counters.bestSprint ?? 0) >= 150);
  add('goal-getter', (counters.goalDays ?? 0) >= 7);
  add('night-owl', (counters.nightOwl ?? 0) > 0);
  add('early-bird', (counters.earlyBird ?? 0) > 0);

  // Must stay last: it depends on how many other badges this run earns.
  add('collector', Object.keys(state.badges).length + earned.length >= 10);

  return earned;
}
