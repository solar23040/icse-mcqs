import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSession } from './engine';
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
