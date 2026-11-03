/**
 * Client for the developer account manager in /api/admin.
 * The session token lives in sessionStorage, so closing the tab signs out.
 */
const ENDPOINT = '/api/admin';
const TOKEN_KEY = 'icse:dev:admin-token';
const TIMEOUT_MS = 10_000;

export interface AdminSubject {
  subject: string;
  lastPracticed: string;
  attempts: number;
}

export interface AdminPlayer {
  id: string;
  name: string;
  xp: number;
  lastOnline: string | null;
  badges: string[];
  subjects: AdminSubject[];
  week: string;
}

export type AdminError = 'unauthorized' | 'unavailable' | 'failed';

export interface AdminUpdate {
  player: AdminPlayer;
  xpApplied: boolean;
}

export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AdminError };

function readToken(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // The in-memory flow still works for this page view.
  }
}

export function hasAdminToken(): boolean {
  return Boolean(readToken());
}

export function clearAdminToken(): void {
  writeToken(null);
}

async function request(
  method: 'GET' | 'POST',
  body?: unknown,
  token = readToken(),
): Promise<{ status: number; payload: unknown } | null> {
  try {
    const response = await fetch(ENDPOINT, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const payload: unknown = await response.json().catch(() => null);
    return { status: response.status, payload };
  } catch {
    return null;
  }
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normalisePlayer(value: unknown): AdminPlayer | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  const { id, name, xp, lastOnline, badges, subjects, week } = record;
  if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) return null;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof week !== 'string') return null;

  const safeBadges = Array.isArray(badges)
    ? [...new Set(badges.filter((badge): badge is string => typeof badge === 'string'))]
    : [];

  const safeSubjects: AdminSubject[] = [];
  if (Array.isArray(subjects)) {
    for (const item of subjects) {
      if (typeof item !== 'object' || item === null) continue;
      const { subject, lastPracticed, attempts } = item as {
        subject?: unknown;
        lastPracticed?: unknown;
        attempts?: unknown;
      };
      if (typeof subject !== 'string' || subject.length === 0) continue;
      if (typeof lastPracticed !== 'string' || !Number.isFinite(Date.parse(lastPracticed))) {
        continue;
      }
      safeSubjects.push({
        subject,
        lastPracticed,
        attempts: toCount(attempts),
      });
    }
  }

  return {
    id,
    name,
    xp: toCount(xp),
    lastOnline:
      typeof lastOnline === 'string' && Number.isFinite(Date.parse(lastOnline))
        ? lastOnline
        : null,
    badges: safeBadges,
    subjects: safeSubjects,
    week,
  };
}

export async function adminLogin(username: string, password: string): Promise<boolean> {
  const result = await request('POST', { action: 'login', username, password }, null);
  if (!result || result.status !== 200) return false;

  const record =
    typeof result.payload === 'object' && result.payload !== null
      ? (result.payload as Record<string, unknown>)
      : null;
  if (typeof record?.token !== 'string' || !/^[a-f0-9]{64}$/.test(record.token)) return false;

  writeToken(record.token);
  return true;
}

export async function adminLogout(): Promise<void> {
  const token = readToken();
  if (token) await request('POST', { action: 'logout' }, token);
  writeToken(null);
}

export async function listPlayers(): Promise<AdminResult<AdminPlayer[]>> {
  if (!readToken()) return { ok: false, error: 'unauthorized' };

  const result = await request('GET');
  if (!result) return { ok: false, error: 'failed' };
  if (result.status === 401) {
    writeToken(null);
    return { ok: false, error: 'unauthorized' };
  }
  if (result.status === 503) return { ok: false, error: 'unavailable' };
  if (result.status !== 200) return { ok: false, error: 'failed' };

  const record =
    typeof result.payload === 'object' && result.payload !== null
      ? (result.payload as Record<string, unknown>)
      : null;
  if (!Array.isArray(record?.users)) return { ok: false, error: 'failed' };

  const players: AdminPlayer[] = [];
  for (const item of record.users) {
    const player = normalisePlayer(item);
    if (player) players.push(player);
  }
  return { ok: true, data: players };
}

export async function updatePlayer(
  id: string,
  patch: { name?: string; xp?: number },
): Promise<AdminResult<AdminUpdate>> {
  const result = await request('POST', { action: 'update', id, ...patch });
  if (!result) return { ok: false, error: 'failed' };
  if (result.status === 401) {
    writeToken(null);
    return { ok: false, error: 'unauthorized' };
  }
  if (result.status === 503) return { ok: false, error: 'unavailable' };
  if (result.status !== 200) return { ok: false, error: 'failed' };

  const record =
    typeof result.payload === 'object' && result.payload !== null
      ? (result.payload as Record<string, unknown>)
      : null;
  const player = normalisePlayer(record?.user);
  if (!player) return { ok: false, error: 'failed' };

  return {
    ok: true,
    data: { player, xpApplied: record?.xpApplied === true },
  };
}

export async function deletePlayer(id: string): Promise<AdminResult<true>> {
  const result = await request('POST', { action: 'delete', id });
  if (!result) return { ok: false, error: 'failed' };
  if (result.status === 401) {
    writeToken(null);
    return { ok: false, error: 'unauthorized' };
  }
  if (result.status === 503) return { ok: false, error: 'unavailable' };
  if (result.status !== 200) return { ok: false, error: 'failed' };

  return { ok: true, data: true };
}
