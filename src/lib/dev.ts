import { levelForGame, levelFromXp, type GameState } from './gamification';
import {
  currentIsoWeek,
  getLeaderboardState,
  saveLeaderboardState,
  type LeaderboardState,
} from './leaderboard';
import { getGame, saveGame } from './storage';

/** Session-only login marker: closing the tab logs the admin out. */
export const DEV_SESSION_KEY = 'icse:dev:session';

/** Larger values are clamped so the UI never has to render absurd numbers. */
export const MAX_DEV_CREDITS = 1_000_000_000;

/**
 * A salted SHA-256 gate is baked in so /dev still works on hosts that build
 * without PUBLIC_DEV_* variables (for example Vercel, which never sees the
 * gitignored .env.local). The hash ships in the public bundle and a short PIN
 * can be brute-forced offline, so this only stops casual access. Set
 * PUBLIC_DEV_USERNAME / PUBLIC_DEV_PASSWORD at build time to override it.
 */
const DEV_SALT = 'icse-dev-v1:';
export const DEV_USERNAME_HASH = '1280903e5653cb53a3ea2fb8594d41634dab58afbcb6de938c6b105846289fd7';
export const DEV_PASSWORD_HASH = 'a04aa5bc8f5dd88c50abe4f60214b4e3f928bd0ee5955bbb06f41a4be55b4ade';

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison for the tiny credential check. */
function fixedEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** Pure matcher, exported so the credential rules can be unit tested. */
export function credentialsMatch(
  username: string,
  password: string,
  expectedUsername: string,
  expectedPassword: string,
): boolean {
  if (!expectedUsername || !expectedPassword) return false;
  return (
    fixedEqual(username.trim(), expectedUsername) &&
    fixedEqual(password, expectedPassword)
  );
}

export function isDevLogin(username: string, password: string): Promise<boolean> {
  const expectedUsername = import.meta.env.PUBLIC_DEV_USERNAME ?? '';
  const expectedPassword = import.meta.env.PUBLIC_DEV_PASSWORD ?? '';

  if (expectedUsername && expectedPassword) {
    return Promise.resolve(
      credentialsMatch(username, password, expectedUsername, expectedPassword),
    );
  }
  return credentialsMatchHashed(username, password);
}

/** Matcher for the baked hash, used when no build-time credentials are set. */
export async function credentialsMatchHashed(
  username: string,
  password: string,
): Promise<boolean> {
  if (!DEV_USERNAME_HASH || !DEV_PASSWORD_HASH) return false;

  const [usernameHash, passwordHash] = await Promise.all([
    sha256Hex(DEV_SALT + username.trim()),
    sha256Hex(DEV_SALT + password),
  ]);
  return fixedEqual(usernameHash, DEV_USERNAME_HASH) && fixedEqual(passwordHash, DEV_PASSWORD_HASH);
}

export function hasDevSession(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem(DEV_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function startDevSession(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(DEV_SESSION_KEY, '1');
  } catch {
    // The panel still works for this page view.
  }
}

export function endDevSession(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(DEV_SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Clamp any admin-entered value to a safe non-negative whole number. */
export function toCredits(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(MAX_DEV_CREDITS, Math.max(0, Math.trunc(number)));
}

/**
 * Set spendable credits. Lifetime XP and the level stay monotonic, matching
 * the normal game rules; use resetCredits to wipe them on purpose.
 */
export function setCredits(game: GameState, credits: number): GameState {
  const xp = toCredits(credits);
  const totalEarnedXP = Math.max(toCredits(game.totalEarnedXP), xp);

  return {
    ...game,
    xp,
    totalEarnedXP,
    highestLevelReached: Math.max(
      levelForGame(game),
      levelFromXp(totalEarnedXP),
      levelFromXp(xp),
    ),
    counters: {
      ...game.counters,
      devCredits: 1,
    },
  };
}

/** Add or remove credits. Removing more than the balance stops at zero. */
export function addCredits(game: GameState, amount: number): GameState {
  const delta = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  return setCredits(game, toCredits(game.xp) + delta);
}

/** Wipe spendable and lifetime credits and return to level 1. */
export function resetCredits(game: GameState): GameState {
  return {
    ...game,
    xp: 0,
    totalEarnedXP: 0,
    highestLevelReached: 1,
    counters: {
      ...game.counters,
      devCredits: 1,
    },
  };
}

/**
 * Ensures the weekly leaderboard reflects dev-added or dev-adjusted credits.
 * Sets the weekly XP and baseline to match the game's totalEarnedXP.
 */
export function syncDevCreditsToLeaderboard(
  game: GameState,
  now = new Date(),
): LeaderboardState {
  const week = currentIsoWeek(now);
  const state = getLeaderboardState(now);
  const targetXp = toCredits(game.totalEarnedXP);

  const updated: LeaderboardState = {
    ...state,
    v: 1,
    optedIn: true,
    week,
    weeklyXp: targetXp,
    lastTotalXp: targetXp,
  };
  saveLeaderboardState(updated);
  return updated;
}

/** Exposes developer functions on window for direct browser dev console use. */
export function initDevConsoleHelpers(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;

  w.addCredits = (amount: number) => {
    const current = getGame();
    const next = addCredits(current, amount);
    saveGame(next);
    syncDevCreditsToLeaderboard(next);
    const msg = `Added ${amount} credits. Balance: ${next.xp} XP. Lifetime: ${next.totalEarnedXP} XP.`;
    console.log(msg);
    return msg;
  };

  w.setCredits = (amount: number) => {
    const current = getGame();
    const next = setCredits(current, amount);
    saveGame(next);
    syncDevCreditsToLeaderboard(next);
    const msg = `Credits set to ${next.xp} XP.`;
    console.log(msg);
    return msg;
  };

  w.resetCredits = () => {
    const current = getGame();
    const next = resetCredits(current);
    saveGame(next);
    syncDevCreditsToLeaderboard(next);
    const msg = 'Credits and level reset to 0.';
    console.log(msg);
    return msg;
  };

  w.syncCredits = () => {
    const current = getGame();
    syncDevCreditsToLeaderboard(current);
    const msg = `Credits synced: Game XP = ${current.xp}, Lifetime = ${current.totalEarnedXP}`;
    console.log(msg);
    return msg;
  };
}

if (typeof window !== 'undefined') {
  initDevConsoleHelpers();
}
