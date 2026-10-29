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
