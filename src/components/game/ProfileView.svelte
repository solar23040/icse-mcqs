<script lang="ts">
  import { onMount } from 'svelte';
  import { BADGES } from '../../lib/badges';
  import { loadProfile, type PublicProfile } from '../../lib/leaderboard-api';
  import { SUBJECTS } from '../../lib/subjects';

  let loading = $state(true);
  let error = $state('');
  let profile = $state<PublicProfile | null>(null);

  const earnedBadges = $derived(
    profile ? BADGES.filter((badge) => profile?.badges.includes(badge.id)) : [],
  );

  function relativeTime(iso: string): string {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return 'Unknown';

    const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 60) return 'Just now';

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.round(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }

  function exactTime(iso: string): string {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return 'Unknown';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function subjectTitle(slug: string): string {
    return SUBJECTS.find((subject) => subject.slug === slug)?.title ?? slug;
  }

  onMount(() => {
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!id) {
      error = 'No profile was selected. Open a player from the leaderboard.';
      loading = false;
      return;
    }

    void loadProfile(id).then((result) => {
      profile = result;
      loading = false;
      if (!result) error = 'This profile is unavailable or has left the leaderboard.';
    });
  });
</script>

<section class="mx-auto w-full max-w-3xl">
  <a
    href="/"
    class="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
  >
    <span aria-hidden="true">←</span> Back to practice
  </a>

  {#if loading}
    <p class="mt-6 text-sm text-slate-500 dark:text-slate-400">Loading profile…</p>
  {:else if error}
    <div class="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/60 dark:bg-amber-950/40">
      <h1 class="text-xl font-bold tracking-tight text-amber-950 dark:text-amber-50">Profile unavailable</h1>
      <p class="mt-2 text-sm text-amber-900 dark:text-amber-100">{error}</p>
      <a
        href="/"
        class="mt-4 inline-flex min-h-10 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
      >
        Go to the leaderboard
      </a>
    </div>
  {:else if profile}
    <header class="mt-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="flex flex-wrap items-center gap-4">
        <span
          aria-hidden="true"
          class="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white dark:bg-indigo-500"
        >
          {profile.name.trim().charAt(0).toUpperCase()}
        </span>
        <div class="min-w-0">
          <h1 class="truncate text-2xl font-bold tracking-tight">{profile.name}</h1>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Last online
            <time datetime={profile.lastOnline} title={exactTime(profile.lastOnline)}>
              {relativeTime(profile.lastOnline)}
            </time>
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400">{exactTime(profile.lastOnline)}</p>
        </div>
      </div>
    </header>

    <section
      aria-labelledby="achievements-heading"
      class="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="achievements-heading" class="text-xl font-bold tracking-tight">Achievements</h2>
        <p class="text-sm font-semibold text-amber-700 dark:text-amber-300">
          {earnedBadges.length} of {BADGES.length} earned
        </p>
      </div>

      {#if earnedBadges.length > 0}
        <ul class="mt-4 grid gap-3 sm:grid-cols-2" role="list">
          {#each earnedBadges as badge (badge.id)}
            <li class="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/60 dark:bg-amber-950/40">
              <div class="flex items-start gap-3">
                <span class="text-2xl" aria-hidden="true">{badge.icon}</span>
                <div>
                  <p class="font-semibold tracking-tight">{badge.title}</p>
                  <p class="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{badge.description}</p>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mt-3 text-sm text-slate-600 dark:text-slate-300">
          No achievements yet. They appear here once this player earns their first badge.
        </p>
      {/if}
    </section>

    <section
      aria-labelledby="recent-practice-heading"
      class="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
    >
      <h2 id="recent-practice-heading" class="text-xl font-bold tracking-tight">Recent practice</h2>

      {#if profile.subjects.length > 0}
        <ul class="mt-4 space-y-2" role="list">
          {#each profile.subjects as entry (entry.subject)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800/70">
              <span class="min-w-0 flex-1 truncate font-semibold">{subjectTitle(entry.subject)}</span>
              <span class="shrink-0 text-slate-600 dark:text-slate-300">
                {entry.attempts} answer{entry.attempts === 1 ? '' : 's'}
              </span>
              <time
                datetime={entry.lastPracticed}
                title={exactTime(entry.lastPracticed)}
                class="shrink-0 text-slate-500 dark:text-slate-400"
              >
                {relativeTime(entry.lastPracticed)}
              </time>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mt-3 text-sm text-slate-600 dark:text-slate-300">
          No practice recorded yet.
        </p>
      {/if}
    </section>
  {/if}
</section>
