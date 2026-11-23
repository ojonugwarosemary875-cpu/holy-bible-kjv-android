const CACHE_NAME = 'holy-bible-kjv-shell-v1';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.add(new Request('./', { cache: 'reload' }));
    } catch {
      // The first successful page load will still be cached by the fetch handler.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('holy-bible-kjv-shell-') && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      try {
        payload = { body: event.data ? event.data.text() : '' };
      } catch {
        payload = {};
      }
    }

    const message = payload.notification || payload;
    const title = message.title || 'A gentle moment with God';
    const options = {
      body: message.body || 'It is your prayer time. Take a quiet moment with God.',
      icon: message.icon || '/holy-bible-kjv-icon.png',
      badge: '/holy-bible-kjv-icon.png',
      tag: payload.data?.kind || 'holy-bible-prayer-reminder',
      renotify: true,
      requireInteraction: true,
      vibrate: [350, 180, 350, 180, 550],
      silent: false,
      data: {
        url: message.url || payload.data?.url || '/'
      }
    };

    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin);
    if (target.origin !== self.location.origin) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client && client.url !== target.href) await client.navigate(target.href);
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put('./', response.clone());
        return response;
      } catch {
        return (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    } catch {
      return cached || Response.error();
    }
  })());
});
