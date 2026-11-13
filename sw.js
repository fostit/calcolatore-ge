// Service worker: tiene l'app nel telefono (funziona offline) e riceve gli screenshot dal menu Condividi.
// A ogni pubblicazione con modifiche AUMENTA il numero di VERSION: è così che il telefono scarica la versione nuova.
const VERSION = 'calc-ge-v2';
const SHARED = 'calc-ge-shared';

const FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/calc.js',
  'js/data.js',
  'js/parse-screen.js',
  'js/regions.js',
  'js/ocr.js',
  'js/settings.js',
  'data/dati-ge.json',
  'fonts/barlow-400.woff2',
  'fonts/barlow-600.woff2',
  'fonts/barlow-700.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/ita.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARED).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function receiveShare(request) {
  const form = await request.formData();
  const files = form.getAll('screenshots').filter((f) => f && f.size);
  const cache = await caches.open(SHARED);
  for (const key of await cache.keys()) await cache.delete(key);
  await Promise.all(files.slice(0, 2).map((f, i) =>
    cache.put(`shared/${i}`, new Response(f, { headers: { 'content-type': f.type || 'image/png' } }))));
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share')) {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('index.html') })
      .then((hit) => hit || fetch(event.request)),
  );
});
