import { describe, expect, it } from 'vitest';
import { toClientQuestions } from './questions';
import type { Question } from './types';

const question: Question = {
  id: 'hist-001',
  question: 'Example?',
  options: ['A', 'B', 'C', 'D'],
  answer: 0,
  explanation: 'Because A.',
  verified: true,
  source: 'icse-class-10-history-2025.pdf',
};

describe('toClientQuestions', () => {
  it('removes internal-only fields', () => {
    const [clientQuestion] = toClientQuestions([question]);

    expect(clientQuestion).toStrictEqual({
      id: 'hist-001',
      question: 'Example?',
      options: ['A', 'B', 'C', 'D'],
      answer: 0,
      explanation: 'Because A.',
      verified: true,
    });
    expect(clientQuestion).not.toHaveProperty('source');
  });

  it('does not mutate the input', () => {
    toClientQuestions([question]);
    expect(question.source).toBe('icse-class-10-history-2025.pdf');
  });
});
