/* ===== Manganana Service Worker =====
   - Navegação: NETWORK-FIRST (sempre busca o HTML novo no servidor)
   - Assets com ?v=: cache-first (URL muda a cada versão → nunca serve o antigo)
   - Imagens do leitor: cache-first (downloads offline)
   - API: network-first com fallback
*/

const VERSION = 'manganana-v1.4.0';
const CORE_CACHE = VERSION + '-core';
const CHAPTER_CACHE = VERSION + '-chapters';

// arquivos essenciais do app (precache)
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css?v=' + VERSION,
  '/app.js?v=' + VERSION,
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

  // NAVEGAÇÃO (HTML): network-first — sempre busca o site novo.
  // Só usa cache se estiver offline (modo avião → app instalado continua funcionando)
  if (req.mode === 'navigate' || url.pathname === '/') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CORE_CACHE).then((c) => c.put('/index.html', clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((c) => c || caches.match('/')))
    );
    return;
  }

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

  // assets (styles.css, app.js, ícones): cache-first.
  // Como o HTML novo referencia ?v= novo, o cache antigo não casa → busca na rede.
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
