import { describe, expect, it } from 'vitest';
import { TOPICS, getTopicBreakdown, isKnownTopic, topicLabel, weakestTopic } from './topics';
import type { Subject } from './types';

describe('topic registry', () => {
  it('has unique slugs and a general fallback for every subject', () => {
    for (const [subject, topics] of Object.entries(TOPICS) as [Subject, { slug: string }[]][]) {
      const slugs = topics.map((topic) => topic.slug);
      expect(new Set(slugs).size, subject).toBe(slugs.length);
      expect(slugs, subject).toContain('general');
    }
  });

  it('validates and labels known topics', () => {
    expect(isKnownTopic('maths', 'algebra')).toBe(true);
    expect(isKnownTopic('maths', 'not-a-topic')).toBe(false);
    expect(topicLabel('physics', 'light')).toBe('Light');
    expect(topicLabel('physics', 'missing')).toBe('missing');
  });
});

describe('topic breakdown', () => {
  const questions = [
    { id: 'q1', topic: 'algebra' },
    { id: 'q2', topic: 'algebra' },
    { id: 'q3', topic: 'geometry' },
    { id: 'q4', topic: 'geometry' },
  ];

  it('aggregates seen, mastery and accuracy per topic', () => {
    const breakdown = getTopicBreakdown('maths', questions, {
      seen: ['q1', 'q2', 'q3'],
      boxes: { q1: 3, q2: 1, q3: 0 },
      questionStats: {
        q1: { attempted: 4, correct: 4 },
        q2: { attempted: 2, correct: 0 },
        q3: { attempted: 6, correct: 3 },
      },
    });

    const algebra = breakdown.find((topic) => topic.topic === 'algebra');
    expect(algebra).toMatchObject({
      total: 2,
      seen: 2,
      mastered: 1,
      attempted: 6,
      correct: 4,
      accuracy: 67,
      mastery: 50,
    });

    const geometry = breakdown.find((topic) => topic.topic === 'geometry');
    expect(geometry).toMatchObject({ total: 2, seen: 1, mastered: 0, accuracy: 50, mastery: 0 });
  });

  it('suggests the least accurate topic once there are enough attempts', () => {
    const breakdown = getTopicBreakdown('maths', questions, {
      seen: ['q1', 'q2', 'q3', 'q4'],
      boxes: { q1: 3, q2: 3, q3: 0, q4: 0 },
      questionStats: {
        q1: { attempted: 10, correct: 9 },
        q3: { attempted: 6, correct: 2 },
      },
    });

    expect(weakestTopic(breakdown)?.topic).toBe('geometry');
  });

  it('falls back to the least mastered seen topic and ignores general', () => {
    const pool = [
      { id: 'q1', topic: 'general' },
      { id: 'q2', topic: 'algebra' },
      { id: 'q3', topic: 'geometry' },
    ];

    const breakdown = getTopicBreakdown('maths', pool, {
      seen: ['q1', 'q2', 'q3'],
      boxes: { q2: 3, q3: 1 },
      questionStats: {},
    });

    expect(weakestTopic(breakdown)?.topic).toBe('geometry');
    expect(weakestTopic([])).toBeNull();
  });
});
