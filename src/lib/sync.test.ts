import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

let storage: typeof import('./storage');
let sync: typeof import('./sync');

beforeEach(async () => {
  vi.resetModules();
  storage = await import('./storage');
  sync = await import('./sync');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function seedProgress(): void {
  storage.markSeen('maths', 'm1');
  storage.recordAnswer('maths', true);
  storage.recordAnswer('maths', false);
  storage.markWrong('maths', 'm2', 5000);
  storage.setUserName('Aryan');
  storage.setUserDescription('Preparing for boards.');

  const game = storage.getGame();
  game.xp = 120;
  game.totalEarnedXP = 150;
  game.highestLevelReached = 2;
  game.streak.count = 4;
  storage.saveGame(game);
}

describe('sync snapshots', () => {
  it('captures and restores game, seen, stats, mistakes and display name', () => {
    vi.stubGlobal('localStorage', new FakeStorage());
    seedProgress();

    const snapshot = sync.captureSyncData(1000);
    expect(snapshot.v).toBe(1);
    expect(snapshot.game.xp).toBe(120);
    expect(snapshot.seen.maths).toEqual(['m1']);
    expect(snapshot.stats.maths).toEqual({ attempted: 2, correct: 1 });
    expect(snapshot.wrong.maths).toEqual(['m2']);
    expect(snapshot.wrongAt.maths).toEqual({ m2: 5000 });
    expect(snapshot.username).toBe('Aryan');
    expect(snapshot.description).toBe('Preparing for boards.');

    storage.resetGame();
    storage.resetSeen('maths');
    storage.resetWrong('maths');
    storage.recordAnswer('maths', false);

    expect(sync.applySyncData(snapshot)).toBe(true);
    expect(storage.getGame().xp).toBe(120);
    expect(storage.getGame().totalEarnedXP).toBe(150);
    expect(storage.getGame().highestLevelReached).toBe(2);
    expect(storage.getSeen('maths')).toEqual(['m1']);
    expect(storage.getStats('maths')).toEqual({ attempted: 2, correct: 1 });
    expect(storage.getWrong('maths')).toEqual(['m2']);
    expect(storage.getWrongTimestamps('maths')).toEqual({ m2: 5000 });
    expect(storage.getUserName()).toBe('Aryan');
    expect(storage.getUserDescription()).toBe('Preparing for boards.');
  });

  it('rejects malformed or unknown-version snapshots', () => {
    expect(sync.normaliseSyncData(null)).toBeNull();
    expect(sync.normaliseSyncData({ v: 99 })).toBeNull();
    expect(sync.normaliseSyncData({ v: 1 })).toBeNull();
    expect(sync.applySyncData({ v: 1, game: 'nope' })).toBe(false);
  });

  it('merges progress without double-counting XP', () => {
    const base = sync.normaliseSyncData({
      v: 1,
      updatedAt: 1,
      game: {
        v: 1,
        xp: 100,
        totalEarnedXP: 100,
        highestLevelReached: 1,
        streak: { count: 2, lastDay: '2026-01-01', freezes: 0, best: 2 },
        dailyGoal: 10,
        daily: { day: '2026-01-01', answered: 5 },
        badges: { first: '2026-01-01' },
        boxes: { m1: 1 },
        missed: { m1: true },
        counters: { sessions: 1 },
      },
      seen: { maths: ['m1'] },
      stats: { maths: { attempted: 2, correct: 1 } },
      wrong: { maths: ['m2'] },
      wrongAt: { maths: { m2: 1000 } },
      username: 'Local',
      description: 'Local bio',
    })!;

    const remote = sync.normaliseSyncData({
      v: 1,
      updatedAt: 2,
      game: {
        v: 1,
        xp: 250,
        totalEarnedXP: 300,
        highestLevelReached: 3,
        streak: { count: 5, lastDay: '2026-01-03', freezes: 1, best: 5 },
        dailyGoal: 20,
        daily: { day: '2026-01-03', answered: 7 },
        badges: { second: '2026-01-03' },
        boxes: { m1: 3, m2: 2 },
        missed: { m3: true },
        counters: { sessions: 2, sprint: 1 },
      },
      seen: { maths: ['m1', 'm3'] },
      stats: { maths: { attempted: 5, correct: 4 } },
      wrong: { maths: ['m3'] },
      wrongAt: { maths: { m2: 2000, m3: 3000 } },
      username: 'Remote',
    })!;

    const merged = sync.mergeSyncData(base, remote, 999);

    expect(merged.updatedAt).toBe(999);
    expect(merged.game.xp).toBe(250);
    expect(merged.game.totalEarnedXP).toBe(300);
    expect(merged.game.highestLevelReached).toBe(3);
    expect(merged.game.streak).toEqual({
      count: 5,
      lastDay: '2026-01-03',
      freezes: 1,
      best: 5,
    });
    expect(merged.game.dailyGoal).toBe(20);
    expect(merged.game.daily).toEqual({ day: '2026-01-03', answered: 7 });
    expect(merged.game.badges).toEqual({
      first: '2026-01-01',
      second: '2026-01-03',
    });
    expect(merged.game.boxes).toEqual({ m1: 3, m2: 2 });
    expect(merged.game.missed).toEqual({ m1: true, m3: true });
    expect(merged.game.counters).toEqual({ sessions: 2, sprint: 1 });
    expect(merged.seen.maths).toEqual(['m1', 'm3']);
    expect(merged.stats.maths).toEqual({ attempted: 5, correct: 4 });
    expect(merged.wrong.maths).toEqual(['m2', 'm3']);
    expect(merged.wrongAt.maths).toEqual({ m2: 2000, m3: 3000 });
    expect(merged.username).toBe('Local');
    expect(merged.description).toBe('Local bio');
  });
});
