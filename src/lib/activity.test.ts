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
