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
