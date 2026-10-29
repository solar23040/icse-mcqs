import { describe, expect, it } from 'vitest';
import {
  answerXp,
  applyAnswer,
  applySession,
  defaultGameState,
  evaluateBadges,
  levelFromXp,
  touchStreak,
  xpForLevel,
} from './gamification';

describe('gamification contract', () => {
  it('exports the public functions', () => {
    expect(typeof answerXp).toBe('function');
    expect(typeof applyAnswer).toBe('function');
    expect(typeof applySession).toBe('function');
    expect(typeof defaultGameState).toBe('function');
    expect(typeof evaluateBadges).toBe('function');
    expect(typeof levelFromXp).toBe('function');
    expect(typeof touchStreak).toBe('function');
    expect(typeof xpForLevel).toBe('function');
  });

  it('returns a blank versioned state', () => {
    expect(defaultGameState()).toEqual({
      v: 1,
      xp: 0,
      streak: { count: 0, lastDay: '', freezes: 0, best: 0 },
      dailyGoal: 10,
      daily: { day: '', answered: 0 },
      badges: {},
      boxes: {},
      missed: {},
      counters: {},
    });
  });
});
