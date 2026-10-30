<script lang="ts">
  import { onMount } from 'svelte';
  import {
    defaultGameState,
    masteryPercent,
    rankFor,
    type GameState
  } from '../../lib/gamification';
  import { getGame, getStats } from '../../lib/storage';
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

  let {
    subjects,
    questionIds = {}
  }: {
    subjects: SubjectInfo[];
    questionIds?: Partial<Record<Subject, string[]>>;
  } = $props();

  let stats = $state<Record<Subject, Stats>>(emptyStats());
  let game = $state<GameState>(defaultGameState());
  let mounted = $state(false);

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

  function refresh(): void {
    const next = emptyStats();
    for (const { slug } of subjects) {
      next[slug] = getStats(slug);
    }
    stats = next;
    game = getGame();
    mounted = true;
  }

  function accuracy(entry: Stats): number {
    if (entry.attempted === 0) return 0;
    return Math.round((entry.correct / entry.attempted) * 100);
  }

  function percentFor(slug: Subject): number | null {
    const ids = questionIds[slug];
    if (!ids || ids.length === 0) return null;
    return masteryPercent(ids.map((id) => ({ id })), game.boxes);
  }

  function dueFor(slug: Subject): number {
    const ids = questionIds[slug] ?? [];
    return ids.filter((id) => {
      const box = game.boxes[id];
      return box !== undefined && box < 3;
    }).length;
  }

  function ringOffset(percent: number): number {
    const circumference = 2 * Math.PI * 16;
    return circumference * (1 - percent / 100);
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
    {@const percent = percentFor(subject.slug)}
    {@const due = dueFor(subject.slug)}
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
          <div class="mt-4 flex items-center gap-3">
            <svg viewBox="0 0 40 40" class="h-12 w-12 shrink-0" role="img" aria-label={mounted && percent !== null ? `${percent}% mastered` : 'Mastery not loaded'}>
              <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="5" class="text-slate-200 dark:text-slate-700" />
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="currentColor"
                stroke-width="5"
                stroke-linecap="round"
                stroke-dasharray={2 * Math.PI * 16}
                stroke-dashoffset={mounted && percent !== null ? ringOffset(percent) : 2 * Math.PI * 16}
                transform="rotate(-90 20 20)"
                class="text-indigo-600 transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none dark:text-indigo-400"
              />
            </svg>
            <div>
              <p class="text-sm font-semibold">
                {mounted && percent !== null ? rankFor(percent) : '–'}
              </p>
              <p class="text-xs text-slate-600 dark:text-slate-300">
                {mounted && percent !== null ? `${percent}% mastered` : 'Mastery'}
              </p>
            </div>
          </div>

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

          <div class="mt-5 flex flex-wrap gap-2">
            <a
              href={`/${subject.slug}`}
              class="inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:text-slate-950"
              aria-label={`Start ${subject.title} practice`}
            >
              Start practice <span aria-hidden="true">→</span>
            </a>
            {#if mounted && due > 0}
              <a
                href={`/${subject.slug}?mode=review`}
                class="inline-flex items-center justify-center rounded-lg border border-indigo-300 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 dark:border-indigo-500/50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              >
                Review ({due} due)
              </a>
            {/if}
          </div>
        {/if}
      </article>
    </li>
  {/each}
</ul>
