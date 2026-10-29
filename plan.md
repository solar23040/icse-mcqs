# Gamification Plan (Phases 0-4)

## Ground rules (apply to every agent prompt)
- Static site, no login, no backend except the existing optional /api/poll pattern.
- All game state lives in localStorage under `icse:game:v1`, accessed ONLY through storage.ts (try/catch + in-memory fallback).
- Game logic is pure functions in `src/lib/gamification.ts`. No DOM or localStorage access there.
- `resetSeen` must NEVER touch game state. "Reset game progress" is a separate, confirmed action.
- Dates use the device's local day (YYYY-MM-DD), injected as a parameter so tests are deterministic.
- Respect `prefers-reduced-motion`. Never convey state by color alone. Keep keyboard shortcuts (1-4, Enter) working.
- Question `id`s are progress keys: never rename them.
- No real names or free-text user input anywhere (users are minors).
- Each agent edits ONLY the files it owns. If you need a change elsewhere, add a note under "Requests" at the bottom of plan.md.
- Done = `npm run validate`, `npm test`, `npm run build` all pass, plus new tests for new logic.

## File ownership
| Agent | Owns |
|---|---|
| A | src/lib/gamification.ts, src/lib/engine.ts, src/lib/storage.ts, their tests |
| B | src/components/quiz/*, src/components/game/* (new) |
| C | src/pages/*, src/components/shell/*, src/layouts/Base.astro, src/lib/config.ts (new), src/lib/badges.ts (new) |
| D | api/*, scripts/*, README.md, plan.md, leaderboard client (src/lib/leaderboard*.ts) |

---

## Phase 0: Contract (do on main first, one commit, before any worktree branches)

```text
Create the shared contract for gamification. Do not implement logic yet.

1. src/lib/gamification.ts: export these types and function signatures with
   `throw new Error("not implemented")` bodies:
   - GameState { v: 1; xp; streak: {count,lastDay,freezes,best}; dailyGoal: 10|20|30;
     daily: {day, answered}; badges: Record<string,string>; boxes: Record<string,0|1|2|3>;
     missed: Record<string,true>; counters: Record<string,number> }
   - GameEvent = {type:"xp",amount} | {type:"levelUp",level} | {type:"badge",id}
     | {type:"streak",count} | {type:"goalReached"} | {type:"mastered",questionId}
   - defaultGameState(), levelFromXp, xpForLevel, answerXp, touchStreak,
     applyAnswer(state, {questionId, subject, correct, combo, today}) => {state, events},
     applySession(state, {subject, total, correct, today}) => {state, events},
     evaluateBadges(state) => string[]
2. src/lib/storage.ts: export getGame(), saveGame(state), resetGame() with the same
   try/catch + in-memory fallback pattern; migrate unknown/older versions to defaults.
3. src/lib/config.ts: DAILY_GOAL_OPTIONS, EXAM_DATE (ISO string, placeholder), XP constants.
4. Add one test file per module that only asserts the exports exist.

Commit message: "gamification: shared contract". Report the final signatures.
```

---

## Phase 1: Core loop (XP, levels, combo, streak, daily goal)

### Agent A
```text
Implement the pure logic in src/lib/gamification.ts and storage persistence.

Rules:
- XP: correct = 10 base. Combo multiplier x1 / x1.5 / x2 (step every 3 consecutive
  correct, cap x2). +5 bonus if the question is in state.missed (and clear it).
  Wrong = 0 XP, never negative. Session completion = +20.
- Level: levelFromXp = floor(sqrt(xp/50)) + 1; xpForLevel(l) = 50*(l-1)^2.
- Streak: count one day when the daily threshold is met (any completed session OR
  >= dailyGoal answers). Gap of 1 day continues; larger gaps consume one freeze per
  missed day if available, otherwise reset to 1. Earn 1 freeze every 7 streak days
  (max 2). Track best streak. Handle clock going backwards (ignore, never decrease).
- daily: reset when day changes.
- applyAnswer/applySession are immutable (return new state) and emit GameEvents in
  deterministic order.
- saveGame/getGame must tolerate corrupt JSON.

Tests (Vitest): level curve boundaries, combo cap, missed bonus once only, streak
across 1/2/3-day gaps with and without freezes, month/year rollover, corrupt storage,
immutability. Do not touch Quiz.svelte or pages.
```

### Agent B
```text
Integrate gamification into Quiz.svelte and create src/components/game/*.

- After each answer call applyAnswer; at session end call applySession. Keep all
  logic in gamification.ts; the component only renders returned state/events.
- Quiz header: combo indicator (x1.5, x2) with a small animation, XP counter, level chip.
- Components: XpBar.svelte, ComboBadge.svelte, Toast/EventStack.svelte (level up,
  badge, goal reached), ResultsSummary additions (XP earned, level progress bar,
  streak line, new badges).
- Reduced motion: replace animations with static state changes.
- aria-live="polite" region announces XP/level/badge events; no focus stealing.
- Do not change session-length picker behavior or keyboard shortcuts.

Add component-level tests only where the repo already tests components; otherwise
document manual test steps in plan.md.
```

### Agent C
```text
Surface the game state on the home page and shell.

- SubjectGrid.svelte: keep attempted/accuracy; add nothing that requires new storage
  reads beyond getGame().
- Home page: daily goal ring (SVG, text label as well as visual), streak flame with
  count, level + XP progress, goal picker (10/20/30) persisted to state.dailyGoal.
- Header (Base.astro island): compact streak + level.
- Add a "Reset game progress" control (confirm dialog, separate from reset seen).
- SSR-safe: render neutral placeholders on the server and hydrate client-side.
```

### Agent D
```text
- Extend README with a "Gamification" section (rules table: XP, combo, streak, freezes).
- Add scripts/validate.ts check that all question ids are unique ACROSS subjects and
  match /^[a-z-]+-\d+$/ (or whatever the current id format is). Warn, don't fail, on
  format; fail on cross-subject duplicates.
- Add an ids snapshot (scripts/ids.snapshot.json) and a validator rule that fails if
  any previously-shipped id disappears (protects stored progress).
```

---

## Phase 2: Mastery (Leitner boxes, review mode, ranks)

### Agent A
```text
- Leitner: wrong -> box 0 (and add to missed); correct -> min(box+1, 3). Box 3 =
  mastered; emit {type:"mastered"} on reaching it. Cap XP at 2 for answering a
  question already in box 3 (anti-farming).
- Extend buildSession(all, seenIds, length, opts?) with mode: "unseen" (default,
  unchanged behavior) | "review" which draws boxes 0-1 first, then 2, then unseen;
  still shuffles question and option order and recomputes correctIndex.
- Add masteryPercent(subjectQuestions, boxes) and rankFor(percent):
  <25 Beginner, <50 Learner, <75 Scholar, >=75 Topper.
- Tests: box transitions, review-mode ordering, empty-pool fallback, defaults of
  buildSession unchanged (existing engine tests must stay green).
```

### Agent B
```text
- Session-length picker gets a mode toggle: "New questions" / "Review weak spots" (disabled
  with explanation when no boxed questions exist).
- Show a box/mastery hint after each answer ("Added to review" / "Mastered!").
- Results: replace the one-off missed-question retry with a link into review mode, but
  keep the in-session retry for immediate use.
```

### Agent C
```text
- SubjectGrid cards: mastery ring + rank title per subject; "Review (N due)" shortcut.
- Subject page header shows rank and mastery %.
- Empty/placeholder subjects show no rank.
```

### Agent D
```text
- Document mastery/rank rules in README.
- Add a test fixture and doc note describing how to add new questions without breaking
  the ids snapshot.
```

---

## Phase 3: Variety (badges, modes, countdown, sharing)

### Agent A
```text
- evaluateBadges + counters: First Steps (10 answered), Perfect Ten (10/10 session),
  Week Warrior (7-day streak), Subject Sweep (all questions in a subject seen),
  Comeback (5 previously missed questions mastered), All-Rounder (attempted every
  live subject), Century (100 correct). Badges are idempotent and never revoked.
- seededShuffle(seed: string) in engine.ts + buildDailyChallenge(allSubjects, day):
  10 mixed-subject questions, identical for every user on the same local day.
- Timed Sprint scoring helper: sprintScore({correct, wrong, seconds}).
- Tests for each badge trigger and for daily-challenge determinism.
```

### Agent B
```text
- Add modes to the quiz flow: Daily Challenge (once per day for XP, replayable for fun)
  and Timed Sprint (60s, pause on tab blur disabled; announce time at 30/10s via
  aria-live, never auto-submit silently).
- Results: share card as copyable text ("Physics 9/10 · 🔥12 · Lv 7") and a PNG
  export via canvas. No external fonts/network.
```

### Agent C
```text
- src/lib/badges.ts: badge metadata (id, title, description, icon). Badges page
  (src/pages/badges.astro) with earned/locked states; locked ones show how to earn them.
- Home: exam countdown from config EXAM_DATE with "N questions/day to finish all
  unseen" nudge; hide when the date has passed.
- Home entry points for Daily Challenge and Timed Sprint.
```

### Agent D
```text
- README: badge list and challenge modes.
- Add export/import progress code: base64 JSON of GameState + seen + stats, with a
  version and checksum, in src/lib/transfer.ts with tests (reject tampered/unknown
  versions). Settings UI hook is requested from C via plan.md "Requests".
```

---

## Phase 4: Social (optional, needs Upstash)

### Agent D (owns everything here)
```text
Add an anonymous weekly leaderboard following the api/poll.ts pattern (single
unbundled Node ESM function api/leaderboard.ts, no imports from src/).

- Identity: anonymous HttpOnly cookie id; display name is generated server-side from
  a fixed adjective+animal list (e.g. "Brave Owl 42"). No free-text names. No PII.
- Redis: sorted set per ISO week (key includes week), TTL 14 days. Submit weekly XP
  only (server caps per-submission and per-day increments to block trivial cheating;
  document that it is not cheat-proof).
- Endpoints: GET top 10 + caller's rank/percentile; POST submit {weeklyXp}.
- Client src/lib/leaderboard.ts + leaderboard-api.ts: local-first, silently degrades
  to "unavailable" when unconfigured (same fallback style as poll-api.ts). Opt-in only,
  off by default, with a plain-language privacy note.
- UI framing: show "top X% this week" so most students feel included.
- Tests: handler (validation, caps, week rollover), client fallback.
- Env vars documented in README (UPSTASH_REDIS_REST_URL/TOKEN or KV_* aliases).
Requests to other agents (UI card on home, opt-in toggle) go in plan.md "Requests".
```

---

## Requests
(agents append cross-ownership requests here)
