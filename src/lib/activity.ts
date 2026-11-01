import { SUBJECTS } from './subjects';
import type { Subject } from './types';

/** Local record of when each subject was last practised, shared by the quiz and profile pages. */
const ACTIVITY_KEY = 'icse:activity:v1';
const MAX_SUBJECTS = 20;

export interface SubjectActivity {
  subject: Subject;
  /** ISO timestamp of the latest answered question in this subject. */
  lastPracticed: string;
}

interface ActivityState {
  v: 1;
  subjects: Record<string, { lastPracticed: string }>;
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

function parseState(raw: string): ActivityState {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { v: 1, subjects: {} };

    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 || typeof record.subjects !== 'object' || record.subjects === null) {
      return { v: 1, subjects: {} };
    }

    const subjects: ActivityState['subjects'] = {};
    for (const [subject, value] of Object.entries(record.subjects as Record<string, unknown>)) {
      if (!SUBJECT_SLUGS.has(subject)) continue;
      if (typeof value !== 'object' || value === null) continue;
      const { lastPracticed } = value as { lastPracticed?: unknown };
      if (isTimestamp(lastPracticed)) subjects[subject] = { lastPracticed };
    }

    return { v: 1, subjects };
  } catch {
    return { v: 1, subjects: {} };
  }
}

export function getActivity(): ActivityState {
  const raw = readRaw();
  return raw === null ? { v: 1, subjects: {} } : parseState(raw);
}

/** Called after every answered question so the profile can show recent subjects. */
export function recordSubjectPractice(subject: Subject, now = new Date()): void {
  if (!SUBJECT_SLUGS.has(subject)) return;

  const state = getActivity();
  state.subjects[subject] = { lastPracticed: now.toISOString() };
  writeRaw(JSON.stringify(state));
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
