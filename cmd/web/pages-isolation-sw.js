// GitHub Pages cannot set isolation headers. Only the app and its workers need them.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    const app = request.mode === 'navigate' && url.pathname === '/app.html';
    const worker = request.destination === 'worker' &&
        ['/vendor/browser-worker.js', '/vendor/opfs-worker.js'].includes(url.pathname);
    if (!app && !worker) return;

    event.respondWith((async () => {
        const response = await fetch(request);
        if (!response.ok) return response;
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    })());
});
