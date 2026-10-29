<script lang="ts">
  import { levelFromXp, xpForLevel } from '../../lib/gamification';

  let { xp, compact = false }: { xp: number; compact?: boolean } = $props();

  const level = $derived(levelFromXp(xp));
  const start = $derived(xpForLevel(level));
  const next = $derived(xpForLevel(level + 1));
  const span = $derived(Math.max(1, next - start));
  const percent = $derived(Math.min(100, Math.max(0, ((xp - start) / span) * 100)));
</script>

<div class={compact ? 'space-y-1' : 'space-y-2'}>
  <div class="flex items-center justify-between gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
    <span>Level {level}</span>
    <span>{xp} XP</span>
  </div>
  <div
    role="progressbar"
    aria-valuemin={start}
    aria-valuemax={next}
    aria-valuenow={xp}
    aria-label={`Level ${level} progress: ${xp} of ${next} XP`}
    class="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
  >
    <div
      class="h-full rounded-full bg-indigo-600 transition-[width] duration-300 motion-reduce:transition-none dark:bg-indigo-400"
      style={`width: ${percent}%`}
    ></div>
  </div>
  {#if !compact}
    <p class="text-xs text-slate-500 dark:text-slate-400">
      {next - xp} XP to level {level + 1}
    </p>
  {/if}
</div>
