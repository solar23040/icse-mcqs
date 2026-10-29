<script lang="ts">
  import type { GameEvent } from '../../lib/gamification';

  let { events }: { events: GameEvent[] } = $props();

  function describe(event: GameEvent): string {
    switch (event.type) {
      case 'xp':
        return `+${event.amount} XP`;
      case 'levelUp':
        return `Level ${event.level} reached`;
      case 'badge':
        return 'New badge earned';
      case 'streak':
        return `${event.count}-day streak`;
      case 'goalReached':
        return 'Daily goal reached';
      case 'mastered':
        return 'Question mastered';
      default:
        return '';
    }
  }
</script>

<div
  class="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6"
  aria-live="polite"
  aria-atomic="false"
>
  {#each events as event, index (index)}
    <p
      class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-lg motion-safe:animate-[fade-in_180ms_ease-out] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
    >
      {describe(event)}
    </p>
  {/each}
</div>
