import { scopedKey } from './accounts';
import { getMyProfileId, getUserName } from './storage';
import { followProfileApi, unfollowProfileApi } from './leaderboard-api';

export interface FollowedUser {
  id: string;
  name: string;
  followedAt: string;
}

export interface FollowerUser {
  id: string;
  name: string;
  followedAt: string;
}

const FOLLOWING_KEY = 'icse:following:v1';
const FOLLOWERS_MAP_KEY = 'icse:followers_map:v1';

function followingKey(): string {
  return scopedKey(FOLLOWING_KEY);
}

function followersMapKey(): string {
  return scopedKey(FOLLOWERS_MAP_KEY);
}
const MAX_FOLLOWING = 100;
const PROFILE_ID_PATTERN = /^[a-f0-9]{16}$/;

const memory = new Map<string, string>();
let removed = false;
let followersRemoved = false;

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      const value = storage.getItem(followingKey());
      if (value !== null) {
        memory.set(followingKey(), value);
        removed = false;
        return value;
      }
    } catch {
      // Fall through to memory copy
    }
  }

  if (removed) return null;
  return memory.get(followingKey()) ?? null;
}

function writeRaw(value: string): void {
  memory.set(followingKey(), value);
  removed = false;

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(followingKey(), value);
  } catch {
    // Memory copy is fallback
  }
}

function readFollowersMapRaw(): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      const value = storage.getItem(followersMapKey());
      if (value !== null) {
        memory.set(followersMapKey(), value);
        followersRemoved = false;
        return value;
      }
    } catch {
      // Fall through to memory copy
    }
  }

  if (followersRemoved) return null;
  return memory.get(followersMapKey()) ?? null;
}

function writeFollowersMapRaw(value: string): void {
  memory.set(followersMapKey(), value);
  followersRemoved = false;

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(followersMapKey(), value);
  } catch {
    // Memory copy is fallback
  }
}

function parseFollowing(raw: string): FollowedUser[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid: FollowedUser[] = [];
    const seenIds = new Set<string>();

    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const { id, name, followedAt } = item as { id?: unknown; name?: unknown; followedAt?: unknown };

      if (typeof id !== 'string' || !PROFILE_ID_PATTERN.test(id) || seenIds.has(id)) continue;
      if (typeof name !== 'string' || name.trim().length === 0) continue;

      const timestamp =
        typeof followedAt === 'string' && Number.isFinite(Date.parse(followedAt))
          ? followedAt
          : new Date().toISOString();

      seenIds.add(id);
      valid.push({
        id,
        name: name.trim().slice(0, 20),
        followedAt: timestamp,
      });
    }

    return valid;
  } catch {
    return [];
  }
}

function parseFollowersMap(raw: string): Record<string, FollowerUser[]> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const result: Record<string, FollowerUser[]> = {};

    for (const [key, list] of Object.entries(record)) {
      if (!PROFILE_ID_PATTERN.test(key) || !Array.isArray(list)) continue;
      const valid: FollowerUser[] = [];
      const seen = new Set<string>();

      for (const item of list) {
        if (typeof item !== 'object' || item === null) continue;
        const { id, name, followedAt } = item as { id?: unknown; name?: unknown; followedAt?: unknown };
        if (typeof id !== 'string' || !PROFILE_ID_PATTERN.test(id) || seen.has(id)) continue;
        if (typeof name !== 'string' || name.trim().length === 0) continue;
        const timestamp =
          typeof followedAt === 'string' && Number.isFinite(Date.parse(followedAt))
            ? followedAt
            : new Date().toISOString();
        seen.add(id);
        valid.push({
          id,
          name: name.trim().slice(0, 20),
          followedAt: timestamp,
        });
      }
      if (valid.length > 0) {
        result[key] = valid.sort((a, b) => Date.parse(b.followedAt) - Date.parse(a.followedAt));
      }
    }

    return result;
  } catch {
    return {};
  }
}

/** Returns the list of users currently followed, newest first. */
export function getFollowing(): FollowedUser[] {
  const raw = readRaw();
  if (raw === null) return [];
  const list = parseFollowing(raw);
  return list.sort((a, b) => Date.parse(b.followedAt) - Date.parse(a.followedAt));
}

/** Check if a profile id is followed. */
export function isFollowing(id: string): boolean {
  if (!PROFILE_ID_PATTERN.test(id)) return false;
  return getFollowing().some((user) => user.id === id);
}

/** Returns the list of followers for a profile id, or the current user if omitted. */
export function getFollowers(targetId?: string): FollowerUser[] {
  const profileId = targetId ?? getMyProfileId();
  if (!profileId || !PROFILE_ID_PATTERN.test(profileId)) return [];

  const raw = readFollowersMapRaw();
  if (!raw) return [];
  const map = parseFollowersMap(raw);
  return map[profileId] ?? [];
}

/** Adds a follower to a target profile in local storage. */
export function addFollower(
  targetId: string,
  follower: { id: string; name: string; followedAt?: string },
): boolean {
  if (!PROFILE_ID_PATTERN.test(targetId)) return false;
  if (!PROFILE_ID_PATTERN.test(follower.id)) return false;
  if (targetId === follower.id) return false;

  const cleanName = follower.name.trim().slice(0, 20);
  if (!cleanName) return false;

  const raw = readFollowersMapRaw();
  const map = raw ? parseFollowersMap(raw) : {};
  const current = map[targetId] ?? [];

  const entry: FollowerUser = {
    id: follower.id,
    name: cleanName,
    followedAt: follower.followedAt ?? new Date().toISOString(),
  };

  const updated = [entry, ...current.filter((f) => f.id !== follower.id)].slice(0, MAX_FOLLOWING);
  map[targetId] = updated;
  writeFollowersMapRaw(JSON.stringify(map));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('icse:followersChange', {
        detail: { targetId, followerId: follower.id, following: true },
      }),
    );
  }
  return true;
}

/** Removes a follower from a target profile in local storage. */
export function removeFollower(targetId: string, followerId: string): boolean {
  if (!PROFILE_ID_PATTERN.test(targetId) || !PROFILE_ID_PATTERN.test(followerId)) return false;

  const raw = readFollowersMapRaw();
  if (!raw) return false;
  const map = parseFollowersMap(raw);
  const current = map[targetId];
  if (!current) return false;

  const filtered = current.filter((f) => f.id !== followerId);
  if (filtered.length === current.length) return false;

  if (filtered.length === 0) {
    delete map[targetId];
  } else {
    map[targetId] = filtered;
  }
  writeFollowersMapRaw(JSON.stringify(map));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('icse:followersChange', {
        detail: { targetId, followerId, following: false },
      }),
    );
  }
  return true;
}

/** Follow a user. Returns true if added, false if already followed or invalid. */
export function followUser(user: { id: string; name: string; followedAt?: string }): boolean {
  if (!PROFILE_ID_PATTERN.test(user.id)) return false;
  const cleanName = user.name.trim().slice(0, 20);
  if (!cleanName) return false;

  const myId = getMyProfileId();
  if (myId && user.id === myId) return false;

  const current = getFollowing();
  if (current.some((entry) => entry.id === user.id)) return false;

  const entry: FollowedUser = {
    id: user.id,
    name: cleanName,
    followedAt: user.followedAt ?? new Date().toISOString(),
  };

  const updated = [entry, ...current].slice(0, MAX_FOLLOWING);
  writeRaw(JSON.stringify(updated));

  // Mirror as a follower to the target profile if our own profile ID is known
  if (myId) {
    const myName = getUserName() ?? 'You';
    addFollower(user.id, { id: myId, name: myName, followedAt: entry.followedAt });
  }

  // Trigger server sync in background (fire-and-forget)
  void followProfileApi(user.id);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('icse:followingChange', { detail: { id: user.id, following: true } }));
  }
  return true;
}

/** Unfollow a user by id. Returns true if removed, false if wasn't followed. */
export function unfollowUser(id: string): boolean {
  if (!PROFILE_ID_PATTERN.test(id)) return false;

  const current = getFollowing();
  const filtered = current.filter((entry) => entry.id !== id);
  if (filtered.length === current.length) return false;

  writeRaw(JSON.stringify(filtered));

  // Mirror removal from target profile's followers
  const myId = getMyProfileId();
  if (myId) {
    removeFollower(id, myId);
  }

  // Trigger server sync in background (fire-and-forget)
  void unfollowProfileApi(id);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('icse:followingChange', { detail: { id, following: false } }));
  }
  return true;
}

/** Toggles following status. Returns the new following status (true = now following). */
export function toggleFollow(user: { id: string; name: string }): boolean {
  if (isFollowing(user.id)) {
    unfollowUser(user.id);
    return false;
  }
  return followUser(user);
}

/** Reset followers map. Useful for tests. */
export function clearFollowers(targetId?: string): void {
  if (targetId) {
    const raw = readFollowersMapRaw();
    if (raw) {
      const map = parseFollowersMap(raw);
      delete map[targetId];
      writeFollowersMapRaw(JSON.stringify(map));
    }
  } else {
    memory.delete(followersMapKey());
    followersRemoved = true;
    const storage = getStorage();
    if (storage) {
      try {
        storage.removeItem(followersMapKey());
      } catch {
        // Ignored
      }
    }
  }
}

/** Reset followed list and followers map. Useful for tests. */
export function clearFollowing(): void {
  memory.delete(followingKey());
  removed = true;
  clearFollowers();
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(followingKey());
    } catch {
      // Ignored
    }
  }
}
