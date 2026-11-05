/**
 * Local account (profile) management.
 *
 * Every account keeps its own progress. The first account keeps the original
 * unscoped `localStorage` keys so existing visitors keep all of their work
 * after this feature ships. Accounts added later are namespaced with
 * `::acct:<id>`.
 *
 * Cloud sync is optional and lives in `account-sync.ts`. Nothing here talks to
 * the network, and passwords are never stored in the browser.
 */

const ACCOUNTS_KEY = 'icse:accounts:v1';
const DEFAULT_ACCOUNT_ID = 'local-default';
const SCOPE_MARKER = '::acct:';
const MAX_NAME_LENGTH = 24;

export interface CloudLink {
  username: string;
  /** Bearer token for /api/account. Never a password. */
  token: string;
  lastSyncedAt: number;
  autoSync: boolean;
}

export interface LocalAccount {
  id: string;
  name: string;
  createdAt: number;
  cloud?: CloudLink;
}

export interface AccountStore {
  v: 1;
  activeId: string;
  accounts: LocalAccount[];
}

/** Keys that belong to the original (unscoped) account and can be cleared. */
const LEGACY_PROGRESS_PREFIXES = [
  'mcq:',
  'icse:game:',
  'icse:username:',
  'icse:leaderboard:',
  'icse:sync:',
  'icse:activity:',
  'icse:following:',
  'icse:followers_map:',
  'icse:description:',
  'icse:my_profile_id:',
];

const memory = new Map<string, string>();
const removedKeys = new Set<string>();
let cachedStore: AccountStore | null = null;

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  const storage = getStorage();

  if (storage) {
    try {
      const value = storage.getItem(key);
      if (value !== null) {
        memory.set(key, value);
        removedKeys.delete(key);
        return value;
      }
    } catch {
      // Fall through to the in-memory copy.
    }
  }

  if (removedKeys.has(key)) return null;
  return memory.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  memory.set(key, value);
  removedKeys.delete(key);

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(key, value);
  } catch {
    // The memory copy above is the fallback.
  }
}

function removeRaw(key: string): void {
  memory.delete(key);
  removedKeys.add(key);

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(key);
  } catch {
    // The memory tombstone above is the fallback.
  }
}

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp-based id.
  }
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Keep names short, readable and free of markup. */
export function sanitiseAccountName(value: string, fallback = 'My account'): string {
  const clean = value.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return clean || fallback;
}

function defaultAccount(): LocalAccount {
  return {
    id: DEFAULT_ACCOUNT_ID,
    name: 'My account',
    createdAt: Date.now(),
  };
}

function defaultStore(): AccountStore {
  const account = defaultAccount();
  return { v: 1, activeId: account.id, accounts: [account] };
}

function normaliseCloud(value: unknown): CloudLink | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.username !== 'string' || record.username.length === 0) return undefined;
  if (typeof record.token !== 'string' || record.token.length < 8) return undefined;

  return {
    username: record.username.slice(0, 32),
    token: record.token,
    lastSyncedAt:
      typeof record.lastSyncedAt === 'number' && Number.isFinite(record.lastSyncedAt)
        ? Math.max(0, Math.trunc(record.lastSyncedAt))
        : 0,
    autoSync: record.autoSync === true,
  };
}

function normaliseAccount(value: unknown): LocalAccount | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) return null;

  const cloud = normaliseCloud(record.cloud);
  return {
    id: record.id.slice(0, 64),
    name: sanitiseAccountName(
      typeof record.name === 'string' ? record.name : '',
      record.id === DEFAULT_ACCOUNT_ID ? 'My account' : 'Account',
    ),
    createdAt:
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? Math.max(0, Math.trunc(record.createdAt))
        : 0,
    ...(cloud ? { cloud } : {}),
  };
}

function parseStore(raw: string): AccountStore | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 || !Array.isArray(record.accounts)) return null;

    const accounts = record.accounts
      .map(normaliseAccount)
      .filter((account): account is LocalAccount => account !== null);
    if (accounts.length === 0) return null;

    // Refuse duplicate ids rather than silently sharing one account's progress.
    const unique = new Map<string, LocalAccount>();
    for (const account of accounts) {
      if (!unique.has(account.id)) unique.set(account.id, account);
    }
    const list = [...unique.values()];

    const activeId =
      typeof record.activeId === 'string' && unique.has(record.activeId)
        ? record.activeId
        : list[0]!.id;

    return { v: 1, activeId, accounts: list };
  } catch {
    return null;
  }
}

/** Loads the store, creating the original account on first use. */
export function getAccountStore(): AccountStore {
  if (cachedStore) return cachedStore;

  const raw = readRaw(ACCOUNTS_KEY);
  const parsed = raw === null ? null : parseStore(raw);
  if (parsed) {
    cachedStore = parsed;
    return parsed;
  }

  const store = defaultStore();
  saveAccountStore(store);
  return store;
}

function saveAccountStore(store: AccountStore): void {
  cachedStore = store;
  writeRaw(ACCOUNTS_KEY, JSON.stringify(store));
}

export function listAccounts(): LocalAccount[] {
  return getAccountStore().accounts;
}

export function getActiveAccountId(): string {
  return getAccountStore().activeId;
}

export function getActiveAccount(): LocalAccount {
  const store = getAccountStore();
  return store.accounts.find((account) => account.id === store.activeId) ?? store.accounts[0]!;
}

export function getAccount(id: string): LocalAccount | null {
  return getAccountStore().accounts.find((account) => account.id === id) ?? null;
}

/**
 * Returns the storage key for the active account. The original account keeps
 * the legacy key so existing progress and the existing backup format keep
 * working without a migration step.
 */
export function scopedKey(base: string): string {
  const activeId = getActiveAccountId();
  return activeId === DEFAULT_ACCOUNT_ID ? base : `${base}${SCOPE_MARKER}${activeId}`;
}

function notify(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('icse:accountsChanged'));
    }
  } catch {
    // Events are a best-effort UI refresh mechanism.
  }
}

export function createAccount(name: string): LocalAccount {
  const store = getAccountStore();
  const account: LocalAccount = {
    id: makeId(),
    name: sanitiseAccountName(name),
    createdAt: Date.now(),
  };

  saveAccountStore({
    ...store,
    activeId: account.id,
    accounts: [...store.accounts, account],
  });
  notify();
  return account;
}

export function switchAccount(id: string): boolean {
  const store = getAccountStore();
  if (!store.accounts.some((account) => account.id === id)) return false;

  saveAccountStore({ ...store, activeId: id });
  notify();
  return true;
}

export function renameAccount(id: string, name: string): boolean {
  const store = getAccountStore();
  const clean = sanitiseAccountName(name, '');

  if (!clean || !store.accounts.some((account) => account.id === id)) return false;

  saveAccountStore({
    ...store,
    accounts: store.accounts.map((account) =>
      account.id === id ? { ...account, name: clean } : account,
    ),
  });
  notify();
  return true;
}

export function updateAccountCloud(id: string, cloud: CloudLink | null): boolean {
  const store = getAccountStore();
  if (!store.accounts.some((account) => account.id === id)) return false;

  saveAccountStore({
    ...store,
    accounts: store.accounts.map((account) => {
      if (account.id !== id) return account;
      if (cloud === null) {
        const { cloud: _removed, ...rest } = account;
        return rest;
      }
      return { ...account, cloud };
    }),
  });
  notify();
  return true;
}

function isScopedTo(key: string, id: string): boolean {
  return key.endsWith(`${SCOPE_MARKER}${id}`);
}

function isLegacyProgressKey(key: string): boolean {
  if (key === ACCOUNTS_KEY || key === 'theme' || key === 'icse:poll-next-subject') return false;
  if (key.includes(SCOPE_MARKER)) return false;
  return LEGACY_PROGRESS_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function allKnownKeys(): string[] {
  const keys = new Set<string>(memory.keys());
  for (const key of removedKeys) keys.delete(key);

  const storage = getStorage();
  if (!storage) return [...keys];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) keys.add(key);
    }
  } catch {
    // The in-memory list is the fallback.
  }

  return [...keys];
}

function deleteAccountData(account: LocalAccount): void {
  if (account.id === DEFAULT_ACCOUNT_ID) {
    for (const key of allKnownKeys()) {
      if (isLegacyProgressKey(key)) removeRaw(key);
    }
    return;
  }

  for (const key of allKnownKeys()) {
    if (isScopedTo(key, account.id)) removeRaw(key);
  }
}

/** Deletes an account and its local progress. The last account cannot go. */
export function deleteAccount(id: string): boolean {
  const store = getAccountStore();
  if (store.accounts.length <= 1) return false;

  const account = store.accounts.find((item) => item.id === id);
  if (!account) return false;

  deleteAccountData(account);
  const remaining = store.accounts.filter((item) => item.id !== id);
  const activeId = store.activeId === id ? remaining[0]!.id : store.activeId;

  saveAccountStore({ v: 1, activeId, accounts: remaining });
  notify();
  return true;
}

/** Test/helper hook: removes the whole account store without touching progress. */
export function resetAccountStoreForTests(): void {
  cachedStore = null;
  removeRaw(ACCOUNTS_KEY);
}

export { ACCOUNTS_KEY, DEFAULT_ACCOUNT_ID };
