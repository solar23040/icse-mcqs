<script lang="ts">
  import { onMount } from 'svelte';
  import { BADGES } from '../../lib/badges';
  import {
    loadLeaderboard,
    loadProfile,
    syncLeaderboard,
    type LeaderboardEntry,
    type LeaderboardMe,
    type PublicProfile,
  } from '../../lib/leaderboard-api';
  import { SUBJECTS } from '../../lib/subjects';
  import type { Subject } from '../../lib/types';
  import {
    defaultGameState,
    levelForGame,
    xpForLevel,
    type GameState,
  } from '../../lib/gamification';
  import {
    getGame,
    getMyProfileId,
    getStats,
    getUserDescription,
    getUserName,
    setMyProfileId,
    setUserDescription,
  } from '../../lib/storage';
  import {
    getLastWeekActivity,
    getRecentSubjects,
    getWeeklyActivity,
    getWeeklyComparison,
    type WeeklyComparison,
    type WeeklyDay,
    type WeeklySummary,
  } from '../../lib/activity';
  import {
    followUser,
    getFollowing,
    isFollowing,
    toggleFollow,
    unfollowUser,
    type FollowedUser,
  } from '../../lib/following';

  let loading = $state(true);
  let error = $state('');
  let isSelf = $state(false);

  // Other player's public profile state
  let profile = $state<PublicProfile | null>(null);
  let isFollowingOther = $state(false);

  // Self state
  let game = $state<GameState>(defaultGameState());
  let displayName = $state('You');
  let myId = $state<string | null>(null);
  let description = $state('');
  let editingDescription = $state(false);
  let descriptionInput = $state('');
  let savingDescription = $state(false);
  let idCopied = $state(false);

  // Stats state
  let weeklyComparison = $state<WeeklyComparison | null>(null);
  let activeWeekView = $state<'thisWeek' | 'lastWeek'>('thisWeek');
  let totalAttempted = $state(0);
  let totalCorrect = $state(0);
  let overallAccuracy = $state(0);
  let myLeaderboard = $state<LeaderboardMe | null>(null);
  let subjectStats = $state<
    Array<{
      slug: Subject;
      title: string;
      icon: string;
      attempted: number;
      correct: number;
      accuracy: number;
      lastPracticed: string | null;
    }>
  >([]);

  // Following state
  let followingList = $state<FollowedUser[]>([]);
  let suggestedUsers = $state<LeaderboardEntry[]>([]);
  let customFollowInput = $state('');
  let customFollowError = $state('');
  let customFollowSuccess = $state('');

  const earnedBadges = $derived(
    isSelf
      ? BADGES.filter((badge) => Boolean(game.badges[badge.id]))
      : profile
        ? BADGES.filter((badge) => profile?.badges.includes(badge.id))
        : [],
  );

  const thisWeekAccuracy = $derived(
    weeklyComparison && weeklyComparison.thisWeek.answered > 0
      ? Math.round((weeklyComparison.thisWeek.correct / weeklyComparison.thisWeek.answered) * 100)
      : 0,
  );

  const lastWeekAccuracy = $derived(
    weeklyComparison && weeklyComparison.lastWeek.answered > 0
      ? Math.round((weeklyComparison.lastWeek.correct / weeklyComparison.lastWeek.answered) * 100)
      : 0,
  );

  function relativeTime(iso: string | null): string {
    if (iso === null) return 'Unknown';
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

  function exactTime(iso: string | null): string {
    if (iso === null) return 'Unknown';
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return 'Unknown';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function dayLabel(day: string): string {
    const date = new Date(`${day}T12:00:00`);
    if (!Number.isFinite(date.getTime())) return day;
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }

  function subjectTitle(slug: string): string {
    return SUBJECTS.find((subject) => subject.slug === slug)?.title ?? slug;
  }

  function maxAnswered(days: WeeklyDay[]): number {
    return Math.max(1, ...days.map((day) => day.answered));
  }

  function loadSelfData(): void {
    game = getGame();
    displayName = getUserName() ?? 'You';
    description = getUserDescription() ?? '';
    myId = getMyProfileId();
    followingList = getFollowing();
    weeklyComparison = getWeeklyComparison();

    let attempted = 0;
    let correct = 0;
    const recent = getRecentSubjects(20);
    const recentMap = new Map(recent.map((item) => [item.subject, item.lastPracticed]));

    subjectStats = SUBJECTS.map((sub) => {
      const stats = getStats(sub.slug);
      attempted += stats.attempted;
      correct += stats.correct;
      const accuracy = stats.attempted > 0 ? Math.round((stats.correct / stats.attempted) * 100) : 0;
      return {
        slug: sub.slug,
        title: sub.title,
        icon: sub.icon,
        attempted: stats.attempted,
        correct: stats.correct,
        accuracy,
        lastPracticed: recentMap.get(sub.slug) ?? null,
      };
    });

    totalAttempted = attempted;
    totalCorrect = correct;
    overallAccuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

    // Load leaderboard in background to get current ranking and suggested users
    void loadLeaderboard().then((snapshot) => {
      if (snapshot?.me) {
        myLeaderboard = snapshot.me;
        if (snapshot.me.id) {
          myId = snapshot.me.id;
          setMyProfileId(snapshot.me.id);
        }
      }
      if (snapshot?.top) {
        // Exclude current user from suggestions
        suggestedUsers = snapshot.top.filter((entry) => entry.id && entry.id !== myId).slice(0, 5);
      }
    });
  }

  function startEditDescription(): void {
    descriptionInput = description;
    editingDescription = true;
  }

  function cancelEditDescription(): void {
    editingDescription = false;
  }

  function saveDescription(): void {
    savingDescription = true;
    setUserDescription(descriptionInput);
    description = getUserDescription() ?? '';
    editingDescription = false;

    // Sync to leaderboard in background so public profile has updated description
    void syncLeaderboard().finally(() => {
      savingDescription = false;
    });
  }

  function copyProfileLink(): void {
    if (!myId) return;
    const url = `${window.location.origin}/profile?id=${myId}`;
    void navigator.clipboard.writeText(url).then(
      () => {
        idCopied = true;
        setTimeout(() => {
          idCopied = false;
        }, 2000);
      },
      () => {
        idCopied = false;
      },
    );
  }

  function handleToggleFollowOther(): void {
    if (!profile) return;
    isFollowingOther = toggleFollow({ id: profile.id, name: profile.name });
    followingList = getFollowing();
  }

  function handleUnfollow(id: string): void {
    unfollowUser(id);
    followingList = getFollowing();
    if (profile && profile.id === id) {
      isFollowingOther = false;
    }
  }

  function handleFollowSuggested(entry: LeaderboardEntry): void {
    if (!entry.id) return;
    followUser({ id: entry.id, name: entry.name });
    followingList = getFollowing();
  }

  async function handleFollowCustomId(): Promise<void> {
    customFollowError = '';
    customFollowSuccess = '';
    const id = customFollowInput.trim().toLowerCase();

    if (!/^[a-f0-9]{16}$/.test(id)) {
      customFollowError = 'Please enter a valid 16-character profile ID.';
      return;
    }

    if (id === myId) {
      customFollowError = "You cannot follow your own profile.";
      return;
    }

    if (isFollowing(id)) {
      customFollowError = 'You are already following this player.';
      return;
    }

    // Attempt to load their name from server
    const fetched = await loadProfile(id);
    const targetName = fetched ? fetched.name : `Player ${id.slice(0, 4)}`;
    followUser({ id, name: targetName });
    followingList = getFollowing();
    customFollowSuccess = `Following ${targetName}!`;
    customFollowInput = '';
    setTimeout(() => {
      customFollowSuccess = '';
    }, 3000);
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id')?.trim() ?? '';
    const savedId = getMyProfileId();

    // If no ID is specified, or ID matches our saved public ID, show our own profile
    if (!id || (savedId && id === savedId)) {
      isSelf = true;
      loadSelfData();
      loading = false;
      return;
    }

    // Otherwise, check if ID matches current user via leaderboard snapshot or load external profile
    void loadLeaderboard().then((snapshot) => {
      if (snapshot?.me?.id && snapshot.me.id === id) {
        isSelf = true;
        setMyProfileId(snapshot.me.id);
        loadSelfData();
        loading = false;
        return;
      }

      // External profile
      isSelf = false;
      void loadProfile(id).then((result) => {
        profile = result;
        loading = false;
        if (!result) {
          error = 'This profile is unavailable or has left the leaderboard.';
        } else {
          isFollowingOther = isFollowing(result.id);
        }
      });
    });

    const handleFollowingChange = (): void => {
      followingList = getFollowing();
      if (profile) isFollowingOther = isFollowing(profile.id);
    };
    window.addEventListener('icse:followingChange', handleFollowingChange);
    return () => window.removeEventListener('icse:followingChange', handleFollowingChange);
  });
</script>

<section class="mx-auto w-full max-w-4xl">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <a
      href="/"
      class="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
    >
      <span aria-hidden="true">←</span> Back to practice
    </a>

    {#if !isSelf && !loading && !error}
      <a
        href="/profile"
        class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <span aria-hidden="true">👤</span>
        View my profile
      </a>
    {/if}
  </div>

  {#if loading}
    <p class="mt-6 text-sm text-slate-500 dark:text-slate-400">Loading profile…</p>
  {:else if error}
    <div
      class="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/60 dark:bg-amber-950/40"
    >
      <h1 class="text-xl font-bold tracking-tight text-amber-950 dark:text-amber-50">Profile unavailable</h1>
      <p class="mt-2 text-sm text-amber-900 dark:text-amber-100">{error}</p>
      <div class="mt-4 flex flex-wrap gap-3">
        <a
          href="/profile"
          class="inline-flex min-h-10 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          View my own profile
        </a>
        <a
          href="/"
          class="inline-flex min-h-10 items-center rounded-lg border border-amber-400 px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-500/60 dark:text-amber-100 dark:hover:bg-amber-900/50"
        >
          Go to leaderboard
        </a>
      </div>
    </div>
  {:else if isSelf}
    <!-- ==================== OWN PROFILE ("PAGE FOR OURSELF") ==================== -->
    <header
      class="mt-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            class="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-3xl font-extrabold text-white shadow-sm dark:bg-indigo-500"
          >
            {displayName.trim().charAt(0).toUpperCase()}
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="truncate text-2xl font-bold tracking-tight sm:text-3xl">{displayName}</h1>
              <span
                class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              >
                You
              </span>
            </div>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Level {levelForGame(game)} · {Math.max(0, xpForLevel(levelForGame(game) + 1) - game.totalEarnedXP)} XP to Level {levelForGame(game) + 1}
            </p>
            {#if myId}
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs text-slate-500 dark:text-slate-400">ID: {myId}</span>
                <button
                  type="button"
                  onclick={copyProfileLink}
                  class="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {idCopied ? 'Link copied! ✓' : 'Share link'}
                </button>
              </div>
            {/if}
          </div>
        </div>

        <button
          type="button"
          onclick={() => window.dispatchEvent(new CustomEvent('icse:openNameModal'))}
          class="rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Change name
        </button>
      </div>

      <!-- Description / Bio Section -->
      <div class="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            About you
          </h2>
          {#if !editingDescription && description}
            <button
              type="button"
              onclick={startEditDescription}
              class="text-xs font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
            >
              Edit description
            </button>
          {/if}
        </div>

        {#if editingDescription}
          <div class="mt-3 space-y-3">
            <textarea
              bind:value={descriptionInput}
              maxlength="250"
              rows="3"
              placeholder="Add a bio or description (e.g. Target ICSE 95%+, aiming for top rank, favorite subjects)..."
              class="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            ></textarea>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs text-slate-500 dark:text-slate-400">
                {descriptionInput.length}/250 characters
              </span>
              <div class="flex gap-2">
                <button
                  type="button"
                  onclick={cancelEditDescription}
                  class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onclick={saveDescription}
                  disabled={savingDescription}
                  class="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingDescription ? 'Saving…' : 'Save description'}
                </button>
              </div>
            </div>
          </div>
        {:else if description}
          <p class="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {description}
          </p>
        {:else}
          <div
            class="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700"
          >
            <p class="text-xs text-slate-500 dark:text-slate-400">
              No description added yet. Add a short bio to introduce yourself and state your ICSE goals!
            </p>
            <button
              type="button"
              onclick={startEditDescription}
              class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Add description
            </button>
          </div>
        {/if}
      </div>
    </header>

    <!-- ==================== CURRENT OVERALL STATS ==================== -->
    <section aria-labelledby="current-stats-heading" class="mt-6">
      <h2 id="current-stats-heading" class="text-lg font-bold tracking-tight">Current stats</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Total earned XP</p>
          <p class="mt-1 text-2xl font-extrabold text-indigo-600 dark:text-indigo-400">
            {game.totalEarnedXP} XP
          </p>
          <p class="mt-0.5 text-xs text-slate-600 dark:text-slate-400">Level {levelForGame(game)} reached</p>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Current streak</p>
          <p class="mt-1 text-2xl font-extrabold text-amber-600 dark:text-amber-400">
            🔥 {game.streak.count} <span class="text-sm font-semibold text-slate-600 dark:text-slate-300">days</span>
          </p>
          <p class="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            Best: {game.streak.best} days · Freezes: {game.streak.freezes}/2
          </p>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Overall practice</p>
          <p class="mt-1 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            {totalAttempted}
          </p>
          <p class="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            {totalCorrect} correct ({overallAccuracy}% accuracy)
          </p>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Weekly leaderboard</p>
          {#if myLeaderboard}
            <p class="mt-1 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              #{myLeaderboard.rank}
            </p>
            <p class="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Top {myLeaderboard.percentile}% this week ({myLeaderboard.xp} XP)
            </p>
          {:else}
            <p class="mt-1 text-2xl font-extrabold text-slate-400">–</p>
            <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Practice to place on the board</p>
          {/if}
        </div>
      </div>
    </section>

    <!-- ==================== THIS WEEK VS LAST WEEK STATS ==================== -->
    <section
      aria-labelledby="weekly-stats-heading"
      class="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="weekly-stats-heading" class="text-xl font-bold tracking-tight">Weekly stats comparison</h2>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Track your momentum: compare this week with last week.
          </p>
        </div>

        <div class="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeWeekView === 'thisWeek'}
            onclick={() => (activeWeekView = 'thisWeek')}
            class="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors {activeWeekView === 'thisWeek'
              ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}"
          >
            This week
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWeekView === 'lastWeek'}
            onclick={() => (activeWeekView = 'lastWeek')}
            class="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors {activeWeekView === 'lastWeek'
              ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}"
          >
            Last week
          </button>
        </div>
      </div>

      {#if weeklyComparison}
        <!-- Comparison Summary Pills -->
        <div class="mt-5 grid gap-3 sm:grid-cols-3">
          <div class="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Questions answered</p>
            <div class="mt-1 flex items-baseline gap-2">
              <span class="text-2xl font-bold">{weeklyComparison.thisWeek.answered}</span>
              <span class="text-xs text-slate-500">vs {weeklyComparison.lastWeek.answered} last week</span>
            </div>
            <div class="mt-2">
              {#if weeklyComparison.answeredDelta > 0}
                <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  +{weeklyComparison.answeredDelta} questions ↗
                </span>
              {:else if weeklyComparison.answeredDelta < 0}
                <span class="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                  {weeklyComparison.answeredDelta} questions ↘
                </span>
              {:else}
                <span class="text-xs font-semibold text-slate-500">Equal to last week</span>
              {/if}
            </div>
          </div>

          <div class="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Weekly accuracy</p>
            <div class="mt-1 flex items-baseline gap-2">
              <span class="text-2xl font-bold">{thisWeekAccuracy}%</span>
              <span class="text-xs text-slate-500">vs {lastWeekAccuracy}% last week</span>
            </div>
            <div class="mt-2">
              {#if weeklyComparison.accuracyDelta > 0}
                <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  +{weeklyComparison.accuracyDelta}% accuracy ↗
                </span>
              {:else if weeklyComparison.accuracyDelta < 0}
                <span class="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                  {weeklyComparison.accuracyDelta}% accuracy ↘
                </span>
              {:else}
                <span class="text-xs font-semibold text-slate-500">Same accuracy</span>
              {/if}
            </div>
          </div>

          <div class="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Active study days</p>
            <div class="mt-1 flex items-baseline gap-2">
              <span class="text-2xl font-bold">{weeklyComparison.thisWeek.activeDays}/7</span>
              <span class="text-xs text-slate-500">vs {weeklyComparison.lastWeek.activeDays}/7</span>
            </div>
            <div class="mt-2">
              {#if weeklyComparison.activeDaysDelta > 0}
                <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  +{weeklyComparison.activeDaysDelta} active day{weeklyComparison.activeDaysDelta === 1 ? '' : 's'} ↗
                </span>
              {:else if weeklyComparison.activeDaysDelta < 0}
                <span class="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                  {weeklyComparison.activeDaysDelta} active days
                </span>
              {:else}
                <span class="text-xs font-semibold text-slate-500">Consistent active days</span>
              {/if}
            </div>
          </div>
        </div>

        <!-- Tab Content: Day breakdown and chart -->
        {@const selectedWeek =
          activeWeekView === 'thisWeek' ? weeklyComparison.thisWeek : weeklyComparison.lastWeek}
        {@const selectedMax = maxAnswered(selectedWeek.days)}

        <div class="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-semibold">
              {activeWeekView === 'thisWeek' ? 'This week’s activity' : 'Last week’s activity'}
            </h3>
            <span class="text-xs text-slate-500">
              {selectedWeek.answered} questions · {selectedWeek.correct} correct · {selectedWeek.activeDays} of 7 days
            </span>
          </div>

          {#if selectedWeek.answered === 0}
            <p class="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
              No questions answered during this period.
            </p>
          {:else}
            <!-- Bar chart -->
            <div class="mt-4 flex items-end gap-2" aria-hidden="true">
              {#each selectedWeek.days as day (day.day)}
                <div class="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {day.answered > 0 ? day.answered : ''}
                  </span>
                  <div class="flex h-20 w-full items-end">
                    <div
                      class="w-full rounded-t-md transition-[height] duration-300 {activeWeekView === 'thisWeek'
                        ? 'bg-indigo-500 dark:bg-indigo-400'
                        : 'bg-slate-400 dark:bg-slate-500'}"
                      style={`height: ${day.answered === 0 ? 0 : Math.max(8, Math.round((day.answered / selectedMax) * 100))}%`}
                    ></div>
                  </div>
                  <span class="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                    {dayLabel(day.day)}
                  </span>
                </div>
              {/each}
            </div>

            <!-- Subject breakdown for selected week -->
            {#if selectedWeek.subjects.length > 0}
              <div class="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Subjects practiced</p>
                <ul class="mt-2 flex flex-wrap gap-2" role="list">
                  {#each selectedWeek.subjects as item (item.subject)}
                    <li
                      class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200"
                    >
                      {subjectTitle(item.subject)}
                      <span class="text-indigo-600 dark:text-indigo-400">· {item.answered} answered</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </section>

    <!-- ==================== ALL SUBJECTS PRACTICE STATS ==================== -->
    <section
      aria-labelledby="subject-stats-heading"
      class="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
    >
      <h2 id="subject-stats-heading" class="text-xl font-bold tracking-tight">Subject practice stats</h2>
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each subjectStats as sub (sub.slug)}
          <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-xl" aria-hidden="true">{sub.icon}</span>
                <span class="font-semibold">{sub.title}</span>
              </div>
              <a
                href={`/${sub.slug}`}
                class="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Practice →
              </a>
            </div>
            <div class="mt-3 flex items-baseline justify-between text-xs">
              <span class="text-slate-600 dark:text-slate-400">
                {sub.attempted} answered ({sub.correct} correct)
              </span>
              <span class="font-bold text-slate-900 dark:text-slate-100">{sub.accuracy}% accuracy</span>
            </div>
            <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div class="h-full bg-indigo-600 dark:bg-indigo-400" style={`width: ${sub.accuracy}%`}></div>
            </div>
            <p class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              Last practiced: {sub.lastPracticed ? relativeTime(sub.lastPracticed) : 'Never'}
            </p>
          </div>
        {/each}
      </div>
    </section>

    <!-- ==================== FOLLOWING PEOPLE ("FOLLOW PPL") ==================== -->
    <section
      aria-labelledby="following-heading"
      class="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="following-heading" class="text-xl font-bold tracking-tight">Following</h2>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Keep track of your study partners and top leaderboard rivals.
          </p>
        </div>
        <span
          class="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300"
        >
          {followingList.length} followed
        </span>
      </div>

      {#if followingList.length > 0}
        <ul class="mt-4 divide-y divide-slate-100 dark:divide-slate-800" role="list">
          {#each followingList as user (user.id)}
            <li class="flex flex-wrap items-center justify-between gap-3 py-3">
              <div class="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-sm font-bold text-white dark:bg-indigo-500"
                >
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <a
                    href={`/profile?id=${user.id}`}
                    class="font-semibold text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
                  >
                    {user.name}
                  </a>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    Followed {relativeTime(user.followedAt)}
                  </p>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <a
                  href={`/profile?id=${user.id}`}
                  class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  View profile
                </a>
                <button
                  type="button"
                  onclick={() => handleUnfollow(user.id)}
                  class="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                >
                  Unfollow
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="mt-4 rounded-2xl bg-slate-50 p-6 text-center dark:bg-slate-800/40">
          <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">
            You aren’t following anyone yet.
          </p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Follow friends or top students from the leaderboard to see their achievements and recent practice!
          </p>
        </div>
      {/if}

      <!-- Suggested players to follow from leaderboard -->
      {#if suggestedUsers.length > 0}
        <div class="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 class="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Suggested players to follow
          </h3>
          <ul class="mt-3 grid gap-2.5 sm:grid-cols-2" role="list">
            {#each suggestedUsers as suggested (suggested.rank)}
              <li
                class="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div class="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                  >
                    #{suggested.rank}
                  </span>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold">{suggested.name}</p>
                    <p class="text-xs text-slate-500">{suggested.xp} XP this week</p>
                  </div>
                </div>

                {#if suggested.id}
                  {@const alreadyFollowing = isFollowing(suggested.id)}
                  <button
                    type="button"
                    onclick={() => handleFollowSuggested(suggested)}
                    disabled={alreadyFollowing}
                    class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors {alreadyFollowing
                      ? 'border border-slate-200 text-slate-400 dark:border-slate-700'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'}"
                  >
                    {alreadyFollowing ? 'Following ✓' : '+ Follow'}
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Follow by ID form -->
      <div class="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
        <label for="follow-id-input" class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Follow by Profile ID
        </label>
        <div class="mt-2 flex max-w-md gap-2">
          <input
            id="follow-id-input"
            type="text"
            bind:value={customFollowInput}
            placeholder="e.g. 0123456789abcdef"
            class="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="button"
            onclick={handleFollowCustomId}
            class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Follow
          </button>
        </div>
        {#if customFollowError}
          <p class="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{customFollowError}</p>
        {/if}
        {#if customFollowSuccess}
          <p class="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">{customFollowSuccess}</p>
        {/if}
      </div>
    </section>

    <!-- ==================== ACHIEVEMENTS / BADGES ==================== -->
    <section
      aria-labelledby="achievements-heading"
      class="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="achievements-heading" class="text-xl font-bold tracking-tight">Achievements</h2>
        <a href="/badges" class="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
          View all badges →
        </a>
      </div>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {earnedBadges.length} of {BADGES.length} badges earned
      </p>

      {#if earnedBadges.length > 0}
        <ul class="mt-4 grid gap-3 sm:grid-cols-2" role="list">
          {#each earnedBadges as badge (badge.id)}
            <li
              class="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/60 dark:bg-amber-950/40"
            >
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
          No achievements yet. Keep practicing to unlock your first badge!
        </p>
      {/if}
    </section>
  {:else if profile}
    <!-- ==================== OTHER PLAYER'S PROFILE ==================== -->
    <header
      class="mt-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            class="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white dark:bg-indigo-500"
          >
            {profile.name.trim().charAt(0).toUpperCase()}
          </span>
          <div class="min-w-0">
            <h1 class="truncate text-2xl font-bold tracking-tight">{profile.name}</h1>
            {#if profile.lastOnline}
              <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Last online
                <time datetime={profile.lastOnline} title={exactTime(profile.lastOnline)}>
                  {relativeTime(profile.lastOnline)}
                </time>
              </p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{exactTime(profile.lastOnline)}</p>
            {:else}
              <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">Last online unknown</p>
            {/if}
          </div>
        </div>

        <button
          type="button"
          onclick={handleToggleFollowOther}
          class="rounded-xl px-4 py-2 text-sm font-semibold transition-colors {isFollowingOther
            ? 'border border-emerald-400 bg-emerald-50 text-emerald-800 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-700 dark:border-emerald-500/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300'
            : 'bg-indigo-600 text-white hover:bg-indigo-700'}"
        >
          {isFollowingOther ? 'Following ✓' : '+ Follow player'}
        </button>
      </div>

      {#if profile.description}
        <div class="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
          <p class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Bio</p>
          <p class="mt-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {profile.description}
          </p>
        </div>
      {/if}
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
            <li
              class="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/60 dark:bg-amber-950/40"
            >
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
            <li
              class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800/70"
            >
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
        <p class="mt-3 text-sm text-slate-600 dark:text-slate-300">No practice recorded yet.</p>
      {/if}
    </section>
  {/if}
</section>
