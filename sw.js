/* MOOD BOARD service worker
   アプリの殻だけキャッシュする。写真の実体は IndexedDB にあるので触らない。 */
const CACHE = 'moodboard-v2';   // 中身を変えたら上げる（古い控えを片付ける合図）
const SHELL = ['./', './index.html', './style.css', './app.js', './i18n.js', './help.js', './manifest.json',
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
  // ネットにつながっていれば新しい版を読み、控えも新しくする。つながっていないときだけ控えを使う
  // （以前は控えを先に使っていたので、更新しても携帯に古い版が残り続けた）
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
