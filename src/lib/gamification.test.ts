import { describe, expect, it } from 'vitest';
import {
  answerXp,
  applyAnswer,
  applySession,
  defaultGameState,
  levelFromXp,
  touchStreak,
  xpForLevel,
  type GameState,
} from './gamification';

function withDaily(state: GameState, day: string, answered = 10): GameState {
  return { ...state, daily: { day, answered } };
}

function withStreak(
  state: GameState,
  count: number,
  lastDay: string,
  freezes = 0,
  best = count,
): GameState {
  return { ...state, streak: { count, lastDay, freezes, best } };
}

describe('level curve', () => {
  it('maps XP thresholds to levels', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(199)).toBe(2);
    expect(levelFromXp(200)).toBe(3);
    expect(levelFromXp(450)).toBe(4);
  });

  it('inverts the XP curve', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(50);
    expect(xpForLevel(3)).toBe(200);
    expect(xpForLevel(4)).toBe(450);
    for (let level = 1; level <= 20; level += 1) {
      expect(levelFromXp(xpForLevel(level))).toBe(level);
    }
  });

  it('tolerates negative and non-finite XP', () => {
    expect(levelFromXp(-10)).toBe(1);
    expect(levelFromXp(Number.NaN)).toBe(1);
    expect(levelFromXp(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('answerXp', () => {
  it('applies the combo tiers and caps at x2', () => {
    expect(answerXp(true, 1, false)).toBe(10);
    expect(answerXp(true, 2, false)).toBe(10);
    expect(answerXp(true, 3, false)).toBe(15);
    expect(answerXp(true, 5, false)).toBe(15);
    expect(answerXp(true, 6, false)).toBe(20);
    expect(answerXp(true, 99, false)).toBe(20);
  });

  it('never awards XP for a wrong answer', () => {
    expect(answerXp(false, 1, false)).toBe(0);
    expect(answerXp(false, 99, true)).toBe(0);
  });

  it('adds the missed bonus', () => {
    expect(answerXp(true, 1, true)).toBe(15);
    expect(answerXp({ correct: true, combo: 3, missed: true })).toBe(20);
  });
});

describe('applyAnswer', () => {
  it('awards XP, clears missed and is immutable', () => {
    const state = withDaily(defaultGameState(), '2026-01-01', 0);
    state.missed.q1 = true;

    const result = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
    });

    expect(result.state).not.toBe(state);
    expect(state.xp).toBe(0);
    expect(state.missed.q1).toBe(true);
    expect(result.state.xp).toBe(15);
    expect(result.state.missed.q1).toBeUndefined();
    expect(result.state.daily.answered).toBe(1);
    expect(result.events).toEqual([{ type: 'xp', amount: 15 }]);
  });

  it('does not pay the missed bonus twice', () => {
    const state = defaultGameState();
    state.missed.q1 = true;

    const first = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
    });
    const second = applyAnswer(first.state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 2,
      today: '2026-01-01',
    });

    expect(first.events).toEqual([{ type: 'xp', amount: 15 }]);
    expect(second.events).toEqual([{ type: 'xp', amount: 10 }]);
  });

  it('emits levelUp when crossing a level boundary', () => {
    const state = defaultGameState();
    state.xp = 45;

    const result = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
    });

    expect(result.state.xp).toBe(55);
    expect(result.events).toEqual([
      { type: 'xp', amount: 10 },
      { type: 'levelUp', level: 2 },
    ]);
  });

  it('resets the daily counter when the day changes', () => {
    const state = withDaily(defaultGameState(), '2026-01-01', 5);

    const result = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-02',
    });

    expect(result.state.daily).toEqual({ day: '2026-01-02', answered: 1 });
  });

  it('emits goalReached exactly when the daily goal is hit', () => {
    const state = withDaily(defaultGameState(), '2026-01-01', 9);

    const result = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
    });

    expect(result.state.daily.answered).toBe(10);
    expect(result.events).toContainEqual({ type: 'goalReached' });
  });
});

describe('streaks', () => {
  it('continues on the next day and across a single missed day', () => {
    let state = withDaily(withStreak(defaultGameState(), 3, '2026-01-01'), '2026-01-02');
    state = touchStreak(state, '2026-01-02');
    expect(state.streak.count).toBe(4);
    expect(state.streak.lastDay).toBe('2026-01-02');

    state = withDaily(withStreak(defaultGameState(), 3, '2026-01-01'), '2026-01-03');
    state = touchStreak(state, '2026-01-03');
    expect(state.streak.count).toBe(4);
  });

  it('uses one freeze per missed day for larger gaps', () => {
    let state = withDaily(
      withStreak(defaultGameState(), 5, '2026-01-01', 2),
      '2026-01-04',
    );
    state = touchStreak(state, '2026-01-04');
    expect(state.streak.count).toBe(6);
    expect(state.streak.freezes).toBe(0);

    state = withDaily(withStreak(defaultGameState(), 5, '2026-01-01', 1), '2026-01-04');
    state = touchStreak(state, '2026-01-04');
    expect(state.streak.count).toBe(1);
  });

  it('handles month and year rollovers', () => {
    let state = withDaily(withStreak(defaultGameState(), 2, '2026-01-31'), '2026-02-01');
    state = touchStreak(state, '2026-02-01');
    expect(state.streak.count).toBe(3);

    state = withDaily(withStreak(defaultGameState(), 4, '2025-12-31'), '2026-01-01');
    state = touchStreak(state, '2026-01-01');
    expect(state.streak.count).toBe(5);
  });

  it('ignores a clock that goes backwards', () => {
    const state = withDaily(withStreak(defaultGameState(), 4, '2026-01-05'), '2026-01-04');
    const result = touchStreak(state, '2026-01-04');
    expect(result).toBe(state);
  });

  it('does not count a day before the daily goal is met', () => {
    const state = withDaily(defaultGameState(), '2026-01-01', 9);
    expect(touchStreak(state, '2026-01-01')).toBe(state);
  });

  it('earns a freeze every seven streak days, up to two', () => {
    let state = withDaily(withStreak(defaultGameState(), 6, '2026-01-06', 0, 6), '2026-01-07');
    state = touchStreak(state, '2026-01-07');
    expect(state.streak.count).toBe(7);
    expect(state.streak.freezes).toBe(1);

    state = withDaily(withStreak(defaultGameState(), 6, '2026-01-06', 2, 6), '2026-01-07');
    state = touchStreak(state, '2026-01-07');
    expect(state.streak.freezes).toBe(2);
  });

  it('tracks the best streak', () => {
    const state = withDaily(withStreak(defaultGameState(), 9, '2026-01-01', 0, 12), '2026-01-02');
    const result = touchStreak(state, '2026-01-02');
    expect(result.streak.count).toBe(10);
    expect(result.streak.best).toBe(12);
  });
});

describe('applySession', () => {
  it('awards 20 XP and counts the streak even below the daily goal', () => {
    const state = withDaily(defaultGameState(), '2026-01-01', 0);

    const result = applySession(state, {
      subject: 'history',
      total: 10,
      correct: 6,
      today: '2026-01-01',
    });

    expect(result.state.xp).toBe(20);
    expect(result.state.streak.count).toBe(1);
    expect(result.state.counters.sessions).toBe(1);
    expect(result.events).toEqual([{ type: 'xp', amount: 20 }, { type: 'streak', count: 1 }]);
  });

  it('does nothing for an empty session', () => {
    const state = defaultGameState();
    const result = applySession(state, {
      subject: 'history',
      total: 0,
      correct: 0,
      today: '2026-01-01',
    });

    expect(result.state.xp).toBe(0);
    expect(result.state.counters.sessions).toBeUndefined();
    expect(result.events).toEqual([]);
  });

  it('does not count the same day twice', () => {
    const first = applySession(defaultGameState(), {
      subject: 'history',
      total: 5,
      correct: 5,
      today: '2026-01-01',
    });
    const second = applySession(first.state, {
      subject: 'history',
      total: 5,
      correct: 5,
      today: '2026-01-01',
    });

    expect(second.state.streak.count).toBe(1);
    expect(second.state.xp).toBe(40);
  });
});

describe('defaultGameState', () => {
  it('returns an independent blank state each time', () => {
    const first = defaultGameState();
    const second = defaultGameState();
    first.xp = 99;
    first.boxes.q1 = 1;
    expect(second.xp).toBe(0);
    expect(second.boxes.q1).toBeUndefined();
  });
});
