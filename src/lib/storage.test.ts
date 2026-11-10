import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSession } from './engine';
import { WRONG_BOX_LOCK_MS } from './config';
import type { Question, Subject } from './types';

type StorageModule = typeof import('./storage');

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

function unavailableStorage(): Storage {
  const fail = (): never => {
    throw new Error('localStorage is unavailable');
  };

  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

function makeQuestion(id: string): Question {
  return {
    id,
    question: `Question ${id}?`,
    options: ['A', 'B', 'C', 'D'],
    answer: 0,
    explanation: `Explanation ${id}`,
    topic: 'general',
    verified: true,
  };
}

let storage: StorageModule;

beforeEach(async () => {
  vi.resetModules();
  storage = await import('./storage');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('storage with localStorage', () => {
  it('stores seen ids and stats under the subject keys', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    storage.markSeen('maths', 'm1');
    storage.markSeen('maths', 'm2');
    storage.markSeen('maths', 'm1');

    expect(storage.getSeen('maths')).toEqual(['m1', 'm2']);
    expect(JSON.parse(fake.getItem('mcq:maths:seen') ?? '[]')).toEqual(['m1', 'm2']);
    expect(storage.getSeen('history')).toEqual([]);

    storage.recordAnswer('maths', true);
    storage.recordAnswer('maths', false);
    storage.recordAnswer('maths', true);

    expect(storage.getStats('maths')).toEqual({ attempted: 3, correct: 2 });
    expect(JSON.parse(fake.getItem('mcq:maths:stats') ?? '{}')).toEqual({
      attempted: 3,
      correct: 2,
    });
    expect(storage.getStats('history')).toEqual({ attempted: 0, correct: 0 });
  });

  it('resets seen ids without touching stats', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    storage.markSeen('geography', 'g1');
    storage.markSeen('geography', 'g2');
    storage.recordAnswer('geography', true);

    storage.resetSeen('geography');

    expect(storage.getSeen('geography')).toEqual([]);
    expect(fake.getItem('mcq:geography:seen')).toBeNull();
    expect(storage.getStats('geography')).toEqual({ attempted: 1, correct: 1 });
  });

  it('returns defaults for malformed JSON and unexpected shapes', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    fake.setItem('mcq:english-lit:seen', '{not valid json');
    fake.setItem('mcq:english-lit:stats', 'also not json');

    expect(storage.getSeen('english-lit')).toEqual([]);
    expect(storage.getStats('english-lit')).toEqual({ attempted: 0, correct: 0 });

    fake.setItem('mcq:english-lit:seen', JSON.stringify({ not: 'an array' }));
    fake.setItem(
      'mcq:english-lit:stats',
      JSON.stringify({ attempted: 'many', correct: null }),
    );

    expect(storage.getSeen('english-lit')).toEqual([]);
    expect(storage.getStats('english-lit')).toEqual({ attempted: 0, correct: 0 });

    fake.setItem('mcq:english-lit:seen', JSON.stringify(['valid', 42, null]));
    expect(storage.getSeen('english-lit')).toEqual(['valid']);
  });

  it('stores and retrieves the user display name', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    expect(storage.getUserName()).toBeNull();
    storage.setUserName('  Aryan Sharma  ');
    expect(storage.getUserName()).toBe('Aryan Sharma');
    expect(fake.getItem('icse:username:v1')).toBe('Aryan Sharma');
  });
});

describe('storage fallback', () => {
  it('keeps working in memory when localStorage throws', () => {
    vi.stubGlobal('localStorage', unavailableStorage());

    expect(() => storage.markSeen('history', 'h1')).not.toThrow();
    expect(() => storage.markSeen('history', 'h2')).not.toThrow();
    storage.markSeen('history', 'h1');

    expect(storage.getSeen('history')).toEqual(['h1', 'h2']);

    storage.recordAnswer('history', false);
    storage.recordAnswer('history', true);

    expect(storage.getStats('history')).toEqual({ attempted: 2, correct: 1 });

    expect(() => storage.resetSeen('history')).not.toThrow();
    expect(storage.getSeen('history')).toEqual([]);
    expect(storage.getStats('history')).toEqual({ attempted: 2, correct: 1 });
  });

  it('works when localStorage does not exist', () => {
    vi.stubGlobal('localStorage', undefined);

    storage.markSeen('economics', 'e1');

    expect(storage.getSeen('economics')).toEqual(['e1']);
    expect(storage.getStats('economics')).toEqual({ attempted: 0, correct: 0 });
  });
});

describe('game storage', () => {
  it('returns defaults for malformed or unknown-version game JSON', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    expect(storage.getGame().v).toBe(1);

    fake.setItem('icse:game:v1', '{not json');
    expect(storage.getGame()).toEqual(expect.objectContaining({ v: 1, xp: 0 }));

    fake.setItem('icse:game:v1', JSON.stringify({ v: 99, xp: 999 }));
    expect(storage.getGame()).toEqual(expect.objectContaining({ v: 1, xp: 0 }));
  });

  it('round-trips game state and resets it without touching seen or stats', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    storage.markSeen('maths', 'm1');
    storage.recordAnswer('maths', true);
    const state = storage.getGame();
    state.xp = 42;
    state.dailyGoal = 20;
    storage.saveGame(state);

    expect(storage.getGame().xp).toBe(42);
    expect(storage.getGame().dailyGoal).toBe(20);

    storage.resetGame();

    expect(storage.getGame().xp).toBe(0);
    expect(storage.getSeen('maths')).toEqual(['m1']);
    expect(storage.getStats('maths')).toEqual({ attempted: 1, correct: 1 });
  });

  it('keeps game state in memory when localStorage throws', () => {
    vi.stubGlobal('localStorage', unavailableStorage());

    const state = storage.getGame();
    state.xp = 7;
    storage.saveGame(state);

    expect(storage.getGame().xp).toBe(7);
    storage.resetGame();
    expect(storage.getGame().xp).toBe(0);
  });
});

describe('wrong questions', () => {
  it('stores wrong ids separately from seen ids and stats', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    storage.markWrong('maths', 'm1');
    storage.markWrong('maths', 'm2');
    storage.markWrong('maths', 'm1');

    expect(storage.getWrong('maths')).toEqual(['m1', 'm2']);
    expect(JSON.parse(fake.getItem('mcq:maths:wrong') ?? '[]')).toEqual(['m1', 'm2']);
    expect(storage.getSeen('maths')).toEqual([]);
    expect(storage.getStats('maths')).toEqual({ attempted: 0, correct: 0 });
    expect(storage.getWrong('history')).toEqual([]);
  });

  it('unmarks a single id and clears the whole list', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    storage.markWrong('geography', 'g1');
    storage.markWrong('geography', 'g2');

    storage.unmarkWrong('geography', 'g1');
    expect(storage.getWrong('geography')).toEqual(['g2']);

    storage.unmarkWrong('geography', 'g2');
    expect(storage.getWrong('geography')).toEqual([]);

    storage.markWrong('geography', 'g3');
    storage.resetWrong('geography');
    expect(storage.getWrong('geography')).toEqual([]);
  });

  it('returns defaults for malformed wrong data', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    fake.setItem('mcq:english-lit:wrong', '{not valid json');
    expect(storage.getWrong('english-lit')).toEqual([]);

    fake.setItem('mcq:english-lit:wrong', JSON.stringify(['valid', 42, null]));
    expect(storage.getWrong('english-lit')).toEqual(['valid']);
  });

  it('keeps working in memory when localStorage throws', () => {
    vi.stubGlobal('localStorage', unavailableStorage());

    expect(() => storage.markWrong('history', 'h1')).not.toThrow();
    expect(() => storage.markWrong('history', 'h2')).not.toThrow();

    expect(storage.getWrong('history')).toEqual(['h1', 'h2']);

    storage.unmarkWrong('history', 'h1');
    expect(storage.getWrong('history')).toEqual(['h2']);

    expect(() => storage.resetWrong('history')).not.toThrow();
    expect(storage.getWrong('history')).toEqual([]);
  });

  it('stores a wrongAt timestamp when a question enters the Wrong box', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);
    const first = Date.parse('2026-01-01T00:00:00Z');

    storage.markWrong('maths', 'm1', first);
    expect(storage.getWrong('maths')).toEqual(['m1']);
    expect(storage.getWrongAt('maths', 'm1')).toBe(first);
    expect(JSON.parse(fake.getItem('mcq:maths:wrong_at') ?? '{}')).toEqual({ m1: first });

    // A failed retry keeps the question in the box and restarts the timer.
    const retry = first + 60 * 60 * 1000;
    const wrongRetry = storage.recordWrongAnswerResult('maths', 'm1', false, retry);
    expect(wrongRetry).toEqual({ removed: false, wrongAt: retry, inWrongList: true });
    expect(storage.getWrong('maths')).toEqual(['m1']);
    expect(storage.getWrongAt('maths', 'm1')).toBe(retry);

    // A correct retry removes it and its timestamp.
    const correctRetry = storage.recordWrongAnswerResult('maths', 'm1', true, retry + 1);
    expect(correctRetry).toEqual({ removed: true, wrongAt: null, inWrongList: false });
    expect(storage.getWrong('maths')).toEqual([]);
    expect(storage.getWrongAt('maths', 'm1')).toBeNull();

    // A correct answer for an id not in the list is ignored.
    expect(storage.recordWrongAnswerResult('maths', 'm1', true, retry)).toEqual({
      removed: false,
      wrongAt: null,
      inWrongList: false,
    });
  });

  it('locks a Wrong-box question for exactly 48 hours', () => {
    const markedAt = Date.parse('2026-01-01T00:00:00Z');

    expect(storage.isWrongLockedAt(markedAt, markedAt)).toBe(true);
    expect(storage.isWrongLockedAt(markedAt, markedAt + WRONG_BOX_LOCK_MS - 1)).toBe(true);
    expect(storage.isWrongLockedAt(markedAt, markedAt + WRONG_BOX_LOCK_MS)).toBe(false);
    expect(storage.wrongUnlockTime(markedAt)).toBe(markedAt + WRONG_BOX_LOCK_MS);
    expect(storage.isWrongLockedAt(null, markedAt)).toBe(false);
  });

  it('returns defaults for malformed wrong timestamps', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    fake.setItem('mcq:english-lit:wrong_at', '{not valid json');
    expect(storage.getWrongTimestamps('english-lit')).toEqual({});

    fake.setItem(
      'mcq:english-lit:wrong_at',
      JSON.stringify({ valid: 123, bad: 'later', zero: 0 }),
    );
    expect(storage.getWrongTimestamps('english-lit')).toEqual({ valid: 123 });
  });

  it('resetWrong clears timestamps along with the wrong list', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    storage.markWrong('physics', 'p1', 123);
    storage.resetWrong('physics');

    expect(storage.getWrong('physics')).toEqual([]);
    expect(storage.getWrongTimestamps('physics')).toEqual({});
  });
});

describe('sessions across storage', () => {
  it('never repeats questions after markSeen between consecutive sessions', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    const pool = Array.from({ length: 12 }, (_, index) => makeQuestion(`q${index + 1}`));
    const subject: Subject = 'history';
    const sessions: string[][] = [];
    let seen: string[] = [];

    while (seen.length < pool.length) {
      const session = buildSession(pool, seen, 5);

      expect(session.questions.length).toBeGreaterThan(0);
      expect(session.poolExhausted).toBe(false);

      const sessionIds = session.questions.map((question) => question.id);

      for (const id of sessionIds) {
        const previousIds = sessions.flat();
        expect(previousIds).not.toContain(id);
        storage.markSeen(subject, id);
      }

      sessions.push(sessionIds);
      seen = storage.getSeen(subject);
    }

    expect(sessions.map((session) => session.length)).toEqual([5, 5, 2]);
    expect(new Set(sessions.flat())).toHaveLength(pool.length);
    expect(storage.getSeen(subject).sort()).toEqual(pool.map((question) => question.id).sort());

    const exhausted = buildSession(pool, storage.getSeen(subject), 5);
    expect(exhausted.questions).toEqual([]);
    expect(exhausted.unseenCount).toBe(0);
    expect(exhausted.poolExhausted).toBe(true);
  });
});

describe('bookmarks and per-question stats', () => {
  it('toggles bookmarks and survives corrupt JSON', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    expect(storage.getBookmarks()).toEqual([]);
    expect(storage.toggleBookmark('hist-001')).toBe(true);
    expect(storage.isBookmarked('hist-001')).toBe(true);
    expect(storage.getBookmarks()).toEqual(['hist-001']);

    storage.toggleBookmark('hist-001');
    expect(storage.getBookmarks()).toEqual([]);

    fake.setItem('icse:bookmarks:v1', '{not json');
    expect(storage.getBookmarks()).toEqual([]);
  });

  it('records per-question attempts and clamps correct to attempted', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    storage.recordQuestionResult('maths', 'm1', false);
    storage.recordQuestionResult('maths', 'm1', true);
    expect(storage.getQuestionStats('maths')).toEqual({
      m1: { attempted: 2, correct: 1 },
    });

    storage.saveQuestionStats('maths', {
      m1: { attempted: 1, correct: 5 },
      m2: { attempted: 0, correct: 0 },
    });
    expect(storage.getQuestionStats('maths')).toEqual({
      m1: { attempted: 1, correct: 1 },
    });
  });

  it('keeps bookmarks and question stats in memory when localStorage throws', () => {
    vi.stubGlobal('localStorage', unavailableStorage());

    storage.toggleBookmark('phys-004');
    storage.recordQuestionResult('physics', 'phys-004', true);

    expect(storage.getBookmarks()).toEqual(['phys-004']);
    expect(storage.getQuestionStats('physics')).toEqual({
      'phys-004': { attempted: 1, correct: 1 },
    });
  });
});

describe('user description and profile ID', () => {
  it('reads and writes description with trimming and length limit', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    expect(storage.getUserDescription()).toBeNull();
    storage.setUserDescription('   Studying hard for ICSE 10th!   ');
    expect(storage.getUserDescription()).toBe('Studying hard for ICSE 10th!');

    storage.setUserDescription('   ');
    expect(storage.getUserDescription()).toBeNull();

    const longDesc = 'a'.repeat(300);
    storage.setUserDescription(longDesc);
    expect(storage.getUserDescription()?.length).toBe(250);
  });

  it('reads and writes valid profile IDs', () => {
    vi.stubGlobal('localStorage', new FakeStorage());

    expect(storage.getMyProfileId()).toBeNull();
    storage.setMyProfileId('0123456789abcdef');
    expect(storage.getMyProfileId()).toBe('0123456789abcdef');

    // Invalid id is ignored
    storage.setMyProfileId('not-a-valid-id');
    expect(storage.getMyProfileId()).toBe('0123456789abcdef');
  });
});
