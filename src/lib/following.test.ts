import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFollowing,
  followUser,
  getFollowing,
  isFollowing,
  toggleFollow,
  unfollowUser,
} from './following';

beforeEach(() => {
  clearFollowing();
});

describe('following system', () => {
  const user1 = { id: '0123456789abcdef', name: 'Brave Owl' };
  const user2 = { id: 'fedcba9876543210', name: 'Clever Fox' };

  it('starts empty', () => {
    expect(getFollowing()).toEqual([]);
    expect(isFollowing(user1.id)).toBe(false);
  });

  it('follows and checks status', () => {
    expect(followUser(user1)).toBe(true);
    expect(isFollowing(user1.id)).toBe(true);
    expect(getFollowing()).toHaveLength(1);
    expect(getFollowing()[0].name).toBe('Brave Owl');
    expect(getFollowing()[0].id).toBe(user1.id);

    // Cannot follow twice
    expect(followUser(user1)).toBe(false);
    expect(getFollowing()).toHaveLength(1);
  });

  it('unfollows a user', () => {
    followUser(user1);
    followUser(user2);
    expect(getFollowing()).toHaveLength(2);

    expect(unfollowUser(user1.id)).toBe(true);
    expect(isFollowing(user1.id)).toBe(false);
    expect(isFollowing(user2.id)).toBe(true);
    expect(getFollowing()).toHaveLength(1);

    // Unfollowing again returns false
    expect(unfollowUser(user1.id)).toBe(false);
  });

  it('toggles follow status', () => {
    expect(toggleFollow(user1)).toBe(true);
    expect(isFollowing(user1.id)).toBe(true);

    expect(toggleFollow(user1)).toBe(false);
    expect(isFollowing(user1.id)).toBe(false);
  });

  it('rejects invalid profile ids or empty names', () => {
    expect(followUser({ id: 'bad-id', name: 'Invalid' })).toBe(false);
    expect(followUser({ id: '0123456789abcdef', name: '   ' })).toBe(false);
    expect(getFollowing()).toEqual([]);
  });

  it('sorts newest followed first', () => {
    followUser({ id: user1.id, name: user1.name, followedAt: '2026-10-01T10:00:00.000Z' });
    followUser({ id: user2.id, name: user2.name, followedAt: '2026-10-02T10:00:00.000Z' });

    const list = getFollowing();
    expect(list[0].id).toBe(user2.id);
    expect(list[1].id).toBe(user1.id);
  });

  it('dispatches window events when available', () => {
    const fakeWindow = {
      dispatchEvent: vi.fn(),
    };
    vi.stubGlobal('window', fakeWindow);
    followUser(user1);
    expect(fakeWindow.dispatchEvent).toHaveBeenCalled();
    const event = fakeWindow.dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('icse:followingChange');
    expect(event.detail).toEqual({ id: user1.id, following: true });
    vi.unstubAllGlobals();
  });
});
