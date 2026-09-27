const CACHE = "mgd-shell-v7";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    try {
      const response = await fetch(SUPABASE_CDN, {cache:"no-store"});
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
    const clients = await self.clients.matchAll({type:"window", includeUncontrolled:true});
    for (const client of clients) client.postMessage({type:"MGD_UPDATED"});
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, {cache:"no-store"});
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
        }
        return response;
      } catch (_) {
        return (await caches.match(event.request)) || (await caches.match("./index.html"));
      }
    })());
    return;
  }
  if (event.request.url === SUPABASE_CDN) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      try {
        const response = await fetch(event.request, {cache:"no-store"});
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
        }
        return response;
      } catch (_) { return cached || Response.error(); }
    })());
  }
});
