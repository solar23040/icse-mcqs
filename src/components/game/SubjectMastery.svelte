<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultGameState, masteryPercent, rankFor, type GameState } from '../../lib/gamification';
  import { getGame } from '../../lib/storage';

  let { questions }: { questions: { id: string }[] } = $props();

  let game = $state<GameState>(defaultGameState());
  let mounted = $state(false);

  const percent = $derived(masteryPercent(questions, game.boxes));
  const rank = $derived(rankFor(percent));
  const due = $derived(
    questions.filter((question) => {
      const box = game.boxes[question.id];
      return box !== undefined && box < 3;
    }).length,
  );

  onMount(() => {
    game = getGame();
    mounted = true;
  });
</script>

<div class="flex flex-wrap items-center gap-3 text-sm">
  <span class="rounded-full bg-slate-100 px-3 py-1 font-semibold dark:bg-slate-800">
    Rank <span class="text-indigo-600 dark:text-indigo-400">{mounted ? rank : '–'}</span>
  </span>
  <span class="rounded-full bg-slate-100 px-3 py-1 font-semibold dark:bg-slate-800">
    Mastery <span class="text-indigo-600 dark:text-indigo-400">{mounted ? `${percent}%` : '–'}</span>
  </span>
  {#if mounted && due > 0}
    <a
      href="?mode=review"
      class="font-semibold text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
    >
      Review {due} weak spot{due === 1 ? '' : 's'} →
    </a>
  {/if}
</div>
