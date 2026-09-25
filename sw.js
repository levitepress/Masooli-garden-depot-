const CACHE = "mgd-shell-v4";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    try {
      const response = await fetch(SUPABASE_CDN);
      if (response.ok || response.type === "opaque") await cache.put(SUPABASE_CDN, response);
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Keep the app shell available immediately, while updating it in the background.
  // This avoids breaking startup when a phone briefly cannot reach Vercel/CDN.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      const network = fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => null);
      return cached || await network || caches.match("./index.html");
    })());
    return;
  }

  // Keep the Supabase client library cached so the app can start reliably.
  if (event.request.url === SUPABASE_CDN) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      try {
        const response = await fetch(event.request);
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
        }
        return response;
      } catch (_) {
        return cached || Response.error();
      }
    })());
  }
});
