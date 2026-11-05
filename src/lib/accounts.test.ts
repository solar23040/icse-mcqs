import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

let accounts: typeof import('./accounts');
let storage: typeof import('./storage');

beforeEach(async () => {
  vi.resetModules();
  accounts = await import('./accounts');
  storage = await import('./storage');
});

describe('local accounts', () => {
  it('creates an original account that keeps using the legacy progress keys', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    const active = accounts.getActiveAccount();
    expect(active.name).toBe('My account');
    expect(accounts.listAccounts()).toHaveLength(1);
    expect(accounts.scopedKey('mcq:maths:seen')).toBe('mcq:maths:seen');

    storage.markSeen('maths', 'm1');
    expect(storage.getSeen('maths')).toEqual(['m1']);
  });

  it('namespaces progress for extra accounts and switches back to the original', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    storage.markSeen('maths', 'original');
    const second = accounts.createAccount('  Riya  ');

    expect(second.name).toBe('Riya');
    expect(accounts.getActiveAccountId()).toBe(second.id);
    expect(accounts.scopedKey('mcq:maths:seen')).toBe(`mcq:maths:seen::acct:${second.id}`);

    // The new account starts empty.
    expect(storage.getSeen('maths')).toEqual([]);
    storage.markSeen('maths', 'second-only');

    expect(fake.getItem(`mcq:maths:seen::acct:${second.id}`)).toBe('["second-only"]');

    expect(accounts.switchAccount(accounts.DEFAULT_ACCOUNT_ID)).toBe(true);
    expect(storage.getSeen('maths')).toEqual(['original']);
  });

  it('deletes only the selected account data', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    storage.markSeen('maths', 'original');
    const second = accounts.createAccount('Second');
    storage.markSeen('maths', 'second-only');
    storage.setUserName('Second person');

    expect(accounts.switchAccount(accounts.DEFAULT_ACCOUNT_ID)).toBe(true);
    expect(accounts.deleteAccount(second.id)).toBe(true);

    expect(fake.getItem(`mcq:maths:seen::acct:${second.id}`)).toBeNull();
    expect(fake.getItem(`icse:username:v1::acct:${second.id}`)).toBeNull();
    expect(storage.getSeen('maths')).toEqual(['original']);
    expect(accounts.listAccounts()).toHaveLength(1);
  });

  it('refuses to delete the last account', () => {
    vi.stubGlobal('localStorage', new FakeStorage());
    const only = accounts.getActiveAccount();

    expect(accounts.deleteAccount(only.id)).toBe(false);
    expect(accounts.listAccounts()).toHaveLength(1);
  });

  it('renames and stores optional cloud link metadata without a password', () => {
    vi.stubGlobal('localStorage', new FakeStorage());
    const active = accounts.getActiveAccount();

    expect(accounts.renameAccount(active.id, '  Board prep  ')).toBe(true);
    expect(accounts.getActiveAccount().name).toBe('Board prep');

    accounts.updateAccountCloud(active.id, {
      username: 'studier',
      token: 'a'.repeat(64),
      lastSyncedAt: 123,
      autoSync: false,
    });

    const linked = accounts.getActiveAccount();
    expect(linked.cloud).toEqual({
      username: 'studier',
      token: 'a'.repeat(64),
      lastSyncedAt: 123,
      autoSync: false,
    });
    expect(JSON.stringify(linked)).not.toContain('password');

    accounts.updateAccountCloud(active.id, null);
    expect(accounts.getActiveAccount().cloud).toBeUndefined();
  });
});
