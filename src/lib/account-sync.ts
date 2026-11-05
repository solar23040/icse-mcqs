import {
  getAccount,
  getActiveAccount,
  updateAccountCloud,
  type LocalAccount,
} from './accounts';
import {
  loginSyncAccount,
  logoutSyncAccount,
  pullSyncData,
  pushSyncData,
  registerSyncAccount,
  type AccountError,
} from './account-api';
import { applySyncData, captureSyncData, mergeSyncData } from './sync';

export type SyncError = AccountError | 'not_linked' | 'sync_failed';

export interface SyncResult {
  ok: boolean;
  error?: SyncError;
  updatedAt?: number;
}

function fail(error: SyncError): SyncResult {
  return { ok: false, error };
}

/** Best-effort push; a failed push keeps the link so the user can retry. */
async function linkAndPush(
  account: LocalAccount,
  username: string,
  token: string,
  merged: ReturnType<typeof captureSyncData>,
): Promise<SyncResult> {
  const pushed = await pushSyncData(token, merged);
  updateAccountCloud(account.id, {
    username,
    token,
    lastSyncedAt: pushed.ok ? Date.now() : 0,
    autoSync: false,
  });

  if (!pushed.ok) return fail(pushed.error);
  return { ok: true, updatedAt: pushed.value.updatedAt };
}

/**
 * Opt-in step: creates a server-side sync account for the active local
 * profile and uploads its current progress. Nothing is sent before this call.
 */
export async function registerSync(username: string, password: string): Promise<SyncResult> {
  const account = getActiveAccount();
  const local = captureSyncData();
  const response = await registerSyncAccount(username, password, local);
  if (!response.ok) return fail(response.error);
  if (!response.value.token) return fail('invalid_response');

  const merged = response.value.data
    ? mergeSyncData(local, response.value.data)
    : local;
  if (!applySyncData(merged)) return fail('sync_failed');

  return linkAndPush(account, username, response.value.token, merged);
}

/**
 * Signs an existing sync account in on this device. Local progress is merged
 * with the server snapshot so neither side is discarded.
 */
export async function loginSync(username: string, password: string): Promise<SyncResult> {
  const account = getActiveAccount();
  const local = captureSyncData();
  const response = await loginSyncAccount(username, password);
  if (!response.ok) return fail(response.error);
  if (!response.value.token) return fail('invalid_response');

  const merged = response.value.data ? mergeSyncData(local, response.value.data) : local;
  if (!applySyncData(merged)) return fail('sync_failed');

  return linkAndPush(account, username, response.value.token, merged);
}

/** Pull, merge, apply locally, then push the merged snapshot back. */
export async function syncNow(accountId?: string): Promise<SyncResult> {
  const account = accountId ? getAccount(accountId) : getActiveAccount();
  if (!account?.cloud) return fail('not_linked');

  const local = captureSyncData();
  const pulled = await pullSyncData(account.cloud.token);
  if (!pulled.ok) return fail(pulled.error);

  const merged = pulled.value.data ? mergeSyncData(local, pulled.value.data) : local;
  if (!applySyncData(merged)) return fail('sync_failed');

  const pushed = await pushSyncData(account.cloud.token, merged);
  if (!pushed.ok) return fail(pushed.error);

  updateAccountCloud(account.id, {
    ...account.cloud,
    lastSyncedAt: Date.now(),
  });
  return { ok: true, updatedAt: pushed.value.updatedAt };
}

export function disconnectSync(accountId: string): void {
  const account = getAccount(accountId);
  if (!account?.cloud) return;

  void logoutSyncAccount(account.cloud.token);
  updateAccountCloud(accountId, null);
}

export function setAutoSync(accountId: string, autoSync: boolean): boolean {
  const account = getAccount(accountId);
  if (!account?.cloud) return false;

  updateAccountCloud(accountId, { ...account.cloud, autoSync });
  return true;
}

export function activeAccountNeedsSync(): boolean {
  const account = getActiveAccount();
  return Boolean(account.cloud?.autoSync && account.cloud.token);
}
