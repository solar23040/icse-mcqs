export interface FollowedUser {
  id: string;
  name: string;
  followedAt: string;
}

const FOLLOWING_KEY = 'icse:following:v1';
const MAX_FOLLOWING = 100;
const PROFILE_ID_PATTERN = /^[a-f0-9]{16}$/;

const memory = new Map<string, string>();
let removed = false;

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
      const value = storage.getItem(FOLLOWING_KEY);
      if (value !== null) {
        memory.set(FOLLOWING_KEY, value);
        removed = false;
        return value;
      }
    } catch {
      // Fall through to memory copy
    }
  }

  if (removed) return null;
  return memory.get(FOLLOWING_KEY) ?? null;
}

function writeRaw(value: string): void {
  memory.set(FOLLOWING_KEY, value);
  removed = false;

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(FOLLOWING_KEY, value);
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

/** Follow a user. Returns true if added, false if already followed or invalid. */
export function followUser(user: { id: string; name: string; followedAt?: string }): boolean {
  if (!PROFILE_ID_PATTERN.test(user.id)) return false;
  const cleanName = user.name.trim().slice(0, 20);
  if (!cleanName) return false;

  const current = getFollowing();
  if (current.some((entry) => entry.id === user.id)) return false;

  const entry: FollowedUser = {
    id: user.id,
    name: cleanName,
    followedAt: user.followedAt ?? new Date().toISOString(),
  };

  const updated = [entry, ...current].slice(0, MAX_FOLLOWING);
  writeRaw(JSON.stringify(updated));

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

/** Reset followed list. Useful for tests. */
export function clearFollowing(): void {
  memory.delete(FOLLOWING_KEY);
  removed = true;
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(FOLLOWING_KEY);
    } catch {
      // Ignored
    }
  }
}
