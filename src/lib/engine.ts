import type { Question, SessionQuestion } from './types';

/**
 * Fisher-Yates shuffle. Returns a new array and never mutates the input.
 * The optional rng lets callers make the order deterministic in tests.
 */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const result = arr.slice();

  for (let i = result.length - 1; i > 0; i -= 1) {
    const value = rng();
    const bounded = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.9999999999999999) : 0;
    const j = Math.floor(bounded * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }

  return result;
}

export type SessionMode = 'unseen' | 'review';

export interface BuildSessionOptions {
  mode?: SessionMode;
  /** Leitner box per question id, supplied by the caller from game state. */
  boxes?: Record<string, 0 | 1 | 2 | 3>;
  rng?: () => number;
}

function toSessionQuestion(question: Question, rng: () => number): SessionQuestion {
  // Shuffle indices alongside the text so duplicate option strings still map
  // back to the original answer correctly.
  const indexed = question.options.map((text, index) => ({ text, index }));
  const shuffledOptions = shuffle(indexed, rng);

  return {
    id: question.id,
    question: question.question,
    options: shuffledOptions.map((option) => option.text),
    correctIndex: shuffledOptions.findIndex((option) => option.index === question.answer),
    explanation: question.explanation,
  };
}

export function buildSession(
  all: Question[],
  seenIds: string[],
  length: number | 'all',
  options?: BuildSessionOptions | SessionMode,
): { questions: SessionQuestion[]; unseenCount: number; poolExhausted: boolean } {
  const mode = typeof options === 'string' ? options : (options?.mode ?? 'unseen');
  const boxes = typeof options === 'object' ? (options.boxes ?? {}) : {};
  const rng = typeof options === 'object' ? (options.rng ?? Math.random) : Math.random;

  const seen = new Set(seenIds);
  const unseen = all.filter((question) => !seen.has(question.id));
  const unseenCount = unseen.length;

  let candidates: Question[];
  if (mode === 'review') {
    const weakest = all.filter((question) => {
      const box = boxes[question.id];
      return box === 0 || box === 1;
    });
    const middle = all.filter((question) => boxes[question.id] === 2);
    candidates = [
      ...shuffle(weakest, rng),
      ...shuffle(middle, rng),
      ...shuffle(unseen, rng),
    ];
  } else {
    candidates = shuffle(unseen, rng);
  }

  const requested =
    length === 'all'
      ? mode === 'review'
        ? candidates.length
        : unseenCount
      : Math.max(0, Number.isFinite(length) ? Math.floor(length) : 0);

  const questions = candidates.slice(0, requested).map((question) => toSessionQuestion(question, rng));

  return {
    questions,
    unseenCount,
    poolExhausted: candidates.length === 0,
  };
}

export type DailyChallengeQuestion = SessionQuestion & { subject: string };

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic PRNG seeded from a string. */
export function seededRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: string): T[];
export function seededShuffle(seed: string, items: T[]): T[];
export function seededShuffle(seed: string): <T>(items: T[]) => T[];
export function seededShuffle<T>(
  first: T[] | string,
  second?: string | T[],
): T[] | ((items: T[]) => T[]) {
  if (typeof first === 'string') {
    if (Array.isArray(second)) return seededShuffle(second, first);
    return (items: T[]) => seededShuffle(items, first);
  }

  if (Array.isArray(first)) {
    const seed = typeof second === 'string' ? second : '';
    return shuffle(first, seededRng(seed));
  }

  throw new Error('seededShuffle expects an array and a seed');
}

export interface SubjectPool {
  subject: string;
  questions: Question[];
}

function normalisePools(allSubjects: unknown): SubjectPool[] {
  if (Array.isArray(allSubjects)) {
    if (allSubjects.length === 0) return [];
    if (Array.isArray(allSubjects[0])) {
      return (allSubjects as Question[][]).map((questions, index) => ({
        subject: `subject-${index}`,
        questions,
      }));
    }
    if (typeof allSubjects[0] === 'object' && allSubjects[0] !== null && 'questions' in allSubjects[0]) {
      return (allSubjects as SubjectPool[]).map((entry) => ({
        subject: entry.subject,
        questions: entry.questions,
      }));
    }
    return [{ subject: 'mixed', questions: allSubjects as Question[] }];
  }

  if (typeof allSubjects === 'object' && allSubjects !== null) {
    return Object.entries(allSubjects as Record<string, Question[]>).map(([subject, questions]) => ({
      subject,
      questions: Array.isArray(questions) ? questions : [],
    }));
  }

  return [];
}

export function buildDailyChallenge(
  allSubjects: unknown,
  day: string,
  length = 10,
): DailyChallengeQuestion[] & { questions: DailyChallengeQuestion[] } {
  const pools = normalisePools(allSubjects);
  const all = pools.flatMap((pool) =>
    pool.questions.map((question) => ({ question, subject: pool.subject })),
  );
  const rng = seededRng(day);
  const shuffled = shuffle(all, rng);
  const chosen = shuffled.slice(0, Math.max(0, length));

  const result = chosen.map(({ question, subject }) => ({
    ...toSessionQuestion(question, rng),
    subject,
  })) as DailyChallengeQuestion[] & { questions: DailyChallengeQuestion[] };

  Object.defineProperty(result, 'questions', {
    value: result,
    enumerable: true,
    writable: false,
  });
  Object.defineProperty(result, 'day', {
    value: day,
    enumerable: true,
    writable: false,
  });

  return result;
}

export function sprintScore({
  correct,
  wrong,
  seconds,
}: {
  correct: number;
  wrong: number;
  seconds: number;
}): number {
  const safeCorrect = Math.max(0, Number.isFinite(correct) ? Math.trunc(correct) : 0);
  const safeWrong = Math.max(0, Number.isFinite(wrong) ? Math.trunc(wrong) : 0);
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? Math.trunc(seconds) : 0);
  const speedBonus = Math.max(0, 60 - safeSeconds);
  return Math.max(0, safeCorrect * 10 - safeWrong * 5 + speedBonus);
}
