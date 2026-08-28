/* MOOD BOARD service worker
   アプリの殻だけキャッシュする。写真の実体は IndexedDB にあるので触らない。 */
const CACHE = 'moodboard-v1';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png',
  // USB書き出しで配るビューア本体。オフラインでも書き出せるようにキャッシュしておく
  './viewer/index.html', './viewer/viewer.css', './viewer/viewer.js',
  './pin-grab.js'];

self.addEventListener('install', (e) => {
  // cache:'reload' を付けないとブラウザキャッシュの古い版を拾うことがある
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 外部の画像取得はキャッシュを挟まない（CORSをそのまま通す）
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
