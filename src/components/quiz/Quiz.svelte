<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { buildSession } from '../../lib/engine';
  import {
    getSeen,
    markSeen,
    recordAnswer,
    resetSeen
  } from '../../lib/storage';
  import type { Question, SessionQuestion, Subject } from '../../lib/types';
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
  let session: SessionQuestion[] = [];
  let index = 0;
  let choice: number | null = null;
  let correctCount = 0;
  let streak = 0;
  let bestStreak = 0;
  let missed: MissedQuestion[] = [];
  let retryMode = false;
  let totalCount = questions.length;
  let unseenCount = questions.length;
  let poolExhausted = false;
  let startError = '';
  let liveMessage = '';

  let current: SessionQuestion | null = null;
  let answered = false;
  let isLast = false;
  let progressPercent = 0;
  let scorePercentValue = 0;

  let questionHeading: HTMLHeadingElement | null = null;
  let resultsHeading: HTMLHeadingElement | null = null;
  let startHeading: HTMLHeadingElement | null = null;
  let nextButton: HTMLButtonElement | null = null;

  $: current = session[index] ?? null;
  $: answered = choice !== null;
  $: isLast = session.length > 0 && index >= session.length - 1;
  $: progressPercent = session.length > 0 ? ((index + 1) / session.length) * 100 : 0;
  $: scorePercentValue = scorePercent(correctCount, session.length);

  let activeSubject = subject;
  $: if (subject !== activeSubject) {
    activeSubject = subject;
    stage = 'start';
    retryMode = false;
    clearSession();
    refreshPool();
  }

  onMount(() => {
    refreshPool();
  });

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
  }

  function clearSession(): void {
    session = [];
    index = 0;
    choice = null;
    correctCount = 0;
    streak = 0;
    bestStreak = 0;
    missed = [];
    startError = '';
    liveMessage = '';
  }

  function startQuestions(nextQuestions: SessionQuestion[], retry: boolean): void {
    session = nextQuestions;
    index = 0;
    choice = null;
    correctCount = 0;
    streak = 0;
    bestStreak = 0;
    missed = [];
    retryMode = retry;
    startError = '';
    liveMessage = '';
    stage = 'quiz';
    void tick().then(() => questionHeading?.focus());
  }

  function handleStart(): void {
    startError = '';
    let nextSession: ReturnType<typeof buildSession>;

    try {
      nextSession = buildSession(questions, getSeen(subject), selectedLength);
    } catch {
      startError = 'The session could not start. Please try again.';
      return;
    }

    if (nextSession.poolExhausted || nextSession.questions.length === 0) {
      refreshPool();
      stage = 'start';
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

    // A retry is practice only, so it must not double-count saved stats.
    try {
      markSeen(subject, question.id);
      if (!retryMode) recordAnswer(subject, correct);
    } catch {
      // A storage failure must not break the quiz.
    }
  }

  function handleNext(): void {
    if (choice === null || !current) return;

    if (index < session.length - 1) {
      index += 1;
      choice = null;
      liveMessage = '';
      void tick().then(() => questionHeading?.focus());
      return;
    }

    finishSession();
  }

  function finishSession(): void {
    if (!retryMode) refreshPool();
    stage = 'results';
    liveMessage = retryMode
      ? `Retry complete. You scored ${correctCount} out of ${session.length}.`
      : `Session complete. You scored ${correctCount} out of ${session.length}.`;
    void tick().then(() => resultsHeading?.focus());
  }

  function handleNewSession(): void {
    refreshPool();
    clearSession();
    retryMode = false;
    stage = 'start';
    void tick().then(() => startHeading?.focus());
  }

  function handleRetryMissed(): void {
    if (missed.length === 0) return;
    const retryQuestions = missed.map((item) => item.question);
    startQuestions(retryQuestions, true);
  }

  function handleReset(): void {
    try {
      resetSeen(subject);
    } catch {
      // Storage is fail-soft; the refresh below will reflect whatever succeeded.
    }
    refreshPool();
    clearSession();
    stage = 'start';

    if (questions.length > 0) {
      handleStart();
    }
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
      {:else if poolExhausted}
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
          <p class="text-lg" aria-live="polite">
            <strong class="text-2xl font-bold text-indigo-600 dark:text-indigo-400"
              >{unseenCount}</strong
            >
            <span> unseen of </span>
            <strong class="text-2xl font-bold">{totalCount}</strong>
            <span> questions</span>
          </p>
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
          Start session
        </button>
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
            class="flex items-center gap-2 text-sm font-semibold"
            role="group"
            aria-label="Session score and streak"
          >
            <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              Score <span class="text-indigo-600 dark:text-indigo-400">{correctCount}</span>
            </span>
            <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              Streak <span class="text-amber-600 dark:text-amber-400">{streak}</span>
            </span>
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
          {retryMode ? 'Retry complete' : 'Session complete'}
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
          Perfect score — no missed questions.
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

      {#if retryMode}
        <p class="text-center text-xs text-slate-500 dark:text-slate-400">
          Retry practice doesn't change your saved score or progress.
        </p>
      {/if}
    </div>
  {/if}
</section>
