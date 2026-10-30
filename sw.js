/* MOOD BOARD service worker
   アプリの殻だけキャッシュする。写真の実体は IndexedDB にあるので触らない。 */
const CACHE = 'moodboard-v7';   // 中身を変えたら上げる（古い控えを片付ける合図）
// Android の「共有」から受け取った写真を、アプリが開いて取り込むまで置いておく場所（殻の控えとは別。片付けない）
const SHARE = 'moodboard-share';
const SHELL = ['./', './index.html', './style.css', './app.js', './i18n.js', './help.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png',
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
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Android：ほかのアプリの「共有」→ MOOD BOARD（manifest の share_target）。
   写真・動画・文字（URL）を受け取って SHARE に置き、アプリを ?shared=… で開く。取り込むのはアプリ側 */
async function receiveShare(request) {
  const form = await request.formData();
  const stamp = Date.now();
  const c = await caches.open(SHARE);
  let n = 0;
  for (const f of form.getAll('media')) {
    if (!f || typeof f === 'string' || !f.size) continue;
    await c.put(new Request('./__shared/' + stamp + '/' + (n++)), new Response(f, {
      headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name || ('shared-' + n)) },
    }));
  }
  const text = ['title', 'text', 'url'].map(k => form.get(k)).filter(v => typeof v === 'string' && v.trim()).join('\n');
  if (text) await c.put(new Request('./__shared/' + stamp + '/text'), new Response(text, { headers: { 'Content-Type': 'text/plain;charset=utf-8' } }));
  return Response.redirect(new URL('./index.html?shared=' + stamp, self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 外部の画像取得はキャッシュを挟まない（CORSをそのまま通す）
  if (url.origin !== location.origin) return;
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request).catch(() => Response.redirect(new URL('./index.html?shared=0', self.registration.scope).href, 303)));
    return;
  }
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
