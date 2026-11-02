<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultGameState, levelForGame, type GameState } from '../../lib/gamification';
  import { getGame, resetGame, saveGame } from '../../lib/storage';
  import {
    addCredits,
    devCredentialsConfigured,
    endDevSession,
    hasDevSession,
    isDevLogin,
    resetCredits,
    setCredits,
    startDevSession,
    toCredits,
  } from '../../lib/dev';

  let mounted = $state(false);
  let authed = $state(false);
  let configured = $state(true);
  let username = $state('');
  let password = $state('');
  let loginError = $state('');
  let game = $state<GameState>(defaultGameState());
  let amount = $state('500');
  let exact = $state('0');
  let status = $state('');
  let statusKind = $state<'ok' | 'error'>('ok');
  let confirmingCreditsReset = $state(false);
  let confirmingFullReset = $state(false);

  const level = $derived(levelForGame(game));

  function format(value: number): string {
    return value.toLocaleString('en-US');
  }

  function refresh(): void {
    game = getGame();
    exact = String(game.xp);
  }

  function showStatus(message: string, kind: 'ok' | 'error' = 'ok'): void {
    status = message;
    statusKind = kind;
  }

  function commit(next: GameState, message: string): void {
    saveGame(next);
    game = next;
    exact = String(next.xp);
    showStatus(message);
  }

  function handleLogin(event: SubmitEvent): void {
    event.preventDefault();
    if (!isDevLogin(username, password)) {
      loginError = configured
        ? 'Wrong username or password.'
        : 'Dev login is not configured on this build. Set PUBLIC_DEV_USERNAME and PUBLIC_DEV_PASSWORD.';
      return;
    }

    startDevSession();
    authed = true;
    loginError = '';
    password = '';
    refresh();
  }

  function logout(): void {
    endDevSession();
    authed = false;
    username = '';
    password = '';
    status = '';
    confirmingCreditsReset = false;
    confirmingFullReset = false;
  }

  function readAmount(): number | null {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      showStatus('Enter a positive whole number.', 'error');
      return null;
    }
    return Math.trunc(value);
  }

  function applyAdd(sign: 1 | -1): void {
    const value = readAmount();
    if (value === null) return;

    commit(
      addCredits(game, sign * value),
      `${sign === 1 ? 'Added' : 'Removed'} ${format(value)} credits.`,
    );
  }

  function applySet(): void {
    const parsed = Number(exact);
    if (!Number.isFinite(parsed) || parsed < 0) {
      showStatus('Enter zero or a positive whole number.', 'error');
      return;
    }

    const value = toCredits(parsed);
    commit(setCredits(game, value), `Credits set to ${format(value)}.`);
  }

  function applyResetCredits(): void {
    commit(resetCredits(game), 'Credits and level reset.');
    confirmingCreditsReset = false;
  }

  function applyFullReset(): void {
    resetGame();
    refresh();
    showStatus('All game progress reset for this browser.');
    confirmingFullReset = false;
  }

  onMount(() => {
    mounted = true;
    configured = devCredentialsConfigured();
    authed = hasDevSession();
    if (authed) refresh();
  });
</script>

{#if !mounted}
  <p class="text-sm text-slate-500 dark:text-slate-400">Loading developer panel…</p>
{:else if !authed}
  <section class="mx-auto w-full max-w-md">
    <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p class="text-sm font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
        Staff only
      </p>
      <h1 class="mt-2 text-2xl font-bold tracking-tight">Developer login</h1>
      <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        Sign in to adjust credits for this browser.
      </p>

      {#if !configured}
        <p class="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-50">
          This build has no dev credentials. Set <code>PUBLIC_DEV_USERNAME</code> and
          <code>PUBLIC_DEV_PASSWORD</code> before building.
        </p>
      {/if}

      <form class="mt-6 space-y-4" onsubmit={handleLogin}>
        <div>
          <label for="dev-username" class="block text-sm font-semibold">Username</label>
          <input
            id="dev-username"
            name="username"
            type="text"
            autocomplete="username"
            bind:value={username}
            class="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div>
          <label for="dev-password" class="block text-sm font-semibold">Password</label>
          <input
            id="dev-password"
            name="password"
            type="password"
            autocomplete="current-password"
            bind:value={password}
            class="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        {#if loginError}
          <p role="alert" class="text-sm font-semibold text-rose-700 dark:text-rose-300">
            {loginError}
          </p>
        {/if}

        <button
          type="submit"
          class="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          Sign in
        </button>
      </form>

      <p class="mt-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        This is a browser-only panel. Its credentials are compiled into the public JavaScript,
        so they only stop casual access. Do not reuse a real password.
      </p>
    </div>
  </section>
{:else}
  <section class="mx-auto w-full max-w-3xl space-y-5">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
          Developer panel
        </p>
        <h1 class="mt-1 text-2xl font-bold tracking-tight">Credit controls</h1>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Changes apply to the player progress saved in this browser.
        </p>
      </div>
      <button
        type="button"
        onclick={logout}
        class="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        Log out
      </button>
    </header>

    <div class="grid gap-3 sm:grid-cols-3">
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Credits</p>
        <p class="mt-1 text-2xl font-bold tabular-nums">{format(game.xp)}</p>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Lifetime credits</p>
        <p class="mt-1 text-2xl font-bold tabular-nums">{format(game.totalEarnedXP)}</p>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Level</p>
        <p class="mt-1 text-2xl font-bold tabular-nums">{level}</p>
      </div>
    </div>

    <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <h2 class="text-lg font-bold tracking-tight">Add or remove</h2>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Use a positive number, then pick add or remove.
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputmode="numeric"
          bind:value={amount}
          aria-label="Credit amount"
          class="min-h-11 w-32 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="button"
          onclick={() => applyAdd(1)}
          class="inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          Add
        </button>
        <button
          type="button"
          onclick={() => applyAdd(-1)}
          class="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Remove
        </button>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        {#each [100, 500, 1000, 5000] as preset}
          <button
            type="button"
            onclick={() => commit(addCredits(game, preset), `Added ${format(preset)} credits.`)}
            class="min-h-9 rounded-lg bg-slate-100 px-3 text-sm font-semibold transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            +{format(preset)}
          </button>
        {/each}
      </div>
    </section>

    <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <h2 class="text-lg font-bold tracking-tight">Set exact balance</h2>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Level and lifetime credits never drop below their current values here.
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputmode="numeric"
          bind:value={exact}
          aria-label="Exact credit balance"
          class="min-h-11 w-36 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="button"
          onclick={applySet}
          class="inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          Set credits
        </button>
      </div>
    </section>

    {#if status}
      <p
        role="status"
        class={`rounded-xl px-4 py-3 text-sm font-semibold ${
          statusKind === 'error'
            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
        }`}
      >
        {status}
      </p>
    {/if}

    <section class="rounded-3xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900/70 dark:bg-rose-950/30 sm:p-6">
      <h2 class="text-lg font-bold tracking-tight text-rose-950 dark:text-rose-50">Danger zone</h2>

      {#if confirmingCreditsReset}
        <p class="mt-2 text-sm text-rose-900 dark:text-rose-100">
          Reset spendable credits, lifetime credits and level to zero?
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={applyResetCredits}
            class="inline-flex min-h-10 items-center rounded-xl bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800"
          >
            Yes, reset credits
          </button>
          <button
            type="button"
            onclick={() => (confirmingCreditsReset = false)}
            class="inline-flex min-h-10 items-center rounded-xl border border-rose-300 px-4 text-sm font-semibold text-rose-900 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-950/60"
          >
            Cancel
          </button>
        </div>
      {:else}
        <button
          type="button"
          onclick={() => (confirmingCreditsReset = true)}
          class="mt-3 inline-flex min-h-10 items-center rounded-xl border border-rose-300 px-4 text-sm font-semibold text-rose-900 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-950/60"
        >
          Reset credits and level
        </button>
      {/if}

      <hr class="my-5 border-rose-200 dark:border-rose-900/70" />

      {#if confirmingFullReset}
        <p class="text-sm text-rose-900 dark:text-rose-100">
          This wipes badges, streak, daily progress and credits for this browser. Continue?
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={applyFullReset}
            class="inline-flex min-h-10 items-center rounded-xl bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800"
          >
            Yes, reset everything
          </button>
          <button
            type="button"
            onclick={() => (confirmingFullReset = false)}
            class="inline-flex min-h-10 items-center rounded-xl border border-rose-300 px-4 text-sm font-semibold text-rose-900 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-950/60"
          >
            Cancel
          </button>
        </div>
      {:else}
        <button
          type="button"
          onclick={() => (confirmingFullReset = true)}
          class="inline-flex min-h-10 items-center rounded-xl border border-rose-300 px-4 text-sm font-semibold text-rose-900 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-950/60"
        >
          Reset all game progress
        </button>
      {/if}
    </section>
  </section>
{/if}
