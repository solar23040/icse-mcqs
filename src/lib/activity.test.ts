import { beforeEach, describe, expect, it, vi } from 'vitest';

type ActivityModule = typeof import('./activity');

let activity: ActivityModule;

beforeEach(async () => {
  vi.resetModules();
  activity = await import('./activity');
});

describe('subject activity', () => {
  it('starts empty', () => {
    expect(activity.getRecentSubjects()).toEqual([]);
  });

  it('keeps the latest practice time per subject and sorts newest first', () => {
    activity.recordSubjectPractice('maths', new Date('2026-10-30T09:00:00.000Z'));
    activity.recordSubjectPractice('history', new Date('2026-10-31T09:00:00.000Z'));
    activity.recordSubjectPractice('maths', new Date('2026-10-31T12:00:00.000Z'));

    expect(activity.getRecentSubjects()).toEqual([
      { subject: 'maths', lastPracticed: '2026-10-31T12:00:00.000Z' },
      { subject: 'history', lastPracticed: '2026-10-31T09:00:00.000Z' },
    ]);
  });

  it('limits the number of returned subjects', () => {
    activity.recordSubjectPractice('maths', new Date('2026-10-31T09:00:00.000Z'));
    activity.recordSubjectPractice('history', new Date('2026-10-31T10:00:00.000Z'));
    activity.recordSubjectPractice('geography', new Date('2026-10-31T11:00:00.000Z'));

    expect(activity.getRecentSubjects(2)).toEqual([
      { subject: 'geography', lastPracticed: '2026-10-31T11:00:00.000Z' },
      { subject: 'history', lastPracticed: '2026-10-31T10:00:00.000Z' },
    ]);
  });

  it('ignores unknown subjects', () => {
    activity.recordSubjectPractice('not-a-subject' as never);

    expect(activity.getRecentSubjects()).toEqual([]);
  });
});

describe('weekly activity', () => {
  it('summarises the last seven days', () => {
    activity.recordSubjectPractice('maths', new Date('2026-10-27T10:00:00'), true);
    activity.recordSubjectPractice('maths', new Date('2026-10-27T11:00:00'), false);
    activity.recordSubjectPractice('history', new Date('2026-11-01T09:00:00'), true);

    const summary = activity.getWeeklyActivity(new Date('2026-11-01T18:00:00'));

    expect(summary.days).toHaveLength(7);
    expect(summary.days[0].day).toBe('2026-10-26');
    expect(summary.days[6].day).toBe('2026-11-01');
    expect(summary.answered).toBe(3);
    expect(summary.correct).toBe(2);
    expect(summary.activeDays).toBe(2);
    expect(summary.subjects).toEqual([
      { subject: 'maths', answered: 2 },
      { subject: 'history', answered: 1 },
    ]);
  });

  it('ignores activity older than the window', () => {
    activity.recordSubjectPractice('physics', new Date('2026-10-20T10:00:00'), true);

    const summary = activity.getWeeklyActivity(new Date('2026-11-01T18:00:00'));

    expect(summary.answered).toBe(0);
    expect(summary.correct).toBe(0);
    expect(summary.activeDays).toBe(0);
    expect(summary.subjects).toEqual([]);
  });

  it('counts the same day only once as active', () => {
    activity.recordSubjectPractice('geography', new Date('2026-11-01T08:00:00'), true);
    activity.recordSubjectPractice('economics', new Date('2026-11-01T09:00:00'), false);

    const summary = activity.getWeeklyActivity(new Date('2026-11-01T18:00:00'));

    expect(summary.activeDays).toBe(1);
    expect(summary.days[6]).toEqual({ day: '2026-11-01', answered: 2, correct: 1 });
  });

  it('summarises last week (prior 7-day period) and calculates comparison', () => {
    // Activity in last week's window: Oct 20 - Oct 26 (prior to Oct 27 - Nov 02)
    activity.recordSubjectPractice('physics', new Date('2026-10-24T10:00:00'), true);
    activity.recordSubjectPractice('physics', new Date('2026-10-24T11:00:00'), false);
    // Activity in this week's window:
    activity.recordSubjectPractice('maths', new Date('2026-10-28T10:00:00'), true);
    activity.recordSubjectPractice('maths', new Date('2026-10-29T10:00:00'), true);
    activity.recordSubjectPractice('history', new Date('2026-11-01T10:00:00'), true);

    const now = new Date('2026-11-02T12:00:00');
    const lastWeek = activity.getLastWeekActivity(now);
    expect(lastWeek.days).toHaveLength(7);
    expect(lastWeek.answered).toBe(2);
    expect(lastWeek.correct).toBe(1);
    expect(lastWeek.activeDays).toBe(1);
    expect(lastWeek.subjects).toEqual([{ subject: 'physics', answered: 2 }]);

    const comp = activity.getWeeklyComparison(now);
    expect(comp.thisWeek.answered).toBe(3);
    expect(comp.thisWeek.correct).toBe(3);
    expect(comp.lastWeek.answered).toBe(2);
    expect(comp.answeredDelta).toBe(1);
    expect(comp.correctDelta).toBe(2);
    expect(comp.accuracyDelta).toBe(50); // 100% vs 50%
    expect(comp.activeDaysDelta).toBe(2); // 3 vs 1
  });
});
