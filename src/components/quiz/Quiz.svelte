<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { buildSession, buildWrongSession, type SessionMode } from '../../lib/engine';
  import { localDay } from '../../lib/date';
  import {
    applyAnswer,
    applySession,
    defaultGameState,
    levelFromXp,
    type GameEvent,
    type GameState
  } from '../../lib/gamification';
  import {
    getGame,
    getSeen,
    getWrong,
    markSeen,
    markWrong,
    recordAnswer,
    resetSeen,
    saveGame,
    resetWrong,
    unmarkWrong
  } from '../../lib/storage';
  import type { Question, SessionQuestion, Subject } from '../../lib/types';
  import ComboBadge from '../game/ComboBadge.svelte';
  import EventStack from '../game/EventStack.svelte';
  import ShareCard from '../game/ShareCard.svelte';
  import XpBar from '../game/XpBar.svelte';
  import {
    isTypingTarget,
    optionIndexFromKey,
    scorePercent,
    type MissedQuestion,
    type SessionLength
  } from './quiz-utils';

  export let subject: Subject;
  export let questions: Question[];

  type Stage = 'start' | 'quiz' | 'results';

  const lengthOptions: { value: SessionLength; label: string; ariaLabel: string }[] = [
    { value: 10, label: '10', ariaLabel: '10 questions' },
    { value: 20, label: '20', ariaLabel: '20 questions' },
    { value: 30, label: '30', ariaLabel: '30 questions' },
    { value: 'all', label: 'All', ariaLabel: 'All unseen questions' }
  ];

  let stage: Stage = 'start';
  let selectedLength: SessionLength = 10;
  let selectedMode: SessionMode = 'unseen';
  let answerHint = '';
  let session: SessionQuestion[] = [];
  let index = 0;
  let choice: number | null = null;
  let correctCount = 0;
  let streak = 0;
  let bestStreak = 0;
  let missed: MissedQuestion[] = [];
  let retryMode = false;
  let mode: 'new' | 'wrong' = 'new';
  let wrongMode = false;
  let wrongIds: string[] = [];
  let totalCount = questions.length;
  let unseenCount = questions.length;
  let poolExhausted = false;
  let startError = '';
  let liveMessage = '';
  let game: GameState = defaultGameState();
  let gameEvents: GameEvent[] = [];
  let today = '';
  let sessionXp = 0;
  let sessionBadges: string[] = [];

  let current: SessionQuestion | null = null;
  let answered = false;
  let isLast = false;
  let progressPercent = 0;
  let scorePercentValue = 0;
  let reviewableCount = 0;

  $: wrongIdSet = new Set(wrongIds);
  $: wrongQuestions = questions.filter((question) => wrongIdSet.has(question.id));
  $: wrongCount = wrongQuestions.length;

  let questionHeading: HTMLHeadingElement | null = null;
  let resultsHeading: HTMLHeadingElement | null = null;
  let startHeading: HTMLHeadingElement | null = null;
  let nextButton: HTMLButtonElement | null = null;

  $: current = session[index] ?? null;
  $: answered = choice !== null;
  $: isLast = session.length > 0 && index >= session.length - 1;
  $: progressPercent = session.length > 0 ? ((index + 1) / session.length) * 100 : 0;
  $: scorePercentValue = scorePercent(correctCount, session.length);
  $: reviewableCount = questions.filter((question) => {
    const box = game.boxes[question.id];
    return box !== undefined && box < 3;
  }).length;
  $: if (stage === 'start' && poolExhausted && wrongCount > 0 && mode === 'new') {
    mode = 'wrong';
  }

  let activeSubject = subject;
  $: if (subject !== activeSubject) {
    activeSubject = subject;
    stage = 'start';
    retryMode = false;
    mode = 'new';
    wrongMode = false;
    clearSession();
    refreshPool();
  }

  onMount(() => {
    refreshPool();
    game = getGame();
    today = localDay(new Date());
    if (new URLSearchParams(window.location.search).get('mode') === 'review') {
      selectedMode = 'review';
    }
  });

  function currentDay(): string {
    return today === '' ? localDay(new Date()) : today;
  }

  function recordGameEvents(events: GameEvent[]): void {
    gameEvents = events;
    sessionXp += events.reduce((sum, event) => (event.type === 'xp' ? sum + event.amount : sum), 0);
    sessionBadges = [
      ...sessionBadges,
      ...events.filter((event) => event.type === 'badge').map((event) => event.id)
    ];
  }

  function refreshPool(): void {
    totalCount = questions.length;
    try {
      const seen = new Set(getSeen(subject));
      unseenCount = questions.reduce(
        (count, question) => count + (seen.has(question.id) ? 0 : 1),
        0
      );
      poolExhausted = totalCount > 0 && unseenCount === 0;
    } catch {
      // Storage is fail-soft; keep the quiz usable if it still throws.
      unseenCount = totalCount;
      poolExhausted = false;
    }

    try {
      wrongIds = getWrong(subject);
    } catch {
      wrongIds = [];
    }
  }

  function clearSession(): void {
    session = [];
    index = 0;
    choice = null;
    correctCount = 0;
    streak = 0;
    bestStreak = 0;
    missed = [];
    retryMode = false;
    wrongMode = false;
    startError = '';
    liveMessage = '';
    gameEvents = [];
    sessionXp = 0;
    sessionBadges = [];
    answerHint = '';
  }

  function startQuestions(nextQuestions: SessionQuestion[], retry: boolean, wrong = false): void {
    session = nextQuestions;
    index = 0;
    choice = null;
    correctCount = 0;
    streak = 0;
    bestStreak = 0;
    missed = [];
    retryMode = retry;
    wrongMode = wrong;
    startError = '';
    liveMessage = '';
    gameEvents = [];
    sessionXp = 0;
    sessionBadges = [];
    answerHint = '';
    stage = 'quiz';
    void tick().then(() => questionHeading?.focus());
  }

  function handleStart(): void {
    startError = '';

    if (mode === 'wrong') {
      if (wrongQuestions.length === 0) {
        startError = 'There are no wrong questions to practice yet.';
        refreshPool();
        return;
      }

      let wrongSession: ReturnType<typeof buildWrongSession>;

      try {
        wrongSession = buildWrongSession(wrongQuestions, selectedLength);
      } catch {
        startError = 'The practice session could not start. Please try again.';
        return;
      }

      if (wrongSession.questions.length === 0) {
        refreshPool();
        stage = 'start';
        return;
      }

      startQuestions(wrongSession.questions, false, true);
      return;
    }

    if (poolExhausted) {
      startError = 'You have seen every question. Reset your progress or practice mistakes.';
      return;
    }

    let nextSession: ReturnType<typeof buildSession>;

    try {
      nextSession = buildSession(questions, getSeen(subject), selectedLength, {
        mode: selectedMode,
        boxes: game.boxes
      });
    } catch {
      startError = 'The session could not start. Please try again.';
      return;
    }

    if (nextSession.poolExhausted || nextSession.questions.length === 0) {
      refreshPool();
      stage = 'start';
      if (selectedMode === 'review') {
        startError = 'Nothing to review yet. Answer some questions first.';
      }
      return;
    }

    startQuestions(nextSession.questions, false);
  }

  function chooseOption(optionIndex: number): void {
    const question = current;
    if (stage !== 'quiz' || !question || choice !== null) return;
    if (optionIndex < 0 || optionIndex >= question.options.length) return;

    choice = optionIndex;
    const correct = optionIndex === question.correctIndex;

    if (correct) {
      correctCount += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      liveMessage = `Correct. ${question.explanation}`;
    } else {
      streak = 0;
      missed = [...missed, { question, chosenIndex: optionIndex }];
      liveMessage = `Incorrect. The correct answer is ${
        question.options[question.correctIndex]
      }. ${question.explanation}`;
    }

    try {
      markSeen(subject, question.id);

      if (correct) {
        unmarkWrong(subject, question.id);
      } else {
        markWrong(subject, question.id);
      }

      // Practice and retry modes are study aids, so they must not
      // double-count saved stats.
      if (!retryMode && !wrongMode) recordAnswer(subject, correct);
    } catch {
      // A storage failure must not break the quiz.
    }

    answerHint = '';
    if (!retryMode && !wrongMode) {
      const previousBox = game.boxes[question.id] ?? 0;
      try {
        const result = applyAnswer(game, {
          questionId: question.id,
          subject,
          correct,
          combo: correct ? streak : 0,
          today: currentDay()
        });
        game = result.state;
        saveGame(game);
        recordGameEvents(result.events);

        if (result.events.some((event) => event.type === 'mastered')) {
          answerHint = 'Mastered!';
        } else if (!correct) {
          answerHint = 'Added to review';
        } else if (previousBox <= 1) {
          answerHint = `Box ${game.boxes[question.id] ?? 1} of 3`;
        }
      } catch {
        // Gamification is fail-soft; the quiz itself keeps working.
      }
    }
  }

  function handleNext(): void {
    if (choice === null || !current) return;

    if (index < session.length - 1) {
      index += 1;
      choice = null;
      answerHint = '';
      liveMessage = '';
      void tick().then(() => questionHeading?.focus());
      return;
    }

    finishSession();
  }

  function finishSession(): void {
    if (!retryMode && !wrongMode) {
      try {
        const seen = new Set(getSeen(subject));
        const unseenRemaining = questions.reduce(
          (count, question) => count + (seen.has(question.id) ? 0 : 1),
          0
        );
        const result = applySession(game, {
          subject,
          total: session.length,
          correct: correctCount,
          today: currentDay(),
          unseenRemaining
        });
        game = result.state;
        saveGame(game);
        recordGameEvents(result.events);
      } catch {
        // Gamification is fail-soft; results still render.
      }
    }
    refreshPool();
    stage = 'results';
    liveMessage = wrongMode
      ? `Practice complete. You scored ${correctCount} out of ${session.length}.`
      : retryMode
        ? `Retry complete. You scored ${correctCount} out of ${session.length}.`
        : `Session complete. You scored ${correctCount} out of ${session.length}.`;
    void tick().then(() => resultsHeading?.focus());
  }

  function handleNewSession(): void {
    refreshPool();
    clearSession();
    mode = 'new';
    stage = 'start';
    void tick().then(() => startHeading?.focus());
  }

  function handleRetryMissed(): void {
    if (missed.length === 0) return;
    const retryQuestions = missed.map((item) => item.question);
    startQuestions(retryQuestions, true);
  }

  function handleReviewSession(): void {
    try {
      const nextSession = buildSession(questions, getSeen(subject), selectedLength, {
        mode: 'review',
        boxes: game.boxes
      });
      if (nextSession.questions.length === 0) return;
      selectedMode = 'review';
      startQuestions(nextSession.questions, false);
    } catch {
      startError = 'The review session could not start. Please try again.';
    }
  }

  function handleReset(): void {
    try {
      resetSeen(subject);
      resetWrong(subject);
    } catch {
      // Storage is fail-soft; the refresh below will reflect whatever succeeded.
    }
    refreshPool();
    clearSession();
    mode = 'new';
    stage = 'start';

    if (questions.length > 0) {
      handleStart();
    }
  }

  function handleClearMistakes(): void {
    try {
      resetWrong(subject);
    } catch {
      // Storage is fail-soft; the refresh below will reflect whatever succeeded.
    }
    refreshPool();
    mode = 'new';
    startError = '';
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (stage !== 'quiz' || !current) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.repeat) {
      // Holding Enter must not skip through several questions.
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (isTypingTarget(event.target)) return;

    const picked = optionIndexFromKey(event.key, current.options.length);
    if (picked !== null) {
      if (choice === null) {
        event.preventDefault();
        chooseOption(picked);
      }
      return;
    }

    if (event.key === 'Enter' && choice !== null) {
      // Let the focused Next button use its native activation.
      if (event.target === nextButton) return;
      event.preventDefault();
      handleNext();
    }
  }

  function modeButtonClasses(
    value: 'new' | 'wrong',
    selected: 'new' | 'wrong'
  ): string {
    const base =
      'min-h-12 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';
    if (value === selected) {
      return `${base} bg-indigo-600 text-white shadow-sm hover:bg-indigo-700`;
    }
    return `${base} border border-slate-300 bg-white text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-400 dark:hover:bg-slate-700`;
  }

  function lengthButtonClasses(value: SessionLength, selected: SessionLength): string {
    const base =
      'min-h-12 rounded-xl px-2 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';
    if (value === selected) {
      return `${base} bg-indigo-600 text-white shadow-sm hover:bg-indigo-700`;
    }
    return `${base} border border-slate-300 bg-white text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-400 dark:hover:bg-slate-700`;
  }

  function optionClasses(
    optionIndex: number,
    chosen: number | null,
    correctIndex: number
  ): string {
    const base =
      'flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:px-4 sm:py-4';

    if (chosen === null) {
      return `${base} border-slate-300 bg-white text-slate-900 hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700`;
    }
    if (optionIndex === correctIndex) {
      return `${base} cursor-default border-emerald-500 bg-emerald-50 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-950/50 dark:text-emerald-50`;
    }
    if (optionIndex === chosen) {
      return `${base} cursor-default border-rose-500 bg-rose-50 text-rose-950 dark:border-rose-400 dark:bg-rose-950/50 dark:text-rose-50`;
    }
    return `${base} cursor-default border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400`;
  }

  function optionNumberClasses(
    optionIndex: number,
    chosen: number | null,
    correctIndex: number
  ): string {
    const base =
      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold';
    if (chosen === null) {
      return `${base} bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300`;
    }
    if (optionIndex === correctIndex) {
      return `${base} bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950`;
    }
    if (optionIndex === chosen) {
      return `${base} bg-rose-600 text-white dark:bg-rose-500 dark:text-rose-950`;
    }
    return `${base} bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400`;
  }

  function optionAriaLabel(
    optionIndex: number,
    option: string,
    chosen: number | null,
    correctIndex: number
  ): string {
    const base = `Option ${optionIndex + 1}: ${option}`;
    if (chosen === null) return base;
    if (optionIndex === correctIndex) return `${base}. Correct answer.`;
    if (optionIndex === chosen) return `${base}. Your answer, incorrect.`;
    return `${base}. Not selected.`;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<section
  class="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:p-8"
>
  <div class="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>
  <EventStack events={gameEvents} />

  {#if stage === 'start'}
    <div class="space-y-7">
      <div class="space-y-2">
        <p
          class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400"
        >
          Practice session
        </p>
        <h2
          bind:this={startHeading}
          tabindex="-1"
          id="quiz-start-heading"
          class="scroll-mt-24 rounded-lg text-2xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:text-3xl"
        >
          Ready when you are
        </h2>
        <p class="text-slate-600 dark:text-slate-300">
          Answer at your own pace. Your progress is saved on this device.
        </p>
      </div>

      {#if totalCount === 0}
        <p
          role="status"
          class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          No questions are available for this subject yet.
        </p>
      {:else if poolExhausted && wrongCount === 0}
        <div
          role="status"
          class="space-y-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-50"
        >
          <div class="space-y-1">
            <h3 class="text-xl font-bold">You've done them all</h3>
            <p class="text-sm">
              You've seen all {totalCount} questions in this subject. Reset your progress to
              start again.
            </p>
          </div>
          <button
            type="button"
            on:click={handleReset}
            class="min-h-14 w-full rounded-2xl bg-amber-600 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
          >
            Reset &amp; start again
          </button>
        </div>
      {:else}
        <div class="space-y-2">
          <p id="practice-mode-label" class="text-sm font-semibold">Practice mode</p>
          <div role="group" aria-labelledby="practice-mode-label" class="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={mode === 'new'}
              disabled={poolExhausted}
              on:click={() => (mode = 'new')}
              class={modeButtonClasses('new', mode)}
            >
              New questions
            </button>
            <button
              type="button"
              aria-pressed={mode === 'wrong'}
              disabled={wrongCount === 0}
              on:click={() => (mode = 'wrong')}
              class={modeButtonClasses('wrong', mode)}
            >
              Practice mistakes ({wrongCount})
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <p class="text-lg" aria-live="polite">
            {#if mode === 'wrong'}
              <strong class="text-2xl font-bold text-rose-600 dark:text-rose-400"
                >{wrongCount}</strong
              >
              <span> question{wrongCount === 1 ? '' : 's'} to practise again</span>
            {:else}
              <strong class="text-2xl font-bold text-indigo-600 dark:text-indigo-400"
                >{unseenCount}</strong
              >
              <span> unseen of </span>
              <strong class="text-2xl font-bold">{totalCount}</strong>
              <span> questions</span>
            {/if}
          </p>
        </div>

        <div class="space-y-2">
          <p id="session-mode-label" class="text-sm font-semibold">Question mode</p>
          <div role="group" aria-labelledby="session-mode-label" class="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={selectedMode === 'unseen'}
              on:click={() => (selectedMode = 'unseen')}
              class="min-h-12 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 {selectedMode ===
              'unseen'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'border border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}"
            >
              New questions
            </button>
            <button
              type="button"
              aria-pressed={selectedMode === 'review'}
              disabled={reviewableCount === 0}
              aria-describedby={reviewableCount === 0 ? 'review-disabled-note' : undefined}
              on:click={() => (selectedMode = 'review')}
              class="min-h-12 rounded-xl border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900 {selectedMode ===
              'review'
                ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}"
            >
              Review weak spots
            </button>
          </div>
          {#if reviewableCount === 0}
            <p id="review-disabled-note" class="text-xs text-slate-500 dark:text-slate-400">
              No boxed questions yet. Answer some questions to build your review list.
            </p>
          {:else}
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {reviewableCount} question{reviewableCount === 1 ? '' : 's'} in your review boxes.
            </p>
          {/if}
        </div>

        <div class="space-y-2">
          <p id="session-length-label" class="text-sm font-semibold">Session length</p>
          <div
            role="group"
            aria-labelledby="session-length-label"
            class="grid grid-cols-4 gap-2"
          >
            {#each lengthOptions as option (option.value)}
              <button
                type="button"
                aria-label={option.ariaLabel}
                aria-pressed={selectedLength === option.value}
                on:click={() => (selectedLength = option.value)}
                class={lengthButtonClasses(option.value, selectedLength)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        {#if startError}
          <p role="alert" class="text-sm font-semibold text-rose-700 dark:text-rose-300">
            {startError}
          </p>
        {/if}

        <button
          type="button"
          on:click={handleStart}
          class="min-h-14 w-full rounded-2xl bg-indigo-600 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          {mode === 'wrong' ? 'Practise wrong questions' : 'Start session'}
        </button>

        {#if wrongCount > 0}
          <button
            type="button"
            on:click={handleClearMistakes}
            class="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-rose-400 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-rose-400 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
          >
            Clear practice mistakes
          </button>
        {/if}
      {/if}
    </div>
  {:else if stage === 'quiz' && current}
    <div class="space-y-6">
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Question {index + 1} of {session.length}
          </p>
          <div
            class="flex flex-wrap items-center gap-2 text-sm font-semibold"
            role="group"
            aria-label="Session score, streak and level"
          >
            <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              Score <span class="text-indigo-600 dark:text-indigo-400">{correctCount}</span>
            </span>
            <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              Streak <span class="text-amber-600 dark:text-amber-400">{streak}</span>
            </span>
            <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              Lv {levelFromXp(game.xp)}
            </span>
            <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              {game.xp} XP
            </span>
            <ComboBadge combo={streak} />
          </div>
        </div>

        <div
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax={session.length}
          aria-valuenow={index + 1}
          aria-label={`Question ${index + 1} of ${session.length}`}
          class="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        >
          <div
            class="h-full rounded-full bg-indigo-600 transition-[width] duration-300 dark:bg-indigo-400"
            style={`width: ${progressPercent}%`}
          ></div>
        </div>
      </div>

      <h2
        bind:this={questionHeading}
        tabindex="-1"
        id="quiz-question"
        class="scroll-mt-24 rounded-lg text-xl font-bold leading-snug tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:text-2xl"
      >
        {current.question}
      </h2>

      <div
        role="radiogroup"
        aria-labelledby="quiz-question"
        aria-describedby={answered ? 'answer-explanation' : undefined}
        class="space-y-3"
      >
        {#each current.options as option, optionIndex}
          <button
            type="button"
            role="radio"
            aria-checked={choice === optionIndex}
            aria-disabled={answered}
            aria-label={optionAriaLabel(optionIndex, option, choice, current.correctIndex)}
            on:click={() => chooseOption(optionIndex)}
            class={optionClasses(optionIndex, choice, current.correctIndex)}
          >
            <span
              aria-hidden="true"
              class={optionNumberClasses(optionIndex, choice, current.correctIndex)}
            >
              {optionIndex + 1}
            </span>
            <span class="min-w-0 flex-1 text-base font-medium sm:text-lg">{option}</span>

            {#if answered && optionIndex === current.correctIndex}
              <span
                class="ml-auto flex shrink-0 items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300"
              >
                <svg
                  class="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 10.5l4 4 8-8"
                  />
                </svg>
                <span class="hidden sm:inline">Correct answer</span>
                <span class="sm:hidden">Correct</span>
              </span>
            {:else if answered && optionIndex === choice}
              <span
                class="ml-auto flex shrink-0 items-center gap-1 text-xs font-bold text-rose-700 dark:text-rose-300"
              >
                <svg
                  class="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path stroke-linecap="round" d="M5 5l10 10M15 5L5 15" />
                </svg>
                <span>Your answer</span>
              </span>
            {/if}
          </button>
        {/each}
      </div>

      {#if answered}
        <div
          class="space-y-4 rounded-2xl border p-4 {choice === current.correctIndex
            ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/60 dark:bg-emerald-950/40'
            : 'border-rose-300 bg-rose-50 dark:border-rose-500/60 dark:bg-rose-950/40'}"
        >
          <p
            class="font-semibold {choice === current.correctIndex
              ? 'text-emerald-800 dark:text-emerald-200'
              : 'text-rose-800 dark:text-rose-200'}"
          >
            {#if choice === current.correctIndex}
              Correct!
            {:else}
              Not quite. The correct answer is
              <strong>{current.options[current.correctIndex]}</strong>.
            {/if}
          </p>
          <p id="answer-explanation" class="text-slate-700 dark:text-slate-200">{current.explanation}</p>

          {#if answerHint}
            <p class="text-sm font-semibold text-indigo-700 dark:text-indigo-300">{answerHint}</p>
          {/if}

          <button
            type="button"
            bind:this={nextButton}
            data-native-enter="true"
            on:click={handleNext}
            class="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
          >
            {isLast ? 'See results' : 'Next'}
            <svg
              class="h-5 w-5"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          </button>
        </div>
      {/if}
    </div>
  {:else if stage === 'results'}
    <div class="space-y-6">
      <div class="space-y-1">
        <p
          class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400"
        >
          Results
        </p>
        <h2
          bind:this={resultsHeading}
          tabindex="-1"
          id="quiz-results-heading"
          class="scroll-mt-24 rounded-lg text-2xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:text-3xl"
        >
          {wrongMode
            ? 'Practice complete'
            : retryMode
              ? 'Retry complete'
              : 'Session complete'}
        </h2>
      </div>

      <div
        class="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-800/60"
      >
        <p class="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Your score
        </p>
        <p class="mt-2 text-4xl font-extrabold tracking-tight">
          <span class="sr-only">{correctCount} out of {session.length}</span>
          <span aria-hidden="true">
            {correctCount}<span class="text-2xl font-bold text-slate-500 dark:text-slate-400">
              / {session.length}</span
            >
          </span>
        </p>
        <p class="mt-1 text-lg font-semibold text-indigo-600 dark:text-indigo-400">
          {scorePercentValue}%
        </p>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Best streak: {bestStreak}
        </p>
      </div>

      {#if !retryMode}
        <div class="space-y-3 rounded-3xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-500/40 dark:bg-indigo-950/30">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-lg font-bold">Progress</h3>
            <p class="rounded-full bg-white px-3 py-1 text-sm font-bold text-indigo-700 dark:bg-slate-900 dark:text-indigo-300">
              +{sessionXp} XP this session
            </p>
          </div>
          <XpBar xp={game.xp} />
          <p class="text-sm text-slate-700 dark:text-slate-200">
            <span aria-hidden="true">🔥</span>
            {game.streak.count}-day streak · best {game.streak.best} · freezes {game.streak.freezes}/2
          </p>
          {#if sessionBadges.length > 0}
            <div>
              <p class="text-sm font-semibold">New badges</p>
              <ul class="mt-1 flex flex-wrap gap-2">
                {#each sessionBadges as badge (badge)}
                  <li class="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                    {badge}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}

      {#if !retryMode}
        <ShareCard
          title={`${subject} practice`}
          correct={correctCount}
          total={session.length}
          streak={game.streak.count}
          level={levelFromXp(game.xp)}
        />
      {/if}

      {#if poolExhausted}
        <div
          role="status"
          class="space-y-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-50"
        >
          <div class="space-y-1">
            <h3 class="text-lg font-bold">You've done them all</h3>
            <p class="text-sm">
              Every question in this subject has been seen. Reset your progress to go through
              them again.
            </p>
          </div>
          <button
            type="button"
            on:click={handleReset}
            class="min-h-14 w-full rounded-2xl bg-amber-600 px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
          >
            Reset &amp; start again
          </button>
        </div>
      {/if}

      {#if missed.length > 0}
        <section aria-labelledby="missed-heading" class="space-y-3">
          <h3 id="missed-heading" class="text-lg font-bold">
            Missed questions ({missed.length})
          </h3>
          <ul class="space-y-3">
            {#each missed as item, listIndex (listIndex)}
              <li
                class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
              >
                <p class="font-semibold leading-snug">{item.question.question}</p>
                <p class="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <span class="font-semibold">Correct answer:</span>
                  {item.question.options[item.question.correctIndex]}
                </p>
                <p class="mt-1 text-sm text-rose-700 dark:text-rose-300">
                  <span class="font-semibold">You chose:</span>
                  {item.question.options[item.chosenIndex]}
                </p>
              </li>
            {/each}
          </ul>
        </section>
      {:else}
        <p
          class="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          {wrongMode
            ? 'All practised questions answered correctly — mistakes cleared.'
            : 'Perfect score — no missed questions.'}
        </p>
      {/if}

      <div class="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          on:click={handleRetryMissed}
          disabled={missed.length === 0}
          class="min-h-14 rounded-2xl bg-indigo-600 px-5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900"
        >
          Retry missed
        </button>
        <button
          type="button"
          on:click={handleNewSession}
          class="min-h-14 rounded-2xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-800 shadow-sm transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
        >
          New session
        </button>
      </div>

      <button
        type="button"
        on:click={handleReviewSession}
        disabled={reviewableCount === 0}
        class="min-h-12 w-full rounded-2xl border border-indigo-300 bg-indigo-50 px-5 text-base font-semibold text-indigo-800 transition-colors hover:border-indigo-400 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-500/50 dark:bg-indigo-950/40 dark:text-indigo-200 dark:focus-visible:ring-offset-slate-900"
      >
        Review weak spots ({reviewableCount} due)
      </button>

      {#if retryMode || wrongMode}
        <p class="text-center text-xs text-slate-500 dark:text-slate-400">
          {wrongMode
            ? "Mistake practice doesn't change your saved score or progress."
            : "Retry practice doesn't change your saved score or progress."}
        </p>
      {/if}
    </div>
  {/if}
</section>
