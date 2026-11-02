import { levelForGame, levelFromXp, type GameState } from './gamification';

/** Session-only login marker: closing the tab logs the admin out. */
export const DEV_SESSION_KEY = 'icse:dev:session';

/** Larger values are clamped so the UI never has to render absurd numbers. */
export const MAX_DEV_CREDITS = 1_000_000_000;

/**
 * Credentials come from PUBLIC_DEV_USERNAME / PUBLIC_DEV_PASSWORD at build
 * time. These values end up in the public JavaScript bundle, so this gate
 * only stops casual access. Never use a real account password here.
 */
export function devCredentialsConfigured(): boolean {
  return Boolean(import.meta.env.PUBLIC_DEV_USERNAME && import.meta.env.PUBLIC_DEV_PASSWORD);
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

export function isDevLogin(username: string, password: string): boolean {
  return credentialsMatch(
    username,
    password,
    import.meta.env.PUBLIC_DEV_USERNAME ?? '',
    import.meta.env.PUBLIC_DEV_PASSWORD ?? '',
  );
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
  };
}
