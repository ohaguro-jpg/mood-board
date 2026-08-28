/* ==========================================================================
   MOOD BOARD  —  端末の中だけで完結するムードボード
   画像の実体を IndexedDB に保存するので、元が消えても手元に残る。
   ========================================================================== */
'use strict';

/* ---------- 保存サイズの方針 ----------------------------------------------
   原寸をそのまま抱えると数GBになるので、取り込み時に作り直す。
   FULL  : 見る用。長辺1800px。ムードボードなら十分すぎる。
   THUMB : 並べる用。長辺480px。何百枚並べても軽い。
   元がこれより小さい画像は触らずそのまま保存する。
--------------------------------------------------------------------------- */
const FULL_EDGE = 1800;
const THUMB_EDGE = 480;
const FULL_Q = 0.84;
const THUMB_Q = 0.72;

/* ========================== IndexedDB ==================================== */
const DB_NAME = 'moodboard';
const DB_VER = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('boards')) {
        db.createObjectStore('boards', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('boardId', 'boardId', { unique: false });
        s.createIndex('imageId', 'imageId', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
const dbGet = (s, k) => tx(s).then(o => new Promise((res, rej) => {
  const r = o.get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const dbAll = (s) => tx(s).then(o => new Promise((res, rej) => {
  const r = o.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
}));
const dbPut = (s, v) => tx(s, 'readwrite').then(o => new Promise((res, rej) => {
  const r = o.put(v); r.onsuccess = () => res(v); r.onerror = () => rej(r.error);
}));
const dbDel = (s, k) => tx(s, 'readwrite').then(o => new Promise((res, rej) => {
  const r = o.delete(k); r.onsuccess = () => res(); r.onerror = () => rej(r.error);
}));
const dbByIndex = (s, idx, key) => tx(s).then(o => new Promise((res, rej) => {
  const r = o.index(idx).getAll(key); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
}));
function dbPutMany(store, values) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const o = t.objectStore(store);
    values.forEach(v => o.put(v));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  }));
}

/* ========================== 小道具 ======================================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(36).slice(2));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nowISO = () => new Date().toISOString();

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.innerHTML = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* テキスト入力（ネイティブprompt はPWAで出ないことがあるので自前） */
function ask(title, initial = '', multiline = false) {
  return new Promise((res) => {
    const wrap = $('#prompt'), inp = $('#prompt-input'), area = $('#prompt-area');
    $('#prompt-title').textContent = title;
    inp.hidden = multiline; area.hidden = !multiline;
    const field = multiline ? area : inp;
    field.value = initial;
    wrap.hidden = false;
    setTimeout(() => { field.focus(); if (!multiline) field.select(); }, 60);
    const done = (val) => {
      wrap.hidden = true;
      $('#prompt-ok').onclick = null; $('#prompt-cancel').onclick = null;
      inp.onkeydown = null;
      res(val);
    };
    $('#prompt-ok').onclick = () => done(field.value.trim());
    $('#prompt-cancel').onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(field.value.trim()); } };
  });
}

function confirmAsk(title) {
  return new Promise((res) => {
    const wrap = $('#prompt');
    $('#prompt-title').textContent = title;
    $('#prompt-input').hidden = true; $('#prompt-area').hidden = true;
    wrap.hidden = false;
    const done = (v) => { wrap.hidden = true; $('#prompt-input').hidden = false; res(v); };
    $('#prompt-ok').onclick = () => done(true);
    $('#prompt-cancel').onclick = () => done(false);
  });
}

/* ---------- 進捗 ---------- */
let progCancelled = false;
function progOpen(label) {
  progCancelled = false;
  $('#prog-label').textContent = label;
  $('#prog-fill').style.width = '0%';
  $('#prog-sub').textContent = '';
  $('#progress').hidden = false;
}
function progSet(done, total, sub) {
  $('#prog-fill').style.width = (total ? (done / total * 100) : 0).toFixed(1) + '%';
  $('#prog-sub').innerHTML = sub || (done + ' / ' + total);
}
function progClose() { $('#progress').hidden = true; }
$('#prog-cancel')?.addEventListener('click', () => { progCancelled = true; });

/* ========================== 画像の作り直し =============================== */
/* 画像をデコードする。
   createImageBitmap は HEIC を読めないが、Safari は <img> なら表示できる。
   iPhoneの写真はHEICなので、この二段構えが要る。 */
async function decodeImage(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close && bmp.close() };
  } catch (e) { /* 下の <img> で試す */ }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('decode');
    return { src: img, w, h, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    const heic = /heic|heif/i.test(blob.type) || /\.(heic|heif)$/i.test(blob.name || '');
    const err = new Error(heic ? 'HEIC' : 'この形式は読めません');
    err.heic = heic;
    throw err;
  }
}

/* Blob -> {full, thumb, w, h}  縮小と再エンコードでサイズを削る */
async function processImage(blob) {
  const dec = await decodeImage(blob);
  const { w, h } = dec;
  const type = pickType();

  // 大きい方を一度だけ描き、サムネはその結果から作る（元の巨大画像を二度描かない）
  const fullCanvas = drawCanvas(dec.src, w, h, FULL_EDGE);
  const full = (Math.max(w, h) <= FULL_EDGE && blob.size < 900 * 1024)
    ? blob                                   // 十分小さいので触らない
    : await canvasToBlob(fullCanvas, type, FULL_Q);
  const thumbCanvas = drawCanvas(fullCanvas, fullCanvas.width, fullCanvas.height, THUMB_EDGE);
  const thumb = await canvasToBlob(thumbCanvas, type, THUMB_Q);
  dec.close();
  return { full, thumb, w, h };
}

function drawCanvas(src, sw, sh, edge) {
  const scale = Math.min(1, edge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}
const canvasToBlob = (c, type, q) => new Promise(res => c.toBlob(b => res(b), type, q));

let _typeCache = null;
function pickType() {
  if (_typeCache) return _typeCache;
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ok = c.toDataURL('image/webp').startsWith('data:image/webp');
  _typeCache = ok ? 'image/webp' : 'image/jpeg';
  return _typeCache;
}

function drawTo(bmp, edge, type, q) {
  const w0 = bmp.width || bmp.naturalWidth;
  const h0 = bmp.height || bmp.naturalHeight;
  return canvasToBlob(drawCanvas(bmp, w0, h0, edge), type, q);
}

/* ========================== 画像URLキャッシュ ============================ */
const urlCache = new Map();   // imageId+kind -> objectURL
function blobURL(id, kind, blob) {
  const key = id + ':' + kind;
  if (urlCache.has(key)) return urlCache.get(key);
  const u = URL.createObjectURL(blob);
  urlCache.set(key, u);
  return u;
}
function releaseURLs() {
  urlCache.forEach(u => URL.revokeObjectURL(u));
  urlCache.clear();
}

/* ========================== 状態 ========================================= */
const S = {
  view: 'home',            // home | board
  boardId: null,
  board: null,
  items: [],               // このボードの配置 {id,boardId,imageId,x,y,w,h,z,note}
  imgs: new Map(),         // imageId -> imageレコード
  sel: null,               // 選択中 itemId（単体操作）
  picking: false,          // みくらべ選択モード
  picked: [],              // 選んだ itemId の順番
  cam: { x: 0, y: 0, k: 1 },
  cmpLayout: 'row',
  cmpFill: false,
};

/* ========================== ホーム ======================================= */
async function renderHome() {
  const boards = await dbAll('boards');
  boards.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const grid = $('#board-grid');
  grid.innerHTML = '';

  const allItems = (await dbAll('items')).filter(i => !i.trashedAt);
  const byBoard = new Map();
  allItems.forEach(it => {
    if (!byBoard.has(it.boardId)) byBoard.set(it.boardId, []);
    byBoard.get(it.boardId).push(it);
  });

  for (const b of boards) {
    const its = (byBoard.get(b.id) || []).sort((x, y) => (y.z || 0) - (x.z || 0));
    const card = document.createElement('button');
    card.className = 'board-card';
    const thumbs = document.createElement('div');
    thumbs.className = 'bc-thumbs' + (its.length === 1 ? ' one' : '');
    const shown = its.slice(0, its.length === 1 ? 1 : 4);
    for (let i = 0; i < Math.max(1, shown.length); i++) {
      if (shown[i]) {
        const im = document.createElement('img');
        im.loading = 'lazy';
        im.dataset.imageId = shown[i].imageId;
        thumbs.appendChild(im);
      } else {
        const d = document.createElement('div'); d.className = 'ph'; thumbs.appendChild(d);
      }
    }
    if (its.length > 1) {
      for (let i = shown.length; i < 4; i++) { const d = document.createElement('div'); d.className = 'ph'; thumbs.appendChild(d); }
    }
    const meta = document.createElement('div');
    meta.className = 'bc-meta';
    meta.innerHTML = '<div class="bc-name"></div><div class="bc-count"></div>';
    meta.querySelector('.bc-name').textContent = b.name;
    meta.querySelector('.bc-count').textContent = its.length + ' まい';
    card.append(thumbs, meta);
    card.onclick = () => openBoard(b.id);
    grid.appendChild(card);
  }

  $('#home-empty').hidden = boards.length > 0;

  // サムネの中身を後から流し込む
  // ※ dataset.imageId は属性としては data-image-id になる
  const allImages = await dbAll('images');
  const imgMap = new Map(allImages.map(r => [r.id, r]));
  $$('#board-grid img[data-image-id]').forEach(im => {
    const rec = imgMap.get(im.dataset.imageId);
    if (rec) im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
  });

  // 使用量
  let statTxt = '';
  const imgCount = allImages.length;
  statTxt += imgCount + ' 枚の写真をこの端末に保存中';
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    statTxt += '<br>' + fmtBytes(est.usage || 0) + ' 使用';
    if (est.quota) statTxt += '（この端末の上限 ' + fmtBytes(est.quota) + '）';
  }
  $('#home-stats').innerHTML = statTxt;
}

async function newBoard() {
  const name = await ask('ボードの名前', '');
  if (name === null) return;
  const b = { id: uid(), name: name || '無題のボード', createdAt: nowISO(), updatedAt: nowISO() };
  await dbPut('boards', b);
  await openBoard(b.id);
}

/* ========================== ボードを開く ================================= */
async function openBoard(id) {
  releaseURLs();
  S.boardId = id;
  S.board = await dbGet('boards', id);
  if (!S.board) { toast('ボードが見つかりません'); return goHome(); }
  S.items = (await dbByIndex('items', 'boardId', id)).filter(i => !i.trashedAt);
  S.items.sort((a, b) => (a.z || 0) - (b.z || 0));
  S.imgs.clear();
  for (const it of S.items) {
    if (!S.imgs.has(it.imageId)) {
      const rec = await dbGet('images', it.imageId);
      if (rec) S.imgs.set(it.imageId, rec);
    }
  }
  S.view = 'board';
  S.sel = null; S.picking = false; S.picked = [];
  $('#view-home').hidden = true;
  $('#view-board').hidden = false;
  $('#btn-back').hidden = false;
  $('#app-title').textContent = S.board.name;
  $('#board-sub').textContent = S.items.length + ' まい';
  $$('[data-boardonly]').forEach(el => el.hidden = false);
  renderCanvas();
  fitAll(true);
  // 少しだけ引いた状態から寄せて、ふわっと広がって見せる
  S.cam.k *= 0.9;
  applyCam();
  requestAnimationFrame(() => { fitAll(false); revealItems(); });
  // パレット用の色は裏でそっと用意する
  ensureColors(false).then(() => renderPalette());
}

function goHome() {
  releaseURLs();
  S.view = 'home'; S.boardId = null; S.board = null; S.items = []; S.imgs.clear();
  S.sel = null; S.picking = false; S.picked = [];
  $('#view-board').hidden = true;
  $('#view-home').hidden = false;
  $('#btn-back').hidden = true;
  $('#app-title').textContent = 'MOOD BOARD';
  $('#board-sub').textContent = '';
  $$('[data-boardonly]').forEach(el => el.hidden = true);
  const pb = $('#palette'); if (pb) pb.hidden = true;
  setDock('board');
  renderHome();
}

async function touchBoard() {
  if (!S.board) return;
  S.board.updatedAt = nowISO();
  await dbPut('boards', S.board);
  $('#board-sub').textContent = S.items.length + ' まい';
}

/* ========================== キャンバス描画 =============================== */
const canvas = $('#canvas');

function renderCanvas() {
  canvas.innerHTML = '';
  S.items.sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const it of S.items) canvas.appendChild(makeItemEl(it));
  $('#board-empty').hidden = S.items.length > 0;
  applyCam();
}

function makeItemEl(it) {
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.id = it.id;
  el.style.width = it.w + 'px';
  el.style.height = it.h + 'px';
  el.style.transform = 'translate(' + it.x + 'px,' + it.y + 'px)';
  const rec = S.imgs.get(it.imageId);
  if (rec) {
    const im = document.createElement('img');
    im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
    im.alt = '';
    el.appendChild(im);
  } else {
    const d = document.createElement('div');
    d.className = 'broken';
    d.textContent = '画像が見つかりません';
    el.appendChild(d);
  }
  if (it.note) {
    const n = document.createElement('div');
    n.className = 'note-tag';
    n.textContent = it.note;
    el.appendChild(n);
  }
  return el;
}

function itemEl(id) { return canvas.querySelector('.item[data-id="' + id + '"]'); }

function updateItemEl(it) {
  const el = itemEl(it.id);
  if (!el) return;
  el.style.width = it.w + 'px';
  el.style.height = it.h + 'px';
  el.style.transform = 'translate(' + it.x + 'px,' + it.y + 'px)';
}

function applyCam() {
  canvas.style.transform = 'translate(' + S.cam.x + 'px,' + S.cam.y + 'px) scale(' + S.cam.k + ')';
  $('#zoom-val').textContent = Math.round(S.cam.k * 100);
  positionHandle();
  scalePickBadges();
}

function boardBounds() {
  if (!S.items.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const it of S.items) {
    x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
    x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

function fitAll(instant) {
  const b = boardBounds();
  const wrapEl = $('#canvas-wrap');
  const W = wrapEl.clientWidth, H = wrapEl.clientHeight;
  if (!b) { S.cam = { x: W / 2, y: H / 2, k: 1 }; applyCam(); return; }
  const pad = 26;
  const k = clamp(Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h), 0.06, 1.6);
  S.cam.k = k;
  S.cam.x = (W - b.w * k) / 2 - b.x1 * k;
  S.cam.y = (H - b.h * k) / 2 - b.y1 * k;
  if (!instant) smoothCam(520);
  applyCam();
}

/* ボードを開いたとき、中心から外へ順に立ち上げる */
function revealItems() {
  const b = boardBounds();
  if (!b) return;
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const maxD = Math.max(1, Math.hypot(b.w, b.h) / 2);
  for (const it of S.items) {
    const el = itemEl(it.id);
    if (!el) continue;
    const d = Math.hypot(it.x + it.w / 2 - cx, it.y + it.h / 2 - cy) / maxD;
    el.style.setProperty('--dl', Math.round(d * 260) + 'ms');
    el.classList.remove('in');
    void el.offsetWidth;            // アニメーションを確実に鳴らし直す
    el.classList.add('in');
  }
}

/* 画面座標 -> キャンバス座標 */
function toCanvas(px, py) {
  const r = $('#canvas-wrap').getBoundingClientRect();
  return {
    x: (px - r.left - S.cam.x) / S.cam.k,
    y: (py - r.top - S.cam.y) / S.cam.k,
  };
}
function viewCenterCanvas() {
  const wrap = $('#canvas-wrap');
  const r = wrap.getBoundingClientRect();
  return toCanvas(r.left + wrap.clientWidth / 2, r.top + wrap.clientHeight / 2);
}

/* ========================== 指の操作 ===================================== */
const wrap = $('#canvas-wrap');
const pointers = new Map();
let G = null;                 // 進行中のジェスチャ
let lastTap = { t: 0, id: null };

/* --- 指を離したあとも滑らせる（止まると機械っぽくなる） --- */
let glideRAF = 0;
function stopGlide() { cancelAnimationFrame(glideRAF); glideRAF = 0; }
function glide(vx, vy) {
  stopGlide();
  let last = performance.now();
  const step = (t) => {
    const dt = Math.min(48, t - last); last = t;
    const decay = Math.pow(0.935, dt / 16.67);
    vx *= decay; vy *= decay;
    S.cam.x += vx * dt; S.cam.y += vy * dt;
    applyCam();
    if (Math.hypot(vx, vy) > 0.015) glideRAF = requestAnimationFrame(step);
    else glideRAF = 0;
  };
  glideRAF = requestAnimationFrame(step);
}

/* --- ズームやフィットのときだけ補間を効かせる --- */
let smoothTimer = 0;
function smoothCam(ms = 420) {
  canvas.classList.add('smooth');
  clearTimeout(smoothTimer);
  smoothTimer = setTimeout(() => canvas.classList.remove('smooth'), ms);
}

function itemFromEvent(e) {
  const el = e.target.closest && e.target.closest('.item');
  return el ? S.items.find(i => i.id === el.dataset.id) : null;
}

wrap.addEventListener('pointerdown', (e) => {
  stopGlide();
  canvas.classList.remove('smooth');
  wrap.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    // ピンチ開始（ドラッグ中でも割り込んでよい）
    const [a, b] = [...pointers.values()];
    G = {
      mode: 'pinch',
      d0: Math.hypot(a.x - b.x, a.y - b.y),
      c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam0: { ...S.cam },
      moved: true,
    };
    return;
  }
  if (pointers.size > 2) return;

  const onHandle = e.target.classList && e.target.classList.contains('handle');
  const it = itemFromEvent(e);

  if (onHandle && S.sel) {
    const sel = S.items.find(i => i.id === S.sel);
    G = { mode: 'resize', it: sel, w0: sel.w, h0: sel.h, sx: e.clientX, sy: e.clientY, moved: false };
  } else if (it && !S.picking) {
    G = { mode: 'drag', it, x0: it.x, y0: it.y, sx: e.clientX, sy: e.clientY, moved: false, startId: it.id };
    // つかんだら手前に出す（見た目だけ即時）
    const el = itemEl(it.id);
    if (el) canvas.appendChild(el);
  } else if (it && S.picking) {
    G = { mode: 'tap-pick', it, sx: e.clientX, sy: e.clientY, moved: false };
  } else {
    G = { mode: 'pan', cam0: { ...S.cam }, sx: e.clientX, sy: e.clientY, moved: false,
          lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 };
  }
}, { passive: false });

wrap.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!G) return;

  if (G.mode === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ratio = d / (G.d0 || 1);
    const k = clamp(G.cam0.k * ratio, 0.05, 6);
    const r = wrap.getBoundingClientRect();
    // ピンチ中心をキャンバス上で固定したままスケール
    const cx = G.c0.x - r.left, cy = G.c0.y - r.top;
    const wx = (cx - G.cam0.x) / G.cam0.k, wy = (cy - G.cam0.y) / G.cam0.k;
    S.cam.k = k;
    S.cam.x = (c.x - r.left) - wx * k;
    S.cam.y = (c.y - r.top) - wy * k;
    applyCam();
    return;
  }

  const dx = e.clientX - G.sx, dy = e.clientY - G.sy;
  if (Math.hypot(dx, dy) > 5) G.moved = true;

  if (G.mode === 'pan') {
    S.cam.x = G.cam0.x + dx;
    S.cam.y = G.cam0.y + dy;
    const t = performance.now();
    const ddt = t - G.lastT;
    if (ddt > 0) {
      // 直近の速度を少しならして拾う（1フレームの跳ねに引きずられないように）
      G.vx = G.vx * 0.4 + ((e.clientX - G.lastX) / ddt) * 0.6;
      G.vy = G.vy * 0.4 + ((e.clientY - G.lastY) / ddt) * 0.6;
      G.lastX = e.clientX; G.lastY = e.clientY; G.lastT = t;
    }
    applyCam();
  } else if (G.mode === 'drag') {
    G.it.x = G.x0 + dx / S.cam.k;
    G.it.y = G.y0 + dy / S.cam.k;
    updateItemEl(G.it);
    positionHandle();
  } else if (G.mode === 'resize') {
    const ratio = G.h0 / G.w0;
    const nw = clamp(G.w0 + dx / S.cam.k, 40, 6000);
    G.it.w = Math.round(nw);
    G.it.h = Math.round(nw * ratio);
    updateItemEl(G.it);
    positionHandle();
  }
}, { passive: false });

async function endGesture(e) {
  pointers.delete(e.pointerId);
  if (!G) return;

  if (G.mode === 'pinch') {
    if (pointers.size === 0) G = null;
    else {
      // 指が1本残ったらパンに引き継ぐ
      const p = [...pointers.values()][0];
      G = { mode: 'pan', cam0: { ...S.cam }, sx: p.x, sy: p.y, moved: true };
    }
    return;
  }
  if (pointers.size > 0) return;

  const g = G; G = null;

  if (g.mode === 'drag') {
    if (g.moved) {
      // 手前に持ってきたので z を振り直し
      const maxZ = Math.max(0, ...S.items.map(i => i.z || 0));
      g.it.z = maxZ + 1;
      await dbPut('items', g.it);
      S.items.sort((a, b) => (a.z || 0) - (b.z || 0));
      touchBoard();
    } else {
      selectItem(g.it.id);
      const t = Date.now();
      if (lastTap.id === g.it.id && t - lastTap.t < 320) {
        openViewer(g.it);
        lastTap = { t: 0, id: null };
      } else {
        lastTap = { t, id: g.it.id };
      }
    }
  } else if (g.mode === 'resize') {
    if (g.moved) { await dbPut('items', g.it); touchBoard(); }
  } else if (g.mode === 'tap-pick') {
    if (!g.moved) togglePick(g.it.id);
  } else if (g.mode === 'pan') {
    if (!g.moved) selectItem(null);
    else if (performance.now() - g.lastT < 90 && Math.hypot(g.vx, g.vy) > 0.12) glide(g.vx, g.vy);
  }
}
wrap.addEventListener('pointerup', endGesture);
wrap.addEventListener('pointercancel', endGesture);

/* マウスホイールでズーム（PC用） */
wrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = wrap.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const wx = (cx - S.cam.x) / S.cam.k, wy = (cy - S.cam.y) / S.cam.k;
  const k = clamp(S.cam.k * (e.deltaY < 0 ? 1.14 : 1 / 1.14), 0.05, 6);
  S.cam.k = k;
  S.cam.x = cx - wx * k;
  S.cam.y = cy - wy * k;
  smoothCam(200);
  applyCam();
}, { passive: false });

/* ========================== 選択 ========================================= */
let handleEl = null;

function selectItem(id) {
  S.sel = id;
  canvas.querySelectorAll('.item.sel').forEach(el => el.classList.remove('sel'));
  if (handleEl) { handleEl.remove(); handleEl = null; }
  if (id) {
    const el = itemEl(id);
    if (el) {
      el.classList.add('sel');
      handleEl = document.createElement('div');
      handleEl.className = 'handle';
      el.appendChild(handleEl);
      positionHandle();
    }
    setDock('item');
  } else {
    setDock(S.picking ? 'select' : 'board');
  }
}

/* ハンドルはズームの影響を受けないように逆スケール */
function positionHandle() {
  if (handleEl) handleEl.style.transform = 'scale(' + (1 / S.cam.k) + ')';
}
/* 順番バッジもズームで潰れないように */
function scalePickBadges() {
  if (!S.picking) return;
  canvas.querySelectorAll('.pick-no').forEach(b => {
    b.style.transform = 'scale(' + (1 / S.cam.k) + ')';
  });
}
function setDock(which) {
  $('#board-dock').hidden = which !== 'board';
  $('#select-dock').hidden = which !== 'select';
  $('#item-dock').hidden = which !== 'item';
}

/* ---- みくらべ選択モード ---- */
function startPicking() {
  S.picking = true; S.picked = [];
  selectItem(null);
  setDock('select');
  updatePickUI();
  toast('くらべたい写真を、順番にタップ');
}
function stopPicking() {
  S.picking = false; S.picked = [];
  canvas.querySelectorAll('.item.picked').forEach(el => {
    el.classList.remove('picked');
    const n = el.querySelector('.pick-no'); if (n) n.remove();
  });
  setDock('board');
}
function togglePick(id) {
  const i = S.picked.indexOf(id);
  if (i >= 0) S.picked.splice(i, 1);
  else {
    if (S.picked.length >= 6) { toast('いちどに くらべられるのは 6枚まで'); return; }
    S.picked.push(id);
  }
  updatePickUI();
}
function updatePickUI() {
  canvas.querySelectorAll('.item').forEach(el => {
    const idx = S.picked.indexOf(el.dataset.id);
    const badge = el.querySelector('.pick-no');
    if (idx >= 0) {
      el.classList.add('picked');
      if (badge) badge.textContent = idx + 1;
      else {
        const b = document.createElement('div');
        b.className = 'pick-no';
        b.textContent = idx + 1;
        b.style.transform = 'scale(' + (1 / S.cam.k) + ')';
        b.style.transformOrigin = '0 0';
        el.appendChild(b);
      }
    } else {
      el.classList.remove('picked');
      if (badge) badge.remove();
    }
  });
  $('#select-count').textContent = S.picked.length + ' まい';
  $('#btn-compare-go').disabled = S.picked.length < 2;
}

/* ========================== くらべる ===================================== */
async function openCompare(ids) {
  const stage = $('#compare-stage');
  stage.innerHTML = '';
  stage.className = S.cmpLayout + (S.cmpFill ? ' fill' : '');
  if (S.cmpLayout === 'grid') {
    stage.style.gridTemplateColumns = ids.length <= 4 ? '1fr 1fr' : '1fr 1fr 1fr';
  } else stage.style.gridTemplateColumns = '';

  for (const id of ids) {
    const it = S.items.find(i => i.id === id);
    if (!it) continue;
    const rec = await dbGet('images', it.imageId);
    const cell = document.createElement('div');
    cell.className = 'cmp-cell';
    const im = document.createElement('img');
    if (rec) im.src = blobURL(rec.id, 'f', rec.full);
    cell.appendChild(im);
    if (it.note) {
      const n = document.createElement('div'); n.className = 'cell-note'; n.textContent = it.note;
      cell.appendChild(n);
    }
    attachCellZoom(cell, im);
    stage.appendChild(cell);
  }
  $$('#cmp-layouts .lay').forEach(b => b.classList.toggle('on', b.dataset.lay === S.cmpLayout));
  $('#cmp-fill').classList.toggle('on', S.cmpFill);
  $('#compare').hidden = false;
}

/* セルごとに独立したピンチズーム */
function attachCellZoom(cell, img) {
  const st = { x: 0, y: 0, k: 1 };
  const pts = new Map();
  let g = null;
  const apply = () => { img.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.k + ')'; };
  cell.addEventListener('pointerdown', (e) => {
    cell.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      g = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s0: { ...st } };
    } else if (pts.size === 1) {
      g = { mode: 'pan', s0: { ...st }, sx: e.clientX, sy: e.clientY, t: Date.now(), moved: false };
    }
  });
  cell.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.mode === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clamp(g.s0.k * (d / (g.d0 || 1)), 1, 8);
      const r = cell.getBoundingClientRect();
      const cx = g.c0.x - r.left, cy = g.c0.y - r.top;
      const wx = (cx - g.s0.x) / g.s0.k, wy = (cy - g.s0.y) / g.s0.k;
      st.k = k; st.x = (c.x - r.left) - wx * k; st.y = (c.y - r.top) - wy * k;
      apply();
    } else if (g.mode === 'pan' && st.k > 1) {
      g.moved = true;
      st.x = g.s0.x + (e.clientX - g.sx);
      st.y = g.s0.y + (e.clientY - g.sy);
      apply();
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      if (g && g.mode === 'pan' && !g.moved && Date.now() - g.t < 300) {
        // タップで等倍に戻す
        if (st.k > 1) { st.x = 0; st.y = 0; st.k = 1; apply(); }
      }
      g = null;
    }
  };
  cell.addEventListener('pointerup', up);
  cell.addEventListener('pointercancel', up);
}

function closeCompare() { $('#compare').hidden = true; $('#compare-stage').innerHTML = ''; }

/* ========================== 1枚を全画面 ================================== */
let viewerBlob = null, viewerName = '';
async function openViewer(it) {
  const rec = await dbGet('images', it.imageId);
  if (!rec) return toast('画像が見つかりません');
  viewerBlob = rec.full; viewerName = (it.note || 'image') + '.' + (rec.full.type.split('/')[1] || 'jpg');
  $('#viewer-img').src = blobURL(rec.id, 'f', rec.full);
  const bits = [rec.w + '×' + rec.h, fmtBytes(rec.full.size)];
  if (rec.srcUrl) bits.push(new URL(rec.srcUrl).hostname);
  $('#viewer-meta').textContent = bits.join('  ·  ');
  $('#viewer').hidden = false;
}

/* ========================== ボードへ入れる =============================== */
const BASE_W = 260;   // 置いたときの標準の幅

/* 新しく入れる画像の置き場所を決める（既存には触らない） */
function nextSpot(index, total) {
  const b = boardBounds();
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(total))));
  const gap = 22;
  const startX = b ? b.x1 : viewCenterCanvas().x - (cols * (BASE_W + gap)) / 2;
  const startY = b ? b.y2 + gap * 2 : viewCenterCanvas().y - 120;
  return {
    x: startX + (index % cols) * (BASE_W + gap),
    y: startY + Math.floor(index / cols) * (BASE_W * 0.82 + gap),
  };
}

/* 画像レコード＋配置を作ってボードに足す */
async function addImageToBoard(rec, spot) {
  const ratio = rec.h / rec.w;
  const it = {
    id: uid(),
    boardId: S.boardId,
    imageId: rec.id,
    x: Math.round(spot.x),
    y: Math.round(spot.y),
    w: BASE_W,
    h: Math.round(BASE_W * ratio),
    z: Math.max(0, ...S.items.map(i => i.z || 0)) + 1,
    note: '',
    addedAt: nowISO(),
  };
  await dbPut('items', it);
  S.items.push(it);
  S.imgs.set(rec.id, rec);
  canvas.appendChild(makeItemEl(it));
  return it;
}

/* 既に同じ画像を持っていれば使い回す（Pinterestは重複が多い） */
let _srcIndex = null;
async function findBySrc(url) {
  if (!_srcIndex) {
    _srcIndex = new Map();
    (await dbAll('images')).forEach(r => { if (r.srcUrl) _srcIndex.set(r.srcUrl, r); });
  }
  return _srcIndex.get(url) || null;
}

async function storeImage(blob, srcUrl) {
  const p = await processImage(blob);
  const rec = {
    id: uid(),
    full: p.full,
    thumb: p.thumb,
    w: p.w,
    h: p.h,
    srcUrl: srcUrl || '',
    addedAt: nowISO(),
  };
  await dbPut('images', rec);
  if (srcUrl && _srcIndex) _srcIndex.set(srcUrl, rec);
  return rec;
}

/* ---------- 端末の写真から ---------- */
async function importFiles(files) {
  const list = Array.from(files).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif|heic)$/i.test(f.name));
  if (!list.length) return toast('画像が見つかりませんでした');
  progOpen('写真を取り込んでいます');
  let ok = 0, ng = 0, heic = 0;
  const before = S.items.length;
  for (let i = 0; i < list.length; i++) {
    if (progCancelled) break;
    progSet(i, list.length, (i + 1) + ' / ' + list.length + ' 枚目');
    try {
      const rec = await storeImage(list[i], '');
      await addImageToBoard(rec, nextSpot(before + ok, list.length));
      ok++;
    } catch (e) { ng++; if (e.heic) heic++; }
    if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));   // 画面を固まらせない
  }
  progClose();
  await touchBoard();
  $('#board-empty').hidden = S.items.length > 0;
  fitAll();
  ensureColors(false).then(() => renderPalette());
  let msg = ok + ' 枚いれました';
  if (heic) {
    msg += '<br>' + heic + ' 枚はHEIC形式で、このブラウザでは開けませんでした。'
        + '<br>iPhoneの 設定 → カメラ → フォーマット を「互換性優先」にすると、'
        + 'これから撮る写真はJPEGになります';
  }
  if (ng - heic > 0) msg += '<br>' + (ng - heic) + ' 枚は読めない形式でした';
  toast(msg, (ng ? 7000 : 2400));
}

/* ---------- URLから（Pinterestもここ） ---------- */
async function importUrls(text) {
  const urls = [...new Set(
    text.split(/[\s,]+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s))
  )];
  if (!urls.length) return toast('URLが見つかりませんでした');

  progOpen('取り込んでいます');
  let ok = 0, dup = 0, ng = 0;
  const failed = [];
  const before = S.items.length;

  for (let i = 0; i < urls.length; i++) {
    if (progCancelled) break;
    progSet(i, urls.length,
      (i + 1) + ' / ' + urls.length + '<br>保存 ' + ok + ' ・ 重複 ' + dup + ' ・ 失敗 ' + ng);
    const url = urls[i];
    try {
      const hit = await findBySrc(url);
      if (hit) {
        if (!S.items.some(it => it.imageId === hit.id)) {
          await addImageToBoard(hit, nextSpot(before + ok + dup, urls.length));
        }
        dup++;
        continue;
      }
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') && blob.size < 200) throw new Error('画像ではない');
      const rec = await storeImage(blob, url);
      await addImageToBoard(rec, nextSpot(before + ok + dup, urls.length));
      ok++;
    } catch (e) {
      ng++;
      failed.push(url);
    }
    if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
  }
  progClose();
  await touchBoard();
  $('#board-empty').hidden = S.items.length > 0;
  fitAll();

  let msg = ok + ' 枚を保存しました';
  if (dup) msg += '<br>' + dup + ' 枚は取り込み済みでした';
  if (ng) {
    const pin = failed.filter(u => /pinimg\.com/.test(u)).length;
    msg += '<br>' + ng + ' 枚は取得できませんでした';
    if (pin) msg += '<br>うち ' + pin + ' 枚はPinterestの画像です。<br>「Pinterestからまとめて」をお使いください';
  }
  toast(msg, ng ? 6000 : 4200);
  if (failed.length) {
    lastFailed = failed;
    console.warn('取得できなかったURL:', failed);
  }
}
let lastFailed = [];

/* ---------- Pinterest 収集スニペット ---------- */
/* 中身は pin-grab.js。長いのでアプリ本体には埋め込まず、必要なときに読む */
let PIN_SNIPPET = '';
async function loadPinSnippet() {
  if (PIN_SNIPPET) return PIN_SNIPPET;
  const res = await fetch('pin-grab.js');
  if (!res.ok) throw new Error('コードが読めませんでした');
  PIN_SNIPPET = await res.text();
  return PIN_SNIPPET;
}

/* ========================== ならべる（石積み） =========================== */
async function arrangeMasonry() {
  if (!S.items.length) return;
  const n = S.items.length;
  const colW = BASE_W, gap = 20;
  // 並べ終わった形が画面の縦横比に近くなる列数を選ぶ
  const wrapEl = $('#canvas-wrap');
  const screenRatio = wrapEl.clientWidth / Math.max(1, wrapEl.clientHeight);
  const avgH = S.items.reduce((a, i) => a + (i.h / i.w) * colW, 0) / n;
  const ideal = Math.sqrt(screenRatio * n * (avgH + gap) / (colW + gap));
  const cols = clamp(Math.round(ideal), 1, 8);
  const heights = new Array(cols).fill(0);
  const order = [...S.items].sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
  for (const it of order) {
    const c = heights.indexOf(Math.min(...heights));
    const ratio = it.h / it.w;
    it.w = colW;
    it.h = Math.round(colW * ratio);
    it.x = c * (colW + gap);
    it.y = heights[c];
    heights[c] += it.h + gap;
    updateItemEl(it);
  }
  await dbPutMany('items', S.items);
  touchBoard();
  fitAll();
  revealItems();
  toast('ならべました');
}

/* ========================== ZIP（無圧縮・自前） ========================== */
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const te = new TextEncoder();

async function makeZip(entries) {   // entries: [{name, data:Uint8Array}]
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const en of entries) {
    const nameB = te.encode(en.name);
    const crc = crc32(en.data);
    const size = en.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameB, en.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, nameB.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + size;
  }
  const cdStart = offset;
  let cdSize = 0;
  central.forEach(c => cdSize += c.length);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, cdStart, true);
  eo.setUint16(20, 0, true);
  return new Blob([...chunks, ...central, new Uint8Array(eo.buffer)], { type: 'application/zip' });
}

async function readZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIPとして読めません');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(lho + 26, true);
    const lelen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lelen;
    let data = buf.subarray(start, start + csize);
    if (method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([data]).stream().pipeThrough(ds);
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (method !== 0) {
      p += 46 + nlen + elen + clen; continue;
    }
    out.push({ name, data });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

function saveBlob(blob, filename) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(u); }, 4000);
}

/* ---------- まるごと書き出し ---------- */
async function exportAll() {
  progOpen('書き出しています');
  try {
    const boards = await dbAll('boards');
    const items = await dbAll('items');
    const images = await dbAll('images');
    const entries = [];
    const imgMeta = [];
    for (let i = 0; i < images.length; i++) {
      if (progCancelled) { progClose(); return; }
      progSet(i, images.length, (i + 1) + ' / ' + images.length + ' 枚を書き出し中');
      const r = images[i];
      const ext = (r.full.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const name = 'images/' + r.id + '.' + ext;
      entries.push({ name, data: new Uint8Array(await r.full.arrayBuffer()) });
      imgMeta.push({ id: r.id, w: r.w, h: r.h, srcUrl: r.srcUrl, addedAt: r.addedAt, file: name, type: r.full.type });
      if (i % 5 === 4) await new Promise(res => setTimeout(res, 0));
    }
    const meta = { app: 'MOOD BOARD', version: 1, exportedAt: nowISO(), boards, items, images: imgMeta };
    entries.unshift({ name: 'moodboard.json', data: te.encode(JSON.stringify(meta, null, 1)) });
    progSet(1, 1, 'ZIPにまとめています');
    const zip = await makeZip(entries);
    progClose();
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    saveBlob(zip, 'moodboard-' + stamp + '.zip');
    toast('書き出しました（' + fmtBytes(zip.size) + '）<br>ここから他の端末に復元できます', 4200);
  } catch (e) {
    progClose();
    toast('書き出しに失敗しました<br>' + e.message);
  }
}

/* ---------- ZIPから読み込み ---------- */
async function importZip(file) {
  progOpen('読み込んでいます');
  try {
    const files = await readZip(file);
    const metaFile = files.find(f => f.name === 'moodboard.json');
    if (!metaFile) throw new Error('MOOD BOARDのZIPではないようです');
    const meta = JSON.parse(new TextDecoder().decode(metaFile.data));
    const byName = new Map(files.map(f => [f.name, f]));

    // 既存とIDがぶつからないよう、すべて振り直す
    const imgMap = new Map(), boardMap = new Map();
    const imgs = meta.images || [];
    for (let i = 0; i < imgs.length; i++) {
      if (progCancelled) break;
      progSet(i, imgs.length, (i + 1) + ' / ' + imgs.length + ' 枚を復元中');
      const m = imgs[i];
      const f = byName.get(m.file);
      if (!f) continue;
      const blob = new Blob([f.data], { type: m.type || 'image/jpeg' });
      let thumb = blob;
      try {
        const bmp = await createImageBitmap(blob);
        thumb = await drawTo(bmp, THUMB_EDGE, pickType(), THUMB_Q);
        bmp.close && bmp.close();
      } catch (e) { /* サムネは作れなくても本体があればよい */ }
      const nid = uid();
      imgMap.set(m.id, nid);
      await dbPut('images', { id: nid, full: blob, thumb, w: m.w, h: m.h, srcUrl: m.srcUrl || '', addedAt: m.addedAt || nowISO() });
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }
    for (const b of (meta.boards || [])) {
      const nid = uid();
      boardMap.set(b.id, nid);
      await dbPut('boards', { ...b, id: nid, name: b.name, updatedAt: nowISO() });
    }
    const newItems = [];
    for (const it of (meta.items || [])) {
      const bid = boardMap.get(it.boardId), iid = imgMap.get(it.imageId);
      if (!bid || !iid) continue;
      newItems.push({ ...it, id: uid(), boardId: bid, imageId: iid });
    }
    if (newItems.length) await dbPutMany('items', newItems);
    _srcIndex = null;
    progClose();
    toast((meta.boards || []).length + ' 個のボード、' + imgMap.size + ' 枚の写真を読み込みました', 4200);
    goHome();
  } catch (e) {
    progClose();
    toast('読み込めませんでした<br>' + e.message, 4000);
  }
}

/* ========================== シート ======================================= */
function openSheet(id) {
  closeSheets();
  $('#scrim').hidden = false;
  $(id).hidden = false;
}
function closeSheets() {
  $('#scrim').hidden = true;
  $$('.sheet').forEach(s => s.hidden = true);
}
$('#scrim').addEventListener('click', closeSheets);

/* ========================== 配線 ========================================= */
$('#btn-back').onclick = () => {
  if (S.picking) return stopPicking();
  if (S.sel) return selectItem(null);
  goHome();
};
$('#btn-menu').onclick = () => {
  const est = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({});
  est.then(e => {
    let t = 'この端末の中に保存されています';
    if (e.usage) t += '<br>使用中 ' + fmtBytes(e.usage);
    t += '<br>MOOD BOARD v1';
    $('#menu-foot').innerHTML = t;
  });
  openSheet('#sheet-menu');
};
$('#btn-new-board').onclick = newBoard;

$('#btn-add').onclick = () => openSheet('#sheet-add');
$('#add-photos').onclick = () => { closeSheets(); $('#file-input').click(); };
$('#add-url').onclick = () => openSheet('#sheet-url');
$('#add-pin').onclick = async () => {
  openSheet('#sheet-pin');
  try { $('#pin-snippet').textContent = await loadPinSnippet(); }
  catch (e) { $('#pin-snippet').textContent = '（コードを読み込めませんでした）'; }
};

$('#file-input').onchange = (e) => {
  const f = e.target.files;
  if (f && f.length) importFiles(f);
  e.target.value = '';
};

$('#url-cancel').onclick = closeSheets;
$('#url-go').onclick = () => {
  const t = $('#url-input').value;
  closeSheets();
  $('#url-input').value = '';
  importUrls(t);
};
$('#pin-close').onclick = closeSheets;
$('#pin-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(await loadPinSnippet());
    toast('コピーしました<br>Chromeの Console に貼り付けてください');
  } catch (e) {
    const r = document.createRange();
    r.selectNodeContents($('#pin-snippet'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    toast('選択しました。長押しでコピーしてください');
  }
};

$('#btn-select').onclick = () => { S.picking ? stopPicking() : startPicking(); };
$('#btn-select-cancel').onclick = stopPicking;
$('#btn-compare-go').onclick = () => openCompare(S.picked);
$('#btn-arrange').onclick = () => {
  renderPaletteBig();
  openSheet('#sheet-arrange');
};
$('#arr-masonry').onclick = () => { closeSheets(); arrangeMasonry(); };
$('#arr-color').onclick = () => { closeSheets(); arrangeByColor(); };

/* 並べかたシートの中の大きいパレット */
function renderPaletteBig() {
  const wrapEl = $('#palette-big-wrap'), box = $('#palette-big');
  const pal = boardPalette(6);
  box.innerHTML = '';
  if (pal.length < 2) { wrapEl.hidden = true; return; }
  pal.forEach(p => {
    const s2 = document.createElement('div');
    s2.className = 'sw';
    s2.style.background = p.hex;
    s2.textContent = p.hex.toUpperCase();
    s2.onclick = async () => {
      try { await navigator.clipboard.writeText(p.hex); toast(p.hex + ' をコピーしました'); }
      catch (e) { toast(p.hex); }
    };
    box.appendChild(s2);
  });
  wrapEl.hidden = false;
}
$('#btn-fit').onclick = () => fitAll();

/* --- 1枚を選んでいるときの操作 --- */
function selItem() { return S.items.find(i => i.id === S.sel); }
$('#btn-item-front').onclick = async () => {
  const it = selItem(); if (!it) return;
  it.z = Math.max(0, ...S.items.map(i => i.z || 0)) + 1;
  const el = itemEl(it.id); if (el) canvas.appendChild(el);
  await dbPut('items', it);
  S.items.sort((a, b) => (a.z || 0) - (b.z || 0));
  touchBoard();
};
$('#btn-item-big').onclick = async () => {
  const it = selItem(); if (!it) return;
  const f = it.w < 500 ? 1.5 : (it.w < 900 ? 1.35 : 0.5);
  it.w = Math.round(it.w * f); it.h = Math.round(it.h * f);
  updateItemEl(it); positionHandle();
  await dbPut('items', it); touchBoard();
};
$('#btn-item-note').onclick = async () => {
  const it = selItem(); if (!it) return;
  const v = await ask('メモ（空にすると消えます）', it.note || '');
  if (v === null) return;
  it.note = v;
  await dbPut('items', it);
  const el = itemEl(it.id);
  if (el) {
    const old = el.querySelector('.note-tag'); if (old) old.remove();
    if (v) { const n = document.createElement('div'); n.className = 'note-tag'; n.textContent = v; el.appendChild(n); }
  }
  touchBoard();
};
$('#btn-item-move').onclick = openMoveSheet;
$('#mv-cancel').onclick = closeSheets;
$$('#mv-mode .chip').forEach(b => b.onclick = () => {
  mvMode = b.dataset.v;
  $$('#mv-mode .chip').forEach(x => x.classList.toggle('on', x === b));
});
$('#mv-here').onclick = async () => {
  const it = selItem(); if (!it) return;
  closeSheets();
  const copy = { ...it, id: uid(), x: it.x + 24, y: it.y + 24, z: Math.max(0, ...S.items.map(i => i.z || 0)) + 1 };
  delete copy.trashedAt;
  await dbPut('items', copy);
  S.items.push(copy);
  canvas.appendChild(makeItemEl(copy));
  selectItem(copy.id);
  touchBoard();
  toast('複製しました');
};
$('#btn-item-remove').onclick = async () => {
  const it = selItem(); if (!it) return;
  it.trashedAt = nowISO();
  await dbPut('items', it);          // 消さずにゴミ箱へ入れる
  S.items = S.items.filter(i => i.id !== it.id);
  const el = itemEl(it.id); if (el) el.remove();
  selectItem(null);
  $('#board-empty').hidden = S.items.length > 0;
  touchBoard();
  renderPalette();
  toast('ゴミ箱に入れました<br>メニューからいつでも戻せます');
};

/* --- くらべる画面 --- */
$('#cmp-close').onclick = closeCompare;
$$('#cmp-layouts .lay').forEach(b => {
  b.onclick = () => { S.cmpLayout = b.dataset.lay; openCompare(S.picked); };
});
$('#cmp-fill').onclick = () => { S.cmpFill = !S.cmpFill; openCompare(S.picked); };

/* --- 1枚表示 --- */
$('#viewer-close').onclick = () => { $('#viewer').hidden = true; };
$('#viewer-save').onclick = () => {
  if (!viewerBlob) return;
  saveBlob(viewerBlob, viewerName.replace(/[\/\\:*?"<>|]/g, '_'));
  toast('保存しました');
};

/* --- メニュー --- */
$('#menu-export').onclick = () => { closeSheets(); exportAll(); };
$('#menu-png').onclick = () => {
  if (S.view !== 'board') { closeSheets(); return toast('先にボードを開いてください'); }
  closeSheets(); exportBoardPNG();
};
$('#menu-trash').onclick = () => { closeSheets(); openTrash(); };
$('#trash-close').onclick = closeSheets;
$('#trash-restore-all').onclick = restoreAllTrash;
$('#menu-import').onclick = () => { closeSheets(); $('#zip-input').click(); };
$('#zip-input').onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) importZip(f);
  e.target.value = '';
};
$('#menu-rename').onclick = async () => {
  closeSheets();
  if (!S.board) return;
  const v = await ask('ボードの名前', S.board.name);
  if (v === null || !v) return;
  S.board.name = v;
  await dbPut('boards', S.board);
  $('#app-title').textContent = v;
  toast('名前を変えました');
};
$('#menu-delete-board').onclick = async () => {
  closeSheets();
  if (!S.board) return;
  const ok = await confirmAsk('「' + S.board.name + '」を削除します。写真そのものは端末に残ります。');
  if (!ok) return;
  for (const it of S.items) await dbDel('items', it.id);
  await dbDel('boards', S.board.id);
  toast('削除しました');
  goHome();
};

/* --- キーボード（PC） --- */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') {
    if (!$('#viewer').hidden) return void ($('#viewer').hidden = true);
    if (!$('#compare').hidden) return closeCompare();
    if (!$('#scrim').hidden) return closeSheets();
    if (S.picking) return stopPicking();
    if (S.sel) return selectItem(null);
    if (S.view === 'board') return goHome();
  }
  if (S.view !== 'board') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); $('#btn-item-remove').click(); }
  if (e.key === 'f' || e.key === 'F') fitAll();
  if (e.key === 'a' || e.key === 'A') arrangeMasonry();
});

/* --- PCからのドラッグ&ドロップ --- */
['dragover', 'drop'].forEach(t => document.addEventListener(t, e => e.preventDefault()));
document.addEventListener('drop', (e) => {
  if (S.view !== 'board') return toast('先にボードを開いてください');
  const dt = e.dataTransfer;
  if (dt.files && dt.files.length) return importFiles(dt.files);
  const url = dt.getData('text/uri-list') || dt.getData('text/plain');
  if (url) importUrls(url);
});

/* ========================== 起動 ========================================= */
window.addEventListener('resize', () => { if (S.view === 'board') positionHandle(); });

(async function init() {
  try {
    await openDB();
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;font-size:14px;line-height:2">' +
      'この端末では保存領域が使えませんでした。<br>プライベートブラウズをオフにしてお試しください。</div>';
    return;
  }
  // 「消えない」を成立させるために、ブラウザに永続保存を申請する
  if (navigator.storage && navigator.storage.persist) {
    try {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    } catch (e) { /* 失敗しても動作はする */ }
  }
  await renderHome();
  // 開発中(localhost)は登録しない。古いキャッシュを掴んで混乱するため
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  if ('serviceWorker' in navigator && !isLocal) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();

/* ==========================================================================
   USBに書き出す
   USBに入れてパソコンに挿し、index.html を開けばそのまま広がって見られる形。
   file:// では fetch が使えないので、データは data.js に埋め込む。
   ========================================================================== */

const VIEWER_FILES = ['viewer/index.html', 'viewer/viewer.css', 'viewer/viewer.js'];

async function buildViewerPayload(onProgress) {
  // ビューア本体を読む（同一オリジンなので取得できる）
  const shell = {};
  for (const f of VIEWER_FILES) {
    const res = await fetch(f + '?t=' + Date.now());
    if (!res.ok) throw new Error(f + ' が読めません');
    shell[f.split('/').pop()] = await res.text();
  }

  const boards = await dbAll('boards');
  const items = await dbAll('items');
  const images = await dbAll('images');
  const used = new Set(items.map(i => i.imageId));

  const files = [];       // {name, data:Uint8Array}
  const imgMeta = {};
  const targets = images.filter(r => used.has(r.id));

  // ビューアでも色順に並べられるよう、色が未計算のものはここで用意する
  for (const r of targets) {
    if (r.dom) continue;
    try {
      const col = await extractColors(r.thumb || r.full);
      r.dom = col.dom; r.hex = col.hex; r.pal = col.pal;
      await dbPut('images', r);
    } catch (e) { r.dom = { h: 0, s: 0, l: 0.5 }; r.hex = '#808080'; }
  }
  for (let i = 0; i < targets.length; i++) {
    if (progCancelled) throw new Error('中止しました');
    onProgress && onProgress(i, targets.length);
    const r = targets[i];
    const ext = (r.full.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const name = 'images/' + r.id + '.' + ext;
    files.push({ name, data: new Uint8Array(await r.full.arrayBuffer()) });
    imgMeta[r.id] = {
      file: name, w: r.w, h: r.h, srcUrl: r.srcUrl || '',
      hex: r.hex || '#808080',
      // h は画像の高さで使っているので、色相は hue にする（衝突させない）
      hue: r.dom ? Math.round(r.dom.h) : 0,
      sat: r.dom ? +r.dom.s.toFixed(3) : 0,
      lum: r.dom ? +r.dom.l.toFixed(3) : 0.5,
    };
    if (i % 5 === 4) await new Promise(res => setTimeout(res, 0));
  }

  const data = {
    app: 'MOOD BOARD',
    version: 1,
    exportedAt: nowISO(),
    boards: boards.map(b => ({ id: b.id, name: b.name })),
    items: items.filter(i => imgMeta[i.imageId]).map(i => ({
      id: i.id, boardId: i.boardId, imageId: i.imageId,
      x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h),
      z: i.z || 0, note: i.note || '',
    })),
    images: imgMeta,
  };

  const readme = [
    'MOOD BOARD',
    '',
    'このフォルダをUSBに入れて、パソコンに挿してください。',
    'index.html をダブルクリックすると、写真が広がって表示されます。',
    '（インターネットにつながっていなくても動きます）',
    '',
    '操作',
    '  ドラッグ          動かす',
    '  ホイール          拡大・縮小',
    '  クリック          選ぶ（複数えらべます）',
    '  ダブルクリック    1枚を大きく',
    '  F                 全体を表示',
    '  A                 並べ直す',
    '  C                 選んだものを見くらべる',
    '  P                 印刷',
    '  Tab               ボードの切り替え',
    '  Esc               もどる',
    '',
    '書き出し日: ' + new Date().toLocaleString('ja-JP'),
    '写真: ' + targets.length + ' 枚 / ボード: ' + boards.length + ' 個',
  ].join('\n');

  files.unshift(
    { name: 'index.html', data: te.encode(shell['index.html']) },
    { name: 'viewer.css', data: te.encode(shell['viewer.css']) },
    { name: 'viewer.js', data: te.encode(shell['viewer.js']) },
    { name: 'data.js', data: te.encode('const MB_DATA = ' + JSON.stringify(data) + ';\n') },
    { name: 'README.txt', data: te.encode(readme) },
  );
  return { files, count: targets.length, boards: boards.length };
}

async function exportUSB() {
  const canDirect = typeof window.showDirectoryPicker === 'function';

  // フォルダに直接書けるなら、解凍いらずでUSBにそのまま置く
  if (canDirect) {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'desktop' });
    } catch (e) {
      return;   // 選ばずに閉じただけ
    }
    progOpen('USBに書き出しています');
    try {
      const { files, count, boards } = await buildViewerPayload((i, n) =>
        progSet(i, n, (i + 1) + ' / ' + n + ' 枚を書き出し中'));
      const root = await dir.getDirectoryHandle('MOOD BOARD', { create: true });
      const imgDir = await root.getDirectoryHandle('images', { create: true });
      for (let i = 0; i < files.length; i++) {
        progSet(i, files.length, '書き込み中  ' + (i + 1) + ' / ' + files.length);
        const f = files[i];
        const isImg = f.name.startsWith('images/');
        const handle = await (isImg ? imgDir : root)
          .getFileHandle(isImg ? f.name.slice(7) : f.name, { create: true });
        const w = await handle.createWritable();
        await w.write(f.data);
        await w.close();
        if (i % 8 === 7) await new Promise(r => setTimeout(r, 0));
      }
      progClose();
      toast('「MOOD BOARD」フォルダに書き出しました<br>' +
        count + ' 枚 / ' + boards + ' ボード<br>index.html を開いてください', 6000);
    } catch (e) {
      progClose();
      toast('書き出せませんでした<br>' + e.message, 4000);
    }
    return;
  }

  // それ以外はZIPで。パソコンで解凍してUSBに入れる
  progOpen('書き出しています');
  try {
    const { files, count, boards } = await buildViewerPayload((i, n) =>
      progSet(i, n, (i + 1) + ' / ' + n + ' 枚を書き出し中'));
    progSet(1, 1, 'ZIPにまとめています');
    const zip = await makeZip(files);
    progClose();
    saveBlob(zip, 'MOOD-BOARD-USB.zip');
    toast('書き出しました（' + fmtBytes(zip.size) + '）<br>' +
      'パソコンで解凍してUSBに入れ、index.html を開いてください', 6000);
  } catch (e) {
    progClose();
    toast('書き出せませんでした<br>' + e.message, 4000);
  }
}

$('#menu-usb').onclick = () => { closeSheets(); exportUSB(); };

/* ==========================================================================
   印刷
   ボードのまま / 格子 / 1枚ずつ の3通り。A4 たて・よこ。
   ========================================================================== */
const PAPER = {
  a4p: { w: 210, h: 297, orient: 'portrait', cols: 3 },
  a4l: { w: 297, h: 210, orient: 'landscape', cols: 4 },
};
const PMARGIN = 10;
const PRINT = { mode: 'board', paper: 'a4p', scope: 'all', note: 'on' };

function setPageStyle(paper) {
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
  st.textContent = '@page{size:A4 ' + PAPER[paper].orient + ';margin:' + PMARGIN + 'mm}';
}

function printHead(title, sub) {
  const h = document.createElement('div');
  h.className = 'sheet-head';
  const t = document.createElement('h3'); t.textContent = title;
  const right = document.createElement('div');
  right.className = 'head-right';
  const pal = boardPalette(6);
  if (pal.length > 1) {
    const box = document.createElement('div');
    box.className = 'pal';
    pal.forEach(p => {
      const i = document.createElement('i');
      i.style.background = p.hex;
      box.appendChild(i);
    });
    right.appendChild(box);
  }
  const s = document.createElement('span'); s.textContent = sub;
  right.appendChild(s);
  h.append(t, right);
  return h;
}

function printSrcOf(it) {
  const rec = S.imgs.get(it.imageId);
  return rec ? blobURL(rec.id, 'f', rec.full) : '';
}

function buildPrint() {
  const P = PAPER[PRINT.paper];
  const availW = P.w - PMARGIN * 2;
  const availH = P.h - PMARGIN * 2;
  const headH = 12;
  const withNote = PRINT.note === 'on';
  const bname = S.board ? S.board.name : 'MOOD BOARD';
  const stamp = new Date().toLocaleDateString('ja-JP');
  const items = (PRINT.scope === 'picked' && S.picked.length)
    ? S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean)
    : S.items;
  const paper = $('#paper');
  paper.innerHTML = '';
  setPageStyle(PRINT.paper);
  if (!items.length) return 0;

  if (PRINT.mode === 'board') {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    items.forEach(it => {
      x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
      x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
    });
    const bw = x2 - x1, bh = y2 - y1;
    const bodyH = availH - headH;
    const sc = Math.min(availW / bw, bodyH / bh);
    const offX = (availW - bw * sc) / 2, offY = (bodyH - bh * sc) / 2;
    const sheet = document.createElement('div');
    sheet.className = 'sheet-p';
    sheet.appendChild(printHead(bname, items.length + ' photos   ' + stamp));
    const holder = document.createElement('div');
    holder.className = 'p-board';
    holder.style.height = bodyH + 'mm';
    items.forEach(it => {
      const d = document.createElement('div');
      d.className = 'pi';
      d.style.left = (offX + (it.x - x1) * sc) + 'mm';
      d.style.top = (offY + (it.y - y1) * sc) + 'mm';
      d.style.width = (it.w * sc) + 'mm';
      d.style.height = (it.h * sc) + 'mm';
      const g = document.createElement('img'); g.src = printSrcOf(it);
      d.appendChild(g);
      holder.appendChild(d);
    });
    sheet.appendChild(holder);
    paper.appendChild(sheet);
    return 1;
  }

  if (PRINT.mode === 'one') {
    items.forEach((it, n) => {
      const sheet = document.createElement('div');
      sheet.className = 'sheet-p';
      sheet.appendChild(printHead(bname, (n + 1) + ' / ' + items.length));
      const d = document.createElement('div');
      d.className = 'p-one';
      const g = document.createElement('img'); g.src = printSrcOf(it);
      d.appendChild(g);
      if (withNote && it.note) {
        const c = document.createElement('div'); c.className = 'pcap'; c.textContent = it.note;
        d.appendChild(c);
      }
      sheet.appendChild(d);
      paper.appendChild(sheet);
    });
    return items.length;
  }

  const cols = P.cols, gap = 4;
  const cellW = (availW - gap * (cols - 1)) / cols;
  const rows = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  let sheet = null, holder = null, used = 0, page = 0;
  const newSheet = () => {
    page++;
    sheet = document.createElement('div');
    sheet.className = 'sheet-p';
    sheet.appendChild(printHead(bname, items.length + ' photos   ' + stamp));
    holder = document.createElement('div');
    holder.className = 'p-grid';
    holder.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
    sheet.appendChild(holder);
    paper.appendChild(sheet);
    used = headH;
  };
  newSheet();
  for (const row of rows) {
    let rh = 0;
    row.forEach(it => { rh = Math.max(rh, cellW * (it.h / it.w)); });
    if (withNote && row.some(i => i.note)) rh += 6;
    rh += gap;
    if (used + rh > availH && used > headH) newSheet();
    used += rh;
    row.forEach(it => {
      const d = document.createElement('div');
      d.className = 'pi';
      const g = document.createElement('img'); g.src = printSrcOf(it);
      d.appendChild(g);
      if (withNote && it.note) {
        const c = document.createElement('div'); c.className = 'pcap'; c.textContent = it.note;
        d.appendChild(c);
      }
      holder.appendChild(d);
    });
  }
  return page;
}

function doPrint() {
  const pages = buildPrint();
  if (!pages) return toast('印刷するものがありません');
  const imgs = Array.from($('#paper').querySelectorAll('img'));
  const ready = imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; }));
  Promise.all(ready).then(() => setTimeout(() => window.print(), 80));
}

/* ボードが横長なら A4よこ を先に出す（ユーザーが選び直したら以後は尊重する） */
let paperTouched = false;
function suggestPaper() {
  if (paperTouched) return;
  const items = (PRINT.scope === 'picked' && S.picked.length)
    ? S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean)
    : S.items;
  if (!items.length) return;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  items.forEach(it => {
    x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
    x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
  });
  PRINT.paper = ((x2 - x1) / Math.max(1, y2 - y1)) > 1.15 ? 'a4l' : 'a4p';
}

function syncPrintChips() {
  [['#pc-mode', 'mode'], ['#pc-paper', 'paper'], ['#pc-scope', 'scope'], ['#pc-note', 'note']]
    .forEach(([sel, key]) => {
      $$(sel + ' .chip').forEach(b => b.classList.toggle('on', b.dataset.v === PRINT[key]));
    });
  $$('#pc-scope .chip').forEach(b => {
    if (b.dataset.v === 'picked') {
      b.disabled = S.picked.length === 0;
      if (b.disabled && PRINT.scope === 'picked') { PRINT.scope = 'all'; }
    }
  });
}
[['#pc-mode', 'mode'], ['#pc-paper', 'paper'], ['#pc-scope', 'scope'], ['#pc-note', 'note']]
  .forEach(([sel, key]) => {
    $$(sel + ' .chip').forEach(b => b.onclick = () => {
      PRINT[key] = b.dataset.v;
      if (key === 'paper') paperTouched = true;
      syncPrintChips();
    });
  });

$('#menu-print').onclick = () => {
  if (S.view !== 'board') { closeSheets(); return toast('先にボードを開いてください'); }
  suggestPaper();
  syncPrintChips();
  openSheet('#sheet-print');
};
$('#print-cancel').onclick = closeSheets;
$('#print-go').onclick = () => { closeSheets(); doPrint(); };
window.addEventListener('afterprint', () => { $('#paper').innerHTML = ''; });

/* ==========================================================================
   色
   ムードボードで見ているのは結局「色と質感」なので、代表色で並べ替えられるようにする。
   ========================================================================== */

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
const hex2 = (n) => n.toString(16).padStart(2, '0');
const toHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

/* 画像から代表色とパレットを取り出す */
async function extractColors(blob) {
  const bmp = await createImageBitmap(blob);
  const N = 56;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, N, N);
  bmp.close && bmp.close();
  const d = ctx.getImageData(0, 0, N, N).data;

  // 4bitに落としてヒストグラムを取る
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let e = bins.get(key);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, e); }
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  if (!bins.size) return { dom: { h: 0, s: 0, l: 0.5 }, hex: '#808080', pal: [] };

  const list = [...bins.values()].map(e => {
    const r = Math.round(e.r / e.n), g = Math.round(e.g / e.n), b = Math.round(e.b / e.n);
    const hsl = rgb2hsl(r, g, b);
    // 数の多さだけで選ぶと壁や背景の灰色ばかりになるので、鮮やかさを足して評価する
    const vivid = hsl.s * (1 - Math.abs(hsl.l - 0.55) * 1.3);
    return { r, g, b, ...hsl, n: e.n, score: e.n * (0.3 + Math.max(0, vivid) * 1.9) };
  }).sort((a, b) => b.score - a.score);

  const dom = list[0];

  // パレットは色相が離れたものを選ぶ
  const pal = [];
  for (const c2 of list) {
    if (pal.length >= 5) break;
    const far = pal.every(p => {
      const dh = Math.min(Math.abs(p.h - c2.h), 360 - Math.abs(p.h - c2.h));
      return dh > 28 || Math.abs(p.l - c2.l) > 0.26;
    });
    if (far) pal.push(c2);
  }

  return {
    dom: { h: dom.h, s: dom.s, l: dom.l },
    hex: toHex(dom.r, dom.g, dom.b),
    pal: pal.map(p => toHex(p.r, p.g, p.b)),
  };
}

/* このボードの画像に色情報がなければ用意する */
async function ensureColors(showProgress) {
  const need = [];
  for (const [id, rec] of S.imgs) if (!rec.dom) need.push(rec);
  if (!need.length) return 0;
  if (showProgress) progOpen('色を調べています');
  for (let i = 0; i < need.length; i++) {
    if (progCancelled) break;
    if (showProgress) progSet(i, need.length, (i + 1) + ' / ' + need.length);
    const rec = need[i];
    try {
      const col = await extractColors(rec.thumb || rec.full);
      rec.dom = col.dom; rec.hex = col.hex; rec.pal = col.pal;
      await dbPut('images', rec);
    } catch (e) { rec.dom = { h: 0, s: 0, l: 0.5 }; rec.hex = '#808080'; rec.pal = []; }
    if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
  }
  if (showProgress) progClose();
  return need.length;
}

/* 色順に並べる。無彩色は最後にまとめて明るさ順 */
async function arrangeByColor() {
  if (!S.items.length) return;
  progCancelled = false;
  await ensureColors(true);

  const keyed = S.items.map(it => {
    const rec = S.imgs.get(it.imageId);
    const dom = (rec && rec.dom) || { h: 0, s: 0, l: 0.5 };
    return { it, dom, gray: dom.s < 0.14 };
  });
  const colored = keyed.filter(k => !k.gray).sort((a, b) => a.dom.h - b.dom.h || b.dom.s - a.dom.s);
  const grays = keyed.filter(k => k.gray).sort((a, b) => b.dom.l - a.dom.l);
  const order = [...colored, ...grays].map(k => k.it);

  const colW = BASE_W, gap = 20, n = order.length;
  const wrapEl = $('#canvas-wrap');
  const ratio = wrapEl.clientWidth / Math.max(1, wrapEl.clientHeight);
  const avgH = order.reduce((a, i) => a + (i.h / i.w) * colW, 0) / n;
  const cols = clamp(Math.round(Math.sqrt(ratio * n * (avgH + gap) / (colW + gap))), 1, 8);

  // 色の流れが見えるよう、横に読む順で置く
  let y = 0, rowH = 0;
  order.forEach((it, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) { y += rowH + gap; rowH = 0; }
    const r = it.h / it.w;
    it.w = colW; it.h = Math.round(colW * r);
    it.x = col * (colW + gap);
    it.y = y;
    rowH = Math.max(rowH, it.h);
    updateItemEl(it);          // ここを忘れると見た目が前のまま残る
  });
  await dbPutMany('items', S.items);
  touchBoard();
  fitAll();
  revealItems();
  renderPalette();
  toast('色の順にならべました');
}

/* ボード全体のパレット（画面の隅に小さく出す） */
function boardPalette(max = 6) {
  const counts = new Map();
  for (const it of S.items) {
    const rec = S.imgs.get(it.imageId);
    if (!rec || !rec.dom) continue;
    const gray = rec.dom.s < 0.14;
    const hb = gray ? 'g' + Math.round(rec.dom.l * 5) : 'h' + Math.round(rec.dom.h / 24);
    const e = counts.get(hb);
    if (e) { e.n++; }
    else counts.set(hb, { n: 1, hex: rec.hex, h: rec.dom.h, l: rec.dom.l, gray });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .sort((a, b) => (a.gray === b.gray) ? (a.gray ? b.l - a.l : a.h - b.h) : (a.gray ? 1 : -1));
}

function renderPalette() {
  const box = $('#palette');
  if (!box) return;
  const pal = boardPalette();
  box.innerHTML = '';
  if (pal.length < 2) { box.hidden = true; return; }
  pal.forEach(p => {
    const s = document.createElement('span');
    s.className = 'sw';
    s.style.background = p.hex;
    s.title = p.hex;
    s.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(p.hex); toast(p.hex + ' をコピーしました'); };
    box.appendChild(s);
  });
  box.hidden = false;
}

/* ==========================================================================
   ボードを1枚の画像にする
   印刷までしたくない場面用。LINEやメールでそのまま渡せる。
   ========================================================================== */
async function exportBoardPNG() {
  if (!S.items.length) return toast('写真がありません');
  progOpen('画像を作っています');
  try {
    const b = boardBounds();
    const PAD = 44, HEAD = 86;
    const MAXEDGE = 2600;
    const w0 = b.w + PAD * 2;
    const h0 = b.h + PAD * 2 + HEAD;
    const scale = clamp(MAXEDGE / Math.max(w0, h0), 0.4, 2.2);
    const W = Math.round(w0 * scale), H = Math.round(h0 * scale);

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(0, 0, W, H);

    // 見出し
    ctx.fillStyle = '#ececed';
    ctx.font = '600 ' + Math.round(26 * scale) + 'px -apple-system,"Hiragino Sans",sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(S.board.name, PAD * scale, HEAD * scale * 0.45);
    ctx.fillStyle = '#8b8b93';
    ctx.font = Math.round(15 * scale) + 'px ui-monospace,Menlo,monospace';
    ctx.fillText(S.items.length + ' photos   ' + new Date().toLocaleDateString('ja-JP'),
      PAD * scale, HEAD * scale * 0.78);

    // パレットを右上に
    const pal = boardPalette(6);
    if (pal.length > 1) {
      const sw = 22 * scale, gap = 5 * scale;
      let x = W - PAD * scale - (sw * pal.length + gap * (pal.length - 1));
      pal.forEach(p => {
        ctx.fillStyle = p.hex;
        ctx.fillRect(x, HEAD * scale * 0.34, sw, sw);
        x += sw + gap;
      });
    }

    // 写真（重なり順のまま）
    const ordered = [...S.items].sort((a, z) => (a.z || 0) - (z.z || 0));
    for (let i = 0; i < ordered.length; i++) {
      if (progCancelled) { progClose(); return; }
      progSet(i, ordered.length, (i + 1) + ' / ' + ordered.length);
      const it = ordered[i];
      const rec = S.imgs.get(it.imageId);
      if (!rec) continue;
      const x = (it.x - b.x1 + PAD) * scale;
      const y = (it.y - b.y1 + PAD) * scale + HEAD * scale;
      const w = it.w * scale, h = it.h * scale;
      try {
        const bmp = await createImageBitmap(rec.full);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.55)';
        ctx.shadowBlur = 18 * scale;
        ctx.shadowOffsetY = 6 * scale;
        ctx.drawImage(bmp, x, y, w, h);
        ctx.restore();
        bmp.close && bmp.close();
      } catch (e) { continue; }
      if (it.note) {
        const g = ctx.createLinearGradient(0, y + h - 46 * scale, 0, y + h);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,.85)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y + h - 46 * scale, w, 46 * scale);
        ctx.fillStyle = '#fff';
        ctx.font = Math.round(15 * scale) + 'px -apple-system,"Hiragino Sans",sans-serif';
        ctx.fillText(it.note, x + 9 * scale, y + h - 17 * scale);
      }
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }

    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    progClose();
    saveBlob(blob, (S.board.name || 'moodboard').replace(/[\/\\:*?"<>|]/g, '_') + '.jpg');
    toast('画像にしました（' + W + '×' + H + '・' + fmtBytes(blob.size) + '）', 4200);
  } catch (e) {
    progClose();
    toast('作れませんでした<br>' + e.message);
  }
}

/* ==========================================================================
   ボード間で移す・コピーする
   写真の実体は1つのまま、置き場所だけを増やす。
   ========================================================================== */
let mvMode = 'move';

async function openMoveSheet() {
  const it = selItem();
  if (!it) return;
  mvMode = 'move';
  $$('#mv-mode .chip').forEach(b => b.classList.toggle('on', b.dataset.v === 'move'));

  const boards = (await dbAll('boards')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const allItems = await dbAll('items');
  const box = $('#mv-boards');
  box.innerHTML = '';
  const images = await dbAll('images');
  const imgMap = new Map(images.map(r => [r.id, r]));

  for (const b of boards) {
    const cnt = allItems.filter(i => i.boardId === b.id && !i.trashedAt).length;
    const row = document.createElement('button');
    row.className = 'mv-row' + (b.id === S.boardId ? ' current' : '');
    const cover = allItems.filter(i => i.boardId === b.id && !i.trashedAt).sort((x, y) => (y.z || 0) - (x.z || 0))[0];
    const rec = cover && imgMap.get(cover.imageId);
    const th = document.createElement('img');
    th.className = 'mv-th';
    if (rec) th.src = blobURL(rec.id, 't', rec.thumb || rec.full);
    const meta = document.createElement('div');
    meta.innerHTML = '<div class="mv-nm"></div><div class="mv-ct"></div>';
    meta.querySelector('.mv-nm').textContent = b.name;
    meta.querySelector('.mv-ct').textContent = (b.id === S.boardId ? 'いまのボード' : cnt + ' まい');
    row.append(th, meta);
    if (b.id !== S.boardId) row.onclick = () => moveItemTo(b.id);
    box.appendChild(row);
  }
  if (boards.length < 2) {
    const p = document.createElement('p');
    p.className = 'sheet-note';
    p.textContent = 'ほかにボードがありません。ホームで作ってください。';
    box.appendChild(p);
  }
  openSheet('#sheet-move');
}

async function moveItemTo(boardId) {
  const it = selItem();
  if (!it) return;
  closeSheets();
  if (mvMode === 'copy') {
    const copy = { ...it, id: uid(), boardId, z: Date.now() % 100000, trashedAt: undefined };
    delete copy.trashedAt;
    await dbPut('items', copy);
    toast('コピーしました');
  } else {
    it.boardId = boardId;
    await dbPut('items', it);
    S.items = S.items.filter(i => i.id !== it.id);
    const el = itemEl(it.id); if (el) el.remove();
    selectItem(null);
    $('#board-empty').hidden = S.items.length > 0;
    renderPalette();
    toast('移しました');
  }
  const b = await dbGet('boards', boardId);
  if (b) { b.updatedAt = nowISO(); await dbPut('boards', b); }
  touchBoard();
}

/* ==========================================================================
   ゴミ箱
   「はずす」は消さずにここへ入れる。いつでも戻せる。
   ========================================================================== */
async function openTrash() {
  const all = await dbByIndex('items', 'boardId', S.boardId);
  const trashed = all.filter(i => i.trashedAt).sort((a, b) => (b.trashedAt || '').localeCompare(a.trashedAt || ''));
  const grid = $('#trash-grid');
  grid.innerHTML = '';
  for (const it of trashed) {
    const rec = await dbGet('images', it.imageId);
    const cell = document.createElement('div');
    cell.className = 'tr-cell';
    const im = document.createElement('img');
    if (rec) im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
    const btn = document.createElement('button');
    btn.textContent = 'もどす';
    btn.onclick = () => restoreItem(it.id);
    cell.append(im, btn);
    grid.appendChild(cell);
  }
  $('#trash-empty').hidden = trashed.length > 0;
  $('#trash-restore-all').hidden = trashed.length === 0;
  openSheet('#sheet-trash');
}

async function restoreItem(id) {
  const it = await dbGet('items', id);
  if (!it) return;
  delete it.trashedAt;
  it.z = Math.max(0, ...S.items.map(i => i.z || 0)) + 1;
  await dbPut('items', it);
  S.items.push(it);
  const rec = await dbGet('images', it.imageId);
  if (rec) S.imgs.set(rec.id, rec);
  canvas.appendChild(makeItemEl(it));
  $('#board-empty').hidden = true;
  touchBoard();
  renderPalette();
  openTrash();
  toast('もどしました');
}

async function restoreAllTrash() {
  const all = await dbByIndex('items', 'boardId', S.boardId);
  const trashed = all.filter(i => i.trashedAt);
  for (const it of trashed) {
    delete it.trashedAt;
    await dbPut('items', it);
  }
  closeSheets();
  await openBoard(S.boardId);
  toast(trashed.length + ' 枚もどしました');
}
