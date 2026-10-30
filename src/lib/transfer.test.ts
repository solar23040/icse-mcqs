import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

let storage: typeof import('./storage');
let transfer: typeof import('./transfer');

beforeEach(async () => {
  vi.resetModules();
  storage = await import('./storage');
  transfer = await import('./transfer');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('transfer', () => {
  it('round-trips game, seen and stats', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    const game = storage.getGame();
    game.xp = 123;
    storage.saveGame(game);
    storage.markSeen('maths', 'm1');
    storage.recordAnswer('maths', true);

    const code = transfer.exportProgress();
    expect(typeof code).toBe('string');

    storage.resetGame();
    storage.resetSeen('maths');
    expect(storage.getGame().xp).toBe(0);
    expect(storage.getSeen('maths')).toEqual([]);

    const result = transfer.importProgress(code);
    expect(result).toEqual({ ok: true });
    expect(storage.getGame().xp).toBe(123);
    expect(storage.getSeen('maths')).toEqual(['m1']);
    expect(storage.getStats('maths')).toEqual({ attempted: 1, correct: 1 });
  });

  it('rejects tampered codes', () => {
    vi.stubGlobal('localStorage', new FakeStorage());
    const code = transfer.exportProgress();
    const tampered = code.slice(0, -4) + 'AAAA';
    expect(transfer.importProgress(tampered).ok).toBe(false);
  });

  it('rejects unknown versions', () => {
    vi.stubGlobal('localStorage', new FakeStorage());
    const code = transfer.exportProgress();
    const decoded = JSON.parse(atob(code));
    decoded.v = 999;
    const recoded = btoa(JSON.stringify(decoded));
    expect(transfer.importProgress(recoded).ok).toBe(false);
  });
});