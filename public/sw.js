/*
 * Hand-written service worker for the static site.
 *
 * - The home page and the hashed JS/CSS it references are precached, so the
 *   app shell works offline after the first visit.
 * - Pages you visit are cached as you go (network first, cache fallback).
 * - Hashed build assets are immutable, so they are served cache first.
 *
 * Bump VERSION whenever the caching strategy changes. Old caches are removed
 * on activation.
 */
const VERSION = 'v1';
const SHELL_CACHE = `icse-shell-${VERSION}`;
const PAGES_CACHE = `icse-pages-${VERSION}`;
const ASSETS_CACHE = `icse-assets-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, PAGES_CACHE, ASSETS_CACHE];

const CORE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Offline | ICSE 10 MCQs</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; padding: 1.5rem; }
      main { max-width: 28rem; text-align: center; }
      a { display: inline-block; margin-top: 1rem; padding: 0.75rem 1.25rem; border-radius: 0.75rem; background: #4f46e5; color: #fff; font-weight: 600; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>You are offline</h1>
      <p>This page has not been saved for offline use yet. Open the home page to keep practising.</p>
      <a href="/">Go to the home page</a>
    </main>
  </body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        CORE_ASSETS.map(async (url) => {
          const response = await fetch(url, { cache: 'reload' });
          if (response.ok) await cache.put(url, response);
        }),
      );

      // The HTML references content-hashed bundles, so read the cached home
      // page and precache those exact files for a fully working offline shell.
      const home = await cache.match('/');
      if (!home) return;
      const html = await home.clone().text();
      const assetUrls = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)].map(
        (match) => match[1],
      );
      await Promise.allSettled(
        assetUrls.map(async (url) => {
          const response = await fetch(url, { cache: 'reload' });
          if (response.ok) await cache.put(url, response);
        }),
      );
    })().then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handleNavigate(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(PAGES_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedPage = await caches.match(request);
    if (cachedPage) return cachedPage;
    const shell = await caches.match('/');
    if (shell) return shell;
    return offlineResponse();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  return (await network) ?? offlineResponse();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API traffic or the developer panel.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dev')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});
