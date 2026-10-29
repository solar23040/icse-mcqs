<script lang="ts">
  let { combo }: { combo: number } = $props();

  const multiplier = $derived(combo >= 6 ? 2 : combo >= 3 ? 1.5 : 1);
</script>

{#if multiplier > 1}
  <span
    class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900 motion-safe:animate-pulse dark:bg-amber-500/20 dark:text-amber-200"
    aria-label={`Combo multiplier ${multiplier} times`}
  >
    <span aria-hidden="true">⚡</span>
    x{multiplier}
  </span>
{/if}
