<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    POLL_OPTIONS,
    clearPollVote,
    getPollVote,
    pollOptionLabel,
    savePollVote,
    type PollOptionId
  } from '../../lib/poll';
  import {
    loadPollResults,
    removePollVote,
    submitPollVote,
    type PollResults
  } from '../../lib/poll-api';

  type Mode = 'loading' | 'live' | 'local';

  let mode = $state<Mode>('loading');
  let results = $state<PollResults | null>(null);
  let vote = $state<PollOptionId | null>(null);
  let selected = $state<PollOptionId | null>(null);
  let editing = $state(false);
  let saving = $state(false);
  let statusMessage = $state('');
  let errorMessage = $state('');

  let confirmationHeading = $state<HTMLHeadingElement | null>(null);
  let formHeading = $state<HTMLLegendElement | null>(null);

  const voteLabel = $derived(vote === null ? '' : pollOptionLabel(vote));

  onMount(() => {
    void initialise();
  });

  async function initialise(): Promise<void> {
    const localVote = getPollVote();
    const live = await loadPollResults();

    if (live) {
      mode = 'live';
      results = live;
      vote = live.myVote;
      selected = live.myVote ?? localVote;
      editing = false;
      if (live.myVote) savePollVote(live.myVote);
      return;
    }

    mode = 'local';
    vote = localVote;
    selected = localVote;
    editing = false;
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!selected || saving) return;

    const choice = selected;
    errorMessage = '';

    if (mode === 'local') {
      savePollVote(choice);
      vote = choice;
      editing = false;
      statusMessage = `Your vote for ${pollOptionLabel(choice)} was saved on this device.`;
      void tick().then(() => confirmationHeading?.focus());
      return;
    }

    saving = true;
    const next = await submitPollVote(choice);
    saving = false;

    if (!next) {
      errorMessage = "We couldn't save your vote. Check your connection and try again.";
      return;
    }

    results = next;
    vote = next.myVote ?? choice;
    selected = vote;
    editing = false;
    savePollVote(vote);
    statusMessage = `Your vote for ${pollOptionLabel(vote)} was saved.`;
    void tick().then(() => confirmationHeading?.focus());
  }

  function changeVote(): void {
    if (!vote) return;

    selected = vote;
    editing = true;
    errorMessage = '';
    statusMessage = 'Choose another subject.';
    void tick().then(() => formHeading?.focus());
  }

  function cancelChange(): void {
    if (!vote) return;

    selected = vote;
    editing = false;
    errorMessage = '';
    statusMessage = 'Your vote was not changed.';
    void tick().then(() => confirmationHeading?.focus());
  }

  async function handleRemove(): Promise<void> {
    if (saving) return;

    errorMessage = '';

    if (mode === 'local') {
      clearPollVote();
      vote = null;
      selected = null;
      editing = false;
      statusMessage = 'Your saved vote was removed.';
      void tick().then(() => formHeading?.focus());
      return;
    }

    saving = true;
    const next = await removePollVote();
    saving = false;

    if (!next) {
      errorMessage = "We couldn't remove your vote. Check your connection and try again.";
      return;
    }

    clearPollVote();
    results = next;
    vote = null;
    selected = null;
    editing = false;
    statusMessage = 'Your vote was removed.';
    void tick().then(() => formHeading?.focus());
  }
</script>

<div class="max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
  {#if mode === 'loading'}
    <div class="h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" aria-hidden="true"></div>
  {:else if vote && !editing}
    <div class="flex items-start gap-4">
      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fill-rule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clip-rule="evenodd"
          />
        </svg>
      </span>

      <div class="min-w-0 flex-1">
        <h2 bind:this={confirmationHeading} tabindex="-1" class="text-xl font-semibold tracking-tight">
          Thanks for voting
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          You picked <strong class="font-semibold text-slate-900 dark:text-slate-100">{voteLabel}</strong>.
          {#if mode === 'live'}
            Your vote is counted with everyone else's.
          {:else}
            Live results aren't connected, so this vote is saved only in this browser.
          {/if}
        </p>

        {#if mode === 'live' && results}
          <div class="mt-6">
            <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100">Live results</h3>
            <ul class="mt-3 space-y-3">
              {#each POLL_OPTIONS as option (option.id)}
                {@const count = results.totals[option.id]}
                {@const percent = results.total > 0 ? Math.round((count / results.total) * 100) : 0}
                <li>
                  <div class="flex items-baseline justify-between gap-3 text-sm">
                    <span
                      class="flex flex-wrap items-center gap-2 {vote === option.id
                        ? 'font-semibold text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400'}"
                    >
                      {option.label}
                      {#if vote === option.id}
                        <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                          Your vote
                        </span>
                      {/if}
                    </span>
                    <span class="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                      {percent}% · {count}
                    </span>
                  </div>
                  <div
                    class="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={percent}
                    aria-label={`${option.label}: ${percent} percent`}
                  >
                    <div class="h-full rounded-full bg-indigo-600 dark:bg-indigo-400" style={`width: ${percent}%`}></div>
                  </div>
                </li>
              {/each}
            </ul>
            <p class="mt-4 text-sm text-slate-500 dark:text-slate-400">
              {results.total}
              {results.total === 1 ? 'vote' : 'votes'} so far
            </p>
          </div>
        {/if}

        {#if errorMessage}
          <p role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {errorMessage}
          </p>
        {/if}

        <div class="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onclick={changeVote}
            disabled={saving}
            class="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:text-slate-950 dark:focus-visible:ring-offset-slate-900"
          >
            Change vote
          </button>
          <button
            type="button"
            onclick={handleRemove}
            disabled={saving}
            class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-900"
          >
            {saving ? 'Removing…' : 'Remove vote'}
          </button>
        </div>
      </div>
    </div>
  {:else}
    <form onsubmit={handleSubmit} novalidate>
      <fieldset>
        <legend bind:this={formHeading} tabindex="-1" class="text-base font-semibold">Select one subject</legend>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {#if mode === 'live'}
            One vote per browser. Results are shared with everyone.
            <span class="mt-1 block text-xs text-slate-500 dark:text-slate-500">
              {results?.total ?? 0}
              {results?.total === 1 ? 'vote' : 'votes'} so far
            </span>
          {:else}
            Live results aren't connected right now, so your vote is saved on this device only.
          {/if}
        </p>

        <ul class="mt-4 grid gap-2 sm:grid-cols-2" role="list">
          {#each POLL_OPTIONS as option (option.id)}
            <li>
              <label
                class="flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 dark:focus-within:ring-offset-slate-900 {selected ===
                option.id
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-200'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-800/70'}"
              >
                <input
                  class="sr-only"
                  type="radio"
                  name="next-subject"
                  value={option.id}
                  bind:group={selected}
                />
                <span
                  class="grid h-5 w-5 shrink-0 place-items-center rounded-full border {selected === option.id
                    ? 'border-indigo-600 dark:border-indigo-400'
                    : 'border-slate-300 dark:border-slate-600'}"
                >
                  <span
                    class="h-2.5 w-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400 {selected === option.id
                      ? ''
                      : 'opacity-0'}"
                  ></span>
                </span>
                <span>{option.label}</span>
              </label>
            </li>
          {/each}
        </ul>
      </fieldset>

      {#if errorMessage}
        <p role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {errorMessage}
        </p>
      {/if}

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!selected || saving}
          class="min-h-12 w-full rounded-xl bg-indigo-600 px-5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:text-slate-950 dark:focus-visible:ring-offset-slate-900"
        >
          {saving ? 'Saving…' : 'Submit vote'}
        </button>
        {#if vote}
          <button
            type="button"
            onclick={cancelChange}
            disabled={saving}
            class="min-h-12 rounded-xl px-4 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-100"
          >
            Cancel
          </button>
        {/if}
      </div>
    </form>
  {/if}

  <p class="sr-only" role="status" aria-live="polite">{statusMessage}</p>
</div>
