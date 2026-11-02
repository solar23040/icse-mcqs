# Changes

## 1. Raise leaderboard XP cap
- **Current:** XP on the leaderboard is capped at 2,000.
- **Change:** Raise the cap to **20,000**.
- **Notes:**
  - Use one constant (`MAX_LEADERBOARD_XP = 20000`) everywhere.
  - Check progress bars and rank calculations that assumed 2,000.

## 2. Wrong-answer box with 2-day lockout
- **Change:** Any question answered incorrectly goes into a **"Wrong" box**.
- **Rules:**
  - Re-attempt allowed only **after 2 days (48 hours)** from when it was answered wrong.
  - Store a `wrongAt` timestamp per question (persistent). Available when `now >= wrongAt + 48h`.
  - Before that, show it locked with a countdown ("Available in 1d 6h").
  - Correct retry: remove from the Wrong box.
  - Wrong retry: keep it in the box and reset the timer.
- **Notes:** Use timestamps, not day counters, so it works across sessions and timezones.

## 3. Hints cost XP (level stays)
- **Change:** Hints are unlocked by spending XP.
- **Rules:**
  - Using a hint **deducts XP**. XP can't go below 0.
  - **Level never decreases.** Track level separately from spendable XP, or store `highestLevelReached`.
  - Not enough XP: disable the hint button and show a message.
  - Confirm before spending ("Use hint for X XP?").
  - Hint cost in one constant (default 10 XP).
- **Notes:** Leaderboard ranking should use `totalEarnedXP`, so hints don't drop your rank.

## Testing checklist
- [ ] Leaderboard shows XP above 2,000, up to 20,000
- [ ] Wrong answer lands in the Wrong box
- [ ] Wrong-box question is locked for 2 days, then unlocks
- [ ] Correct retry removes it; wrong retry resets the timer
- [ ] Using a hint reduces XP
- [ ] Level stays the same after a hint
- [ ] Hint is blocked when XP is insufficient

---

# Multi-Agent Plan

Run Agents 1-3 in parallel, each on its own git branch or worktree. Run Agent 4 after they finish.

## Shared context (applies to every agent)
Read this file first, but do ONLY your assigned section. Don't touch other features. Find the existing XP, level and storage code before writing anything. Match the existing code style and stack. Keep changes minimal. When done, list the files you changed and anything another agent might conflict with.

## Agent 1: Leaderboard cap
- Find every place 2000/2,000 is used as a cap (leaderboard, progress bars, rank math, validation, backend and frontend).
- Replace with a single constant `MAX_LEADERBOARD_XP = 20000` and use it everywhere.
- Check that nothing breaks from larger numbers (UI overflow, number formatting, DB column limits).
- Verify: XP above 2,000 shows correctly, and 20,000 is the ceiling.

## Agent 2: Wrong box with 2-day lockout
- On a wrong answer, add the question to the Wrong box with a persistent `wrongAt` timestamp.
- Allow re-attempt only when `now >= wrongAt + 48h`. Before that, show it locked with a countdown.
- Correct retry removes it. Wrong retry keeps it and resets `wrongAt`.
- Add a Wrong box view/section in the UI.
- Verify: wrong answer lands in the box, locked state blocks retry, unlock works after 48h (mock the time to test).

## Agent 3: Hints cost XP, level stays
- Using a hint deducts spendable XP (never below 0).
- Decouple level from spendable XP (or store `highestLevelReached`). Level must never go down.
- Track `totalEarnedXP` separately. Leaderboard ranking uses it.
- Insufficient XP: disable the hint button with a message. Add the "Use hint for X XP?" confirmation.
- Hint cost in one constant (default 10 XP).
- Verify: XP drops after a hint, level unchanged, blocked at insufficient XP.

## Agent 4: Integrator and reviewer (run last)
- Merge the three branches and resolve conflicts, especially in XP and level state, where Agent 3 changed the data model.
- Make sure the leaderboard (Agent 1) uses `totalEarnedXP` and the 20,000 cap together correctly.
- Check that Wrong-box logic (Agent 2) still awards XP correctly on a successful retry.
- Run the app and existing tests. Go through the testing checklist above item by item and report pass/fail.
- Fix small bugs yourself; list anything bigger instead of rewriting.
