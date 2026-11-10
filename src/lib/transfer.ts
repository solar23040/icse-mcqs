import {
  getBookmarks,
  getGame,
  getQuestionStats,
  getSeen,
  getStats,
  saveGame,
  saveQuestionStats,
  saveSeen,
  saveStats,
  setBookmarks,
  type QuestionStats,
} from './storage';
import type { Subject } from './types';
import { SUBJECTS } from './subjects';

const TRANSFER_VERSION = 1;

interface TransferCore {
  game: ReturnType<typeof getGame>;
  seen: Partial<Record<Subject, string[]>>;
  stats: Partial<Record<Subject, { attempted: number; correct: number }>>;
  bookmarks: string[];
  qstats: Partial<Record<Subject, QuestionStats>>;
}

interface TransferPayload extends TransferCore {
  v: typeof TRANSFER_VERSION;
  checksum: string;
}

/**
 * Only fields that exist in the payload are hashed, so codes exported before
 * bookmarks and per-question stats existed still validate.
 */
function coreOf(record: Record<string, unknown>): Record<string, unknown> {
  const core: Record<string, unknown> = {
    game: record.game,
    seen: record.seen,
    stats: record.stats,
  };
  if (record.bookmarks !== undefined) core.bookmarks = record.bookmarks;
  if (record.qstats !== undefined) core.qstats = record.qstats;
  return core;
}

function checksumOf(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function utf8ToBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function base64ToUtf8(text: string): string {
  return decodeURIComponent(escape(atob(text)));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

function cleanQuestionStats(value: unknown): QuestionStats {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const stats: QuestionStats = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (id === '' || typeof entry !== 'object' || entry === null) continue;
    const record = entry as { attempted?: unknown; correct?: unknown };
    const attempted =
      typeof record.attempted === 'number' && Number.isFinite(record.attempted)
        ? Math.max(0, Math.trunc(record.attempted))
        : 0;
    if (attempted === 0) continue;
    const correct =
      typeof record.correct === 'number' && Number.isFinite(record.correct)
        ? Math.min(attempted, Math.max(0, Math.trunc(record.correct)))
        : 0;
    stats[id] = { attempted, correct };
  }
  return stats;
}

export function exportProgress(): string {
  const subjects = SUBJECTS.map((subject) => subject.slug);
  const seen = Object.fromEntries(subjects.map((subject) => [subject, getSeen(subject)])) as Partial<
    Record<Subject, string[]>
  >;
  const stats = Object.fromEntries(
    subjects.map((subject) => [subject, getStats(subject)]),
  ) as Partial<Record<Subject, { attempted: number; correct: number }>>;
  const qstats = Object.fromEntries(
    subjects.map((subject) => [subject, getQuestionStats(subject)]),
  ) as Partial<Record<Subject, QuestionStats>>;

  const core = { game: getGame(), seen, stats, bookmarks: getBookmarks(), qstats };
  const payload: TransferPayload = {
    v: TRANSFER_VERSION,
    checksum: checksumOf(core),
    ...core,
  };

  return utf8ToBase64(JSON.stringify(payload));
}

export interface ImportResult {
  ok: boolean;
  error?: string;
}

export function importProgress(code: string): ImportResult {
  let payload: unknown;
  try {
    payload = JSON.parse(base64ToUtf8(code.trim()));
  } catch {
    return { ok: false, error: 'invalid_code' };
  }

  if (typeof payload !== 'object' || payload === null) return { ok: false, error: 'invalid_code' };

  const record = payload as Record<string, unknown>;
  if (record.v !== TRANSFER_VERSION) return { ok: false, error: 'unknown_version' };
  if (record.checksum !== checksumOf(coreOf(record))) {
    return { ok: false, error: 'checksum_mismatch' };
  }

  if (typeof record.game !== 'object' || record.game === null) {
    return { ok: false, error: 'invalid_game' };
  }

  const game = record.game as ReturnType<typeof getGame>;
  if (game.v !== 1) return { ok: false, error: 'invalid_game' };

  const seen = (record.seen ?? {}) as Partial<Record<Subject, unknown>>;
  const stats = (record.stats ?? {}) as Partial<Record<Subject, unknown>>;
  const qstats = (record.qstats ?? {}) as Partial<Record<Subject, unknown>>;

  try {
    saveGame(game);
    for (const subject of SUBJECTS.map((item) => item.slug)) {
      const seenIds = seen[subject];
      if (Array.isArray(seenIds) && seenIds.every((id) => typeof id === 'string')) {
        saveSeen(subject, seenIds);
      }
      const stat = stats[subject];
      if (
        typeof stat === 'object' &&
        stat !== null &&
        typeof (stat as { attempted?: unknown }).attempted === 'number' &&
        typeof (stat as { correct?: unknown }).correct === 'number'
      ) {
        saveStats(subject, {
          attempted: Math.max(0, Math.trunc((stat as { attempted: number }).attempted)),
          correct: Math.max(0, Math.trunc((stat as { correct: number }).correct)),
        });
      }
      if (qstats[subject] !== undefined) {
        saveQuestionStats(subject, cleanQuestionStats(qstats[subject]));
      }
    }

    // Older codes have no bookmarks field; leave the local list untouched then.
    if (record.bookmarks !== undefined) {
      setBookmarks(stringList(record.bookmarks));
    }
  } catch {
    return { ok: false, error: 'storage_error' };
  }

  return { ok: true };
}
