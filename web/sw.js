// Mohan Mishra PWA service worker: network-first for /api and pages, stale-while-revalidate for static assets.
const V = 'mm-v15';
const SHELL = ['/', '/css/app.css?v=13', '/js/icons.js?v=13', '/js/ui.js?v=13', '/js/customer.js?v=13', '/js/vendor.js?v=13', '/js/admin.js?v=13', '/js/panel2.js?v=13', '/js/chat.js?v=13', '/js/landing.js?v=13', '/js/main.js?v=13', '/assets/brand/logo-rounded.png', '/icons/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => { })); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return; const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) { e.respondWith(fetch(r).catch(() => new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'You are offline. Check your connection and try again.' } }), { status: 503, headers: { 'content-type': 'application/json' } }))); return; }
  if (r.mode === 'navigate') { e.respondWith(fetch(r).then(res => { caches.open(V).then(c => c.put('/', res.clone())); return res; }).catch(() => caches.match('/'))); return; }
  e.respondWith(caches.match(r).then(hit => { const net = fetch(r).then(res => { if (res.ok) caches.open(V).then(c => c.put(r, res.clone())); return res; }).catch(() => hit); return hit || net; }));
});
