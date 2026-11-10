import type { Subject } from './types';

export interface TopicInfo {
  /** Stable slug stored in question data and used in URLs. */
  slug: string;
  label: string;
}

/**
 * Canonical topics per subject. Question data must use one of these slugs for
 * its own subject; keep the list short enough to be useful for weak-topic drills.
 */
export const TOPICS: Record<Subject, TopicInfo[]> = {
  history: [
    { slug: 'civics', label: 'Civics & Constitution' },
    { slug: 'nationalism', label: 'Rise of Nationalism' },
    { slug: 'freedom', label: 'Freedom Struggle' },
    { slug: 'british-rule', label: 'British Rule & Reform' },
    { slug: 'world', label: 'World History' },
    { slug: 'post-independence', label: 'Independent India' },
    { slug: 'general', label: 'General' }
  ],
  economics: [
    { slug: 'demand-supply', label: 'Demand & Supply' },
    { slug: 'production', label: 'Factors of Production' },
    { slug: 'money-banking', label: 'Money & Banking' },
    { slug: 'public-finance', label: 'Public Finance' },
    { slug: 'market', label: 'Market Structures' },
    { slug: 'consumer', label: 'Consumer Awareness' },
    { slug: 'national-income', label: 'National Income & Development' },
    { slug: 'general', label: 'General' }
  ],
  geography: [
    { slug: 'climate', label: 'Climate & Monsoon' },
    { slug: 'soil', label: 'Soil & Conservation' },
    { slug: 'agriculture', label: 'Agriculture' },
    { slug: 'industry', label: 'Industry & Minerals' },
    { slug: 'water', label: 'Water Resources' },
    { slug: 'forests', label: 'Forests & Wildlife' },
    { slug: 'waste', label: 'Waste & Environment' },
    { slug: 'transport', label: 'Transport & Communication' },
    { slug: 'general', label: 'General' }
  ],
  maths: [
    { slug: 'algebra', label: 'Algebra & Matrices' },
    { slug: 'geometry', label: 'Geometry' },
    { slug: 'trigonometry', label: 'Trigonometry' },
    { slug: 'mensuration', label: 'Mensuration' },
    { slug: 'statistics', label: 'Statistics' },
    { slug: 'probability', label: 'Probability' },
    { slug: 'commercial', label: 'Commercial Maths' },
    { slug: 'coordinate', label: 'Coordinate Geometry' },
    { slug: 'general', label: 'General' }
  ],
  'english-lit': [
    { slug: 'julius-caesar', label: 'Julius Caesar' },
    { slug: 'poetry', label: 'Poetry' },
    { slug: 'prose', label: 'Prose' },
    { slug: 'general', label: 'General' }
  ],
  physics: [
    { slug: 'force-motion', label: 'Force & Motion' },
    { slug: 'work-energy', label: 'Work, Energy & Power' },
    { slug: 'machines', label: 'Machines' },
    { slug: 'light', label: 'Light' },
    { slug: 'sound', label: 'Sound' },
    { slug: 'electricity', label: 'Electricity & Magnetism' },
    { slug: 'heat', label: 'Heat' },
    { slug: 'modern', label: 'Modern Physics' },
    { slug: 'general', label: 'General' }
  ],
  chemistry: [
    { slug: 'periodic', label: 'Periodic Table' },
    { slug: 'bonding', label: 'Chemical Bonding' },
    { slug: 'acids-bases', label: 'Acids, Bases & Salts' },
    { slug: 'electrochemistry', label: 'Electrochemistry' },
    { slug: 'metals', label: 'Metals & Metallurgy' },
    { slug: 'organic', label: 'Organic Chemistry' },
    { slug: 'stoichiometry', label: 'Mole Concept' },
    { slug: 'general', label: 'General' }
  ],
  'computer-applications': [
    { slug: 'basics', label: 'Computer Basics' },
    { slug: 'general', label: 'General' }
  ],
  'physical-education': [
    { slug: 'growth', label: 'Growth & Development' },
    { slug: 'fitness', label: 'Fitness & Training' },
    { slug: 'injuries', label: 'Injuries & First Aid' },
    { slug: 'nutrition', label: 'Nutrition & Diet' },
    { slug: 'biomechanics', label: 'Biomechanics & Skills' },
    { slug: 'psychology', label: 'Sports Psychology' },
    { slug: 'games', label: 'Games & Sports Culture' },
    { slug: 'general', label: 'General' }
  ]
};

export function topicsFor(subject: Subject): TopicInfo[] {
  return TOPICS[subject] ?? [{ slug: 'general', label: 'General' }];
}

export function isKnownTopic(subject: Subject | string, slug: string): boolean {
  const list = TOPICS[subject as Subject];
  if (!list) return true; // Unknown subjects (validator fixtures) are not restricted.
  return list.some((topic) => topic.slug === slug);
}

export function topicLabel(subject: Subject | string, slug: string): string {
  const list = TOPICS[subject as Subject] ?? [];
  return list.find((topic) => topic.slug === slug)?.label ?? slug;
}

export interface TopicStatInput {
  seen: Iterable<string>;
  boxes: Record<string, 0 | 1 | 2 | 3>;
  questionStats: Record<string, { attempted: number; correct: number }>;
}

export interface TopicBreakdown {
  topic: string;
  label: string;
  /** Questions tagged with this topic. */
  total: number;
  seen: number;
  mastered: number;
  attempted: number;
  correct: number;
  /** 0-100, answer accuracy. */
  accuracy: number;
  /** 0-100, share of the topic sitting in Leitner box 3. */
  mastery: number;
}

/** Aggregates mastery and accuracy per topic for one subject. */
export function getTopicBreakdown(
  subject: Subject,
  questions: readonly { id: string; topic: string }[],
  input: TopicStatInput,
): TopicBreakdown[] {
  const seen = new Set(input.seen);
  const buckets = new Map<string, { total: number; seen: number; mastered: number; attempted: number; correct: number }>();

  for (const topic of topicsFor(subject)) {
    buckets.set(topic.slug, { total: 0, seen: 0, mastered: 0, attempted: 0, correct: 0 });
  }

  for (const question of questions) {
    const bucket = buckets.get(question.topic);
    if (!bucket) continue;
    bucket.total += 1;
    if (seen.has(question.id)) bucket.seen += 1;
    if (input.boxes[question.id] === 3) bucket.mastered += 1;
    const stat = input.questionStats[question.id];
    if (stat) {
      bucket.attempted += stat.attempted;
      bucket.correct += stat.correct;
    }
  }

  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.total > 0)
    .map(([topic, bucket]) => ({
      topic,
      label: topicLabel(subject, topic),
      total: bucket.total,
      seen: bucket.seen,
      mastered: bucket.mastered,
      attempted: bucket.attempted,
      correct: bucket.correct,
      accuracy: bucket.attempted > 0 ? Math.round((bucket.correct / bucket.attempted) * 100) : 0,
      mastery: bucket.total > 0 ? Math.round((bucket.mastered / bucket.total) * 100) : 0,
    }));
}

/** Enough answers before a low accuracy is allowed to label a topic "weak". */
const MIN_ATTEMPTS_FOR_WEAKNESS = 5;

/**
 * Picks the topic most worth practising: the least accurate one with enough
 * attempts, otherwise the least mastered topic that has been seen at all.
 */
export function weakestTopic(breakdown: readonly TopicBreakdown[]): TopicBreakdown | null {
  const attempted = breakdown.filter(
    (topic) => topic.attempted >= MIN_ATTEMPTS_FOR_WEAKNESS && topic.topic !== 'general',
  );
  if (attempted.length > 0) {
    return attempted.reduce((worst, topic) =>
      topic.accuracy < worst.accuracy ? topic : worst,
    );
  }

  const seen = breakdown.filter((topic) => topic.seen > 0 && topic.topic !== 'general');
  if (seen.length > 0) {
    return seen.reduce((worst, topic) => (topic.mastery < worst.mastery ? topic : worst));
  }

  return null;
}
