import { describe, expect, it } from 'vitest';
import {
  SECONDS_PER_QUESTION,
  formatClock,
  optionIndexFromKey,
  scorePercent,
} from './quiz-utils';

describe('formatClock', () => {
  it('formats seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(95)).toBe('1:35');
    expect(formatClock(3600)).toBe('60:00');
  });

  it('clamps invalid or negative values', () => {
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatClock(12.9)).toBe('0:12');
  });
});

describe('SECONDS_PER_QUESTION', () => {
  it('is 30 seconds', () => {
    expect(SECONDS_PER_QUESTION).toBe(30);
  });
});

describe('optionIndexFromKey', () => {
  it('maps 1-4 to zero-based option indexes', () => {
    expect(optionIndexFromKey('1', 4)).toBe(0);
    expect(optionIndexFromKey('4', 4)).toBe(3);
  });

  it('rejects out-of-range and non-numeric keys', () => {
    expect(optionIndexFromKey('0', 4)).toBeNull();
    expect(optionIndexFromKey('5', 4)).toBeNull();
    expect(optionIndexFromKey('a', 4)).toBeNull();
    expect(optionIndexFromKey('12', 4)).toBeNull();
  });
});

describe('scorePercent', () => {
  it('rounds the percentage and handles empty sessions', () => {
    expect(scorePercent(3, 4)).toBe(75);
    expect(scorePercent(1, 3)).toBe(33);
    expect(scorePercent(0, 0)).toBe(0);
  });
});
