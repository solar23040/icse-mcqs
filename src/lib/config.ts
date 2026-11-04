/** Daily goal choices offered in the UI. */
export const DAILY_GOAL_OPTIONS = [10, 20, 30] as const;

export type DailyGoal = (typeof DAILY_GOAL_OPTIONS)[number];

/** Placeholder exam date (ISO, local day). Replace with the real board exam date. */
export const EXAM_DATE = '2027-03-01';

/** A question answered wrong can be retried after this cooldown. */
export const WRONG_BOX_LOCK_MS = 48 * 60 * 60 * 1000;

/**
 * XP tuning constants. XP (shown as credits) accrues slowly on purpose:
 * correct answers start at 2 XP instead of 10, so a session takes about
 * five times as long to earn the same balance. Existing balances are not
 * touched by these values.
 */
export const XP_CORRECT_BASE = 2;
export const XP_MISSED_BONUS = 1;
export const XP_SESSION_COMPLETE = 4;
export const XP_MASTERED_CAP = 1;
/** XP deducted for the first hint of the day. */
export const HINT_COST_XP = 50;
/** Extra XP added to the second hint of the same day (50 + 50 = 100). */
export const HINT_SECOND_EXTRA_XP = 50;

/** Combo multiplier tiers. A tier is reached every COMBO_STEP consecutive correct answers. */
export const COMBO_TIER_1 = 1;
export const COMBO_TIER_2 = 1.5;
export const COMBO_TIER_3 = 2;
export const COMBO_STEP = 3;
