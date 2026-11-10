import { EXAM_SECONDS_PER_QUESTION } from './config';
import { shuffle, toSessionQuestion } from './engine';
import type { Question, SessionQuestion, Subject } from './types';

export interface ExamPool {
  subject: Subject;
  questions: Question[];
}

export interface ExamQuestion extends SessionQuestion {
  subject: Subject;
}

export interface ExamScoreRow {
  key: string;
  label: string;
  total: number;
  correct: number;
  percent: number;
}

export interface ExamScore {
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  percent: number;
  perSubject: ExamScoreRow[];
  perTopic: ExamScoreRow[];
}

/**
 * Builds a mixed-subject paper. Questions are picked uniformly from the combined
 * pools, so bigger subjects contribute proportionally more questions.
 */
export function buildExamPaper(
  pools: readonly ExamPool[],
  options: { count: number; rng?: () => number } = { count: 25 },
): ExamQuestion[] {
  const rng = options.rng ?? Math.random;
  const all = pools.flatMap((pool) =>
    pool.questions.map((question) => ({ question, subject: pool.subject })),
  );

  const count = Number.isFinite(options.count)
    ? Math.max(0, Math.trunc(options.count))
    : 0;

  return shuffle(all, rng)
    .slice(0, count)
    .map(({ question, subject }) => ({
      ...toSessionQuestion(question, rng),
      subject,
    }));
}

/** Time allowance in seconds for a paper of `count` questions. */
export function examDurationSeconds(count: number): number {
  const questions = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return questions * EXAM_SECONDS_PER_QUESTION;
}

function percentOf(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function addRow(
  rows: Map<string, ExamScoreRow>,
  key: string,
  label: string,
  correct: boolean,
): void {
  const row = rows.get(key) ?? { key, label, total: 0, correct: 0, percent: 0 };
  row.total += 1;
  if (correct) row.correct += 1;
  row.percent = percentOf(row.correct, row.total);
  rows.set(key, row);
}

/**
 * Marks a paper. A null answer counts as unanswered and never as correct.
 * `labels` supplies display names for topic slugs.
 */
export function scoreExam(
  questions: readonly ExamQuestion[],
  answers: readonly (number | null)[],
  labels: (subject: Subject, topic: string) => string = (_subject, topic) => topic,
): ExamScore {
  const perSubject = new Map<string, ExamScoreRow>();
  const perTopic = new Map<string, ExamScoreRow>();
  let correct = 0;
  let unanswered = 0;

  questions.forEach((question, index) => {
    const answer = answers[index] ?? null;
    const isCorrect = answer !== null && answer === question.correctIndex;
    if (answer === null) unanswered += 1;
    if (isCorrect) correct += 1;

    addRow(perSubject, question.subject, question.subject, isCorrect);
    const topicKey = `${question.subject}:${question.topic}`;
    addRow(perTopic, topicKey, labels(question.subject, question.topic), isCorrect);
  });

  const total = questions.length;

  return {
    total,
    correct,
    wrong: total - correct - unanswered,
    unanswered,
    percent: percentOf(correct, total),
    perSubject: [...perSubject.values()].sort((a, b) => a.percent - b.percent),
    perTopic: [...perTopic.values()].sort((a, b) => a.percent - b.percent),
  };
}
