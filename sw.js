const CACHE_NAME = "fazal-din-audit-v9.01-camera-fix";

// App-shell assets we want available offline immediately after install.
// Includes the complete ES-module graph of js/main.js so a fresh install can
// start offline. Keep in sync when adding/removing modules.
// (These are still precached, but at *runtime* they are served network-first,
// same as every other JS/CSS/JSON/HTML file — see isRarelyChanging below.)
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./css/engagement.css",
  "./css/barcode.css",
  "./css/rack-scan.css",
  "./css/desktop.css",
  "./css/design-upgrade.css",
  "./js/vendor/zxing-library.min.js",
  "./js/vendor/zxing-wasm-reader.iife.js",
  "./js/vendor/zxing_reader.wasm",
  "./js/main.js",
  "./js/actions.js",
  "./js/components.js",
  "./js/pages.js",
  "./js/repository.js",
  "./js/store.js",
  "./js/store/initial-state.js",
  "./js/store/store.js",
  "./js/repository/barcode.js",
  "./js/repository/rack-scan.js",
  "./js/repository/db.js",
  "./js/repository/expiry.js",
  "./js/repository/legacy.js",
  "./js/repository/storage.js",
  "./js/repository/supabase.js",
  "./js/repository/templates.js",
  "./js/actions/assignment-actions.js",
  "./js/actions/audit-log-actions.js",
  "./js/actions/auth-actions.js",
  "./js/actions/barcode-actions.js",
  "./js/actions/rack-scan-actions.js",
  "./js/rack/rack-scan-core.js",
  "./js/components/rack-scan-components.js",
  "./js/pages/rack-scan-pages.js",
  "./js/actions/bus.js",
  "./js/actions/calculator-actions.js",
  "./js/actions/compile-actions.js",
  "./js/actions/counting-actions.js",
  "./js/actions/dashboard-actions.js",
  "./js/actions/difference-actions.js",
  "./js/actions/engagement-actions.js",
  "./js/actions/expiry-actions.js",
  "./js/actions/index.js",
  "./js/actions/individual-actions.js",
  "./js/actions/inventory-actions.js",
  "./js/actions/item-key.js",
  "./js/actions/legacy-actions.js",
  "./js/actions/report-actions.js",
  "./js/actions/round-actions.js",
  "./js/actions/snapshot-actions.js",
  "./js/actions/staff-actions.js",
  "./js/actions/variance-edit-actions.js",
  "./js/barcode/barcode-lookup.js",
  "./js/barcode/barcode-quality.js",
  "./js/barcode/barcode-reports.js",
  "./js/barcode/barcode-scanner.js",
  "./js/barcode/barcode-service.js",
  "./js/barcode/barcode-validation.js",
  "./js/barcode/barcode-zxing.js",
  "./js/components/assignment-components.js",
  "./js/components/barcode-components.js",
  "./js/components/compile-components.js",
  "./js/components/counting-components.js",
  "./js/components/dashboard-components.js",
  "./js/components/dom-utils.js",
  "./js/components/engagement-components.js",
  "./js/components/expiry-components.js",
  "./js/components/index.js",
  "./js/components/inventory-components.js",
  "./js/components/legacy-components.js",
  "./js/components/login-components.js",
  "./js/components/report-components.js",
  "./js/components/round-components.js",
  "./js/components/staff-components.js",
  "./js/pages/auth-pages.js",
  "./js/pages/barcode-counting-pages.js",
  "./js/pages/barcode-pages.js",
  "./js/pages/calculator-pages.js",
  "./js/pages/engagement-pages.js",
  "./js/pages/event-delegation.js",
  "./js/pages/expiry-pages.js",
  "./js/pages/home-stats-page.js",
  "./js/pages/inventory-pages.js",
  "./js/pages/legacy-pages.js",
  "./js/pages/staff-pages.js",
  "./js/pages/sub-pages.js",
  "./favicon.ico",
  "./favicon-16x16.png",
  "./favicon-32x32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

// External CDN assets (cached separately so failures don't block install)
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"
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
       url.pathname.endsWith(".wasm") ||
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
