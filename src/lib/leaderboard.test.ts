import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceWeeklyXp,
  currentIsoWeek,
  defaultLeaderboardState,
  getLeaderboardState,
  saveLeaderboardState,
  setLeaderboardOptedIn,
  startLeaderboard,
  type LeaderboardState,
} from './leaderboard';

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
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function state(overrides: Partial<LeaderboardState> = {}): LeaderboardState {
  return {
    v: 1,
    optedIn: true,
    week: '2026-W01',
    weeklyXp: 10,
    lastTotalXp: 100,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('currentIsoWeek', () => {
  it('uses UTC ISO weeks across year boundaries', () => {
    expect(currentIsoWeek(new Date('2025-12-29T12:00:00Z'))).toBe('2026-W01');
    expect(currentIsoWeek(new Date('2026-01-04T12:00:00Z'))).toBe('2026-W01');
    expect(currentIsoWeek(new Date('2026-01-05T12:00:00Z'))).toBe('2026-W02');
  });
});

describe('advanceWeeklyXp', () => {
  it('adds positive XP changes within the same week', () => {
    expect(advanceWeeklyXp(state(), 150, '2026-W01')).toEqual(
      state({ weeklyXp: 60, lastTotalXp: 150 }),
    );
  });

  it('starts a fresh bucket when the week changes', () => {
    expect(advanceWeeklyXp(state(), 150, '2026-W02')).toEqual(
      state({ week: '2026-W02', weeklyXp: 0, lastTotalXp: 150 }),
    );
  });

  it('never subtracts XP after a reset or import', () => {
    expect(advanceWeeklyXp(state(), 40, '2026-W01')).toEqual(
      state({ weeklyXp: 10, lastTotalXp: 40 }),
    );
    expect(advanceWeeklyXp(state(), -20, '2026-W01')).toEqual(
      state({ weeklyXp: 10, lastTotalXp: 0 }),
    );
  });
});

describe('leaderboard preferences', () => {
  it('starts from the current XP baseline instead of submitting all-time XP', () => {
    expect(startLeaderboard(defaultLeaderboardState('2026-W01'), 900, '2026-W01')).toEqual({
      v: 1,
      optedIn: true,
      week: '2026-W01',
      weeklyXp: 0,
      lastTotalXp: 900,
    });

    expect(startLeaderboard(state({ weeklyXp: 50 }), 150, '2026-W01')).toEqual(
      state({ weeklyXp: 50, lastTotalXp: 150 }),
    );

    expect(startLeaderboard(state({ week: '2025-W52', weeklyXp: 50 }), 150, '2026-W01')).toEqual(
      state({ week: '2026-W01', weeklyXp: 0, lastTotalXp: 150 }),
    );
  });

  it('persists the opt-in flag without losing the weekly bucket', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    saveLeaderboardState(state({ optedIn: false }));
    const next = setLeaderboardOptedIn(true, new Date('2026-01-01T12:00:00Z'));

    expect(next.optedIn).toBe(true);
    expect(next.weeklyXp).toBe(10);
    expect(getLeaderboardState(new Date('2026-01-01T12:00:00Z'))).toEqual(next);
  });

  it('falls back to defaults when stored data is corrupt', () => {
    const storage = new FakeStorage();
    storage.setItem('icse:leaderboard:v1', '{not json');
    vi.stubGlobal('localStorage', storage);

    expect(getLeaderboardState(new Date('2026-01-01T12:00:00Z'))).toEqual(
      defaultLeaderboardState('2026-W01'),
    );
  });
});
