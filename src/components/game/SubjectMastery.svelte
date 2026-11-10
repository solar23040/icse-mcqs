<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultGameState, masteryPercent, rankFor, type GameState } from '../../lib/gamification';
  import { getGame, getQuestionStats, getSeen, type QuestionStats } from '../../lib/storage';
  import { getTopicBreakdown, weakestTopic } from '../../lib/topics';
  import type { Subject } from '../../lib/types';

  let { subject, questions }: { subject: Subject; questions: { id: string; topic: string }[] } = $props();

  let game = $state<GameState>(defaultGameState());
  let seen = $state<string[]>([]);
  let questionStats = $state<QuestionStats>({});
  let mounted = $state(false);

  const percent = $derived(masteryPercent(questions, game.boxes));
  const rank = $derived(rankFor(percent));
  const due = $derived(
    questions.filter((question) => {
      const box = game.boxes[question.id];
      return box !== undefined && box < 3;
    }).length,
  );

  const topics = $derived(
    getTopicBreakdown(subject, questions, {
      seen,
      boxes: game.boxes,
      questionStats,
    }).sort((a, b) => {
      const startedA = a.attempted > 0 ? 0 : 1;
      const startedB = b.attempted > 0 ? 0 : 1;
      if (startedA !== startedB) return startedA - startedB;
      if (startedA === 0 && a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
      return a.mastery - b.mastery;
    }),
  );
  const weakest = $derived(weakestTopic(topics));

  onMount(() => {
    game = getGame();
    try {
      seen = getSeen(subject);
      questionStats = getQuestionStats(subject);
    } catch {
      seen = [];
      questionStats = {};
    }
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

{#if mounted && topics.length > 1}
  <details class="group mt-4 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
    <summary
      class="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-indigo-400"
    >
      <span>
        Topics
        {#if weakest}
          <span class="font-normal text-slate-500 dark:text-slate-400">
            · weakest: {weakest.label} ({weakest.accuracy}%)
          </span>
        {/if}
      </span>
      <span class="text-xs font-semibold text-indigo-600 group-open:hidden dark:text-indigo-400">Show</span>
      <span class="hidden text-xs font-semibold text-indigo-600 group-open:inline dark:text-indigo-400">Hide</span>
    </summary>

    <div class="space-y-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
      {#if weakest}
        <a
          href={`?topic=${weakest.topic}`}
          class="inline-flex min-h-10 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          Practise weakest topic: {weakest.label} →
        </a>
      {/if}

      <ul class="space-y-2" role="list">
        {#each topics as topic (topic.topic)}
          <li class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <a
                href={`?topic=${topic.topic}`}
                class="font-semibold underline-offset-4 hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
              >
                {topic.label}
              </a>
              <span class="text-xs text-slate-500 dark:text-slate-400">
                {#if topic.attempted > 0}
                  {topic.accuracy}% accuracy · {topic.attempted} answer{topic.attempted === 1 ? '' : 's'}
                {:else}
                  not started
                {/if}
                · {topic.mastered}/{topic.total} mastered
              </span>
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                class="h-full rounded-full {topic.attempted > 0 && topic.accuracy < 50
                  ? 'bg-rose-500 dark:bg-rose-400'
                  : 'bg-emerald-500 dark:bg-emerald-400'}"
                style={`width: ${topic.attempted > 0 ? topic.accuracy : 0}%`}
              ></div>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  </details>
{/if}
