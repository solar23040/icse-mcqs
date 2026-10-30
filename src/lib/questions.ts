import type { Question } from './types';

/**
 * Keep internal-only fields (such as `source`) out of the props that Astro
 * serialises into the page for client components.
 */
export function toClientQuestions(questions: readonly Question[]): Question[] {
  return questions.map((question) => ({
    id: question.id,
    question: question.question,
    options: question.options,
    answer: question.answer,
    explanation: question.explanation,
    verified: question.verified,
  }));
}
