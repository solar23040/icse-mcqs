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
});
