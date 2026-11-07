<script lang="ts">
  import { onMount } from 'svelte';
  import { syncLeaderboard } from '../../lib/leaderboard-api';
  import { initDevConsoleHelpers } from '../../lib/dev';

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
    initDevConsoleHelpers();
    if (Date.now() - lastPing() < MIN_INTERVAL_MS) return;

    // syncLeaderboard auto-joins the visitor and keeps their entry fresh.
    void syncLeaderboard().then((snapshot) => {
      if (snapshot) rememberPing();
    });
  });
</script>
