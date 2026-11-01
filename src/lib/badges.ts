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
  { id: 'dedicated', title: 'Dedicated', description: 'Finish 25 practice sessions.', icon: '🗓️' },
  { id: 'marathon', title: 'Marathon', description: 'Finish 50 practice sessions.', icon: '🏃' },
  { id: 'sharpshooter', title: 'Sharpshooter', description: 'Get 15 correct in a row in one session.', icon: '🏹' },
  { id: 'flawless-twenty', title: 'Flawless Twenty', description: 'Score 20/20 in a session.', icon: '💎' },
  { id: 'mastermind', title: 'Mastermind', description: 'Master 50 questions.', icon: '🧠' },
  { id: 'specialist', title: 'Specialist', description: 'Master 25 questions in one subject.', icon: '🏆' },
  { id: 'comeback-king', title: 'Comeback King', description: 'Master 25 previously missed questions.', icon: '👑' },
  { id: 'grand-slam', title: 'Grand Slam', description: 'Sweep 3 different subjects.', icon: '🏅' },
  { id: 'fortnight', title: 'Fortnight', description: 'Keep a 14-day streak.', icon: '🌙' },
  { id: 'daily-devotee', title: 'Daily Devotee', description: 'Complete 7 daily challenges.', icon: '📅' },
  { id: 'speed-demon', title: 'Speed Demon', description: 'Score 150 or more in a timed sprint.', icon: '⚡' },
  { id: 'goal-getter', title: 'Goal Getter', description: 'Reach your daily goal on 7 different days.', icon: '✅' },
  { id: 'night-owl', title: 'Night Owl', description: 'Answer a question after 10 pm.', icon: '🦉' },
  { id: 'early-bird', title: 'Early Bird', description: 'Answer a question before 7 am.', icon: '🌅' },
  { id: 'collector', title: 'Collector', description: 'Earn 10 badges.', icon: '🎖️' },
];

export function badgeInfo(id: string): BadgeInfo | undefined {
  return BADGES.find((badge) => badge.id === id);
}

export function badgeTitle(id: string): string {
  return badgeInfo(id)?.title ?? id;
}
