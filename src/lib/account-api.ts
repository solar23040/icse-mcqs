import { normaliseSyncData, type SyncData } from './sync';

const ENDPOINT = '/api/account';
const TIMEOUT_MS = 10_000;

export type AccountError =
  | 'not_configured'
  | 'username_taken'
  | 'invalid_credentials'
  | 'invalid_username'
  | 'weak_password'
  | 'unauthorized'
  | 'invalid_payload'
  | 'payload_too_large'
  | 'storage_unavailable'
  | 'network'
  | 'invalid_response'
  | 'unknown';

export interface RemoteSync {
  token: string | null;
  data: SyncData | null;
  updatedAt: number;
  rev: number;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: AccountError };

const KNOWN_ERRORS = new Set<AccountError>([
  'not_configured',
  'username_taken',
  'invalid_credentials',
  'invalid_username',
  'weak_password',
  'unauthorized',
  'invalid_payload',
  'payload_too_large',
  'storage_unavailable',
  'network',
  'invalid_response',
  'unknown',
]);

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normaliseResponse(payload: unknown): RemoteSync | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const record = payload as Record<string, unknown>;
  if (record.ok !== true) return null;

  const data = record.data === null || record.data === undefined ? null : normaliseSyncData(record.data);
  if (record.data !== null && record.data !== undefined && data === null) return null;

  return {
    token: typeof record.token === 'string' && record.token.length > 0 ? record.token : null,
    data,
    updatedAt: toCount(record.updatedAt),
    rev: toCount(record.rev),
  };
}

async function request(
  action: string,
  body: Record<string, unknown> = {},
  token?: string,
): Promise<ApiResult<RemoteSync>> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status === 404) {
      // `npm run dev` serves the static site only, so the API route is absent.
      return { ok: false, error: 'not_configured' };
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, error: 'invalid_response' };
    }

    if (!response.ok) {
      const raw =
        typeof payload === 'object' && payload !== null
          ? (payload as { error?: unknown }).error
          : undefined;
      const error =
        typeof raw === 'string' && KNOWN_ERRORS.has(raw as AccountError)
          ? (raw as AccountError)
          : response.status === 401
            ? 'unauthorized'
            : 'unknown';
      return { ok: false, error };
    }

    const value = normaliseResponse(payload);
    return value ? { ok: true, value } : { ok: false, error: 'invalid_response' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export function registerSyncAccount(
  username: string,
  password: string,
  data: SyncData,
): Promise<ApiResult<RemoteSync>> {
  return request('register', { username, password, data });
}

export function loginSyncAccount(
  username: string,
  password: string,
): Promise<ApiResult<RemoteSync>> {
  return request('login', { username, password });
}

export function pullSyncData(token: string): Promise<ApiResult<RemoteSync>> {
  return request('pull', {}, token);
}

export function pushSyncData(token: string, data: SyncData): Promise<ApiResult<RemoteSync>> {
  return request('push', { data }, token);
}

export function logoutSyncAccount(token: string): Promise<ApiResult<RemoteSync>> {
  return request('logout', {}, token);
}
