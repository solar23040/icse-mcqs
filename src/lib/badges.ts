export interface BadgeInfo {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export const BADGES: BadgeInfo[] = [
  { id: 'first-steps', title: 'First Steps', description: 'Answer 10 questions.', icon: '👣' },
  { id: 'perfect-ten', title: 'Perfect Ten', description: 'Score 10/10 in a session.', icon: '🎯' },
  { id: 'week-warrior', title: 'Week Warrior', description: 'Keep a 7-day streak.', icon: '🔥' },
  { id: 'subject-sweep', title: 'Subject Sweep', description: 'See every question in a subject.', icon: '🧹' },
  { id: 'comeback', title: 'Comeback', description: 'Master 5 previously missed questions.', icon: '💪' },
  { id: 'all-rounder', title: 'All-Rounder', description: 'Attempt every live subject.', icon: '🌍' },
  { id: 'century', title: 'Century', description: 'Get 100 correct answers.', icon: '💯' },
];

export function badgeInfo(id: string): BadgeInfo | undefined {
  return BADGES.find((badge) => badge.id === id);
}

export function badgeTitle(id: string): string {
  return badgeInfo(id)?.title ?? id;
}
