const CACHE_NAME = "fazal-din-audit-v2.0";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

// External CDN assets (cached separately so failures don't block install)
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/dropbox.js/10.34.0/Dropbox-sdk.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
];

// Install: pre-cache all static app shell assets
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache static assets (required)
      const staticPromise = cache.addAll(STATIC_ASSETS);
      // Cache CDN assets (best-effort — don't fail install if CDN is unreachable)
      const cdnPromise = Promise.allSettled(
        CDN_ASSETS.map(url =>
          fetch(url, { mode: "cors" })
            .then(res => { if (res.ok) cache.put(url, res); })
            .catch(() => {})
        )
      );
      return Promise.all([staticPromise, cdnPromise]);
    })
  );
});

// Activate: delete stale caches and claim clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache-first for static/icon assets; Network-first for everything else
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== "GET") return;

  // Cache-first strategy for same-origin static assets and cached CDN resources
  const isStaticAsset =
    (url.origin === self.location.origin &&
      (url.pathname.endsWith(".png") ||
       url.pathname.endsWith(".ico") ||
       url.pathname.endsWith(".json") ||
       url.pathname === "/" ||
       url.pathname.endsWith("index.html"))) ||
    CDN_ASSETS.some(cdn => event.request.url === cdn);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        }).catch(() => caches.match("./index.html"));
      })
    );
    return;
  }

  // Network-first for Dropbox API and everything else; fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
