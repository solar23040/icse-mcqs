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

export function buildSession(
  all: Question[],
  seenIds: string[],
  length: number | 'all',
): { questions: SessionQuestion[]; unseenCount: number; poolExhausted: boolean } {
  const seen = new Set(seenIds);
  const unseen = all.filter((question) => !seen.has(question.id));
  const unseenCount = unseen.length;

  const requested =
    length === 'all' ? unseenCount : Math.max(0, Number.isFinite(length) ? Math.floor(length) : 0);

  const questions = shuffle(unseen)
    .slice(0, requested)
    .map((question): SessionQuestion => {
      // Shuffle indices alongside the text so duplicate option strings still map
      // back to the original answer correctly.
      const indexed = question.options.map((text, index) => ({ text, index }));
      const shuffledOptions = shuffle(indexed);

      return {
        id: question.id,
        question: question.question,
        options: shuffledOptions.map((option) => option.text),
        correctIndex: shuffledOptions.findIndex((option) => option.index === question.answer),
        explanation: question.explanation,
      };
    });

  return {
    questions,
    unseenCount,
    poolExhausted: unseenCount === 0,
  };
}

export interface WrongSessionResult {
  questions: SessionQuestion[];
  wrongCount: number;
  unseenCount: number;
  poolExhausted: boolean;
}

/**
 * Builds a practice session from the ids a learner previously answered wrong.
 * Accepts either the full pool plus the wrong ids, or a pool that is already
 * filtered down to the wrong questions.
 */
export function buildWrongSession(
  pool: Question[],
  length: number | 'all',
): WrongSessionResult;
export function buildWrongSession(
  all: Question[],
  wrongIds: string[],
  length: number | 'all',
): WrongSessionResult;
export function buildWrongSession(
  all: Question[],
  wrongIdsOrLength: string[] | number | 'all',
  maybeLength?: number | 'all',
): WrongSessionResult {
  let pool: Question[];
  let length: number | 'all';

  if (Array.isArray(wrongIdsOrLength)) {
    const wrong = new Set(wrongIdsOrLength);
    pool = all.filter((question) => wrong.has(question.id));
    length = maybeLength ?? 'all';
  } else {
    pool = all;
    length = wrongIdsOrLength;
  }

  const session = buildSession(pool, [], length);

  return {
    questions: session.questions,
    wrongCount: pool.length,
    unseenCount: pool.length,
    poolExhausted: pool.length === 0,
  };
}

/* Alias for callers that think of the feature as "review". */
export const buildReviewSession = buildWrongSession;
