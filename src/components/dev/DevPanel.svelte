<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultGameState, levelForGame, type GameState } from '../../lib/gamification';
  import { getGame, getMyProfileId, resetGame, saveGame } from '../../lib/storage';
  import { getLeaderboardState } from '../../lib/leaderboard';
  import { syncLeaderboard } from '../../lib/leaderboard-api';
  import {
    adminLogin,
    adminLogout,
    deletePlayer,
    hasAdminToken,
    listPlayers,
    updatePlayer,
    type AdminPlayer,
  } from '../../lib/admin-api';
  import {
    addCredits,
    endDevSession,
    hasDevSession,
    isDevLogin,
    resetCredits,
    setCredits,
    startDevSession,
    syncDevCreditsToLeaderboard,
    toCredits,
  } from '../../lib/dev';

  let mounted = $state(false);
  let authed = $state(false);
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

  let tab = $state<'credits' | 'players'>('credits');
  let adminReady = $state<boolean | null>(null);
  let players = $state<AdminPlayer[]>([]);
  let playersLoading = $state(false);
  let playersMessage = $state('');
  let playersKind = $state<'info' | 'error'>('info');
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editXp = $state('');
  let savingId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);

  const level = $derived(levelForGame(game));

  function format(value: number): string {
    return value.toLocaleString('en-US');
  }

  let leaderboardXp = $state(0);

  function refresh(): void {
    game = getGame();
    exact = String(game.xp);
    const lb = getLeaderboardState();
    leaderboardXp = lb.weeklyXp;
  }

  function showStatus(message: string, kind: 'ok' | 'error' = 'ok'): void {
    status = message;
    statusKind = kind;
  }

  async function commit(next: GameState, message: string): Promise<void> {
    saveGame(next);
    game = next;
    exact = String(next.xp);
    const lb = syncDevCreditsToLeaderboard(next);
    leaderboardXp = lb.weeklyXp;
    showStatus(message);

    try {
      const myId = getMyProfileId();
      if (hasAdminToken() && myId) {
        await updatePlayer(myId, { xp: lb.weeklyXp });
      } else {
        const snapshot = await syncLeaderboard();
        if (hasAdminToken() && snapshot?.me?.id && snapshot.me.xp !== lb.weeklyXp) {
          await updatePlayer(snapshot.me.id, { xp: lb.weeklyXp });
        }
      }
    } catch {
      // Best-effort server sync
    }
  }

  async function handleLogin(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const allowed = await isDevLogin(username, password);
    if (!allowed) {
      loginError = 'Wrong username or password.';
      return;
    }

    startDevSession();
    authed = true;
    loginError = '';
    // Best effort: the shared account list needs the leaderboard server.
    adminReady = await adminLogin(username, password);
    password = '';
    refresh();
  }

  function logout(): void {
    void adminLogout();
    endDevSession();
    authed = false;
    username = '';
    password = '';
    status = '';
    confirmingCreditsReset = false;
    confirmingFullReset = false;
    tab = 'credits';
    adminReady = null;
    players = [];
    playersMessage = '';
    playersKind = 'info';
    editingId = null;
    confirmingDeleteId = null;
  }

  function showPlayersMessage(message: string, kind: 'info' | 'error' = 'info'): void {
    playersMessage = message;
    playersKind = kind;
  }

  async function refreshPlayers(): Promise<void> {
    playersLoading = true;
    playersMessage = '';
    const result = await listPlayers();
    playersLoading = false;

    if (result.ok) {
      players = result.data;
      return;
    }
    if (result.error === 'unauthorized') {
      showPlayersMessage('Admin session expired. Log out and sign in again.', 'error');
    } else if (result.error === 'unavailable') {
      showPlayersMessage('Player management needs the leaderboard server, which is not configured on this deployment.', 'error');
    } else {
      showPlayersMessage('Could not load players. Check your connection and try again.', 'error');
    }
  }

  async function openPlayers(): Promise<void> {
    tab = 'players';
    editingId = null;
    confirmingDeleteId = null;

    if (!hasAdminToken()) {
      players = [];
      showPlayersMessage(
        adminReady === false
          ? 'Player management needs the leaderboard server, which is not configured on this deployment.'
          : 'Admin session expired. Log out and sign in again.',
        'error',
      );
      return;
    }
    await refreshPlayers();
  }

  function beginEdit(player: AdminPlayer): void {
    editingId = player.id;
    editName = player.name;
    editXp = String(player.xp);
    confirmingDeleteId = null;
    playersMessage = '';
  }

  function cancelEdit(): void {
    editingId = null;
    playersMessage = '';
  }

  async function saveEdit(player: AdminPlayer): Promise<void> {
    const name = editName.trim();
    const xp = Number(editXp);

    if (!name) {
      showPlayersMessage('Enter a display name.', 'error');
      return;
    }
    if (!Number.isFinite(xp) || xp < 0) {
      showPlayersMessage('Weekly XP must be zero or a positive number.', 'error');
      return;
    }

    savingId = player.id;
    const result = await updatePlayer(player.id, { name, xp: Math.trunc(xp) });
    savingId = null;

    if (result.ok) {
      players = players.map((item) =>
        item.id === result.data.player.id ? result.data.player : item,
      );
      editingId = null;

      const myId = getMyProfileId();
      if (myId && player.id === myId) {
        const nextXp = Math.trunc(xp);
        const nextGame = setCredits(game, nextXp);
        saveGame(nextGame);
        game = nextGame;
        exact = String(nextGame.xp);
        syncDevCreditsToLeaderboard(nextGame);
        leaderboardXp = nextXp;
      }

      showPlayersMessage(
        result.data.xpApplied
          ? `Saved ${result.data.player.name}.`
          : `Saved ${result.data.player.name}, but this player has no entry in this week's board, so XP was not changed.`,
      );
      return;
    }

    if (result.error === 'unauthorized') {
      showPlayersMessage('Admin session expired. Log out and sign in again.', 'error');
    } else if (result.error === 'unavailable') {
      showPlayersMessage('Player management is not configured on this deployment.', 'error');
    } else {
      showPlayersMessage('Could not save that player. Try again.', 'error');
    }
  }

  async function removePlayer(player: AdminPlayer): Promise<void> {
    savingId = player.id;
    const result = await deletePlayer(player.id);
    savingId = null;

    if (result.ok) {
      players = players.filter((item) => item.id !== player.id);
      confirmingDeleteId = null;
      showPlayersMessage(`Removed ${player.name}.`);
      return;
    }

    if (result.error === 'unauthorized') {
      showPlayersMessage('Admin session expired. Log out and sign in again.', 'error');
    } else {
      showPlayersMessage('Could not remove that player. Try again.', 'error');
    }
  }

  function shortDate(value: string | null): string {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Unknown';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
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

  async function applyFullReset(): Promise<void> {
    resetGame();
    const nextGame = defaultGameState();
    syncDevCreditsToLeaderboard(nextGame);
    refresh();
    showStatus('All game progress reset for this browser.');
    confirmingFullReset = false;

    try {
      const myId = getMyProfileId();
      if (hasAdminToken() && myId) {
        await updatePlayer(myId, { xp: 0 });
      } else {
        await syncLeaderboard();
      }
    } catch {
      // Best effort
    }
  }

  onMount(() => {
    mounted = true;
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

    <div class="flex gap-2" role="tablist" aria-label="Developer panel sections">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'credits' ? 'true' : 'false'}
        onclick={() => (tab = 'credits')}
        class={`inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold transition-colors ${
          tab === 'credits'
            ? 'bg-indigo-600 text-white'
            : 'border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
        }`}
      >
        Credits
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'players' ? 'true' : 'false'}
        onclick={openPlayers}
        class={`inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold transition-colors ${
          tab === 'players'
            ? 'bg-indigo-600 text-white'
            : 'border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
        }`}
      >
        All players
      </button>
    </div>

    {#if tab === 'credits'}
    <div class="grid gap-3 sm:grid-cols-4">
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
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Leaderboard XP</p>
        <p class="mt-1 text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{format(leaderboardXp)}</p>
      </div>
    </div>

    <div class="flex items-center justify-end">
      <button
        type="button"
        onclick={() => commit(game, 'Credits and leaderboard synced.')}
        class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Sync with leaderboard
      </button>
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
    {:else}
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold tracking-tight">All players</h2>
          <p class="text-sm text-slate-600 dark:text-slate-300">
            Shared weekly leaderboard · {players.length} {players.length === 1 ? 'player' : 'players'}
            {#if players[0]} · {players[0].week}{/if}
          </p>
        </div>
        <button
          type="button"
          onclick={refreshPlayers}
          disabled={playersLoading}
          class="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      <p class="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        This edits the shared leaderboard account: display name and this week's XP. Local credits,
        badges and streaks live in each visitor's browser, so they cannot be changed remotely.
      </p>

      {#if playersMessage}
        <p
          role="status"
          class={`rounded-xl px-4 py-3 text-sm font-semibold ${
            playersKind === 'error'
              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200'
              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
          }`}
        >
          {playersMessage}
        </p>
      {/if}

      {#if playersLoading}
        <p class="text-sm text-slate-500 dark:text-slate-400">Loading players…</p>
      {:else if players.length === 0}
        {#if !playersMessage}
          <p class="text-sm text-slate-500 dark:text-slate-400">
            No players yet. They appear after someone answers a question and the leaderboard syncs.
          </p>
        {/if}
      {:else}
        <ul class="space-y-3">
          {#each players as player (player.id)}
            <li class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {#if editingId === player.id}
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="block text-sm font-semibold">
                    Display name
                    <input
                      type="text"
                      maxlength="20"
                      bind:value={editName}
                      class="mt-1 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label class="block text-sm font-semibold">
                    Weekly XP
                    <input
                      type="text"
                      inputmode="numeric"
                      bind:value={editXp}
                      class="mt-1 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onclick={() => saveEdit(player)}
                    disabled={savingId === player.id}
                    class="inline-flex min-h-9 items-center rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingId === player.id ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onclick={cancelEdit}
                    class="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              {:else}
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p class="font-bold">{player.name}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">
                      Last online {shortDate(player.lastOnline)} · {player.badges.length} badges ·
                      {player.subjects.length} subjects · id {player.id.slice(0, 8)}
                    </p>
                  </div>
                  <p class="text-xl font-bold tabular-nums">{format(player.xp)} XP</p>
                </div>

                {#if player.badges.length > 0 || player.subjects.length > 0}
                  <details class="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-950/60 dark:text-slate-300">
                    <summary class="cursor-pointer font-semibold">Details</summary>
                    {#if player.badges.length > 0}
                      <p class="mt-2"><span class="font-semibold">Badges:</span> {player.badges.join(', ')}</p>
                    {/if}
                    {#if player.subjects.length > 0}
                      <p class="mt-1">
                        <span class="font-semibold">Subjects:</span>
                        {player.subjects.map((item) => `${item.subject} (${item.attempts})`).join(', ')}
                      </p>
                    {/if}
                  </details>
                {/if}

                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onclick={() => beginEdit(player)}
                    class="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    Edit
                  </button>
                  {#if confirmingDeleteId === player.id}
                    <button
                      type="button"
                      onclick={() => removePlayer(player)}
                      disabled={savingId === player.id}
                      class="inline-flex min-h-9 items-center rounded-lg bg-rose-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:opacity-50"
                    >
                      {savingId === player.id ? 'Removing…' : 'Yes, remove'}
                    </button>
                    <button
                      type="button"
                      onclick={() => (confirmingDeleteId = null)}
                      class="inline-flex min-h-9 items-center rounded-lg border border-rose-300 px-3 text-sm font-semibold text-rose-900 transition-colors hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-950/60"
                    >
                      Cancel
                    </button>
                  {:else}
                    <button
                      type="button"
                      onclick={() => (confirmingDeleteId = player.id)}
                      class="inline-flex min-h-9 items-center rounded-lg border border-rose-300 px-3 text-sm font-semibold text-rose-900 transition-colors hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-950/60"
                    >
                      Remove
                    </button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
    {/if}
  </section>
{/if}
