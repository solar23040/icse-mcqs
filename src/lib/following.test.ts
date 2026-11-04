import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFollower,
  clearFollowers,
  clearFollowing,
  followUser,
  getFollowers,
  getFollowing,
  isFollowing,
  removeFollower,
  toggleFollow,
  unfollowUser,
} from './following';
import { setMyProfileId, setUserName } from './storage';

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

describe('followers system', () => {
  const targetId = '1111222233334444';
  const follower1 = { id: '0123456789abcdef', name: 'Brave Owl' };
  const follower2 = { id: 'fedcba9876543210', name: 'Clever Fox' };

  it('starts with empty followers', () => {
    expect(getFollowers(targetId)).toEqual([]);
  });

  it('adds and retrieves followers', () => {
    expect(addFollower(targetId, follower1)).toBe(true);
    const followers = getFollowers(targetId);
    expect(followers).toHaveLength(1);
    expect(followers[0].id).toBe(follower1.id);
    expect(followers[0].name).toBe('Brave Owl');
  });

  it('rejects adding self as follower or invalid IDs', () => {
    expect(addFollower(targetId, { id: targetId, name: 'Myself' })).toBe(false);
    expect(addFollower('invalid-target', follower1)).toBe(false);
    expect(addFollower(targetId, { id: 'bad-id', name: 'Valid Name' })).toBe(false);
    expect(addFollower(targetId, { id: follower1.id, name: '   ' })).toBe(false);
  });

  it('removes followers', () => {
    addFollower(targetId, follower1);
    addFollower(targetId, follower2);
    expect(getFollowers(targetId)).toHaveLength(2);

    expect(removeFollower(targetId, follower1.id)).toBe(true);
    const remaining = getFollowers(targetId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(follower2.id);

    expect(removeFollower(targetId, follower1.id)).toBe(false);
  });

  it('clears followers for target or all', () => {
    addFollower(targetId, follower1);
    expect(getFollowers(targetId)).toHaveLength(1);

    clearFollowers(targetId);
    expect(getFollowers(targetId)).toEqual([]);
  });

  it('automatically mirrors followUser as a follower to target when myProfileId is set', () => {
    const myId = '9999888877776666';
    setMyProfileId(myId);
    setUserName('Lead Student');

    followUser({ id: targetId, name: 'Target Student' });
    const targetFollowers = getFollowers(targetId);
    expect(targetFollowers).toHaveLength(1);
    expect(targetFollowers[0].id).toBe(myId);
    expect(targetFollowers[0].name).toBe('Lead Student');

    unfollowUser(targetId);
    expect(getFollowers(targetId)).toHaveLength(0);
  });
});
