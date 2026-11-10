<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { buildExamPaper, examDurationSeconds, scoreExam, type ExamQuestion, type ExamPool, type ExamScore } from '../../lib/exam';
  import { EXAM_SECONDS_PER_QUESTION } from '../../lib/config';
  import { localDay } from '../../lib/date';
  import { SUBJECTS } from '../../lib/subjects';
  import { topicLabel } from '../../lib/topics';
  import { recordSubjectPractice } from '../../lib/activity';
  import { syncLeaderboard } from '../../lib/leaderboard-api';
  import { applyAnswer, applySession, defaultGameState, type GameState } from '../../lib/gamification';
  import {
    getGame,
    markSeen,
    recordAnswer,
    recordQuestionResult,
    recordWrongAnswerResult,
    saveGame,
  } from '../../lib/storage';
  import { formatClock, isTypingTarget, optionIndexFromKey } from '../quiz/quiz-utils';

  let { pools }: { pools: ExamPool[] } = $props();

  type Stage = 'start' | 'exam' | 'results';

  const paperSizes = [10, 25, 50];
  const availableCount = pools.reduce((sum, pool) => sum + pool.questions.length, 0);

  let stage = $state<Stage>('start');
  let paperSize = $state(25);
  let questions = $state<ExamQuestion[]>([]);
  let answers = $state<(number | null)[]>([]);
  let index = $state(0);
  let timeLeft = $state(0);
  let deadline = $state(0);
  let timerId: ReturnType<typeof setInterval> | null = null;
  let totalSeconds = $state(0);
  let score = $state<ExamScore | null>(null);
  let sessionXp = $state(0);
  let submitted = $state(false);
  let liveMessage = $state('');
  let heading = $state<HTMLHeadingElement | null>(null);

  const current = $derived(questions[index] ?? null);
  const answeredCount = $derived(answers.filter((answer) => answer !== null).length);
  const unansweredCount = $derived(questions.length - answeredCount);

  function subjectTitle(subject: string): string {
    return SUBJECTS.find((item) => item.slug === subject)?.title ?? subject;
  }

  function startExam(): void {
    const paper = buildExamPaper(pools, { count: paperSize });
    if (paper.length === 0) return;

    questions = paper;
    answers = paper.map(() => null);
    index = 0;
    score = null;
    submitted = false;
    sessionXp = 0;
    totalSeconds = examDurationSeconds(paper.length);
    timeLeft = totalSeconds;
    stage = 'exam';
    liveMessage = `Exam started. ${paper.length} questions, ${formatClock(totalSeconds)}.`;
    startTimer();
    void tick().then(() => heading?.focus());
  }

  function startTimer(): void {
    stopTimer();
    deadline = Date.now() + totalSeconds * 1000;
    timerId = setInterval(tickTimer, 250);
  }

  function tickTimer(): void {
    if (deadline === 0) return;
    const remainingMs = deadline - Date.now();
    const previous = timeLeft;
    timeLeft = Math.max(0, Math.ceil(remainingMs / 1000));

    if (timeLeft !== previous && (timeLeft === 300 || timeLeft === 60)) {
      liveMessage = `${formatClock(timeLeft)} left.`;
    }

    if (remainingMs <= 0) {
      deadline = 0;
      stopTimer();
      timeLeft = 0;
      liveMessage = "Time's up. Marking your paper.";
      submitExam(true);
    }
  }

  function stopTimer(): void {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function chooseOption(optionIndex: number): void {
    if (stage !== 'exam' || !current) return;
    if (optionIndex < 0 || optionIndex >= current.options.length) return;
    answers = answers.map((answer, position) => (position === index ? optionIndex : answer));
  }

  function goTo(nextIndex: number): void {
    if (stage !== 'exam' || questions.length === 0) return;
    index = Math.min(Math.max(0, nextIndex), questions.length - 1);
    void tick().then(() => heading?.focus());
  }

  function requestSubmit(): void {
    if (stage !== 'exam' || submitted) return;
    const message =
      unansweredCount > 0
        ? `Submit the exam? ${unansweredCount} question${unansweredCount === 1 ? '' : 's'} still unanswered.`
        : 'Submit the exam and see your score?';
    if (typeof window !== 'undefined' && !window.confirm(message)) return;
    submitExam(false);
  }

  /** Marks the paper and writes progress once. */
  function submitExam(auto: boolean): void {
    if (stage !== 'exam' || submitted) return;
    submitted = true;
    stopTimer();

    if (!auto && timeLeft > 0) {
      totalSeconds = Math.max(0, totalSeconds - timeLeft);
    }

    const result = scoreExam(questions, answers, (subject, topic) => topicLabel(subject, topic));
    score = result;

    const today = localDay(new Date());
    let game: GameState = defaultGameState();
    try {
      game = getGame();
    } catch {
      // Fail soft with defaults.
    }

    let combo = 0;
    let bestStreak = 0;
    const gained: number[] = [];

    questions.forEach((question, position) => {
      const answer = answers[position] ?? null;
      if (answer === null) return;
      const correct = answer === question.correctIndex;
      combo = correct ? combo + 1 : 0;
      bestStreak = Math.max(bestStreak, combo);

      try {
        markSeen(question.subject, question.id);
        recordSubjectPractice(question.subject, new Date(), correct);
        recordAnswer(question.subject, correct);
        recordQuestionResult(question.subject, question.id, correct);
        recordWrongAnswerResult(question.subject, question.id, correct);
        const update = applyAnswer(game, {
          questionId: question.id,
          subject: question.subject,
          correct,
          combo: correct ? combo : 0,
          today,
          hour: new Date().getHours(),
        });
        game = update.state;
        gained.push(
          ...update.events.flatMap((event) => (event.type === 'xp' ? [event.amount] : [])),
        );
      } catch {
        // Gamification is fail-soft.
      }
    });

    try {
      const session = applySession(game, {
        subject: 'mock',
        total: questions.length,
        correct: result.correct,
        today,
        bestStreak,
      });
      game = session.state;
      gained.push(...session.events.flatMap((event) => (event.type === 'xp' ? [event.amount] : [])));
      saveGame(game);
    } catch {
      // Gamification is fail-soft.
    }

    sessionXp = gained.reduce((sum, amount) => sum + amount, 0);
    stage = 'results';
    liveMessage = `Exam marked. You scored ${result.correct} out of ${result.total}.`;
    void syncLeaderboard();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (stage !== 'exam' || !current) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;

    const picked = optionIndexFromKey(event.key, current.options.length);
    if (picked !== null) {
      event.preventDefault();
      chooseOption(picked);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      goTo(index + 1);
    }
  }

  function weakestTopicLink(): string {
    if (!score || score.perTopic.length === 0) return '/';
    const [subject, topic] = score.perTopic[0]!.key.split(':');
    return `/${subject}?topic=${topic}`;
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
  });

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (stage !== 'exam' || submitted) return;
    event.preventDefault();
    event.returnValue = '';
  }

  onDestroy(() => {
    stopTimer();
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<section class="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:p-8">
  <div class="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>

  {#if stage === 'start'}
    <div class="space-y-6">
      <div class="space-y-2">
        <p class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
          Mock exam
        </p>
        <h2 class="text-2xl font-bold tracking-tight sm:text-3xl">Exam conditions, marked at the end</h2>
        <p class="text-slate-600 dark:text-slate-300">
          Mixed subjects, one timer for the whole paper, no hints. You can change answers and jump
          between questions until you submit — then every explanation is revealed.
        </p>
      </div>

      <div class="space-y-2">
        <p id="paper-size-label" class="text-sm font-semibold">Paper size</p>
        <div role="group" aria-labelledby="paper-size-label" class="grid grid-cols-3 gap-2">
          {#each paperSizes as size (size)}
            <button
              type="button"
              aria-pressed={paperSize === size}
              on:click={() => (paperSize = size)}
              class="min-h-12 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 {paperSize === size
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'border border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}"
            >
              {size} questions
            </button>
          {/each}
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {Math.min(paperSize, availableCount)} questions · {formatClock(
            examDurationSeconds(Math.min(paperSize, availableCount)),
          )} · about {EXAM_SECONDS_PER_QUESTION}s per question
        </p>
      </div>

      <button
        type="button"
        on:click={startExam}
        disabled={availableCount === 0}
        class="min-h-14 w-full rounded-2xl bg-indigo-600 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-900"
      >
        Start mock exam
      </button>
    </div>
  {:else if stage === 'exam' && current}
    <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
        <p class="text-slate-600 dark:text-slate-300">Question {index + 1} of {questions.length}</p>
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
            {answeredCount}/{questions.length} answered
          </span>
          <span
            class="rounded-full px-3 py-1 tabular-nums {timeLeft <= 60
              ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200'
              : 'bg-slate-100 dark:bg-slate-800'}"
            aria-label={`${formatClock(timeLeft)} left`}
          >
            <span aria-hidden="true">⏳</span>
            {formatClock(timeLeft)}
          </span>
        </div>
      </div>

      <div class="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          class="h-full rounded-full bg-indigo-600 transition-[width] duration-300 dark:bg-indigo-400"
          style={`width: ${((index + 1) / questions.length) * 100}%`}
        ></div>
      </div>

      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Question palette">
        {#each questions as question, position (question.id)}
          <button
            type="button"
            aria-label={`Question ${position + 1}${answers[position] !== null ? ', answered' : ', not answered'}`}
            aria-current={position === index ? 'true' : undefined}
            on:click={() => goTo(position)}
            class="h-8 w-8 rounded-lg text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 {position === index
              ? 'bg-indigo-600 text-white'
              : answers[position] !== null
                ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-500/25 dark:text-emerald-100'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}"
          >
            {position + 1}
          </button>
        {/each}
      </div>

      <h2
        bind:this={heading}
        tabindex="-1"
        id="exam-question"
        class="scroll-mt-24 rounded-lg text-xl font-bold leading-snug tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:text-2xl"
      >
        {current.question}
      </h2>

      <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {subjectTitle(current.subject)} · {topicLabel(current.subject, current.topic)}
      </p>

      <div role="radiogroup" aria-labelledby="exam-question" class="space-y-3">
        {#each current.options as option, optionIndex}
          <button
            type="button"
            role="radio"
            aria-checked={answers[index] === optionIndex}
            on:click={() => chooseOption(optionIndex)}
            class="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:px-4 sm:py-4 {answers[index] === optionIndex
              ? 'border-indigo-500 bg-indigo-50 text-indigo-950 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-50'
              : 'border-slate-300 bg-white text-slate-900 hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700'}"
          >
            <span
              aria-hidden="true"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold {answers[index] === optionIndex
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}"
            >
              {optionIndex + 1}
            </span>
            <span class="min-w-0 flex-1 text-base font-medium sm:text-lg">{option}</span>
          </button>
        {/each}
      </div>

      <div class="grid grid-cols-2 gap-3">
        <button
          type="button"
          on:click={() => goTo(index - 1)}
          disabled={index === 0}
          class="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-800 transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
        >
          Previous
        </button>
        <button
          type="button"
          on:click={() => goTo(index + 1)}
          disabled={index === questions.length - 1}
          class="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-800 transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
        >
          Next
        </button>
      </div>

      <button
        type="button"
        on:click={requestSubmit}
        class="min-h-14 w-full rounded-2xl bg-indigo-600 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
      >
        Submit exam{unansweredCount > 0 ? ` (${unansweredCount} unanswered)` : ''}
      </button>
    </div>
  {:else if stage === 'results' && score}
    <div class="space-y-6">
      <div class="space-y-1">
        <p class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
          Mock exam results
        </p>
        <h2 class="text-2xl font-bold tracking-tight sm:text-3xl">
          {score.percent}% — {score.correct}/{score.total}
        </h2>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {score.wrong} wrong · {score.unanswered} unanswered · {formatClock(totalSeconds)} used ·
          +{sessionXp} XP
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="exam-subjects-heading" class="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 id="exam-subjects-heading" class="text-sm font-bold">By subject</h3>
          <ul class="mt-2 space-y-1.5" role="list">
            {#each score.perSubject as row (row.key)}
              <li class="flex items-center justify-between gap-2 text-sm">
                <span class="truncate">{subjectTitle(row.key)}</span>
                <span class="shrink-0 font-semibold tabular-nums">
                  {row.correct}/{row.total} · {row.percent}%
                </span>
              </li>
            {/each}
          </ul>
        </section>

        <section aria-labelledby="exam-topics-heading" class="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 id="exam-topics-heading" class="text-sm font-bold">Weakest topics</h3>
          <ul class="mt-2 space-y-1.5" role="list">
            {#each score.perTopic.slice(0, 6) as row (row.key)}
              <li class="flex items-center justify-between gap-2 text-sm">
                <span class="truncate">{row.label}</span>
                <span class="shrink-0 font-semibold tabular-nums">
                  {row.correct}/{row.total} · {row.percent}%
                </span>
              </li>
            {/each}
          </ul>
        </section>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          on:click={() => (stage = 'start')}
          class="min-h-14 rounded-2xl bg-indigo-600 px-5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          Take another paper
        </button>
        <a
          href={weakestTopicLink()}
          class="flex min-h-14 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-800 shadow-sm transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
        >
          Drill weakest topic
        </a>
      </div>

      <section aria-labelledby="exam-review-heading" class="space-y-3">
        <h3 id="exam-review-heading" class="text-lg font-bold">Question review</h3>
        <ul class="space-y-3">
          {#each questions as question, position (question.id)}
            {@const chosen = answers[position] ?? null}
            {@const isCorrect = chosen === question.correctIndex}
            <li class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p class="font-semibold leading-snug">{position + 1}. {question.question}</p>
              <p class="mt-2 text-sm {isCorrect ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}">
                {#if chosen === null}
                  No answer (unanswered)
                {:else if isCorrect}
                  Your answer: {question.options[chosen]} ✓
                {:else}
                  Your answer: {question.options[chosen]} ✗
                {/if}
              </p>
              <p class="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                Correct: {question.options[question.correctIndex]}
              </p>
              <p class="mt-2 text-sm text-slate-700 dark:text-slate-200">{question.explanation}</p>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</section>
