<script lang="ts">
  import { onMount } from 'svelte';
  import { DAILY_GOAL_OPTIONS, type DailyGoal } from '../../lib/config';
  import { localDay } from '../../lib/date';
  import { defaultGameState, type GameState } from '../../lib/gamification';
  import { getGame, resetGame, saveGame } from '../../lib/storage';
  import XpBar from './XpBar.svelte';

  let game = $state<GameState>(defaultGameState());
  let today = $state('');
  let mounted = $state(false);
  let confirmingReset = $state(false);

  const answeredToday = $derived(game.daily.day === today ? game.daily.answered : 0);
  const goal = $derived(game.dailyGoal);
  const goalPercent = $derived(Math.min(100, Math.round((answeredToday / goal) * 100)));
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = $derived(circumference * (1 - goalPercent / 100));

  function refresh(): void {
    today = localDay(new Date());
    game = getGame();
    mounted = true;
  }

  function chooseGoal(next: DailyGoal): void {
    game = { ...game, dailyGoal: next };
    saveGame(game);
  }

  function confirmReset(): void {
    resetGame();
    game = getGame();
    confirmingReset = false;
  }

  onMount(() => {
    refresh();
    const handlePageShow = (): void => refresh();
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  });
</script>

<section
  aria-labelledby="game-progress-heading"
  class="mb-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <p class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
        Your progress
      </p>
      <h2 id="game-progress-heading" class="mt-1 text-xl font-bold tracking-tight">
        Keep the streak alive
      </h2>
    </div>
    <div class="min-w-44 flex-1 sm:max-w-64">
      <XpBar xp={mounted ? game.xp : 0} />
    </div>
  </div>

  <div class="mt-6 grid gap-4 sm:grid-cols-3">
    <div class="flex items-center gap-4 rounded-2xl bg-slate-100 p-4 dark:bg-slate-800/70">
      <svg viewBox="0 0 72 72" class="h-20 w-20 shrink-0" role="img" aria-label={`Daily goal ${answeredToday} of ${goal} answers`}>
        <circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor" stroke-width="8" class="text-slate-300 dark:text-slate-700" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke="currentColor"
          stroke-width="8"
          stroke-linecap="round"
          stroke-dasharray={circumference}
          stroke-dashoffset={mounted ? dashOffset : circumference}
          transform="rotate(-90 36 36)"
          class="text-indigo-600 transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none dark:text-indigo-400"
        />
        <text x="36" y="40" text-anchor="middle" class="fill-slate-800 text-sm font-bold dark:fill-slate-100">
          {mounted ? `${answeredToday}/${goal}` : '–'}
        </text>
      </svg>
      <div>
        <p class="text-sm font-semibold">Daily goal</p>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {mounted ? `${answeredToday} of ${goal} answered` : 'Loading your progress'}
        </p>
        {#if mounted && answeredToday >= goal}
          <p class="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300">Goal reached</p>
        {/if}
      </div>
    </div>

    <div class="rounded-2xl bg-slate-100 p-4 dark:bg-slate-800/70">
      <p class="text-sm font-semibold">Streak</p>
      <p class="mt-1 text-2xl font-extrabold">
        <span aria-hidden="true">🔥</span>
        <span>{mounted ? game.streak.count : '–'}</span>
        <span class="text-sm font-semibold text-slate-600 dark:text-slate-300">days</span>
      </p>
      <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
        Best {mounted ? game.streak.best : '–'} · Freezes {mounted ? game.streak.freezes : '–'}/2
      </p>
    </div>

    <div class="rounded-2xl bg-slate-100 p-4 dark:bg-slate-800/70">
      <p id="daily-goal-label" class="text-sm font-semibold">Daily goal</p>
      <div role="group" aria-labelledby="daily-goal-label" class="mt-2 grid grid-cols-3 gap-2">
        {#each DAILY_GOAL_OPTIONS as option (option)}
          <button
            type="button"
            aria-pressed={goal === option}
            on:click={() => chooseGoal(option)}
            class="min-h-10 rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 {goal ===
            option
              ? 'bg-indigo-600 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}"
          >
            {option}
          </button>
        {/each}
      </div>
      <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">Questions per day</p>
    </div>
  </div>

  <div class="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
    {#if confirmingReset}
      <div role="alertdialog" aria-labelledby="reset-game-heading" class="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/60 dark:bg-amber-950/40">
        <h3 id="reset-game-heading" class="font-bold text-amber-950 dark:text-amber-50">Reset game progress?</h3>
        <p class="mt-1 text-sm text-amber-900 dark:text-amber-100">
          This clears XP, levels, streaks, badges and mastery. Your seen questions and accuracy stay.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            on:click={confirmReset}
            class="min-h-10 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
          >
            Yes, reset game progress
          </button>
          <button
            type="button"
            on:click={() => (confirmingReset = false)}
            class="min-h-10 rounded-lg border border-amber-400 px-4 text-sm font-semibold text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:border-amber-500/60 dark:text-amber-100 dark:focus-visible:ring-offset-slate-900"
          >
            Cancel
          </button>
        </div>
      </div>
    {:else}
      <button
        type="button"
        on:click={() => (confirmingReset = true)}
        class="rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"
      >
        Reset game progress
      </button>
    {/if}
  </div>
</section>
