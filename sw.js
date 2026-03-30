const CACHE_NAME = 'dashboard-la-barra-v3';
const APP_ASSETS = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/styles.css',
    './js/app.js',
    './js/auth.js',
    './js/constants.js',
    './js/firebase-config.js',
    './js/product-utils.js',
    './js/storage.js',
    './icons/dashboard-icon.svg',
    './icons/dashboard-icon-maskable.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const isNavigationRequest = event.request.mode === 'navigate';
    const isHtmlRequest = event.request.headers.get('accept')?.includes('text/html');

    if (isNavigationRequest || isHtmlRequest) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return networkResponse;
                })
                .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            return fetch(event.request)
                .then((networkResponse) => {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return networkResponse;
                })
                .catch(() => caches.match('./index.html'));
        })
    );
});
