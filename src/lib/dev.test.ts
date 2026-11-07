import { describe, expect, it } from 'vitest';
import {
  addCredits,
  credentialsMatch,
  credentialsMatchHashed,
  isDevLogin,
  resetCredits,
  setCredits,
  syncDevCreditsToLeaderboard,
  toCredits,
} from './dev';
import { defaultGameState, levelFromXp } from './gamification';

describe('dev credentials', () => {
  it('accepts the configured username and password', () => {
    expect(credentialsMatch('devansh', '181011', 'devansh', '181011')).toBe(true);
  });

  it('ignores surrounding whitespace in the username only', () => {
    expect(credentialsMatch('  devansh  ', '181011', 'devansh', '181011')).toBe(true);
    expect(credentialsMatch('devansh', ' 181011 ', 'devansh', '181011')).toBe(false);
  });

  it('rejects wrong, empty or unconfigured credentials', () => {
    expect(credentialsMatch('someone', '181011', 'devansh', '181011')).toBe(false);
    expect(credentialsMatch('devansh', '000000', 'devansh', '181011')).toBe(false);
    expect(credentialsMatch('', '', 'devansh', '181011')).toBe(false);
    expect(credentialsMatch('devansh', '181011', '', '')).toBe(false);
  });

  it('accepts the baked hash when no build-time credentials are set', async () => {
    expect(await credentialsMatchHashed('devansh', '181011')).toBe(true);
    expect(await credentialsMatchHashed('  devansh  ', '181011')).toBe(true);
  });

  it('rejects wrong input against the baked hash', async () => {
    expect(await credentialsMatchHashed('devansh', '181010')).toBe(false);
    expect(await credentialsMatchHashed('someone', '181011')).toBe(false);
    expect(await credentialsMatchHashed('devansh', ' 181011 ')).toBe(false);
    expect(await credentialsMatchHashed('', '')).toBe(false);
  });

  it('logs in through the public helper', async () => {
    await expect(isDevLogin('devansh', '181011')).resolves.toBe(true);
    await expect(isDevLogin('devansh', 'nope')).resolves.toBe(false);
  });
});

describe('credit controls', () => {
  it('normalises admin input to safe whole numbers', () => {
    expect(toCredits(42.9)).toBe(42);
    expect(toCredits('500')).toBe(500);
    expect(toCredits(-10)).toBe(0);
    expect(toCredits(Number.NaN)).toBe(0);
    expect(toCredits(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toCredits(851011)).toBe(851011);
  });

  it('sets credits and raises lifetime XP with the level', () => {
    const state = defaultGameState();
    const next = setCredits(state, 1000);

    expect(next.xp).toBe(1000);
    expect(next.totalEarnedXP).toBe(1000);
    expect(next.highestLevelReached).toBe(levelFromXp(1000));
    expect(next).not.toBe(state);
  });

  it('never lowers lifetime XP or the level when credits are lowered', () => {
    const state = defaultGameState();
    state.xp = 1000;
    state.totalEarnedXP = 1000;
    state.highestLevelReached = levelFromXp(1000);

    const next = setCredits(state, 10);

    expect(next.xp).toBe(10);
    expect(next.totalEarnedXP).toBe(1000);
    expect(next.highestLevelReached).toBe(levelFromXp(1000));
  });

  it('adds and removes credits without going below zero', () => {
    const state = setCredits(defaultGameState(), 300);

    expect(addCredits(state, 200).xp).toBe(500);
    expect(addCredits(state, -1000).xp).toBe(0);
    expect(addCredits(state, -1000).totalEarnedXP).toBe(300);
  });

  it('resets spendable, lifetime and level', () => {
    const state = setCredits(defaultGameState(), 1000);
    const next = resetCredits(state);

    expect(next.xp).toBe(0);
    expect(next.totalEarnedXP).toBe(0);
    expect(next.highestLevelReached).toBe(1);
    // Other progress is untouched.
    expect(next.badges).toBe(state.badges);
    expect(next.streak).toBe(state.streak);
  });

  it('syncs dev credits to leaderboard state', () => {
    const game = setCredits(defaultGameState(), 1500);
    const lbState = syncDevCreditsToLeaderboard(game);

    expect(lbState.weeklyXp).toBe(1500);
    expect(lbState.lastTotalXp).toBe(1500);
    expect(lbState.optedIn).toBe(true);

    const resetGame = resetCredits(game);
    const resetLbState = syncDevCreditsToLeaderboard(resetGame);
    expect(resetLbState.weeklyXp).toBe(0);
    expect(resetLbState.lastTotalXp).toBe(0);
  });
});
