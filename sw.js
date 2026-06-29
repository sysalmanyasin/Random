const CACHE_NAME = "fazal-din-audit-v1.8";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json"
];

// Install Service Worker and cache essential layouts
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate handler
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-first falling back to local cache fetch strategy
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
