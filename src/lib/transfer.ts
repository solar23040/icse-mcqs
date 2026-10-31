import { getGame, getSeen, getStats, saveGame, saveSeen, saveStats } from './storage';
import type { Subject } from './types';
import { SUBJECTS } from './subjects';

const TRANSFER_VERSION = 1;

interface TransferPayload {
  v: typeof TRANSFER_VERSION;
  checksum: string;
  game: ReturnType<typeof getGame>;
  seen: Partial<Record<Subject, string[]>>;
  stats: Partial<Record<Subject, { attempted: number; correct: number }>>;
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

export function exportProgress(): string {
  const subjects = SUBJECTS.map((subject) => subject.slug);
  const seen = Object.fromEntries(subjects.map((subject) => [subject, getSeen(subject)])) as Partial<
    Record<Subject, string[]>
  >;
  const stats = Object.fromEntries(
    subjects.map((subject) => [subject, getStats(subject)]),
  ) as Partial<Record<Subject, { attempted: number; correct: number }>>;

  const core = { game: getGame(), seen, stats };
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

  const core = { game: record.game, seen: record.seen, stats: record.stats };
  if (record.checksum !== checksumOf(core)) return { ok: false, error: 'checksum_mismatch' };

  if (typeof record.game !== 'object' || record.game === null) {
    return { ok: false, error: 'invalid_game' };
  }

  const game = record.game as ReturnType<typeof getGame>;
  if (game.v !== 1) return { ok: false, error: 'invalid_game' };

  const seen = (record.seen ?? {}) as Partial<Record<Subject, unknown>>;
  const stats = (record.stats ?? {}) as Partial<Record<Subject, unknown>>;

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
    }
  } catch {
    return { ok: false, error: 'storage_error' };
  }

  return { ok: true };
}
