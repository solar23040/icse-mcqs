import { describe, expect, it } from 'vitest';
import {
  answerXp,
  applyAnswer,
  applySession,
  defaultGameState,
  evaluateBadges,
  levelFromXp,
  masteryPercent,
  rankFor,
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

  it('awards Subject Sweep once no unseen questions remain', () => {
    const result = applySession(defaultGameState(), {
      subject: 'history',
      total: 10,
      correct: 6,
      today: '2026-01-01',
      unseenRemaining: 0,
    });

    expect(result.state.counters['sweep:history']).toBe(1);
    expect(result.state.badges['subject-sweep']).toBe('2026-01-01');
    expect(result.events).toContainEqual({ type: 'badge', id: 'subject-sweep' });
  });

  it('does not award Subject Sweep while questions are still unseen', () => {
    const result = applySession(defaultGameState(), {
      subject: 'history',
      total: 10,
      correct: 6,
      today: '2026-01-01',
      unseenRemaining: 1,
    });

    expect(result.state.badges['subject-sweep']).toBeUndefined();
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

describe('Leitner boxes', () => {
  it('moves correct answers up and wrong answers back to box 0', () => {
    const first = applyAnswer(defaultGameState(), {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
    });
    expect(first.state.boxes.q1).toBe(1);

    const second = applyAnswer(first.state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 2,
      today: '2026-01-01',
    });
    expect(second.state.boxes.q1).toBe(2);

    const wrong = applyAnswer(second.state, {
      questionId: 'q1',
      subject: 'maths',
      correct: false,
      combo: 0,
      today: '2026-01-01',
    });
    expect(wrong.state.boxes.q1).toBe(0);
    expect(wrong.state.missed.q1).toBe(true);
  });

  it('emits mastered once when reaching box 3', () => {
    let state = defaultGameState();
    let events: ReturnType<typeof applyAnswer>['events'] = [];

    for (let combo = 1; combo <= 3; combo += 1) {
      const result = applyAnswer(state, {
        questionId: 'q1',
        subject: 'maths',
        correct: true,
        combo,
        today: '2026-01-01',
      });
      state = result.state;
      events = result.events;
    }

    expect(state.boxes.q1).toBe(3);
    expect(events).toContainEqual({ type: 'mastered', questionId: 'q1' });

    const fourth = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 4,
      today: '2026-01-01',
    });
    expect(fourth.events.some((event) => event.type === 'mastered')).toBe(false);
  });

  it('caps XP at 2 for a question already in box 3', () => {
    const state = defaultGameState();
    state.boxes.q1 = 3;
    state.xp = 100;

    const result = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 9,
      today: '2026-01-01',
    });

    expect(result.state.xp).toBe(102);
    expect(result.events).toContainEqual({ type: 'xp', amount: 2 });
  });
});

describe('mastery and ranks', () => {
  it('computes mastered percentage', () => {
    const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }];
    expect(masteryPercent(questions, {})).toBe(0);
    expect(masteryPercent(questions, { q1: 3 })).toBe(25);
    expect(masteryPercent(questions, { q1: 3, q2: 3, q3: 3 })).toBe(75);
    expect(masteryPercent([], {})).toBe(0);
  });

  it('maps percentages to rank titles', () => {
    expect(rankFor(0)).toBe('Beginner');
    expect(rankFor(24)).toBe('Beginner');
    expect(rankFor(25)).toBe('Learner');
    expect(rankFor(49)).toBe('Learner');
    expect(rankFor(50)).toBe('Scholar');
    expect(rankFor(74)).toBe('Scholar');
    expect(rankFor(75)).toBe('Topper');
    expect(rankFor(100)).toBe('Topper');
  });
});

describe('badges', () => {
  it('awards First Steps after ten answers', () => {
    const state = defaultGameState();
    state.counters.answered = 10;
    expect(evaluateBadges(state)).toContain('first-steps');
  });

  it('awards Perfect Ten after a perfect session', () => {
    const state = defaultGameState();
    state.counters.perfectSessions = 1;
    expect(evaluateBadges(state)).toContain('perfect-ten');
  });

  it('awards Week Warrior from a 7-day streak', () => {
    const state = defaultGameState();
    state.streak.best = 7;
    expect(evaluateBadges(state)).toContain('week-warrior');
  });

  it('awards Comeback after five mastered missed questions', () => {
    const state = defaultGameState();
    state.counters.comeback = 5;
    expect(evaluateBadges(state)).toContain('comeback');
  });

  it('awards Century at 100 correct answers', () => {
    const state = defaultGameState();
    state.counters.correct = 100;
    expect(evaluateBadges(state)).toContain('century');
  });

  it('is idempotent and never re-awards a badge', () => {
    const state = defaultGameState();
    state.counters.answered = 10;
    state.badges['first-steps'] = '2026-01-01';
    expect(evaluateBadges(state)).not.toContain('first-steps');
  });

  it('awards Dedicated and Marathon for session volume', () => {
    const state = defaultGameState();
    state.counters.sessions = 25;
    expect(evaluateBadges(state)).toContain('dedicated');

    state.counters.sessions = 50;
    expect(evaluateBadges(state)).toContain('marathon');
  });

  it('awards Sharpshooter and Flawless Twenty', () => {
    const state = defaultGameState();
    state.counters.bestSessionStreak = 15;
    state.counters.perfectTwenty = 1;
    expect(evaluateBadges(state)).toEqual(
      expect.arrayContaining(['sharpshooter', 'flawless-twenty']),
    );
  });

  it('awards Mastermind and Specialist for mastery', () => {
    const state = defaultGameState();
    state.counters.mastered = 50;
    state.counters['mastered:history'] = 25;
    expect(evaluateBadges(state)).toEqual(expect.arrayContaining(['mastermind', 'specialist']));
  });

  it('does not award Specialist below 25 mastered in one subject', () => {
    const state = defaultGameState();
    state.counters['mastered:history'] = 24;
    expect(evaluateBadges(state)).not.toContain('specialist');
  });

  it('awards Comeback King at 25 mastered missed questions', () => {
    const state = defaultGameState();
    state.counters.comeback = 25;
    expect(evaluateBadges(state)).toContain('comeback-king');
  });

  it('awards Grand Slam after sweeping three subjects', () => {
    const state = defaultGameState();
    state.counters['sweep:history'] = 1;
    state.counters['sweep:maths'] = 1;
    state.counters['sweep:geography'] = 1;
    expect(evaluateBadges(state)).toContain('grand-slam');
  });

  it('awards Fortnight at a 14-day streak', () => {
    const state = defaultGameState();
    state.streak.best = 14;
    expect(evaluateBadges(state)).toContain('fortnight');
  });

  it('awards Daily Devotee and Goal Getter from counters', () => {
    const state = defaultGameState();
    state.counters.dailyChallenges = 7;
    state.counters.goalDays = 7;
    expect(evaluateBadges(state)).toEqual(expect.arrayContaining(['daily-devotee', 'goal-getter']));
  });

  it('awards Speed Demon at a sprint score of 150', () => {
    const state = defaultGameState();
    state.counters.bestSprint = 150;
    expect(evaluateBadges(state)).toContain('speed-demon');
  });

  it('awards Night Owl and Early Bird from time markers', () => {
    const state = defaultGameState();
    state.counters.nightOwl = 1;
    expect(evaluateBadges(state)).toContain('night-owl');

    const morning = defaultGameState();
    morning.counters.earlyBird = 1;
    expect(evaluateBadges(morning)).toContain('early-bird');
  });

  it('awards Collector last, once ten badges are earned', () => {
    const state = defaultGameState();
    state.badges = Object.fromEntries(
      [
        'perfect-ten',
        'week-warrior',
        'subject-sweep',
        'comeback',
        'all-rounder',
        'century',
        'dedicated',
        'sharpshooter',
        'mastermind',
      ].map((id) => [id, '2026-01-01']),
    );
    state.counters.answered = 10;
    const earned = evaluateBadges(state);
    expect(earned).toEqual(['first-steps', 'collector']);
  });

  it('does not award Collector below ten badges', () => {
    const state = defaultGameState();
    state.badges = Object.fromEntries(
      [
        'perfect-ten',
        'week-warrior',
        'subject-sweep',
        'comeback',
        'all-rounder',
        'century',
        'dedicated',
        'sharpshooter',
      ].map((id) => [id, '2026-01-01']),
    );
    state.counters.answered = 10;
    expect(evaluateBadges(state)).not.toContain('collector');
  });
});

describe('new badge counters', () => {
  it('tracks session best streak, perfect twenty and sprint score', () => {
    const result = applySession(defaultGameState(), {
      subject: 'sprint',
      total: 20,
      correct: 20,
      today: '2026-01-01',
      bestStreak: 16,
      score: 160,
    });

    expect(result.state.counters.bestSessionStreak).toBe(16);
    expect(result.state.counters.perfectTwenty).toBe(1);
    expect(result.state.counters.bestSprint).toBe(160);
    expect(result.events).toEqual(
      expect.arrayContaining([
        { type: 'badge', id: 'sharpshooter' },
        { type: 'badge', id: 'flawless-twenty' },
        { type: 'badge', id: 'speed-demon' },
      ]),
    );
  });

  it('keeps the highest per-session and sprint values', () => {
    const state = defaultGameState();
    state.counters.bestSessionStreak = 20;
    state.counters.bestSprint = 200;

    const result = applySession(state, {
      subject: 'sprint',
      total: 5,
      correct: 5,
      today: '2026-01-01',
      bestStreak: 4,
      score: 60,
    });

    expect(result.state.counters.bestSessionStreak).toBe(20);
    expect(result.state.counters.bestSprint).toBe(200);
  });

  it('counts mastery per subject and overall', () => {
    const state = defaultGameState();
    state.boxes.q1 = 2;

    const result = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 3,
      today: '2026-01-01',
    });

    expect(result.state.counters.mastered).toBe(1);
    expect(result.state.counters['mastered:maths']).toBe(1);
  });

  it('counts a day when the daily goal is reached', () => {
    const state = withDaily(defaultGameState(), '2026-01-01', 9);

    const result = applyAnswer(state, {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
    });

    expect(result.state.counters.goalDays).toBe(1);
    expect(result.events).toContainEqual({ type: 'goalReached' });
  });

  it('marks Night Owl and Early Bird from the local hour', () => {
    const night = applyAnswer(defaultGameState(), {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
      hour: 23,
    });
    expect(night.state.counters.nightOwl).toBe(1);

    const morning = applyAnswer(defaultGameState(), {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
      hour: 6,
    });
    expect(morning.state.counters.earlyBird).toBe(1);

    const noon = applyAnswer(defaultGameState(), {
      questionId: 'q1',
      subject: 'maths',
      correct: true,
      combo: 1,
      today: '2026-01-01',
      hour: 12,
    });
    expect(noon.state.counters.nightOwl).toBeUndefined();
    expect(noon.state.counters.earlyBird).toBeUndefined();
  });
});
