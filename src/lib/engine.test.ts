import { describe, expect, it, vi } from 'vitest';
import { buildDailyChallenge, buildSession, seededShuffle, shuffle, sprintScore } from './engine';
import type { Question } from './types';

function makeQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    question: `Question ${id}?`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    answer: 0,
    explanation: `Explanation ${id}`,
    verified: true,
    ...overrides,
  };
}

function makePool(count: number): Question[] {
  return Array.from({ length: count }, (_, index) => makeQuestion(`q${index + 1}`));
}

const ids = (questions: { id: string }[]): string[] => questions.map((question) => question.id);

describe('shuffle', () => {
  it('returns a new array with the same values and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);

    expect(result).not.toBe(input);
    expect(result).toHaveLength(input.length);
    expect([...result].sort((a, b) => a - b)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses the injected rng for a deterministic Fisher-Yates order', () => {
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
  });

  it('tolerates an rng that returns boundary values', () => {
    expect(shuffle([1, 2, 3, 4], () => 1)).toEqual([1, 2, 3, 4]);
    expect(shuffle([1, 2, 3, 4], () => Number.NaN)).toEqual([2, 3, 4, 1]);
  });
});

describe('buildSession', () => {
  it('drops seen questions and keeps the rest', () => {
    const pool = makePool(5);
    const result = buildSession(pool, ['q1', 'q3'], 'all');

    expect(ids(result.questions).sort()).toEqual(['q2', 'q4', 'q5']);
    expect(result.unseenCount).toBe(3);
    expect(result.poolExhausted).toBe(false);
  });

  it('returns every unseen question when length is all', () => {
    const pool = makePool(6);
    const result = buildSession(pool, ['q2', 'q6'], 'all');

    expect(result.questions).toHaveLength(4);
    expect(result.unseenCount).toBe(4);
    expect(result.questions.every((question) => !['q2', 'q6'].includes(question.id))).toBe(true);
  });

  it('shuffles the question order', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      const result = buildSession(makePool(4), [], 'all');
      expect(ids(result.questions)).toEqual(['q2', 'q3', 'q4', 'q1']);
    } finally {
      random.mockRestore();
    }
  });

  it('keeps the correct answer after shuffling options for 200 iterations', () => {
    const pool = [makeQuestion('q1', { options: ['one', 'two', 'three', 'four'], answer: 2 })];
    const correctIndexes = new Set<number>();

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const [question] = buildSession(pool, [], 1).questions;
      expect(question).toBeDefined();
      expect(question!.options).toHaveLength(4);
      expect([...question!.options].sort()).toEqual(['four', 'one', 'three', 'two']);
      expect(question!.options[question!.correctIndex]).toBe('three');
      correctIndexes.add(question!.correctIndex);
    }

    // 200 shuffles of four options should not produce a single fixed position.
    expect(correctIndexes.size).toBeGreaterThan(1);
  });

  it('maps duplicate option text back to the original answer index', () => {
    const pool = [makeQuestion('q1', { options: ['same', 'same', 'same', 'same'], answer: 3 })];

    for (let iteration = 0; iteration < 50; iteration += 1) {
      const [question] = buildSession(pool, [], 1).questions;
      // Correctness is tracked by original index, not by the first matching text.
      expect(question!.options[question!.correctIndex]).toBe('same');
      expect(question!.correctIndex).toBeGreaterThanOrEqual(0);
      expect(question!.correctIndex).toBeLessThan(4);
    }
  });

  it('never exposes source or verified', () => {
    const pool = [makeQuestion('q1', { source: '2023 Paper', verified: true })];
    const [question] = buildSession(pool, [], 1).questions;

    expect(question).toStrictEqual({
      id: 'q1',
      question: 'Question q1?',
      options: expect.any(Array),
      correctIndex: expect.any(Number),
      explanation: 'Explanation q1',
    });
    expect(question).not.toHaveProperty('source');
    expect(question).not.toHaveProperty('verified');
  });

  it('returns all unseen questions when length is larger than the unseen pool', () => {
    const pool = makePool(4);
    const result = buildSession(pool, ['q1'], 10);

    expect(result.questions).toHaveLength(3);
    expect(result.unseenCount).toBe(3);
    expect(result.poolExhausted).toBe(false);
  });

  it('handles a length of zero without claiming the pool is exhausted', () => {
    const result = buildSession(makePool(3), [], 0);

    expect(result.questions).toEqual([]);
    expect(result.unseenCount).toBe(3);
    expect(result.poolExhausted).toBe(false);
  });

  it('returns an empty session when every question has been seen', () => {
    const pool = makePool(3);
    const result = buildSession(pool, ['q1', 'q2', 'q3'], 10);

    expect(result.questions).toEqual([]);
    expect(result.unseenCount).toBe(0);
    expect(result.poolExhausted).toBe(true);
  });

  it('returns an empty exhausted session for an empty pool', () => {
    expect(buildSession([], [], 'all')).toEqual({
      questions: [],
      unseenCount: 0,
      poolExhausted: true,
    });
  });

  it('does not mutate the question pool or seen list', () => {
    const pool = [makeQuestion('q1', { options: ['A', 'B', 'C', 'D'], answer: 1 })];
    const seen = ['q2'];

    buildSession(pool, seen, 'all');

    expect(pool[0]!.options).toEqual(['A', 'B', 'C', 'D']);
    expect(pool[0]!.answer).toBe(1);
    expect(seen).toEqual(['q2']);
  });
});

describe('review mode', () => {
  const pool = makePool(6);
  const boxes = { q1: 0, q2: 1, q3: 2, q4: 3 } as const;
  const seen = ['q1', 'q2', 'q3', 'q4'];

  it('draws boxes 0-1, then box 2, then unseen', () => {
    const result = buildSession(pool, seen, 'all', { mode: 'review', boxes, rng: () => 0 });

    expect(result.questions).toHaveLength(5);
    expect(ids(result.questions).slice(0, 2).sort()).toEqual(['q1', 'q2']);
    expect(ids(result.questions)[2]).toBe('q3');
    expect(ids(result.questions).slice(3).sort()).toEqual(['q5', 'q6']);
  });

  it('honours the requested length and still shuffles options', () => {
    const result = buildSession(pool, seen, 2, { mode: 'review', boxes, rng: () => 0 });

    expect(result.questions).toHaveLength(2);
    for (const question of result.questions) {
      const original = pool.find((item) => item.id === question.id);
      expect(question).toBeDefined();
      expect(question.options).toHaveLength(4);
      expect(question.correctIndex).toBeGreaterThanOrEqual(0);
      expect(question.correctIndex).toBeLessThan(4);
      expect(question.options[question.correctIndex]).toBe(original!.options[original!.answer]);
    }
  });

  it('falls back to an empty exhausted session when nothing is due', () => {
    const allSeen = makePool(3);
    const result = buildSession(allSeen, ['q1', 'q2', 'q3'], 10, {
      mode: 'review',
      boxes: { q1: 3, q2: 3, q3: 3 },
    });

    expect(result.questions).toEqual([]);
    expect(result.unseenCount).toBe(0);
    expect(result.poolExhausted).toBe(true);
  });

  it('keeps unseen mode as the unchanged default', () => {
    const defaultResult = buildSession(pool, seen, 'all', { rng: () => 0 });
    const explicit = buildSession(pool, seen, 'all', { mode: 'unseen', rng: () => 0 });

    expect(ids(defaultResult.questions)).toEqual(ids(explicit.questions));
    expect(ids(defaultResult.questions).sort()).toEqual(['q5', 'q6']);
  });
});

describe('seeded shuffle and daily challenge', () => {
  const pool = makePool(4);

  it('is deterministic for the same seed', () => {
    const first = seededShuffle(pool, '2026-01-01');
    const second = seededShuffle(pool, '2026-01-01');
    expect(first.map((question) => question.id)).toEqual(second.map((question) => question.id));
  });

  it('changes order for a different seed', () => {
    const first = seededShuffle(pool, '2026-01-01').map((question) => question.id);
    const second = seededShuffle(pool, '2026-01-02').map((question) => question.id);
    expect(first).not.toEqual(second);
  });

  it('builds the same daily challenge for the same day', () => {
    const pools = { maths: makePool(8), physics: makePool(8) };
    const first = buildDailyChallenge(pools, '2026-01-01');
    const second = buildDailyChallenge(pools, '2026-01-01');
    expect(first.map((question) => question.id)).toEqual(second.map((question) => question.id));
    expect(first).toHaveLength(10);
    expect(first.questions.map((question) => question.id)).toEqual(first.map((question) => question.id));
  });
});

describe('sprint score', () => {
  it('rewards correct answers and speed, penalises wrong ones', () => {
    expect(sprintScore({ correct: 0, wrong: 0, seconds: 60 })).toBe(0);
    expect(sprintScore({ correct: 5, wrong: 0, seconds: 60 })).toBe(50);
    expect(sprintScore({ correct: 5, wrong: 2, seconds: 30 })).toBe(50 - 10 + 30);
    expect(sprintScore({ correct: 0, wrong: 10, seconds: 10 })).toBe(0);
  });
});
