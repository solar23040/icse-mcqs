import { describe, expect, it, vi } from 'vitest';
import { buildSession, shuffle } from './engine';
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
