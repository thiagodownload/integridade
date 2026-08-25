const CACHE = 'canal-integridade-v01';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(r => r || caches.match('./index.html'))));
});

self.addEventListener('push', event => {
  const data = event.data?.json?.() || {};
  event.waitUntil(self.registration.showNotification(data.title || 'Canal de Integridade', {
    body: data.body || 'Há uma nova atualização. Acesse o painel para consultar.',
    data: { url: data.url || './#/operacoes' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || './#/operacoes'));
});
