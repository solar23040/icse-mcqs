import { describe, expect, it } from 'vitest';
import { seededRng } from './engine';
import { buildExamPaper, scoreExam, type ExamPool } from './exam';
import type { Question, Subject } from './types';

function makeQuestion(id: string, subject: Subject, topic: string): Question {
  return {
    id,
    question: `Question ${id}?`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    answer: 2,
    explanation: `Explanation ${id}`,
    topic,
    verified: true,
  };
}

const pools: ExamPool[] = [
  {
    subject: 'maths',
    questions: [
      makeQuestion('m1', 'maths', 'algebra'),
      makeQuestion('m2', 'maths', 'geometry'),
      makeQuestion('m3', 'maths', 'algebra'),
    ],
  },
  {
    subject: 'physics',
    questions: [
      makeQuestion('p1', 'physics', 'light'),
      makeQuestion('p2', 'physics', 'electricity'),
    ],
  },
];

describe('buildExamPaper', () => {
  it('builds a deterministic mixed paper without duplicates', () => {
    const first = buildExamPaper(pools, { count: 4, rng: seededRng('exam') });
    const second = buildExamPaper(pools, { count: 4, rng: seededRng('exam') });

    expect(first.map((question) => question.id)).toEqual(second.map((question) => question.id));
    expect(new Set(first.map((question) => question.id)).size).toBe(4);
    expect(first.some((question) => question.subject === 'maths')).toBe(true);
  });

  it('caps at the available pool and preserves the answer key after shuffling', () => {
    const paper = buildExamPaper(pools, { count: 50, rng: seededRng('cap') });

    expect(paper).toHaveLength(5);
    for (const question of paper) {
      expect(question.options[question.correctIndex]).toBe('Gamma');
      expect(question.topic).toBeTruthy();
    }
  });

  it('returns an empty paper for a non-positive count', () => {
    expect(buildExamPaper(pools, { count: 0 })).toEqual([]);
    expect(buildExamPaper(pools, { count: -3 })).toEqual([]);
  });
});

describe('scoreExam', () => {
  const paper = [
    { ...makeQuestion('m1', 'maths', 'algebra'), subject: 'maths' as const, correctIndex: 0 },
    { ...makeQuestion('m2', 'maths', 'geometry'), subject: 'maths' as const, correctIndex: 1 },
    { ...makeQuestion('p1', 'physics', 'light'), subject: 'physics' as const, correctIndex: 2 },
  ].map(({ answer: _answer, ...question }) => question);

  it('scores correct, wrong and unanswered answers', () => {
    const score = scoreExam(paper, [0, 3, null], (_subject, topic) => topic);

    expect(score.total).toBe(3);
    expect(score.correct).toBe(1);
    expect(score.wrong).toBe(1);
    expect(score.unanswered).toBe(1);
    expect(score.percent).toBe(33);
  });

  it('breaks the score down by subject and topic', () => {
    const score = scoreExam(paper, [0, 1, 2], (_subject, topic) => `label-${topic}`);

    expect(score.perSubject).toEqual([
      { key: 'maths', label: 'maths', total: 2, correct: 2, percent: 100 },
      { key: 'physics', label: 'physics', total: 1, correct: 1, percent: 100 },
    ]);
    expect(score.perTopic.map((row) => row.label).sort()).toEqual([
      'label-algebra',
      'label-geometry',
      'label-light',
    ]);
  });

  it('handles a blank paper', () => {
    const score = scoreExam([], []);
    expect(score).toMatchObject({ total: 0, correct: 0, percent: 0 });
    expect(score.perSubject).toEqual([]);
  });
});
