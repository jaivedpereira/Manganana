/* ===== Manganana Service Worker =====
   - Cache dos arquivos do app (carregamento instantâneo)
   - Cache automático de imagens do leitor (leitura offline)
   - Estratégia: cache-first p/ assets, network-first p/ API
*/

const VERSION = 'manganana-v1.1.0';
const CORE_CACHE = VERSION + '-core';
const CHAPTER_CACHE = VERSION + '-chapters';

// arquivos essenciais do app (precache)
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CORE_CACHE).then((c) => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CORE_CACHE && k !== CHAPTER_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// remove capítulos do cache (mensagem do app)
self.addEventListener('message', (e) => {
  const { type, urls } = e.data || {};
  if (type === 'DELETE_CHAPTER' && Array.isArray(urls)) {
    e.waitUntil(
      caches.open(CHAPTER_CACHE).then((cache) => Promise.all(urls.map((u) => cache.delete(u))))
    );
  }
});

// estratégia de fetch
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  // API do próprio app (proxies): network-first com fallback p/ cache
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/img')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CORE_CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // imagens do leitor (/api/img): cache-first + cache automático ao baixar.
  // Assim, capítulos "baixados" (pré-buscados pelo app) funcionam offline.
  if (url.pathname.startsWith('/api/img')) {
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CHAPTER_CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        }).catch(() => cached || Response.error());
      })
    );
    return;
  }

  // assets core: cache-first
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CORE_CACHE).then((c) => c.put(req, clone)).catch(() => {});
        return res;
      });
    })
  );
});
