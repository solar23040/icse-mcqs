<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultGameState, levelFromXp, type GameState } from '../../lib/gamification';
  import { getGame } from '../../lib/storage';

  let game = $state<GameState>(defaultGameState());
  let mounted = $state(false);

  onMount(() => {
    game = getGame();
    mounted = true;
  });
</script>

<a
  href="/"
  class="flex items-center gap-3 rounded-lg px-2 py-1 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800"
  aria-label={mounted
    ? `Level ${levelFromXp(game.xp)}, ${game.streak.count}-day streak`
    : 'Your level and streak'}
>
  <span class="inline-flex items-center gap-1" aria-hidden="true">
    <span>🔥</span>
    <span>{mounted ? game.streak.count : '–'}</span>
  </span>
  <span class="inline-flex items-center gap-1" aria-hidden="true">
    <span>⭐</span>
    <span>Lv {mounted ? levelFromXp(game.xp) : '–'}</span>
  </span>
</a>
