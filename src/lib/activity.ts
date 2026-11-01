import { localDay } from './date';
import { SUBJECTS } from './subjects';
import type { Subject } from './types';

/** Local record of when each subject was last practised, shared by the quiz and profile pages. */
const ACTIVITY_KEY = 'icse:activity:v1';
const MAX_SUBJECTS = 20;
/** Keep a rolling window so the stored history cannot grow forever. */
const MAX_DAYS = 90;

export interface SubjectActivity {
  subject: Subject;
  /** ISO timestamp of the latest answered question in this subject. */
  lastPracticed: string;
}

interface DayActivity {
  answered: number;
  correct: number;
  subjects: Record<string, number>;
}

interface ActivityState {
  v: 1;
  subjects: Record<string, { lastPracticed: string }>;
  days: Record<string, DayActivity>;
}

export interface WeeklyDay {
  /** Local day as YYYY-MM-DD. */
  day: string;
  answered: number;
  correct: number;
}

export interface WeeklySummary {
  /** Oldest day first, always seven entries for the default window. */
  days: WeeklyDay[];
  answered: number;
  correct: number;
  activeDays: number;
  /** Subjects practised in the window, most answers first. */
  subjects: { subject: Subject; answered: number }[];
}

const SUBJECT_SLUGS = new Set<string>(SUBJECTS.map(({ slug }) => slug));

const memory = new Map<string, string>();
let removed = false;

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      const value = storage.getItem(ACTIVITY_KEY);
      if (value !== null) {
        memory.set(ACTIVITY_KEY, value);
        removed = false;
        return value;
      }
    } catch {
      // Fall through to the in-memory copy.
    }
  }
  if (removed) return null;
  return memory.get(ACTIVITY_KEY) ?? null;
}

function writeRaw(value: string): void {
  memory.set(ACTIVITY_KEY, value);
  removed = false;

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(ACTIVITY_KEY, value);
  } catch {
    // The memory copy above is the fallback.
  }
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  return Number.isFinite(Date.parse(value));
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function emptyState(): ActivityState {
  return { v: 1, subjects: {}, days: {} };
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function parseDays(value: unknown): ActivityState['days'] {
  if (typeof value !== 'object' || value === null) return {};

  const days: ActivityState['days'] = {};
  for (const [day, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isDay(day) || typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;

    const subjects: Record<string, number> = {};
    if (typeof record.subjects === 'object' && record.subjects !== null) {
      for (const [subject, count] of Object.entries(record.subjects as Record<string, unknown>)) {
        if (SUBJECT_SLUGS.has(subject) && toCount(count) > 0) subjects[subject] = toCount(count);
      }
    }

    days[day] = {
      answered: toCount(record.answered),
      correct: toCount(record.correct),
      subjects,
    };
  }
  return days;
}

function parseState(raw: string): ActivityState {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyState();

    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 || typeof record.subjects !== 'object' || record.subjects === null) {
      return emptyState();
    }

    const subjects: ActivityState['subjects'] = {};
    for (const [subject, value] of Object.entries(record.subjects as Record<string, unknown>)) {
      if (!SUBJECT_SLUGS.has(subject)) continue;
      if (typeof value !== 'object' || value === null) continue;
      const { lastPracticed } = value as { lastPracticed?: unknown };
      if (isTimestamp(lastPracticed)) subjects[subject] = { lastPracticed };
    }

    return { v: 1, subjects, days: parseDays(record.days) };
  } catch {
    return emptyState();
  }
}

export function getActivity(): ActivityState {
  const raw = readRaw();
  return raw === null ? emptyState() : parseState(raw);
}

/**
 * Called after every answered question so the profile can show recent
 * subjects and the home panel can show a weekly summary.
 */
export function recordSubjectPractice(
  subject: Subject,
  now = new Date(),
  correct?: boolean,
): void {
  if (!SUBJECT_SLUGS.has(subject)) return;

  const state = getActivity();
  state.subjects[subject] = { lastPracticed: now.toISOString() };

  const day = localDay(now);
  const entry = state.days[day] ?? { answered: 0, correct: 0, subjects: {} };
  entry.answered += 1;
  if (correct === true) entry.correct += 1;
  entry.subjects[subject] = (entry.subjects[subject] ?? 0) + 1;
  state.days[day] = entry;

  pruneOldDays(state, day);
  writeRaw(JSON.stringify(state));
}

/** Drop days older than the rolling window, keeping the stored JSON small. */
function pruneOldDays(state: ActivityState, today: string): void {
  const cutoff = new Date(`${today}T12:00:00`);
  if (!Number.isFinite(cutoff.getTime())) return;
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);

  for (const day of Object.keys(state.days)) {
    const date = new Date(`${day}T12:00:00`);
    if (!Number.isFinite(date.getTime()) || date < cutoff) delete state.days[day];
  }
}

/** Summary of the last `dayCount` local days, including today. */
export function getWeeklyActivity(now = new Date(), dayCount = 7): WeeklySummary {
  const windowSize = Math.max(1, Math.min(MAX_DAYS, Math.floor(dayCount)));
  const state = getActivity();
  const days: WeeklyDay[] = [];
  const subjectTotals = new Map<Subject, number>();

  for (let offset = windowSize - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = localDay(date);
    const record = state.days[key];
    const answered = record?.answered ?? 0;
    const correct = Math.min(answered, record?.correct ?? 0);

    days.push({ day: key, answered, correct });

    for (const [subject, count] of Object.entries(record?.subjects ?? {})) {
      if (!SUBJECT_SLUGS.has(subject)) continue;
      subjectTotals.set(subject as Subject, (subjectTotals.get(subject as Subject) ?? 0) + count);
    }
  }

  const answered = days.reduce((sum, day) => sum + day.answered, 0);
  const correct = days.reduce((sum, day) => sum + day.correct, 0);
  const subjects = [...subjectTotals.entries()]
    .map(([subject, count]) => ({ subject, answered: count }))
    .sort((left, right) => right.answered - left.answered || left.subject.localeCompare(right.subject));

  return {
    days,
    answered,
    correct,
    activeDays: days.filter((day) => day.answered > 0).length,
    subjects,
  };
}

/** Most recently practised subjects first. */
export function getRecentSubjects(limit = 5): SubjectActivity[] {
  const entries = Object.entries(getActivity().subjects)
    .filter((entry): entry is [Subject, { lastPracticed: string }] =>
      SUBJECT_SLUGS.has(entry[0]) && isTimestamp(entry[1].lastPracticed),
    )
    .map(([subject, value]) => ({ subject, lastPracticed: value.lastPracticed }))
    .sort((left, right) => Date.parse(right.lastPracticed) - Date.parse(left.lastPracticed));

  return entries.slice(0, Math.max(0, Math.min(MAX_SUBJECTS, limit)));
}
