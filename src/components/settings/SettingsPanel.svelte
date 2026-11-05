<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createAccount,
    deleteAccount,
    getActiveAccount,
    listAccounts,
    renameAccount,
    switchAccount,
    type LocalAccount
  } from '../../lib/accounts';
  import {
    disconnectSync,
    loginSync,
    registerSync,
    setAutoSync,
    syncNow,
    type SyncError
  } from '../../lib/account-sync';
  import { levelFromXp } from '../../lib/gamification';
  import { getGame } from '../../lib/storage';

  let accounts = $state<LocalAccount[]>([]);
  let active = $state<LocalAccount | null>(null);
  let mounted = $state(false);
  let xp = $state(0);

  let newAccountName = $state('');
  let renameValue = $state('');
  let accountMessage = $state('');
  let confirmDeleteId = $state<string | null>(null);

  let linkMode = $state<'register' | 'login'>('register');
  let username = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let linkBusy = $state(false);
  let syncBusy = $state(false);
  let syncMessage = $state('');
  let syncFailed = $state(false);

  const cloud = $derived(active?.cloud ?? null);
  const activeLevel = $derived(levelFromXp(xp));

  const SYNC_ERRORS: Record<SyncError, string> = {
    not_configured:
      'Cross-device sync is not configured on this deployment yet. Your progress is still saved locally.',
    username_taken: 'That username is already in use. Try signing in instead.',
    invalid_credentials: 'That username and password combination did not work.',
    invalid_username: 'Use 3–24 letters, numbers, dots, dashes or underscores.',
    weak_password: 'Use a password with at least 8 characters.',
    unauthorized: 'Your sign-in has expired. Sign in again to keep syncing.',
    invalid_payload: 'The sync data was rejected. Please try again.',
    payload_too_large: 'This account has too much progress to sync.',
    storage_unavailable: 'The sync service is unavailable right now. Try again later.',
    network: "Couldn't reach the sync service. Check your connection and try again.",
    invalid_response: 'The sync service returned an unexpected response.',
    unknown: 'Something went wrong. Please try again.',
    not_linked: 'This account is not linked for cross-device sync.',
    sync_failed: "Couldn't apply the synced progress. Your local data was left untouched."
  };

  function refresh(): void {
    accounts = listAccounts();
    active = getActiveAccount();
    renameValue = active.name;
    xp = getGame().xp;
    mounted = true;
  }

  function reloadAfterSwitch(): void {
    // A reload is the simplest way to make every component read the new keys.
    window.location.reload();
  }

  function handleCreate(): void {
    if (!newAccountName.trim()) return;
    createAccount(newAccountName);
    reloadAfterSwitch();
  }

  function handleSwitch(id: string): void {
    if (id === active?.id) return;
    if (switchAccount(id)) reloadAfterSwitch();
  }

  function handleRename(): void {
    if (!active) return;
    if (renameAccount(active.id, renameValue)) {
      accountMessage = 'Account renamed.';
      refresh();
    } else {
      accountMessage = 'Enter a name with at least one letter or number.';
    }
  }

  function handleDelete(id: string): void {
    if (deleteAccount(id)) {
      confirmDeleteId = null;
      if (id === active?.id) {
        reloadAfterSwitch();
      } else {
        accountMessage = 'Account deleted from this browser.';
        refresh();
      }
    } else {
      accountMessage = 'Keep at least one account in this browser.';
    }
  }

  function validateLink(): string | null {
    const clean = username.trim();
    if (!/^[a-zA-Z0-9._-]{3,24}$/.test(clean)) return SYNC_ERRORS.invalid_username;
    if (password.length < 8) return SYNC_ERRORS.weak_password;
    if (linkMode === 'register' && password !== confirmPassword) {
      return 'The passwords do not match.';
    }
    return null;
  }

  async function handleLink(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!active || linkBusy) return;

    const validationError = validateLink();
    if (validationError) {
      syncFailed = true;
      syncMessage = validationError;
      return;
    }

    linkBusy = true;
    syncFailed = false;
    syncMessage = '';

    const result =
      linkMode === 'register'
        ? await registerSync(username.trim(), password)
        : await loginSync(username.trim(), password);

    // Never keep the password in component state after the request.
    password = '';
    confirmPassword = '';
    linkBusy = false;

    if (result.ok) {
      syncFailed = false;
      syncMessage =
        linkMode === 'register'
          ? 'Sync account created. This account can now sign in on another device.'
          : 'Signed in. Progress from both devices has been merged.';
      refresh();
      window.dispatchEvent(new CustomEvent('icse:syncRequested'));
    } else {
      syncFailed = true;
      syncMessage = SYNC_ERRORS[result.error ?? 'unknown'];
    }
  }

  async function handleSyncNow(): Promise<void> {
    if (!active || syncBusy) return;

    syncBusy = true;
    syncFailed = false;
    syncMessage = '';
    const result = await syncNow(active.id);
    syncBusy = false;

    if (result.ok) {
      syncMessage = 'Progress synced in both directions.';
      refresh();
    } else {
      syncFailed = true;
      syncMessage = SYNC_ERRORS[result.error ?? 'unknown'];
    }
  }

  function handleAutoSync(event: Event): void {
    if (!active) return;
    const input = event.currentTarget as HTMLInputElement | null;
    if (!input) return;

    if (setAutoSync(active.id, input.checked)) {
      refresh();
      if (input.checked) window.dispatchEvent(new CustomEvent('icse:syncRequested'));
    }
  }

  function handleDisconnect(): void {
    if (!active) return;
    disconnectSync(active.id);
    syncFailed = false;
    syncMessage = 'Cross-device sync is off for this account. The server copy was left untouched.';
    refresh();
  }

  function formatDate(timestamp: number): string {
    if (!timestamp) return 'not yet';
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return 'not yet';
    }
  }

  onMount(() => {
    refresh();
    const handleAccountsChanged = (): void => refresh();
    window.addEventListener('icse:accountsChanged', handleAccountsChanged);
    return () => window.removeEventListener('icse:accountsChanged', handleAccountsChanged);
  });
</script>

<div class="space-y-8">
  <section
    aria-labelledby="accounts-heading"
    class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
  >
    <p class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
      Local accounts
    </p>
    <h2 id="accounts-heading" class="mt-1 text-xl font-bold tracking-tight">Who is practising?</h2>
    <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      Keep separate progress for different people on this browser. Everything stays on this device unless you turn on
      optional cross-device sync below.
    </p>

    <ul class="mt-5 space-y-2">
      {#each accounts as account (account.id)}
        <li
          class="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 {account.id === active?.id
            ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/50 dark:bg-indigo-500/10'
            : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'}"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">
              {account.name}
              {#if account.id === active?.id}
                <span class="ml-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Active
                </span>
              {/if}
            </p>
            <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {#if account.id === active?.id}
                Level {mounted ? activeLevel : '–'} · {mounted ? xp : '–'} XP
              {:else}
                Local progress saved separately
              {/if}
              {#if account.cloud}
                · Sync: {account.cloud.username}
              {/if}
            </p>
          </div>

          {#if account.id !== active?.id}
            <button
              type="button"
              on:click={() => handleSwitch(account.id)}
              class="min-h-9 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              Switch
            </button>
          {/if}

          {#if accounts.length > 1}
            {#if confirmDeleteId === account.id}
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold text-rose-700 dark:text-rose-300">Delete progress?</span>
                <button
                  type="button"
                  on:click={() => handleDelete(account.id)}
                  class="min-h-9 rounded-lg bg-rose-700 px-3 text-xs font-semibold text-white hover:bg-rose-800"
                >
                  Delete
                </button>
                <button
                  type="button"
                  on:click={() => (confirmDeleteId = null)}
                  class="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-600"
                >
                  Cancel
                </button>
              </div>
            {:else}
              <button
                type="button"
                on:click={() => (confirmDeleteId = account.id)}
                class="min-h-9 rounded-lg px-2 text-xs font-semibold text-slate-500 underline-offset-4 hover:text-rose-700 hover:underline dark:text-slate-400 dark:hover:text-rose-300"
              >
                Delete
              </button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>

    <form class="mt-5 flex flex-col gap-2 sm:flex-row" on:submit|preventDefault={handleCreate}>
      <label class="sr-only" for="new-account-name">New account name</label>
      <input
        id="new-account-name"
        bind:value={newAccountName}
        maxlength="24"
        placeholder="New account name"
        class="min-h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
      />
      <button
        type="submit"
        disabled={!newAccountName.trim()}
        class="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add account
      </button>
    </form>

    {#if active}
      <form class="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row" on:submit|preventDefault={handleRename}>
        <label class="sr-only" for="rename-account">Rename active account</label>
        <input
          id="rename-account"
          bind:value={renameValue}
          maxlength="24"
          class="min-h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="submit"
          class="min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700"
        >
          Rename
        </button>
      </form>
    {/if}

    {#if accountMessage}
      <p role="status" class="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">{accountMessage}</p>
    {/if}
  </section>

  <section
    aria-labelledby="sync-heading"
    class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
  >
    <p class="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
      Cross-device sync
    </p>
    <h2 id="sync-heading" class="mt-1 text-xl font-bold tracking-tight">Use this account on another device</h2>
    <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      Off by default. Turn it on only if you want to sign in to this account on another phone or computer with a
      password. Without it, progress never leaves this browser.
    </p>

    {#if !mounted}
      <p class="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading sync settings…</p>
    {:else if active && active.cloud}
      <div class="mt-5 rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
        <p class="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          Linked as {active.cloud.username}
        </p>
        <p class="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
          Last synced: {formatDate(active.cloud.lastSyncedAt)}
        </p>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          on:click={handleSyncNow}
          disabled={syncBusy || linkBusy}
          class="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {syncBusy ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          type="button"
          on:click={handleDisconnect}
          disabled={syncBusy || linkBusy}
          class="min-h-10 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/60 dark:text-rose-300 dark:hover:bg-rose-500/10"
        >
          Turn off sync
        </button>
      </div>

      <label class="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <input
          type="checkbox"
          checked={active.cloud.autoSync}
          on:change={handleAutoSync}
          class="mt-0.5 h-5 w-5 accent-indigo-600"
        />
        <span>
          <span class="block text-sm font-semibold">Sync automatically when I return to the site</span>
          <span class="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            Merges progress when this page opens or the tab becomes visible. You can still use the button above.
          </span>
        </span>
      </label>

      <p class="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        This browser stores a random sign-in token, never your password. Passwords are checked on the server with a
        salted hash. Turning sync off removes the token from this device; the server copy stays until you delete it.
      </p>
    {:else if active}
      <form class="mt-5 space-y-4" on:submit={handleLink}>
        <fieldset>
          <legend class="text-sm font-semibold">Choose how to connect</legend>
          <div role="group" aria-label="Sync account mode" class="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={linkMode === 'register'}
              on:click={() => { linkMode = 'register'; syncMessage = ''; }}
              class="min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors {linkMode ===
              'register'
                ? 'bg-indigo-600 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}"
            >
              Create sync login
            </button>
            <button
              type="button"
              aria-pressed={linkMode === 'login'}
              on:click={() => { linkMode = 'login'; syncMessage = ''; }}
              class="min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors {linkMode ===
              'login'
                ? 'bg-indigo-600 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}"
            >
              Sign in on this device
            </button>
          </div>
        </fieldset>

        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label for="sync-username" class="text-sm font-semibold">Username</label>
            <input
              id="sync-username"
              bind:value={username}
              type="text"
              maxlength="24"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="e.g. aryan.sharma"
              class="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
            />
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              3–24 letters, numbers, dots, dashes or underscores. This is only for sync, not your leaderboard name.
            </p>
          </div>

          <div>
            <label for="sync-password" class="text-sm font-semibold">Password</label>
            <input
              id="sync-password"
              bind:value={password}
              type="password"
              maxlength="128"
              autocomplete={linkMode === 'register' ? 'new-password' : 'current-password'}
              placeholder="At least 8 characters"
              class="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
            />
          </div>
        </div>

        {#if linkMode === 'register'}
          <div>
            <label for="sync-password-confirm" class="text-sm font-semibold">Confirm password</label>
            <input
              id="sync-password-confirm"
              bind:value={confirmPassword}
              type="password"
              maxlength="128"
              autocomplete="new-password"
              placeholder="Type it again"
              class="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
            />
          </div>
        {/if}

        <button
          type="submit"
          disabled={linkBusy || !username.trim() || !password}
          class="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {linkBusy
            ? 'Connecting…'
            : linkMode === 'register'
              ? 'Turn on sync'
              : 'Sign in and merge progress'}
        </button>

        <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          The password is sent once over HTTPS to verify it. It is never saved in this browser or synced back. If you
          sign in on a device that already has progress, both sets are merged.
        </p>
      </form>
    {/if}

    {#if syncMessage}
      <p
        role={syncFailed ? 'alert' : 'status'}
        class="mt-4 text-sm font-semibold {syncFailed
          ? 'text-rose-700 dark:text-rose-300'
          : 'text-emerald-700 dark:text-emerald-300'}"
      >
        {syncMessage}
      </p>
    {/if}
  </section>
</div>
