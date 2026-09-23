const CACHE = "mgd-shell-v2";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
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
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (event.request.url.startsWith(self.location.origin) || event.request.url === SUPABASE_CDN) {
        const copy = response.clone();
        caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
      }
      return response;
    } catch (_) {
      return caches.match("./index.html");
    }
  })());
});
