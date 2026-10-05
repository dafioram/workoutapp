const APP_NAME = "workout";
// Bump when APP_FILES changes. Edits to existing files don't need a bump:
// they are picked up in the background and served on the next launch.
const VER = "2"

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
    `${basePath}/static/sounds/finish.mp3`,

    `${basePath}/static/vendor/chart-4.5.1.umd.min.js`,
    `${basePath}/static/vendor/mobile-drag-drop-2.3.0-rc.2.min.js`,
    `${basePath}/static/vendor/mobile-drag-drop-2.3.0-rc.2.css`
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

// Fetch event: stale-while-revalidate for this app's own files.
// Serve from cache immediately (works offline, no waiting on a slow network),
// then refresh the cached copy in the background so updates show up next launch.
// Cross-origin requests (the exercise library) go straight to the network;
// that data is stored in IndexedDB instead.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            // ignoreSearch: true prevents URL parameters from breaking offline access
            const cached = await cache.match(request, { ignoreSearch: true });

            const network = fetch(request).then((response) => {
                // Only cache full responses; Safari requests audio with Range
                // headers and cache.put() rejects 206 Partial Content.
                if (response.status === 200) {
                    cache.put(request, response.clone());
                }
                return response;
            });

            if (cached) {
                event.waitUntil(network.catch(() => {}));
                return cached;
            }
            return network;
        })
    );
});
