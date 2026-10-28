<script lang="ts">
  import { onMount } from 'svelte';
  import { getStats } from '../../lib/storage';
  import type { Subject } from '../../lib/types';

  interface SubjectInfo {
    slug: Subject;
    title: string;
    placeholder?: boolean;
  }

  interface Stats {
    attempted: number;
    correct: number;
  }

  let { subjects }: { subjects: SubjectInfo[] } = $props();

  function emptyStats(): Record<Subject, Stats> {
    return {
      history: { attempted: 0, correct: 0 },
      economics: { attempted: 0, correct: 0 },
      geography: { attempted: 0, correct: 0 },
      maths: { attempted: 0, correct: 0 },
      'english-lit': { attempted: 0, correct: 0 },
      physics: { attempted: 0, correct: 0 },
      chemistry: { attempted: 0, correct: 0 },
      'computer-applications': { attempted: 0, correct: 0 },
      'physical-education': { attempted: 0, correct: 0 },
    };
  }

  let stats = $state<Record<Subject, Stats>>(emptyStats());

  function refresh(): void {
    const next = emptyStats();
    for (const { slug } of subjects) {
      next[slug] = getStats(slug);
    }
    stats = next;
  }

  function accuracy(entry: Stats): number {
    if (entry.attempted === 0) return 0;
    return Math.round((entry.correct / entry.attempted) * 100);
  }

  onMount(() => {
    refresh();

    // Returning via the browser back/forward cache restores the page without remounting.
    const handlePageShow = (): void => refresh();
    window.addEventListener('pageshow', handlePageShow);

    return () => window.removeEventListener('pageshow', handlePageShow);
  });
</script>

<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
  {#each subjects as subject (subject.slug)}
    <li>
      <article
        class="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 class="text-lg font-semibold tracking-tight">{subject.title}</h2>

        {#if subject.placeholder}
          <p class="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Questions are being written. This subject is coming soon.
          </p>
          <span
            class="mt-5 inline-flex items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400"
          >
            Coming soon
          </span>
        {:else}
          <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-xl bg-slate-100 p-3 dark:bg-slate-800/70">
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Attempted</dt>
              <dd class="mt-1 text-xl font-semibold">{stats[subject.slug].attempted}</dd>
            </div>
            <div class="rounded-xl bg-slate-100 p-3 dark:bg-slate-800/70">
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Accuracy</dt>
              <dd class="mt-1 text-xl font-semibold">{accuracy(stats[subject.slug])}%</dd>
            </div>
          </dl>

          <a
            href={`/${subject.slug}`}
            class="mt-5 inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:text-slate-950"
            aria-label={`Start ${subject.title} practice`}
          >
            Start practice <span aria-hidden="true">→</span>
          </a>
        {/if}
      </article>
    </li>
  {/each}
</ul>
