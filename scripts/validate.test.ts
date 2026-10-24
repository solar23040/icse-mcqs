import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SUBJECTS,
  formatReport,
  jaccardSimilarity,
  normalizeOption,
  normalizeText,
  validateProject,
  validateSubjects,
  writeDuplicatesReport,
  type SubjectData,
  type SubjectSlug,
  type ValidationReport,
} from './validate';

function makeQuestion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'hist-001',
    question: 'What is the capital of France?',
    options: ['Paris', 'London', 'Rome', 'Berlin'],
    answer: 0,
    explanation: 'Paris is the capital of France.',
    verified: false,
    ...overrides,
  };
}

function makeSubject(data: unknown, slug: SubjectSlug = 'history'): SubjectData {
  const title = SUBJECTS.find((item) => item.slug === slug)?.title ?? slug;
  return {
    slug,
    title,
    file: `src/data/${slug}.json`,
    data,
  };
}

function validateOne(data: unknown): ValidationReport {
  return validateSubjects([makeSubject(data)]);
}

function messages(report: ValidationReport): string {
  return report.errors.map((error) => error.message).join('\n');
}

function withTempDir(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'icse-validate-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('normalisation and similarity', () => {
  it('normalises case, whitespace and punctuation', () => {
    expect(normalizeText('  What  is the CAPITAL, of France?! ')).toBe('what is the capital of france');
  });

  it('computes Jaccard token similarity', () => {
    expect(jaccardSimilarity('one two three', 'one two three')).toBe(1);
    expect(jaccardSimilarity('one two three', 'one two four')).toBeCloseTo(2 / 4);
    expect(jaccardSimilarity('one two', 'three four')).toBe(0);
  });
});

describe('validateSubjects', () => {
  it('accepts a valid question and reports per-subject counts', () => {
    const report = validateOne([makeQuestion()]);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.total).toBe(1);
    expect(report.counts).toEqual([{ slug: 'history', title: 'History & Civics', count: 1 }]);
  });

  it('fails on missing required fields', () => {
    const question = makeQuestion();
    delete question.explanation;

    expect(messages(validateOne([question]))).toContain('missing required field "explanation"');
  });

  it('fails when options are not exactly four', () => {
    const report = validateOne([makeQuestion({ options: ['Paris', 'London', 'Rome'] })]);

    expect(messages(report)).toContain('exactly 4 options (got 3)');
  });

  it('fails when an option is not a non-empty string', () => {
    const report = validateOne([makeQuestion({ options: ['Paris', 'London', '', 'Berlin'] })]);

    expect(messages(report)).toContain('every option must be a non-empty string');
  });

  it('fails when answer is outside 0-3 or not an integer', () => {
    expect(messages(validateOne([makeQuestion({ answer: 4 })]))).toContain('integer from 0 to 3');
    expect(messages(validateOne([makeQuestion({ answer: 1.5 })]))).toContain('integer from 0 to 3');
    expect(messages(validateOne([makeQuestion({ answer: -1 })]))).toContain('integer from 0 to 3');
  });

  it('fails on duplicate options after normalising case and punctuation', () => {
    const report = validateOne([
      makeQuestion({ options: ['Paris', ' paris. ', 'Rome', 'Berlin'] }),
    ]);

    expect(messages(report)).toContain('duplicate option at positions 1 and 2');
  });

  it('keeps maths signs and operators when comparing options', () => {
    expect(normalizeOption(' -2 ')).toBe('-2');
    expect(normalizeOption('2')).toBe('2');
    expect(normalizeOption('p^2 = 4qr')).not.toBe(normalizeOption('p^2 > 4qr'));

    const report = validateOne([
      makeQuestion({ options: ['2', '-2', '1, 2', '1, -2'] }),
      makeQuestion({
        id: 'hist-002',
        question: 'Which quadratic condition gives equal roots?',
        options: ['p^2 = 4qr', 'p^2 > 4qr', 'q^2 = 4pr', '-q^2 = 4pr'],
      }),
    ]);

    expect(report.errors).toEqual([]);
  });

  it('fails on duplicate ids across subjects', () => {
    const report = validateSubjects([
      makeSubject([makeQuestion()], 'history'),
      makeSubject([makeQuestion({ question: 'A different question about rivers?' })], 'geography'),
    ]);

    expect(messages(report)).toContain('duplicate id "hist-001"');
  });

  it('fails on exact duplicate questions after normalisation', () => {
    const report = validateOne([
      makeQuestion(),
      makeQuestion({ id: 'hist-002', question: '  WHAT is the capital, of France?! ' }),
    ]);

    expect(messages(report)).toContain('duplicate question text');
  });

  it('fails when a field named year or paper exists at any depth', () => {
    const report = validateOne([
      makeQuestion({ year: 2024, metadata: { paper: '2024' } }),
    ]);
    const text = messages(report);

    expect(text).toContain('forbidden field "year"');
    expect(text).toContain('forbidden field "metadata.paper"');
  });

  it('fails when verified is not a boolean and source is not a string', () => {
    const report = validateOne([makeQuestion({ verified: 'no', source: 42 })]);
    const text = messages(report);

    expect(text).toContain('field "verified" must be a boolean');
    expect(text).toContain('field "source" must be a string when present');
  });

  it('fails when the top-level value is not an array', () => {
    expect(messages(validateOne({ questions: [] }))).toContain('must be an array of questions');
  });

  it('reports near-duplicates as warnings, not errors', () => {
    const report = validateOne([
      makeQuestion({
        id: 'hist-001',
        question:
          'The quick brown fox jumps over a lazy dog while carrying small red balls through green gardens near flowing rivers under cloudy skies during warm summer evenings',
      }),
      makeQuestion({
        id: 'hist-002',
        question:
          'The quick brown fox jumps over a lazy dog while carrying small blue balls through green gardens near flowing rivers under cloudy skies during warm summer evenings',
      }),
    ]);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.similarity).toBeGreaterThan(0.9);
    expect(formatReport(report)).toContain('WARN: 1 near-duplicate pair(s)');
  });
});

describe('formatReport', () => {
  it('prints a per-subject summary and PASS result', () => {
    const text = formatReport(validateOne([makeQuestion()]));

    expect(text).toContain('History & Civics');
    expect(text).toContain('TOTAL');
    expect(text).toContain('PASS: 1 question(s) are valid.');
    expect(text).toContain('Near-duplicates: none');
  });

  it('prints FAIL and each error', () => {
    const text = formatReport(validateOne([makeQuestion({ answer: 9 })]));

    expect(text).toContain('FAIL: 1 validation error(s)');
    expect(text).toContain('field "answer" must be an integer from 0 to 3');
  });
});

describe('project files', () => {
  it('fails clearly on invalid JSON', () => {
    withTempDir((directory) => {
      const dataDirectory = join(directory, 'src', 'data');
      mkdirSync(dataDirectory, { recursive: true });
      for (const subject of SUBJECTS) {
        const contents = subject.slug === 'history' ? '[{' : '[]';
        writeFileSync(join(dataDirectory, `${subject.slug}.json`), contents, 'utf8');
      }

      const report = validateProject(directory);
      const historyError = report.errors.find((error) => error.file === 'src/data/history.json');

      expect(historyError?.index).toBeNull();
      expect(historyError?.message).toContain('invalid JSON');
    });
  });

  it('writes near-duplicate warnings to a report file', () => {
    withTempDir((directory) => {
      const report = validateOne([
        makeQuestion({
          id: 'hist-001',
          question:
            'The quick brown fox jumps over a lazy dog while carrying small red balls through green gardens near flowing rivers under cloudy skies during warm summer evenings',
        }),
        makeQuestion({
          id: 'hist-002',
          question:
            'The quick brown fox jumps over a lazy dog while carrying small blue balls through green gardens near flowing rivers under cloudy skies during warm summer evenings',
        }),
      ]);
      const reportPath = join(directory, 'dupes-report.txt');

      writeDuplicatesReport(report.warnings, reportPath);
      const text = readFileSync(reportPath, 'utf8');

      expect(text).toContain('similarity');
      expect(text).toContain('hist-001');
      expect(text).toContain('hist-002');
    });
  });

  it('writes an explicit empty report when there are no warnings', () => {
    withTempDir((directory) => {
      const reportPath = join(directory, 'dupes-report.txt');
      writeDuplicatesReport([], reportPath);

      expect(readFileSync(reportPath, 'utf8')).toContain('No near-duplicate warnings.');
    });
  });

  it('validates the five shipped data files', () => {
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const report = validateProject(projectRoot);

    expect(report.errors).toEqual([]);
    expect(report.total).toBe(247);
    expect(report.counts.map((item) => item.count)).toEqual([74, 60, 37, 44, 32]);
  });
});
