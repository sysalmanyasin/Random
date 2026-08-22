const CACHE_NAME = "fazal-din-audit-v8.5-template-card-simplified";

// App-shell assets we want available offline immediately after install.
// (These are still precached, but at *runtime* they are served network-first,
// same as every other JS/CSS/JSON/HTML file — see isRarelyChanging below.)
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./css/engagement.css",
  "./js/repository.js",
  "./js/store.js",
  "./js/actions.js",
  "./js/components.js",
  "./js/pages.js",
  "./js/main.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

// External CDN assets (cached separately so failures don't block install)
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
];

// Install: pre-cache the app shell so there's something to fall back to offline.
// This does NOT mean these files are served cache-first at runtime (see fetch handler).
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const staticPromise = cache.addAll(STATIC_ASSETS);
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

// Fetch strategy:
//  - Rarely-changing binary assets (icons, favicons) -> cache-first
//  - Everything else that's part of the app (html/js/css/json, incl. CDN libs) -> network-first,
//    falling back to cache only when the network is unavailable (offline).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== "GET") return;

  const isRarelyChangingAsset =
    url.origin === self.location.origin &&
    (url.pathname.endsWith(".png") ||
     url.pathname.endsWith(".ico"));

  if (isRarelyChangingAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  const isAppCode =
    (url.origin === self.location.origin &&
      (url.pathname.endsWith(".js") ||
       url.pathname.endsWith(".css") ||
       url.pathname.endsWith(".json") ||
       url.pathname === "/" ||
       url.pathname.endsWith("index.html"))) ||
    CDN_ASSETS.some(cdn => event.request.url === cdn);

  if (isAppCode) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }

  // Network-first for Dropbox API and everything else; fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
