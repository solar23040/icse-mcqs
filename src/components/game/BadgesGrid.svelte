<script lang="ts">
  import { onMount } from 'svelte';
  import { BADGES, badgeInfo } from '../../lib/badges';
  import { defaultGameState, type GameState } from '../../lib/gamification';
  import { getGame } from '../../lib/storage';

  let game = $state<GameState>(defaultGameState());
  let mounted = $state(false);

  onMount(() => {
    game = getGame();
    mounted = true;
  });

  function earned(id: string): boolean {
    return mounted && Boolean(game.badges[id]);
  }
</script>

<section class="mx-auto w-full max-w-3xl">
  <h1 class="text-3xl font-bold tracking-tight">Badges</h1>
  <p class="mt-2 text-slate-600 dark:text-slate-300">
    Earn badges as you practise. Locked badges show how to unlock them.
  </p>

  <ul class="mt-6 grid gap-4 sm:grid-cols-2" role="list">
    {#each BADGES as badge (badge.id)}
      {@const info = badgeInfo(badge.id)!}
      <li
        class="rounded-2xl border p-5 shadow-sm {earned(badge.id)
          ? 'border-amber-300 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-950/40'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}"
      >
        <div class="flex items-center gap-3">
          <span class="text-3xl" aria-hidden="true">{info.icon}</span>
          <div>
            <h2 class="text-lg font-semibold tracking-tight">{info.title}</h2>
            <p class="text-sm text-slate-600 dark:text-slate-300">{info.description}</p>
          </div>
        </div>
        <p class="mt-3 text-sm font-semibold {earned(badge.id) ? 'text-amber-800 dark:text-amber-200' : 'text-slate-500 dark:text-slate-400'}">
          {earned(badge.id) ? 'Earned' : 'Locked'}
        </p>
      </li>
    {/each}
  </ul>
</section>
