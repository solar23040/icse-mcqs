<script lang="ts">
  let {
    title,
    correct,
    total,
    streak,
    level
  }: {
    title: string;
    correct: number;
    total: number;
    streak: number;
    level: number;
  } = $props();

  let copied = $state(false);
  let canvas: HTMLCanvasElement | null = null;

  const text = $derived(`${title} ${correct}/${total} · 🔥${streak} · Lv ${level}`);

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  function downloadPng(): void {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#e2e8f0';
    context.font = 'bold 32px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(title, width / 2, 90);
    context.font = 'bold 72px system-ui, sans-serif';
    context.fillText(`${correct}/${total}`, width / 2, 200);
    context.font = '24px system-ui, sans-serif';
    context.fillText(`${Math.round((correct / Math.max(1, total)) * 100)}%`, width / 2, 250);
    context.fillText(`🔥 ${streak}-day streak`, width / 2, 320);
    context.fillText(`Level ${level}`, width / 2, 360);

    const link = document.createElement('a');
    link.download = `${title.toLowerCase().replace(/\s+/g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }
</script>

<div class="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/60">
  <p class="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
    Share
  </p>
  <p class="text-base font-semibold">{text}</p>
  <div class="flex flex-wrap gap-2">
    <button
      type="button"
      on:click={copyText}
      class="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
    >
      {copied ? 'Copied' : 'Copy text'}
    </button>
    <button
      type="button"
      on:click={downloadPng}
      class="min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
    >
      Download PNG
    </button>
  </div>
  <canvas bind:this={canvas} width="600" height="400" class="hidden" aria-hidden="true"></canvas>
</div>
