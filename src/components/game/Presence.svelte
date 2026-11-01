<script lang="ts">
  import { onMount } from 'svelte';
  import { syncLeaderboard } from '../../lib/leaderboard-api';

  const PRESENCE_KEY = 'icse:presence:v1';
  const MIN_INTERVAL_MS = 5 * 60 * 1000;

  function lastPing(): number {
    try {
      const value = Number(localStorage.getItem(PRESENCE_KEY));
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  function rememberPing(): void {
    try {
      localStorage.setItem(PRESENCE_KEY, String(Date.now()));
    } catch {
      // Presence tracking is optional; ignore blocked storage.
    }
  }

  onMount(() => {
    if (Date.now() - lastPing() < MIN_INTERVAL_MS) return;

    // syncLeaderboard is a no-op unless the visitor joined the leaderboard.
    void syncLeaderboard().then((snapshot) => {
      if (snapshot) rememberPing();
    });
  });
</script>
