// Service worker for offline app-shell support (BUG-07).
//
// Hand-rolled rather than @serwist/next: this app is a single-route
// SPA-style shell ("/" hosts Today/History/Settings as client-side tabs,
// there are no other Next routes to precompute a manifest for) with all
// meal/goal data already offline-capable via IndexedDB (lib/db.ts). The only
// gap was the JS/CSS/document shell itself having zero offline caching.
// A build-time precache manifest (what @serwist/next/Workbox generate) buys
// nothing extra for one route, so a small runtime-caching SW is simpler,
// dependency-free, and easier to audit than pulling in a bundler plugin.
//
// Strategy:
//  - Navigations ("/"): network-first, falling back to the cached shell
//    when offline, so online users always get the latest build.
//  - Hashed static assets (_next/static/*, icons): cache-first — safe since
//    filenames are content-hashed/immutable per build.
//  - Everything else same-origin: stale-while-revalidate.
//  - Anything under /api/: never intercepted — AI parsing needs a live
//    network response; let those fail naturally offline so the app's own
//    error states (BUG-09 etc.) handle it, rather than masking the failure.
//
// Tradeoff to know about: the JS/CSS chunk files are NOT precached by name
// (their hashes aren't known until next build) — they get cached
// opportunistically on first successful online load via the cache-first
// handler below. So offline-from-first-install (before ever completing one
// online page load) isn't covered; "load once online, then works offline"
// is. That matches how PWA installs actually happen in practice (browsers
// require an engagement visit before offering "Add to Home Screen").

const CACHE_NAME = "calories-shell-v1";
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/", { ignoreSearch: true }))
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
