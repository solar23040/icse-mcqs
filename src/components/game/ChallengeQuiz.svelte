<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { buildDailyChallenge, sprintScore } from '../../lib/engine';
  import { localDay } from '../../lib/date';
  import { applyAnswer, applySession, defaultGameState, levelFromXp, type GameEvent, type GameState } from '../../lib/gamification';
  import { getGame, markSeen, recordAnswer, saveGame } from '../../lib/storage';
  import { optionIndexFromKey, isTypingTarget } from '../quiz/quiz-utils';
  import type { Question, Subject } from '../../lib/types';
  import EventStack from './EventStack.svelte';
  import ShareCard from './ShareCard.svelte';

  let {
    mode,
    pools
  }: {
    mode: 'daily' | 'sprint';
    pools: { subject: Subject; title: string; questions: Question[] }[];
  } = $props();

  type Stage = 'start' | 'quiz' | 'results';
  let stage: Stage = 'start';
  let game: GameState = defaultGameState();
  let today = '';
  let questions: (ReturnType<typeof buildDailyChallenge>[number] & { subject: Subject })[] = [];
  let index = 0;
  let choice: number | null = null;
  let correctCount = 0;
  let wrongCount = 0;
  let streak = 0;
  let bestStreak = 0;
  let missedCount = 0;
  let answeredCount = 0;
  let dailyAlready = false;
  let timeLeft = 60;
  let timeUp = false;
  let deadline = 0;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let gameEvents: GameEvent[] = [];
  let sessionXp = 0;
  let sessionBadges: string[] = [];
  let liveMessage = '';
  let questionHeading: HTMLHeadingElement | null = null;
  let nextButton: HTMLButtonElement | null = null;

  const current = $derived(questions[index] ?? null);
  const answered = $derived(choice !== null);

  function currentDay(): string {
    return today === '' ? localDay(new Date()) : today;
  }

  function recordEvents(events: GameEvent[]): void {
    gameEvents = events;
    sessionXp += events.reduce((sum, event) => (event.type === 'xp' ? sum + event.amount : sum), 0);
    sessionBadges = [...sessionBadges, ...events.flatMap((event) => (event.type === 'badge' ? [event.id] : []))];
  }

  const SPRINT_SECONDS = 60;

  function tickTimer(): void {
    if (deadline === 0) return;
    const remainingMs = deadline - Date.now();
    const previous = timeLeft;
    timeLeft = Math.max(0, Math.ceil(remainingMs / 1000));
    if (timeLeft !== previous && (timeLeft === 30 || timeLeft === 10)) {
      liveMessage = `${timeLeft} seconds left`;
    }
    if (remainingMs <= 0) {
      timeLeft = 0;
      timeUp = true;
      stopTimer();
      liveMessage = 'Time is up. Press See results when ready.';
    }
  }

  function startTimer(): void {
    stopTimer();
    timeUp = false;
    deadline = Date.now() + SPRINT_SECONDS * 1000;
    timeLeft = SPRINT_SECONDS;
    timerId = setInterval(tickTimer, 250);
  }

  function stopTimer(): void {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  // The interval can be throttled in background tabs, so answers are also
  // checked against the real deadline instead of the last rendered second.
  function sprintLocked(): boolean {
    if (mode !== 'sprint') return false;
    tickTimer();
    return timeUp;
  }

  function startSession(): void {
    today = localDay(new Date());
    game = getGame();

    if (mode === 'daily') {
      const day = currentDay();
      questions = buildDailyChallenge(pools, day) as typeof questions;
      dailyAlready = (game.counters[`dailyChallenge:${day}`] ?? 0) > 0;
    } else {
      questions = buildDailyChallenge(pools, `sprint-${Math.random()}`, 20) as typeof questions;
      dailyAlready = false;
    }

    index = 0;
    choice = null;
    correctCount = 0;
    wrongCount = 0;
    streak = 0;
    bestStreak = 0;
    missedCount = 0;
    answeredCount = 0;
    gameEvents = [];
    sessionXp = 0;
    sessionBadges = [];
    liveMessage = '';
    stage = 'quiz';
    void tick().then(() => questionHeading?.focus());

    if (mode === 'sprint') startTimer();
  }

  function chooseOption(optionIndex: number): void {
    const question = current;
    if (stage !== 'quiz' || !question || choice !== null) return;
    if (optionIndex < 0 || optionIndex >= question.options.length) return;
    if (sprintLocked()) return;

    choice = optionIndex;
    const correct = optionIndex === question.correctIndex;
    if (correct) {
      correctCount += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      liveMessage = `Correct. ${question.explanation}`;
    } else {
      streak = 0;
      wrongCount += 1;
      missedCount += 1;
      liveMessage = `Incorrect. The correct answer is ${question.options[question.correctIndex]}. ${question.explanation}`;
    }
    answeredCount += 1;

    try {
      markSeen(question.subject, question.id);
      const shouldCount = mode === 'sprint' || !dailyAlready;
      if (shouldCount) recordAnswer(question.subject, correct);
    } catch {
      // Storage is fail-soft.
    }

    const shouldUpdateGame = mode === 'sprint' || !dailyAlready;
    if (shouldUpdateGame) {
      try {
        const result = applyAnswer(game, {
          questionId: question.id,
          subject: question.subject,
          correct,
          combo: correct ? streak : 0,
          today: currentDay()
        });
        game = result.state;
        if (mode === 'daily' && !dailyAlready) {
          // Mark the daily run as used on the first answer so reloading
          // mid-challenge cannot be used to farm XP a second time.
          game.counters[`dailyChallenge:${currentDay()}`] = 1;
        }
        saveGame(game);
        recordEvents(result.events);
      } catch {
        // Gamification is fail-soft.
      }
    }
  }

  function handleNext(): void {
    if (choice === null || !current) return;
    if (index < questions.length - 1) {
      index += 1;
      choice = null;
      liveMessage = '';
      void tick().then(() => questionHeading?.focus());
      return;
    }
    finishSession();
  }

  function finishSession(): void {
    stopTimer();
    const shouldUpdateGame = mode === 'sprint' || !dailyAlready;
    if (shouldUpdateGame) {
      try {
        const result = applySession(game, {
          subject: mode,
          total: answeredCount,
          correct: correctCount,
          today: currentDay()
        });
        game = result.state;
        saveGame(game);
        recordEvents(result.events);

        if (mode === 'daily') {
          game.counters[`dailyChallenge:${currentDay()}`] = 1;
          saveGame(game);
        }
      } catch {
        // Gamification is fail-soft.
      }
    }

    stage = 'results';
    liveMessage = mode === 'daily' ? 'Daily challenge complete.' : 'Sprint complete.';
    void tick().then(() => (document.getElementById('challenge-results-heading') as HTMLElement | null)?.focus());
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (stage !== 'quiz' || !current) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.repeat) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (isTypingTarget(event.target)) return;

    const picked = optionIndexFromKey(event.key, current.options.length);
    if (picked !== null) {
      if (choice === null && !sprintLocked()) {
        event.preventDefault();
        chooseOption(picked);
      }
      return;
    }

    if (event.key === 'Enter' && choice !== null) {
      if (event.target === nextButton) return;
      event.preventDefault();
      handleNext();
    }
  }

  onMount(() => {
    today = localDay(new Date());
    game = getGame();
  });

  onDestroy(() => {
    stopTimer();
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<section class="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:p-8">
  <div class="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>
  <EventStack events={gameEvents} />

  {#if stage === 'start'}
    <div class="space-y-6">
      <div>
        <p class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
          {mode === 'daily' ? 'Daily challenge' : 'Timed sprint'}
        </p>
        <h2 class="mt-1 text-2xl font-bold tracking-tight">
          {mode === 'daily' ? 'Ten mixed questions' : 'Sixty seconds'}
        </h2>
        <p class="mt-2 text-slate-600 dark:text-slate-300">
          {mode === 'daily'
            ? 'The same ten questions for everyone today. Play once for XP, or replay for fun.'
            : 'Answer as many as you can in 60 seconds. The timer does not pause.'}
        </p>
        {#if mode === 'daily' && dailyAlready}
          <p class="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
            You already played today. This run is for fun and will not change XP.
          </p>
        {/if}
      </div>
      <button
        type="button"
        on:click={startSession}
        class="min-h-14 w-full rounded-2xl bg-indigo-600 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
      >
        Start
      </button>
    </div>
  {:else if stage === 'quiz' && current}
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">
          Question {index + 1} of {questions.length}
        </p>
        <div class="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {#if mode === 'sprint'}
            <span class="rounded-full bg-rose-100 px-3 py-1 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200">
              {timeLeft}s
            </span>
          {/if}
          <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
            Score <span class="text-indigo-600 dark:text-indigo-400">{correctCount}</span>
          </span>
          <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
            Lv {levelFromXp(game.xp)}
          </span>
        </div>
      </div>

      <h2 bind:this={questionHeading} tabindex="-1" id="quiz-question" class="scroll-mt-24 rounded-lg text-xl font-bold leading-snug tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:text-2xl">
        {current.question}
      </h2>

      <div role="radiogroup" aria-labelledby="quiz-question" class="space-y-3">
        {#each current.options as option, optionIndex}
          <button
            type="button"
            role="radio"
            aria-checked={choice === optionIndex}
            aria-disabled={answered || (mode === 'sprint' && timeUp)}
            on:click={() => chooseOption(optionIndex)}
            class="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:px-4 sm:py-4 {choice === null
              ? 'border-slate-300 bg-white text-slate-900 hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
              : optionIndex === current.correctIndex
                ? 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-950/50 dark:text-emerald-50'
                : optionIndex === choice
                  ? 'border-rose-500 bg-rose-50 text-rose-950 dark:border-rose-400 dark:bg-rose-950/50 dark:text-rose-950'
                  : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400'}"
          >
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold dark:bg-slate-700 dark:text-slate-300">
              {optionIndex + 1}
            </span>
            <span class="min-w-0 flex-1 text-base font-medium sm:text-lg">{option}</span>
          </button>
        {/each}
      </div>

      {#if answered}
        <div class="space-y-4 rounded-2xl border p-4 {choice === current.correctIndex ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/60 dark:bg-emerald-950/40' : 'border-rose-300 bg-rose-50 dark:border-rose-500/60 dark:bg-rose-950/40'}">
          <p class="font-semibold {choice === current.correctIndex ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}">
            {choice === current.correctIndex ? 'Correct!' : `Not quite. The correct answer is ${current.options[current.correctIndex]}.`}
          </p>
          <p class="text-slate-700 dark:text-slate-200">{current.explanation}</p>
          <button
            type="button"
            bind:this={nextButton}
            on:click={handleNext}
            class="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
          >
            {index >= questions.length - 1 ? 'See results' : 'Next'}
          </button>
        </div>
      {/if}

      {#if mode === 'sprint' && timeUp && !answered}
        <button
          type="button"
          on:click={finishSession}
          class="min-h-14 w-full rounded-2xl bg-indigo-600 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          See results
        </button>
      {/if}
    </div>
  {:else if stage === 'results'}
    <div id="challenge-results" class="space-y-6">
      <div class="space-y-1">
        <p class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
          Results
        </p>
        <h2 id="challenge-results-heading" tabindex="-1" class="scroll-mt-24 rounded-lg text-2xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:text-3xl">
          {mode === 'daily' ? 'Daily challenge complete' : 'Sprint complete'}
        </h2>
      </div>

      <div class="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-800/60">
        <p class="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Your score
        </p>
        <p class="mt-2 text-4xl font-extrabold tracking-tight">
          {correctCount}<span class="text-2xl font-bold text-slate-500 dark:text-slate-400"> / {answeredCount}</span>
        </p>
        <p class="mt-1 text-lg font-semibold text-indigo-600 dark:text-indigo-400">
          {answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0}%
        </p>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Best streak: {bestStreak}
        </p>
        {#if mode === 'sprint'}
          <p class="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Sprint score: {sprintScore({ correct: correctCount, wrong: wrongCount, seconds: 60 - timeLeft })}
          </p>
        {/if}
      </div>

      <ShareCard
        title={mode === 'daily' ? 'Daily Challenge' : 'Timed Sprint'}
        correct={correctCount}
        total={answeredCount}
        streak={game.streak.count}
        level={levelFromXp(game.xp)}
      />

      <button
        type="button"
        on:click={() => (stage = 'start')}
        class="min-h-14 w-full rounded-2xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-800 shadow-sm transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
      >
        Play again
      </button>
    </div>
  {/if}
</section>
EOF