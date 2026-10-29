/** Daily goal choices offered in the UI. */
export const DAILY_GOAL_OPTIONS = [10, 20, 30] as const;

export type DailyGoal = (typeof DAILY_GOAL_OPTIONS)[number];

/** Placeholder exam date (ISO, local day). Replace with the real board exam date. */
export const EXAM_DATE = '2027-03-01';

/** XP tuning constants. */
export const XP_CORRECT_BASE = 10;
export const XP_MISSED_BONUS = 5;
export const XP_SESSION_COMPLETE = 20;
export const XP_MASTERED_CAP = 2;

/** Combo multiplier tiers. A tier is reached every COMBO_STEP consecutive correct answers. */
export const COMBO_TIER_1 = 1;
export const COMBO_TIER_2 = 1.5;
export const COMBO_TIER_3 = 2;
export const COMBO_STEP = 3;