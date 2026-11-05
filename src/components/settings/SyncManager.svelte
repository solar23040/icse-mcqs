<script lang="ts">
  import { onMount } from 'svelte';
  import { activeAccountNeedsSync, syncNow } from '../../lib/account-sync';

  let syncing = false;

  async function run(): Promise<void> {
    if (syncing || !activeAccountNeedsSync()) return;

    syncing = true;
    try {
      const result = await syncNow();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('icse:syncFinished', { detail: result }));
      }
    } finally {
      syncing = false;
    }
  }

  onMount(() => {
    const handleVisible = (): void => {
      if (document.visibilityState === 'visible') void run();
    };
    const handleRequest = (): void => {
      void run();
    };

    void run();
    window.addEventListener('focus', handleRequest);
    window.addEventListener('pageshow', handleRequest);
    window.addEventListener('icse:syncRequested', handleRequest);
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      window.removeEventListener('focus', handleRequest);
      window.removeEventListener('pageshow', handleRequest);
      window.removeEventListener('icse:syncRequested', handleRequest);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  });
</script>
