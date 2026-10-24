import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollOptionId } from './poll';

type PollModule = typeof import('./poll');

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

let poll: PollModule;

beforeEach(async () => {
  vi.resetModules();
  poll = await import('./poll');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('poll options', () => {
  it('lists the nine candidate subjects with unique ids and labels', () => {
    expect(poll.POLL_OPTIONS).toHaveLength(9);
    expect(new Set(poll.POLL_OPTIONS.map((option) => option.id)).size).toBe(9);
    expect(new Set(poll.POLL_OPTIONS.map((option) => option.label)).size).toBe(9);
    expect(poll.POLL_OPTIONS.map((option) => option.label)).toEqual([
      'Mass Media',
      'Physical Education',
      'Computer Applications',
      'Hindi',
      'Physics',
      'Chemistry',
      'Biology',
      'Commercial Studies',
      'English Language',
    ]);
  });

  it('resolves labels and rejects unknown ids', () => {
    expect(poll.pollOptionLabel('chemistry')).toBe('Chemistry');
    expect(poll.isPollOptionId('chemistry')).toBe(true);
    expect(poll.isPollOptionId('astrology')).toBe(false);
    expect(poll.isPollOptionId(null)).toBe(false);
  });
});

describe('poll vote storage', () => {
  it('saves, reads and clears a vote', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    expect(poll.getPollVote()).toBeNull();
    expect(poll.savePollVote('physics')).toBe(true);

    expect(poll.getPollVote()).toBe('physics');
    expect(fake.getItem(poll.POLL_STORAGE_KEY)).toBe('physics');

    poll.clearPollVote();

    expect(poll.getPollVote()).toBeNull();
    expect(fake.getItem(poll.POLL_STORAGE_KEY)).toBeNull();
  });

  it('overwrites an existing vote', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    poll.savePollVote('hindi');
    poll.savePollVote('biology');

    expect(poll.getPollVote()).toBe('biology');
    expect(fake.getItem(poll.POLL_STORAGE_KEY)).toBe('biology');
  });

  it('ignores and removes a stored value that is not an option', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);
    fake.setItem(poll.POLL_STORAGE_KEY, 'astrology');

    expect(poll.getPollVote()).toBeNull();
    expect(fake.getItem(poll.POLL_STORAGE_KEY)).toBeNull();
  });

  it('refuses to save an unknown option', () => {
    const fake = new FakeStorage();
    vi.stubGlobal('localStorage', fake);

    expect(poll.savePollVote('astrology' as PollOptionId)).toBe(false);
    expect(fake.getItem(poll.POLL_STORAGE_KEY)).toBeNull();
    expect(poll.getPollVote()).toBeNull();
  });

  it('keeps working in memory when localStorage throws', () => {
    vi.stubGlobal('localStorage', unavailableStorage());

    expect(() => poll.savePollVote('mass-media')).not.toThrow();
    expect(poll.getPollVote()).toBe('mass-media');

    poll.clearPollVote();

    expect(poll.getPollVote()).toBeNull();
  });

  it('works when localStorage does not exist', () => {
    vi.stubGlobal('localStorage', undefined);

    poll.savePollVote('computer-applications');

    expect(poll.getPollVote()).toBe('computer-applications');

    poll.clearPollVote();

    expect(poll.getPollVote()).toBeNull();
  });
});
