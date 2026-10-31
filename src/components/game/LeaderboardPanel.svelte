<script lang="ts">
  import { onMount } from 'svelte';
  import { getGame } from '../../lib/storage';
  import { getUserName } from '../../lib/storage';
  import {
    advanceWeeklyXp,
    currentIsoWeek,
    getLeaderboardState,
    saveLeaderboardState,
    setLeaderboardOptedIn,
    startLeaderboard,
    type LeaderboardSnapshot
  } from '../../lib/leaderboard';
  import { leaveLeaderboard, loadLeaderboard, submitWeeklyXp } from '../../lib/leaderboard-api';

  let mounted = $state(false);
  let optedIn = $state(false);
  let busy = $state(false);
  let snapshot = $state<LeaderboardSnapshot | null>(null);
  let message = $state('');
  let failed = $state(false);
  let displayName = $state<string | null>(null);

  async function sync(): Promise<void> {
    if (!optedIn) return;

    busy = true;
    failed = false;
    message = '';

    try {
      const week = currentIsoWeek();
      const advanced = advanceWeeklyXp(getLeaderboardState(), getGame().xp, week);
      saveLeaderboardState(advanced);

      // Always POST so the name is submitted to the server (even when weeklyXp is 0 on first join).
      // loadLeaderboard() (GET) never sends the name, so using it would leave the user nameless.
      const result = await submitWeeklyXp(advanced.weeklyXp);

      if (result) {
        snapshot = result;
      } else {
        snapshot = null;
        failed = true;
        message = 'Leaderboard unavailable right now. Your progress is still saved.';
      }
    } finally {
      busy = false;
    }
  }

  async function handleToggle(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement | null;
    if (!input || busy) return;

    if (input.checked) {
      const state = startLeaderboard(getLeaderboardState(), getGame().xp);
      saveLeaderboardState(state);
      optedIn = true;
      await sync();
      return;
    }

    await leave();
  }

  async function leave(): Promise<void> {
    optedIn = false;
    setLeaderboardOptedIn(false);
    snapshot = null;
    failed = false;
    message = '';
    busy = true;

    const result = await leaveLeaderboard();
    busy = false;

    if (!result) {
      failed = true;
      message = 'Could not reach the leaderboard. Your entry will expire automatically.';
    } else {
      message = 'You left the weekly leaderboard.';
    }
  }

  onMount(() => {
    mounted = true;
    const state = getLeaderboardState();
    optedIn = state.optedIn;
    displayName = getUserName();
    if (optedIn) void sync();

    // Re-sync when user sets their name via the modal
    const handleNameSet = (e: Event): void => {
      displayName = (e as CustomEvent<{ name: string }>).detail.name;
      if (optedIn) void sync();
    };
    window.addEventListener('icse:nameSet', handleNameSet);
    // Return cleanup so the listener is removed when the component unmounts
    return () => window.removeEventListener('icse:nameSet', handleNameSet);
  });
</script>

<section
  aria-labelledby="leaderboard-heading"
  class="mb-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <p class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
        Weekly leaderboard
      </p>
      <h2 id="leaderboard-heading" class="mt-1 text-xl font-bold tracking-tight">
        Compare your week
      </h2>
    </div>

    <label class="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-600">
      <input
        type="checkbox"
        role="switch"
        checked={optedIn}
        disabled={!mounted || busy}
        on:change={handleToggle}
        class="h-5 w-5 accent-indigo-600"
      />
      <span>{optedIn ? 'Joined' : 'Join'}</span>
    </label>
  </div>

  <p class="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
    Optional. Joining stores a random id in an HttpOnly cookie and shares your weekly XP and chosen display name.
    No email or IP address is stored, and you can leave at any time to remove your entry.
  </p>

  <div class="mt-5">
    {#if !mounted}
      <p class="text-sm text-slate-500 dark:text-slate-400">Loading leaderboard settings…</p>
    {:else if !optedIn}
      <p class="text-sm text-slate-600 dark:text-slate-300">
        The leaderboard is off. Turn it on to see the top 10 and your weekly rank.
      </p>
    {:else if busy && !snapshot}
      <p class="text-sm text-slate-500 dark:text-slate-400">Loading this week's scores…</p>
    {:else if snapshot}
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">Week {snapshot.week}</p>
          <button
            type="button"
            on:click={sync}
            disabled={busy}
            class="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>

        {#if snapshot.me}
          <div class="rounded-2xl bg-indigo-50 p-4 dark:bg-indigo-500/15">
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
                You are {displayName ?? snapshot.me.name}
              </p>
              <button
                type="button"
                on:click={() => window.dispatchEvent(new CustomEvent('icse:openNameModal'))}
                class="text-xs font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
              >
                Change name
              </button>
            </div>
            <p class="mt-1 text-sm text-indigo-900 dark:text-indigo-100">
              Rank #{snapshot.me.rank} · {snapshot.me.xp} XP · Top {snapshot.me.percentile}% this week
            </p>
          </div>
        {:else}
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-slate-600 dark:text-slate-300">
              You are not on the board yet. Answer some questions, then refresh.
            </p>
            <button
              type="button"
              on:click={() => window.dispatchEvent(new CustomEvent('icse:openNameModal'))}
              class="text-xs font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
            >
              {displayName ? 'Change name' : 'Set name'}
            </button>
          </div>
        {/if}

        {#if snapshot.top.length > 0}
          <ol class="space-y-2">
            {#each snapshot.top as entry (entry.rank)}
              <li
                class="flex items-center gap-3 rounded-xl px-3 py-2 text-sm {snapshot.me?.rank === entry.rank
                  ? 'bg-indigo-100 font-semibold dark:bg-indigo-500/20'
                  : 'bg-slate-100 dark:bg-slate-800/70'}"
              >
                <span class="w-8 shrink-0 text-slate-500 dark:text-slate-400">#{entry.rank}</span>
                <span class="min-w-0 flex-1 truncate">
                  {snapshot.me?.rank === entry.rank ? (displayName ?? entry.name) : entry.name}
                </span>
                <span class="shrink-0 text-indigo-700 dark:text-indigo-300">{entry.xp} XP</span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="text-sm text-slate-600 dark:text-slate-300">
            No scores yet this week. Be the first on the board.
          </p>
        {/if}

        <button
          type="button"
          on:click={leave}
          disabled={busy}
          class="min-h-10 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/60 dark:text-rose-300 dark:hover:bg-rose-500/10"
        >
          Leave leaderboard
        </button>
      </div>
    {:else}
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          on:click={sync}
          disabled={busy}
          class="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Try again
        </button>
        <button
          type="button"
          on:click={leave}
          disabled={busy}
          class="min-h-10 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/60 dark:text-rose-300 dark:hover:bg-rose-500/10"
        >
          Leave leaderboard
        </button>
      </div>
    {/if}

    {#if message}
      <p class="mt-3 text-sm {failed ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'}">
        {message}
      </p>
    {/if}
  </div>

  <p class="sr-only" aria-live="polite">{message}</p>
</section>
