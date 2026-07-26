const APP_NAME = "workout";
const VER = "1"

const CACHE_NAME = APP_NAME + "-v" + VER

const basePath = new URL("./", self.location).pathname.replace(/\/$/, "");

const APP_FILES = [
    `${basePath}/`,
    `${basePath}/index.html`,
    `${basePath}/timer.html`,
    `${basePath}/history.html`,
    `${basePath}/analysis.html`,
    `${basePath}/exercises.html`,
    `${basePath}/warm_up.html`,

    `${basePath}/app.js`,
    `${basePath}/database.js`,

    `${basePath}/manifest.json`,

    `${basePath}/static/icons/icon-192.png`,
    `${basePath}/static/icons/icon-512.png`,

    `${basePath}/static/sounds/beep_short.mp3`,
    `${basePath}/static/sounds/beep_long.mp3`,
    `${basePath}/static/sounds/finish.mp3`
];


// Install event: Cache the static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(APP_FILES);
        })
    );
    self.skipWaiting();
});

// Activate event: Clean up ONLY old caches for THIS app
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    // Check if the cache belongs to this app, but is an older version
                    if (cache.startsWith(APP_NAME) && cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event: Serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    event.respondWith(
        // ignoreSearch: true prevents URL parameters from breaking offline access
        caches.match(event.request, { ignoreSearch: true }).then((response) => {
            return response || fetch(event.request);
        })
    );
});