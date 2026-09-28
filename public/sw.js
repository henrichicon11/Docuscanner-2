/* DocuScanner service worker: offline app shell + runtime caching (incl. OCR assets). */
const VERSION = 'v1';
const SHELL = `docuscanner-shell-${VERSION}`;
const RUNTIME = `docuscanner-runtime-${VERSION}`;
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App navigations: network first, fall back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Same-origin hashed assets and OCR (tesseract core / traineddata from CDN): cache first
  const cacheable = url.origin === self.location.origin ||
    /(^|\.)jsdelivr\.net$/.test(url.hostname) || /tessdata/.test(url.pathname) || /unpkg\.com$/.test(url.hostname);
  if (!cacheable) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
