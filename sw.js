const CACHE = "mgd-shell-v3";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);

    // Keep the Supabase library available for the PWA, but don't intercept
    // normal Supabase API requests with the shell cache.
    try {
      const response = await fetch(SUPABASE_CDN, { mode: "no-cors" });
      await cache.put(SUPABASE_CDN, response);
    } catch (_) {}

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Serve the cached Supabase library when available.
  if (event.request.url === SUPABASE_CDN) {
    event.respondWith((async () => {
      const cached = await caches.match(SUPABASE_CDN);
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch (_) {
        throw _;
      }
    })());
    return;
  }

  // Never turn Supabase/API failures into index.html.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);

      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE)
          .then(c => c.put(event.request, copy))
          .catch(() => {});
      }

      return response;
    } catch (error) {
      // Only navigation requests should fall back to the app shell.
      if (event.request.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
