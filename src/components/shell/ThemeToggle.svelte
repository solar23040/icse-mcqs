<script lang="ts">
  import { onMount } from 'svelte';

  let isDark = $state(false);

  onMount(() => {
    isDark = document.documentElement.classList.contains('dark');
  });

  function toggleTheme(): void {
    isDark = !isDark;
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    try {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch {
      /* Ignore blocked storage: the theme still changes for this page view. */
    }
  }
</script>

<button
  type="button"
  onclick={toggleTheme}
  class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition-colors hover:bg-slate-200/70 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
  aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
  title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
>
  <!-- Sun is shown while the dark theme is active. -->
  <svg class="hidden h-5 w-5 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path stroke-linecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
  <!-- Moon is shown while the light theme is active. -->
  <svg class="h-5 w-5 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
  </svg>
</button>
