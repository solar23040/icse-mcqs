#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SUBJECTS = [
  { slug: 'history', title: 'History & Civics' },
  { slug: 'economics', title: 'Economics' },
  { slug: 'geography', title: 'Geography' },
  { slug: 'maths', title: 'Maths' },
  { slug: 'english-lit', title: 'English Literature' },
] as const;

export type SubjectSlug = (typeof SUBJECTS)[number]['slug'];

export const DUPLICATES_REPORT = 'dupes-report.txt';
export const NEAR_DUPLICATE_THRESHOLD = 0.9;

const REQUIRED_FIELDS = ['id', 'question', 'options', 'answer', 'explanation', 'verified'] as const;

export interface SubjectData {
  slug: SubjectSlug;
  title: string;
  file: string;
  data: unknown;
}

export interface ValidationError {
  file: string;
  subject: string;
  /** Zero-based array index, or null for a file-level error. */
  index: number | null;
  id?: string;
  message: string;
}

export interface QuestionRef {
  file: string;
  subject: string;
  /** Zero-based array index. */
  index: number;
  id: string;
  question: string;
}

export interface NearDuplicate {
  a: QuestionRef;
  b: QuestionRef;
  similarity: number;
}

export interface SubjectCount {
  slug: string;
  title: string;
  count: number;
}

export interface ValidationReport {
  errors: ValidationError[];
  warnings: NearDuplicate[];
  counts: SubjectCount[];
  total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Lowercase, strip punctuation, and collapse whitespace for comparison. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalise an option for duplicate detection while keeping maths symbols.
 * Stripping signs or operators would make "2" and "-2" or "p^2 = 4qr" and
 * "p^2 > 4qr" look identical.
 */
export function normalizeOption(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u2212/g, '-')
    .replace(/[^\p{L}\p{N}+\-=<>≤≥≠^/×÷%±√π\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value: string): Set<string> {
  const normalized = normalizeText(value);
  return new Set(normalized === '' ? [] : normalized.split(' '));
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

/** Jaccard token similarity: 0 = no shared words, 1 = identical word sets. */
export function jaccardSimilarity(a: string, b: string): number {
  return jaccardSets(tokenSet(a), tokenSet(b));
}

function findForbiddenFields(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenFields(item, `${path}[${index}]`, found));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '' ? key : `${path}.${key}`;
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'year' || lowerKey === 'paper') found.push(childPath);
    findForbiddenFields(child, childPath, found);
  }
}

function formatIndex(index: number): string {
  return `question ${index + 1}`;
}

/**
 * Validate already-parsed subject data. Pure function so it can be unit tested
 * without touching the filesystem.
 */
export function validateSubjects(subjects: readonly SubjectData[]): ValidationReport {
  const errors: ValidationError[] = [];
  const counts: SubjectCount[] = [];
  const questions: QuestionRef[] = [];
  const firstId = new Map<string, { subject: string; index: number }>();
  const firstQuestion = new Map<string, { subject: string; index: number; id: string }>();
  let total = 0;

  const addError = (subject: SubjectData, index: number | null, message: string, id?: string): void => {
    const issue: ValidationError = {
      file: subject.file,
      subject: subject.slug,
      index,
      message,
    };
    if (id !== undefined && id !== '') issue.id = id;
    errors.push(issue);
  };

  for (const subject of subjects) {
    if (!Array.isArray(subject.data)) {
      counts.push({ slug: subject.slug, title: subject.title, count: 0 });
      addError(subject, null, 'top-level value must be an array of questions');
      continue;
    }

    const entries = subject.data;
    counts.push({ slug: subject.slug, title: subject.title, count: entries.length });
    total += entries.length;

    entries.forEach((entry: unknown, index) => {
      if (!isRecord(entry)) {
        addError(subject, index, 'question must be a JSON object');
        return;
      }

      for (const field of REQUIRED_FIELDS) {
        if (!hasOwn(entry, field)) {
          addError(subject, index, `missing required field "${field}"`);
        }
      }

      const forbidden: string[] = [];
      findForbiddenFields(entry, '', forbidden);
      for (const path of forbidden) {
        addError(subject, index, `forbidden field "${path}" (year and paper must never appear in question data)`);
      }

      let validId: string | null = null;
      if (hasOwn(entry, 'id')) {
        if (typeof entry.id !== 'string' || entry.id.trim() === '') {
          addError(subject, index, 'field "id" must be a non-empty string');
        } else {
          validId = entry.id.trim();
        }
      }

      let validQuestion: string | null = null;
      if (hasOwn(entry, 'question')) {
        if (typeof entry.question !== 'string' || entry.question.trim() === '') {
          addError(subject, index, 'field "question" must be a non-empty string');
        } else {
          validQuestion = entry.question;
        }
      }

      if (hasOwn(entry, 'options')) {
        if (!Array.isArray(entry.options)) {
          addError(subject, index, 'field "options" must be an array of exactly 4 strings');
        } else {
          if (entry.options.length !== 4) {
            addError(subject, index, `field "options" must contain exactly 4 options (got ${entry.options.length})`);
          }

          const optionsAreStrings = entry.options.every(
            (option: unknown): option is string => typeof option === 'string' && option.trim() !== '',
          );
          if (!optionsAreStrings) {
            addError(subject, index, 'every option must be a non-empty string');
          } else {
            const seen = new Map<string, number>();
            entry.options.forEach((option, optionIndex) => {
              const normalized = normalizeOption(option);
              if (normalized === '') return;
              const first = seen.get(normalized);
              if (first !== undefined) {
                addError(
                  subject,
                  index,
                  `duplicate option at positions ${first + 1} and ${optionIndex + 1}: "${option}"`,
                );
              } else {
                seen.set(normalized, optionIndex);
              }
            });
          }
        }
      }

      if (hasOwn(entry, 'answer')) {
        if (
          typeof entry.answer !== 'number' ||
          !Number.isInteger(entry.answer) ||
          entry.answer < 0 ||
          entry.answer > 3
        ) {
          addError(subject, index, `field "answer" must be an integer from 0 to 3 (got ${String(entry.answer)})`);
        }
      }

      if (hasOwn(entry, 'explanation')) {
        if (typeof entry.explanation !== 'string' || entry.explanation.trim() === '') {
          addError(subject, index, 'field "explanation" must be a non-empty string');
        }
      }

      if (hasOwn(entry, 'verified') && typeof entry.verified !== 'boolean') {
        addError(subject, index, 'field "verified" must be a boolean');
      }

      if (hasOwn(entry, 'source') && typeof entry.source !== 'string') {
        addError(subject, index, 'field "source" must be a string when present');
      }

      if (validId !== null) {
        const previous = firstId.get(validId);
        if (previous !== undefined) {
          addError(
            subject,
            index,
            `duplicate id "${validId}" (first used in ${previous.subject} ${formatIndex(previous.index)})`,
            validId,
          );
        } else {
          firstId.set(validId, { subject: subject.slug, index });
        }
      }

      if (validQuestion !== null) {
        const normalizedQuestion = normalizeText(validQuestion);
        const previous = firstQuestion.get(normalizedQuestion);
        if (previous !== undefined) {
          addError(
            subject,
            index,
            `duplicate question text after normalising case/whitespace/punctuation ` +
              `(first used in ${previous.subject} ${formatIndex(previous.index)}, id "${previous.id}")`,
            validId ?? undefined,
          );
        } else {
          firstQuestion.set(normalizedQuestion, {
            subject: subject.slug,
            index,
            id: validId ?? '(no id)',
          });
        }

        questions.push({
          file: subject.file,
          subject: subject.slug,
          index,
          id: validId ?? '(no id)',
          question: validQuestion,
        });
      }
    });
  }

  return {
    errors,
    warnings: findNearDuplicates(questions),
    counts,
    total,
  };
}

/**
 * Return pairs of questions whose Jaccard token similarity is above the
 * threshold. Exact duplicates are skipped here because they are hard errors.
 */
export function findNearDuplicates(
  questions: readonly QuestionRef[],
  threshold: number = NEAR_DUPLICATE_THRESHOLD,
): NearDuplicate[] {
  const prepared = questions.map((ref) => {
    const normalized = normalizeText(ref.question);
    return { ref, normalized, tokens: tokenSet(ref.question) };
  });

  const warnings: NearDuplicate[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = prepared[i];
      const b = prepared[j];
      if (a === undefined || b === undefined) continue;
      if (a.normalized === b.normalized) continue;
      if (a.tokens.size === 0 || b.tokens.size === 0) continue;

      // Jaccard cannot exceed min(sizeA, sizeB) / max(sizeA, sizeB).
      const upperBound = Math.min(a.tokens.size, b.tokens.size) / Math.max(a.tokens.size, b.tokens.size);
      if (upperBound <= threshold) continue;

      const similarity = jaccardSets(a.tokens, b.tokens);
      if (similarity > threshold) {
        warnings.push({ a: a.ref, b: b.ref, similarity });
      }
    }
  }

  warnings.sort((left, right) => {
    if (right.similarity !== left.similarity) return right.similarity - left.similarity;
    const leftKey = `${left.a.subject}/${left.a.id}`;
    const rightKey = `${right.a.subject}/${right.a.id}`;
    if (leftKey !== rightKey) return leftKey.localeCompare(rightKey);
    return `${left.b.subject}/${left.b.id}`.localeCompare(`${right.b.subject}/${right.b.id}`);
  });

  return warnings;
}

/** Read all five data files from a project root and validate them. */
export function validateProject(projectRoot: string = process.cwd()): ValidationReport {
  const subjects: SubjectData[] = [];
  const loadErrors: ValidationError[] = [];

  for (const subject of SUBJECTS) {
    const file = `src/data/${subject.slug}.json`;
    let data: unknown = [];

    try {
      const raw = readFileSync(join(projectRoot, file), 'utf8');
      try {
        data = JSON.parse(raw) as unknown;
      } catch (error) {
        loadErrors.push({
          file,
          subject: subject.slug,
          index: null,
          message: `invalid JSON: ${describeError(error)}`,
        });
      }
    } catch (error) {
      loadErrors.push({
        file,
        subject: subject.slug,
        index: null,
        message: `could not read file: ${describeError(error)}`,
      });
    }

    subjects.push({ slug: subject.slug, title: subject.title, file, data });
  }

  const report = validateSubjects(subjects);
  return { ...report, errors: [...loadErrors, ...report.errors] };
}

export function writeDuplicatesReport(warnings: readonly NearDuplicate[], filePath: string): void {
  const lines: string[] = [
    'Near-duplicate question report',
    '',
    `Jaccard token similarity, threshold > ${NEAR_DUPLICATE_THRESHOLD.toFixed(2)}.`,
    'These are warnings only and do not fail validation.',
    '',
  ];

  if (warnings.length === 0) {
    lines.push('No near-duplicate warnings.');
  } else {
    warnings.forEach((pair, index) => {
      lines.push(`${index + 1}. similarity ${pair.similarity.toFixed(3)}`);
      lines.push(
        `   A: [${pair.a.subject}] ${pair.a.file} ${formatIndex(pair.a.index)} (${pair.a.id})`,
      );
      lines.push(`      ${pair.a.question}`);
      lines.push(
        `   B: [${pair.b.subject}] ${pair.b.file} ${formatIndex(pair.b.index)} (${pair.b.id})`,
      );
      lines.push(`      ${pair.b.question}`);
      lines.push('');
    });
  }

  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function formatError(error: ValidationError): string {
  const location = error.index === null ? error.file : `${error.file} ${formatIndex(error.index)}`;
  const id = error.id === undefined ? '' : ` (${error.id})`;
  return `  [${error.subject}] ${location}${id}: ${error.message}`;
}

export function formatReport(report: ValidationReport, reportPath: string = DUPLICATES_REPORT): string {
  const lines: string[] = ['Question counts by subject:'];
  const titleWidth = Math.max(...report.counts.map((item) => item.title.length), 'TOTAL'.length);

  for (const item of report.counts) {
    lines.push(`  ${item.title.padEnd(titleWidth)}  ${item.count}`);
  }
  lines.push(`  ${'TOTAL'.padEnd(titleWidth)}  ${report.total}`);
  lines.push('');

  if (report.errors.length === 0) {
    lines.push(`PASS: ${report.total} question(s) are valid.`);
  } else {
    lines.push(`FAIL: ${report.errors.length} validation error(s):`);
    for (const error of report.errors) lines.push(formatError(error));
  }

  if (report.warnings.length === 0) {
    lines.push(`Near-duplicates: none (report: ${reportPath}).`);
  } else {
    lines.push(
      `WARN: ${report.warnings.length} near-duplicate pair(s) above ${NEAR_DUPLICATE_THRESHOLD.toFixed(2)} ` +
        `similarity, not failures (full list: ${reportPath}).`,
    );
    const shown = report.warnings.slice(0, 10);
    for (const pair of shown) {
      lines.push(
        `  ${pair.similarity.toFixed(3)} ${pair.a.subject}/${pair.a.id} ~ ${pair.b.subject}/${pair.b.id}`,
      );
    }
    if (report.warnings.length > shown.length) {
      lines.push(`  ... and ${report.warnings.length - shown.length} more in ${reportPath}`);
    }
  }

  return lines.join('\n');
}

/** Run the full validation and print a human-readable summary. Returns the exit code. */
export function runValidation(projectRoot: string = process.cwd()): number {
  const report = validateProject(projectRoot);
  const reportPath = join(projectRoot, DUPLICATES_REPORT);

  try {
    writeDuplicatesReport(report.warnings, reportPath);
  } catch (error) {
    console.warn(`Warning: could not write ${DUPLICATES_REPORT}: ${describeError(error)}`);
  }

  console.log(formatReport(report));
  return report.errors.length === 0 ? 0 : 1;
}

const entryPoint = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
const isMainModule = entryPoint !== null && entryPoint === import.meta.url;

if (isMainModule) {
  try {
    const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
    process.exitCode = runValidation(projectRoot);
  } catch (error) {
    console.error(`Validation crashed: ${describeError(error)}`);
    process.exitCode = 1;
  }
}
