<script lang="ts">
  import { onMount } from 'svelte';
  import { getUserName, setUserName } from '../../lib/storage';

  const MAX_LEN = 20;

  let show = $state(false);
  let value = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  function sanitise(raw: string): string {
    return raw.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, MAX_LEN);
  }

  function submit(): void {
    const name = sanitise(value);
    if (!name) return;
    setUserName(name);
    show = false;
    // Dispatch so LeaderboardPanel can pick it up immediately
    window.dispatchEvent(new CustomEvent('icse:nameSet', { detail: { name } }));
  }

  function dismiss(): void {
    show = false;
    try {
      sessionStorage.setItem('icse:name_prompt_dismissed', '1');
    } catch {
      // silently ignore if sessionStorage is unavailable
    }
  }

  function handleInputKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') submit();
  }

  function handleWindowKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && show) {
      dismiss();
    }
  }

  onMount(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem('icse:name_prompt_dismissed') === '1';
    } catch {
      // silently ignore
    }

    if (!getUserName() && !dismissed) {
      show = true;
      requestAnimationFrame(() => inputEl?.focus());
    }

    const handleOpen = (): void => {
      value = getUserName() ?? '';
      show = true;
      requestAnimationFrame(() => inputEl?.focus());
    };

    window.addEventListener('icse:openNameModal', handleOpen);
    window.addEventListener('keydown', handleWindowKey);

    return () => {
      window.removeEventListener('icse:openNameModal', handleOpen);
      window.removeEventListener('keydown', handleWindowKey);
    };
  });
</script>

{#if show}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
    on:click|self={dismiss}
  >
    <!-- Modal -->
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-modal-heading"
      class="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
    >
      <p class="text-sm font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
        Welcome! 👋
      </p>
      <h2 id="name-modal-heading" class="mt-2 text-2xl font-bold tracking-tight">
        What's your name?
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        This name will appear on the leaderboard when you join. You can always update it later.
      </p>

      <div class="mt-6">
        <label for="name-input" class="sr-only">Your name</label>
        <input
          id="name-input"
          bind:this={inputEl}
          bind:value
          type="text"
          maxlength={MAX_LEN}
          placeholder="e.g. Aryan, StudyBeast42…"
          on:keydown={handleInputKey}
          class="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-base placeholder-slate-400 outline-none ring-inset transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-400/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
        />
        <p class="mt-1.5 text-right text-xs text-slate-400">{value.length}/{MAX_LEN}</p>
      </div>

      <div class="mt-4 flex flex-col gap-2">
        <button
          type="button"
          on:click={submit}
          disabled={!sanitise(value)}
          class="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Let's go →
        </button>
        <button
          type="button"
          on:click={dismiss}
          class="min-h-11 w-full rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Skip for now
        </button>
      </div>
    </div>
  </div>
{/if}
