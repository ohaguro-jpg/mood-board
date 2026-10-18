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
  mode: 'canvas',          // canvas（置いて考える）/ grid（ざっと眺める）
  filter: { q: '', hue: null },   // さがす（メモ・文字・タグ／色）
};

const TEXT_W = 220, TEXT_H = 190;

/* ========================== 設定 =========================================
   端末ごとの好み。ボードの中身ではないので localStorage に置く。
   ========================================================================== */
const BG_PRESETS = {
  black: { bg: '#0d0d0f', dot: '#22222a', fg: '#ececed', sub: '#8b8b93' },
  gray:  { bg: '#3b3b42', dot: '#55555e', fg: '#f1f1f3', sub: '#b6b6bd' },
  white: { bg: '#f2f2f4', dot: '#d6d6dc', fg: '#1a1a1c', sub: '#6d6d75' },
  paper: { bg: '#efe9dc', dot: '#d8cdb6', fg: '#2a2415', sub: '#7a6f57' },
};
const GAPS = { tight: 8, normal: 20, loose: 40 };
const FONTS = { normal: 16, large: 17.5, xlarge: 19 };
const SET = {
  bg: 'black',
  dots: 'on',
  shadow: 'on',
  gap: 'normal',
  font: 'normal',     // 文字の大きさ（remを土台にしているので全体が一緒に変わる）
  snap: 'on',         // 動かすとき、隣とそろう位置に吸い付く
  wheel: 'pan',       // pan＝2本指で動かす / zoom＝2本指で拡大
  motion: 'smooth',   // smooth / calm
};
const bgPreset = () => BG_PRESETS[SET.bg] || BG_PRESETS.black;
const gapPx = () => GAPS[SET.gap] != null ? GAPS[SET.gap] : GAPS.normal;

function loadSettings() {
  try {
    const raw = localStorage.getItem('mb_settings');
    if (raw) Object.assign(SET, JSON.parse(raw));
  } catch (e) { /* 読めなくても既定値で動く */ }
  applySettings();
}
/* ========================== 元にもどす ====================================
   ボードの配置をまるごと控えておいて、操作の前の状態に戻せるようにする。
   画像の実体は消さない方針なので、控えるのは items だけでよい。
   ========================================================================== */
const HIST = { past: [], future: [], limit: 40 };
const snapshotItems = () => S.items.map(it => ({ ...it }));

function pushHistory(snap) {
  HIST.past.push(snap || snapshotItems());
  if (HIST.past.length > HIST.limit) HIST.past.shift();
  HIST.future.length = 0;
  syncUndoUI();
}
function clearHistory() { HIST.past.length = 0; HIST.future.length = 0; syncUndoUI(); }
function syncUndoUI() {
  const u = $('#menu-undo'), r = $('#menu-redo');
  if (u) u.disabled = !HIST.past.length;
  if (r) r.disabled = !HIST.future.length;
}

async function applySnapshot(snap) {
  // いま盤面にあって控えに無いもの＝その操作で足されたもの。ゴミ箱に送って取り消す
  const keep = new Set(snap.map(i => i.id));
  for (const it of S.items) {
    if (keep.has(it.id)) continue;
    const cur = await dbGet('items', it.id);
    if (cur) { cur.trashedAt = nowISO(); await dbPut('items', cur); }
  }
  // 控えを書き戻す。位置も、ゴミ箱に入れたものの復活も、これ1つで戻る
  const restored = snap.map(i => { const c = { ...i }; delete c.trashedAt; return c; });
  if (restored.length) await dbPutMany('items', restored);
  S.items = restored;
  S.sel = null;
  for (const it of S.items) {
    if (it.imageId && !S.imgs.has(it.imageId)) {
      const rec = await dbGet('images', it.imageId);
      if (rec) S.imgs.set(it.imageId, rec);
    }
  }
  if (S.mode === 'grid') renderGrid(); else renderCanvas();
  $('#board-empty').hidden = S.items.length > 0;
  setDock(S.picking ? 'select' : 'board');
  renderPalette();
  await touchBoard();
}

async function undo() {
  if (!HIST.past.length) return toast('これ以上もどせません');
  HIST.future.push(snapshotItems());
  await applySnapshot(HIST.past.pop());
  syncUndoUI();
  toast('もどしました');
}
async function redo() {
  if (!HIST.future.length) return toast('やり直せるものがありません');
  HIST.past.push(snapshotItems());
  await applySnapshot(HIST.future.pop());
  syncUndoUI();
  toast('やり直しました');
}

function applySettings() {
  const p = bgPreset();
  const root = document.documentElement;
  root.style.setProperty('--board-bg', p.bg);
  root.style.setProperty('--board-dot', SET.dots === 'on' ? p.dot : 'transparent');
  root.style.setProperty('--board-fg', p.fg);
  // 影は1枚でなく重ねる（遠く＋近く）。明るい盤面では黒を弱める
  const light = SET.bg === 'white' || SET.bg === 'paper';
  const shadow = light
    ? '0 1px 2px rgba(0,0,0,.10), 0 8px 24px rgba(0,0,0,.12)'
    : '0 1px 2px rgba(0,0,0,.28), 0 8px 24px rgba(0,0,0,.42)';
  root.style.setProperty('--item-shadow', SET.shadow === 'on' ? shadow : 'none');
  root.style.fontSize = (FONTS[SET.font] || FONTS.normal) + 'px';
  document.body.classList.toggle('calm', SET.motion === 'calm');
  // 盤面の明暗をCSSから見分けられるようにする
  ['black','gray','white','paper'].forEach(n =>
    document.body.classList.toggle('board-' + n, SET.bg === n));
  try { localStorage.setItem('mb_settings', JSON.stringify(SET)); } catch (e) { }
}

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
    if (it.imageId && !S.imgs.has(it.imageId)) {
      const rec = await dbGet('images', it.imageId);
      if (rec) S.imgs.set(it.imageId, rec);
    }
  }
  S.view = 'board';
  S.sel = null; S.picking = false; S.picked = [];
  S.filter = { q: '', hue: null };
  clearHistory();   // 履歴はボードごと。別のボードには持ち込まない
  $('#view-home').hidden = true;
  $('#view-board').hidden = false;
  $('#btn-back').hidden = false;
  $('#app-title').textContent = S.board.name;
  document.body.classList.remove('at-home');
  $('#board-sub').textContent = S.items.length + ' まい';
  $$('[data-boardonly]').forEach(el => el.hidden = false);
  $('#btn-view').hidden = false;
  let saved = 'canvas';
  try { saved = localStorage.getItem('mb_mode') || 'canvas'; } catch (e) { }
  S.mode = saved;
  const grid = S.mode === 'grid';
  $('#canvas-wrap').hidden = grid;
  $('#grid-view').hidden = !grid;
  $('#zoom-readout').hidden = grid;
  $('#btn-view').classList.toggle('on', grid);
  $('#btn-arrange').disabled = grid;
  $('#btn-fit').disabled = grid;

  renderCanvas();
  if (grid) {
    renderGrid();
  } else {
    fitAll(true);
    // 少しだけ引いた状態から寄せて、ふわっと広がって見せる
    S.cam.k *= 0.9;
    applyCam();
    requestAnimationFrame(() => { fitAll(false); revealItems(); });
  }
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
  document.body.classList.add('at-home');
  $('#board-sub').textContent = '';
  $$('[data-boardonly]').forEach(el => el.hidden = true);
  const pb = $('#palette'); if (pb) pb.hidden = true;
  $('#zoom-readout').hidden = false;
  $('#btn-view').hidden = true;
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
  applyFilter();
}

function makeItemEl(it) {
  const el = document.createElement('div');
  el.className = 'item' + (it.type === 'text' ? ' text-item' : '') + (it.type === 'color' ? ' color-item' : '');
  el.dataset.id = it.id;
  el.style.width = it.w + 'px';
  el.style.height = it.h + 'px';
  el.style.transform = 'translate(' + it.x + 'px,' + it.y + 'px)';
  if (it.type === 'color') {
    el.style.background = it.hex || '#888';
    const t = document.createElement('div');
    t.className = 'sw-hex';
    t.textContent = (it.hex || '').toUpperCase();
    t.style.color = readableOn(it.hex);
    el.appendChild(t);
    return el;
  }
  if (it.type === 'text') {
    const t = document.createElement('div');
    t.className = 'note-body';
    t.textContent = it.text || '';
    el.appendChild(t);
    return el;
  }
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

/* ========================== さがす（メモ・文字・タグ・色） ================ */
function itemMatchesFilter(it) {
  const f = S.filter;
  if (!f.q && f.hue == null) return true;
  let ok = true;
  if (f.q) {
    const hay = ((it.note || '') + ' ' + (it.desc || '') + ' ' + (it.text || '') + ' '
                 + ((it.tags || []).join(' ')) + ' ' + (it.section || '')).toLowerCase();
    ok = hay.includes(f.q.toLowerCase());
  }
  if (ok && f.hue != null) {
    const rec = S.imgs.get(it.imageId);
    if (!rec || !rec.dom || rec.dom.s < 0.14) ok = false;
    else {
      const dh = Math.min(Math.abs(rec.dom.h - f.hue), 360 - Math.abs(rec.dom.h - f.hue));
      ok = dh <= 26;
    }
  }
  return ok;
}
function applyFilter() {
  const active = !!(S.filter.q || S.filter.hue != null);
  let hit = 0;
  canvas.querySelectorAll('.item').forEach(el => {
    const it = S.items.find(i => i.id === el.dataset.id);
    const match = !it || itemMatchesFilter(it);
    if (match) hit++;
    el.classList.toggle('dim', active && !match);
  });
  $$('#grid-scroll .gcell').forEach(cell => {
    const it = S.items.find(i => i.id === cell.dataset.id);
    const match = !it || itemMatchesFilter(it);
    cell.hidden = active && !match;
  });
  const cnt = $('#search-count');
  if (cnt) cnt.textContent = active ? (hit + ' / ' + S.items.length + ' まいに一致') : '';
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

/* --- そろう位置に吸い付かせる ---
   隣の左/中央/右・上/中央/下に近づいたら、そこへ寄せて線を出す。
   手で置いてもボードが散らからない。 */
function snapPosition(it, nx, ny) {
  const tol = 7 / S.cam.k;                    // 画面上で7pxぶん
  const mine = { v: [nx, nx + it.w / 2, nx + it.w], h: [ny, ny + it.h / 2, ny + it.h] };
  let bv = null, bh = null;
  for (const o of S.items) {
    if (o.id === it.id) continue;
    const ov = [o.x, o.x + o.w / 2, o.x + o.w];
    const oh = [o.y, o.y + o.h / 2, o.y + o.h];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const dv = ov[b] - mine.v[a];
        if (Math.abs(dv) < tol && (!bv || Math.abs(dv) < Math.abs(bv.d))) bv = { d: dv, at: ov[b] };
        const dh = oh[b] - mine.h[a];
        if (Math.abs(dh) < tol && (!bh || Math.abs(dh) < Math.abs(bh.d))) bh = { d: dh, at: oh[b] };
      }
    }
  }
  return {
    x: Math.round(bv ? nx + bv.d : nx),
    y: Math.round(bh ? ny + bh.d : ny),
    vx: bv ? bv.at : null,
    hy: bh ? bh.at : null,
  };
}
function showGuides(vx, hy) {
  const gv = $('#guide-v'), gh = $('#guide-h');
  if (vx == null) gv.hidden = true;
  else { gv.hidden = false; gv.style.left = (vx * S.cam.k + S.cam.x) + 'px'; }
  if (hy == null) gh.hidden = true;
  else { gh.hidden = false; gh.style.top = (hy * S.cam.k + S.cam.y) + 'px'; }
}
function hideGuides() { $('#guide-v').hidden = true; $('#guide-h').hidden = true; }

/* --- 枠で囲んで選ぶ --- */
function marqueeTo(g, e) {
  const r = wrap.getBoundingClientRect();
  const x1 = Math.min(g.sx, e.clientX), x2 = Math.max(g.sx, e.clientX);
  const y1 = Math.min(g.sy, e.clientY), y2 = Math.max(g.sy, e.clientY);
  const box = $('#marquee');
  box.hidden = false;
  box.style.left = (x1 - r.left) + 'px';
  box.style.top = (y1 - r.top) + 'px';
  box.style.width = (x2 - x1) + 'px';
  box.style.height = (y2 - y1) + 'px';
  const a = toCanvas(x1, y1), b = toCanvas(x2, y2);
  const hit = S.items
    .filter(it => it.x < b.x && it.x + it.w > a.x && it.y < b.y && it.y + it.h > a.y)
    .map(it => it.id);
  S.picked = [...new Set([...g.base, ...hit])];
  updatePickUI();
}
function hideMarquee() { $('#marquee').hidden = true; }

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
    G = { mode: 'resize', it: sel, w0: sel.w, h0: sel.h, sx: e.clientX, sy: e.clientY, moved: false, snap: snapshotItems() };
  } else if (it && !S.picking) {
    G = { mode: 'drag', it, x0: it.x, y0: it.y, sx: e.clientX, sy: e.clientY, moved: false, startId: it.id, snap: snapshotItems() };
    // つかんだら手前に出す（見た目だけ即時）
    const el = itemEl(it.id);
    if (el) canvas.appendChild(el);
  } else if (it && S.picking) {
    G = { mode: 'tap-pick', it, sx: e.clientX, sy: e.clientY, moved: false };
  } else if (e.button === 1 || spaceHeld) {
    // 中ボタン / スペース＋ドラッグ は、いつでも盤面を動かす
    G = { mode: 'pan', cam0: { ...S.cam }, sx: e.clientX, sy: e.clientY, moved: false,
          lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 };
  } else if (S.picking || e.shiftKey || e.pointerType === 'mouse') {
    // 何もないところからのドラッグは、枠で囲んで選ぶ。
    // マウスはこれが既定（指は盤面移動のままにしないとスマホで動かせなくなる）
    if (!S.picking) startPicking(true);
    G = { mode: 'marquee', sx: e.clientX, sy: e.clientY, moved: false, base: S.picked.slice() };
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
    const nx = G.x0 + dx / S.cam.k;
    const ny = G.y0 + dy / S.cam.k;
    // option を押している間はスナップを切る（細かく置きたいとき用）
    const s = (SET.snap === 'on' && !e.altKey)
      ? snapPosition(G.it, nx, ny)
      : { x: Math.round(nx), y: Math.round(ny), vx: null, hy: null };
    G.it.x = s.x; G.it.y = s.y;
    showGuides(s.vx, s.hy);
    updateItemEl(G.it);
    positionHandle();
  } else if (G.mode === 'marquee') {
    marqueeTo(G, e);
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

  hideGuides();

  if (g.mode === 'drag') {
    if (g.moved) {
      pushHistory(g.snap);
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
        if (g.it.type === 'text') editTextItem(g.it);
        else if (g.it.type === 'color') copyHex(g.it.hex || '');
        else openViewer(g.it);
        lastTap = { t: 0, id: null };
      } else {
        lastTap = { t, id: g.it.id };
      }
    }
  } else if (g.mode === 'resize') {
    if (g.moved) { pushHistory(g.snap); await dbPut('items', g.it); touchBoard(); }
  } else if (g.mode === 'tap-pick') {
    if (!g.moved) togglePick(g.it.id);
  } else if (g.mode === 'marquee') {
    hideMarquee();
  } else if (g.mode === 'pan') {
    if (!g.moved) selectItem(null);
    else if (performance.now() - g.lastT < 90 && Math.hypot(g.vx, g.vy) > 0.12) glide(g.vx, g.vy);
  }
}
wrap.addEventListener('pointerup', endGesture);
wrap.addEventListener('pointercancel', endGesture);

/* --- トラックパッド / マウスホイール（PC用） ---
   2本指のスクロール＝動かす。ピンチと ⌘+ホイール＝拡大縮小。
   トラックパッドの2本指スクロールもホイールとして飛んでくるので、
   全部をズームに割り当てると「動かそうとすると拡大する」状態になる。 */

/* ズームの中心を指の位置に固定したままスケールする */
function zoomAt(cx, cy, k) {
  const wx = (cx - S.cam.x) / S.cam.k, wy = (cy - S.cam.y) / S.cam.k;
  S.cam.k = k;
  S.cam.x = cx - wx * k;
  S.cam.y = cy - wy * k;
  applyCam();
}

/* スペースを押している間は、どこをドラッグしても盤面が動く（Figmaなどと同じ） */
let spaceHeld = false;
const isTyping = (e) => {
  const t = e.target;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
};
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !isTyping(e)) { spaceHeld = true; wrap.style.cursor = 'grab'; }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceHeld = false; wrap.style.cursor = ''; }
});
addEventListener('blur', () => { spaceHeld = false; wrap.style.cursor = ''; });

/* Safari のトラックパッドのピンチはWebKit独自のイベントで来る（Chromeでは発火しない） */
let gesture0 = null;
wrap.addEventListener('gesturestart', (e) => {
  e.preventDefault();
  const r = wrap.getBoundingClientRect();
  gesture0 = { k: S.cam.k, cx: e.clientX - r.left, cy: e.clientY - r.top };
});
wrap.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (!gesture0) return;
  zoomAt(gesture0.cx, gesture0.cy, clamp(gesture0.k * e.scale, 0.05, 6));
});
wrap.addEventListener('gestureend', (e) => { e.preventDefault(); gesture0 = null; });

/* ホイールの量をピクセルに揃える。
   deltaMode は 0=ピクセル / 1=行 / 2=ページ で、マウスやブラウザによって変わる。
   行で来たものを素のまま使うと「1ノッチで3pxしか動かない」状態になる。 */
function wheelPx(e) {
  const m = e.deltaMode;
  const unit = m === 1 ? 16 : m === 2 ? wrap.clientHeight : 1;
  return { x: e.deltaX * unit, y: e.deltaY * unit };
}

/* マウスのホイールは1ノッチが大きく粗い。トラックパッドは細かい値が大量に来る。
   同じ係数だとマウスで飛びすぎるので、粗い入力ほど倍率を抑える。 */
function zoomFactorFor(dy) {
  const a = Math.abs(dy);
  const perPx = a > 40 ? 0.0015 : 0.005;   // 粗い入力(マウス)は控えめに
  return Math.exp(-dy * perPx);
}

wrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (gesture0) return;                     // Safariのピンチ中は二重に効かせない
  stopGlide();
  const d = wheelPx(e);

  // Chromeはトラックパッドのピンチを ctrlKey 付きのホイールとして送ってくる
  if (e.ctrlKey || e.metaKey || SET.wheel === 'zoom') {
    const r = wrap.getBoundingClientRect();
    const dy = clamp(d.y, -120, 120);
    zoomAt(e.clientX - r.left, e.clientY - r.top,
           clamp(S.cam.k * zoomFactorFor(dy), 0.05, 6));
    return;
  }

  // shift＋ホイールは横スクロール（マウスは縦にしか回せないため）
  if (e.shiftKey && !d.x) { S.cam.x -= d.y; }
  else { S.cam.x -= d.x; S.cam.y -= d.y; }
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
    const it = S.items.find(i => i.id === id);
    const noteSpan = $('#btn-item-note span');
    if (noteSpan) noteSpan.textContent = (it && it.type === 'text') ? '文字' : 'メモ';
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
function startPicking(quiet) {
  S.picking = true; S.picked = [];
  selectItem(null);
  setDock('select');
  updatePickUI();
  if (!quiet) toast('タップで選ぶ／何もない所をドラッグすると枠で囲んで選べます', 3200);
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
  else S.picked.push(id);
  updatePickUI();
}
function pickedImageCount() {
  return S.picked.filter(id => { const it = S.items.find(i => i.id === id); return it && it.type !== 'text'; }).length;
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
  const imgN = pickedImageCount();
  $('#btn-compare-go').disabled = imgN < 2 || imgN > 6;
  $('#btn-bulk-move').disabled = S.picked.length < 1;
  $('#btn-bulk-align').disabled = S.picked.length < 2;
  $('#btn-bulk-tag').disabled = S.picked.length < 1;
  $('#btn-bulk-trash').disabled = S.picked.length < 1;
  $('#btn-bulk-print').disabled = S.picked.length < 1;
  if (S.mode === 'grid') syncGridPick();
}

/* ========================== くらべる ===================================== */
async function openCompare(ids) {
  ids = ids.filter(id => { const it = S.items.find(i => i.id === id); return it && it.type !== 'text'; });
  const stage = $('#compare-stage');
  stage.innerHTML = '';

  if (S.cmpLayout === 'overlay') {
    if (ids.length !== 2) { toast('「かさねる」は2枚を選んでください'); S.cmpLayout = 'row'; return openCompare(ids); }
    stage.className = 'overlay';
    stage.style.gridTemplateColumns = '';
    const recs = [];
    for (const id of ids) {
      const it = S.items.find(i => i.id === id);
      recs.push(it ? await dbGet('images', it.imageId) : null);
    }
    const cell = document.createElement('div'); cell.className = 'ov-cell';
    const imB = document.createElement('img'); imB.className = 'ov-bottom';
    const imT = document.createElement('img'); imT.className = 'ov-top';
    if (recs[0]) imB.src = blobURL(recs[0].id, 'f', recs[0].full);
    if (recs[1]) imT.src = blobURL(recs[1].id, 'f', recs[1].full);
    const wrapT = document.createElement('div'); wrapT.className = 'ov-top-wrap'; wrapT.appendChild(imT);
    const handle = document.createElement('div'); handle.className = 'ov-handle';
    cell.append(imB, wrapT, handle);
    attachOverlaySlider(cell, wrapT, handle);
    stage.appendChild(cell);
    $$('#cmp-layouts .lay').forEach(b => b.classList.toggle('on', b.dataset.lay === 'overlay'));
    $('#cmp-fill').hidden = true;
    $('#compare').hidden = false;
    return;
  }
  $('#cmp-fill').hidden = false;

  stage.className = S.cmpLayout + (S.cmpFill ? ' fill' : '');
  if (S.cmpLayout === 'grid') {
    stage.style.gridTemplateColumns = ids.length <= 4 ? '1fr 1fr' : '1fr 1fr 1fr';
  } else stage.style.gridTemplateColumns = '';

  for (const id of ids) {
    const it = S.items.find(i => i.id === id);
    if (!it || !it.imageId) continue;
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

/* 2枚を重ねて、境界をドラッグして比べる */
function attachOverlaySlider(cell, wrapT, handle) {
  const setPos = (ratio) => {
    ratio = clamp(ratio, 0, 1);
    wrapT.style.clipPath = 'inset(0 ' + ((1 - ratio) * 100) + '% 0 0)';
    handle.style.left = (ratio * 100) + '%';
  };
  setPos(0.5);
  let dragging = false;
  const move = (clientX) => {
    const r = cell.getBoundingClientRect();
    setPos((clientX - r.left) / r.width);
  };
  cell.addEventListener('pointerdown', (e) => { dragging = true; cell.setPointerCapture(e.pointerId); move(e.clientX); });
  cell.addEventListener('pointermove', (e) => { if (dragging) move(e.clientX); });
  const stop = () => { dragging = false; };
  cell.addEventListener('pointerup', stop);
  cell.addEventListener('pointercancel', stop);
}

/* セルごとに独立したピンチズーム */
function attachCellZoom(cell, img) {
  const st = { x: 0, y: 0, k: 1 };
  const pts = new Map();
  let g = null;
  const apply = () => { img.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.k + ')'; };

  /* トラックパッド（ピンチは指2本のポインタとしては飛んでこないので、別で受ける） */
  const zoomCellAt = (cx, cy, k) => {
    const wx = (cx - st.x) / st.k, wy = (cy - st.y) / st.k;
    st.k = k;
    st.x = cx - wx * k;
    st.y = cy - wy * k;
    if (st.k <= 1) { st.x = 0; st.y = 0; st.k = 1; }
    apply();
  };
  let cg = null;
  cell.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    const r = cell.getBoundingClientRect();
    cg = { k: st.k, cx: e.clientX - r.left, cy: e.clientY - r.top };
  });
  cell.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    if (cg) zoomCellAt(cg.cx, cg.cy, clamp(cg.k * e.scale, 1, 8));
  });
  cell.addEventListener('gestureend', (e) => { e.preventDefault(); cg = null; });
  cell.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (cg) return;
    const r = cell.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cell.clientHeight : 1;
      const d = clamp(e.deltaY * unit, -120, 120);
      zoomCellAt(e.clientX - r.left, e.clientY - r.top, clamp(st.k * Math.exp(-d * 0.006), 1, 8));
      return;
    }
    if (st.k > 1) { st.x -= e.deltaX; st.y -= e.deltaY; apply(); }
  }, { passive: false });

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
let viewerBlob = null, viewerName = '', viewerItem = null;
async function openViewer(it) {
  if (!it.imageId) return;
  const rec = await dbGet('images', it.imageId);
  if (!rec) return toast('画像が見つかりません');
  viewerItem = it;
  const un = $('#viewer-uncrop');
  if (un) un.hidden = !it.croppedFrom;
  $('#viewer-pal').hidden = true;
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
    tags: [],
    addedAt: nowISO(),
  };
  await dbPut('items', it);
  S.items.push(it);
  S.imgs.set(rec.id, rec);
  canvas.appendChild(makeItemEl(it));
  return it;
}

/* ========================== 色を置く（色見本） ============================
   ムードボードで見ているのは結局「色と質感」なので、色そのものも置けるようにする。
   ========================================================================== */
const SWATCH_W = 170, SWATCH_H = 170;

/* 背景の明るさに合わせて、上に乗せる文字の色を決める */
function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 'rgba(255,255,255,.85)';
  const n = parseInt(m[1], 16);
  const lum = (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  return lum > 0.62 ? 'rgba(0,0,0,.62)' : 'rgba(255,255,255,.85)';
}
async function copyHex(hex) {
  try { await navigator.clipboard.writeText(hex); toast(hex.toUpperCase() + ' をコピーしました'); }
  catch (e) { toast(hex.toUpperCase()); }
}
function normalizeHex(v) {
  let s = String(v || '').trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
}

async function addColorToBoard(hex, spot) {
  const it = {
    id: uid(),
    boardId: S.boardId,
    type: 'color',
    hex,
    x: Math.round(spot.x - SWATCH_W / 2),
    y: Math.round(spot.y - SWATCH_H / 2),
    w: SWATCH_W,
    h: SWATCH_H,
    z: Math.max(0, ...S.items.map(i => i.z || 0)) + 1,
    note: '',
    tags: [],
    addedAt: nowISO(),
  };
  await dbPut('items', it);
  S.items.push(it);
  const el = makeItemEl(it);
  canvas.appendChild(el);
  el.classList.add('in');
  return it;
}

/* ========================== 文字を置く（ノート） =========================== */
async function addTextToBoard(text, spot) {
  const it = {
    id: uid(),
    boardId: S.boardId,
    type: 'text',
    x: Math.round(spot.x - TEXT_W / 2),
    y: Math.round(spot.y - TEXT_H / 2),
    w: TEXT_W,
    h: TEXT_H,
    z: Math.max(0, ...S.items.map(i => i.z || 0)) + 1,
    text: text || '',
    note: '',
    tags: [],
    addedAt: nowISO(),
  };
  await dbPut('items', it);
  S.items.push(it);
  const el = makeItemEl(it);
  canvas.appendChild(el);
  el.classList.add('in');
  return it;
}

async function editTextItem(it) {
  const v = await ask('文字を編集（空にするとゴミ箱へ）', it.text || '', true);
  if (v === null) return;
  pushHistory();
  if (!v) {
    it.trashedAt = nowISO();
    await dbPut('items', it);
    S.items = S.items.filter(i => i.id !== it.id);
    const el = itemEl(it.id); if (el) el.remove();
    selectItem(null);
    $('#board-empty').hidden = S.items.length > 0;
    touchBoard();
    toast('からっぽにしたのでゴミ箱に入れました');
    return;
  }
  it.text = v;
  await dbPut('items', it);
  const el = itemEl(it.id);
  if (el) { const b = el.querySelector('.note-body'); if (b) b.textContent = v; }
  touchBoard();
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
  pushHistory();
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
  if (S.mode === 'grid') renderGrid(); else fitAll();
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

  pushHistory();
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
  if (S.mode === 'grid') renderGrid(); else fitAll();

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
  pushHistory();
  const n = S.items.length;
  const colW = BASE_W, gap = gapPx();
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
      const bid = boardMap.get(it.boardId);
      if (!bid) continue;
      if (it.imageId) {
        const iid = imgMap.get(it.imageId);
        if (!iid) continue;
        newItems.push({ ...it, id: uid(), boardId: bid, imageId: iid });
      } else if (isCardItem(it)) {
        newItems.push({ ...it, id: uid(), boardId: bid });
      }
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

/* --- 設定（歯車） --- */
const SET_CHIPS = [['#st-bg', 'bg'], ['#st-dots', 'dots'], ['#st-shadow', 'shadow'],
                   ['#st-gap', 'gap'], ['#st-font', 'font'], ['#st-snap', 'snap'],
                   ['#st-wheel', 'wheel'], ['#st-motion', 'motion']];
function syncSettingChips() {
  SET_CHIPS.forEach(([sel, key]) => {
    $$(sel + ' .chip').forEach(b => b.classList.toggle('on', b.dataset.v === SET[key]));
  });
}
SET_CHIPS.forEach(([sel, key]) => {
  $$(sel + ' .chip').forEach(b => b.onclick = () => {
    SET[key] = b.dataset.v;
    applySettings();
    syncSettingChips();
    // すきまは、次に「ならべる」したときから効く
    if (key === 'gap' && S.view === 'board') toast('「ならべる」でこのすきまになります');
  });
});
$('#btn-settings').onclick = () => { syncSettingChips(); openSheet('#sheet-settings'); };
$('#settings-close').onclick = closeSheets;

$('#btn-add').onclick = () => openSheet('#sheet-add');
$('#add-photos').onclick = () => { closeSheets(); $('#file-input').click(); };
$('#add-text').onclick = async () => {
  closeSheets();
  const v = await ask('文字を書く', '', true);
  if (v === null || !v) return;
  pushHistory();
  const it = await addTextToBoard(v, viewCenterCanvas());
  selectItem(it.id);
  touchBoard();
};
$('#add-color').onclick = () => { renderColorSheet(); openSheet('#sheet-color'); };
$('#add-url').onclick = () => openSheet('#sheet-url');

/* --- 色を置く --- */
async function placeColor(hex, near) {
  const h = normalizeHex(hex);
  if (!h) return toast('色のコードが読めませんでした');
  closeSheets();
  pushHistory();
  const spot = near || viewCenterCanvas();
  const it = await addColorToBoard(h, spot);
  selectItem(it.id);
  touchBoard();
  toast(h.toUpperCase() + ' を置きました');
}
function renderColorSheet() {
  const box = $('#color-board-pal');
  box.innerHTML = '';
  const pal = boardPalette(8);
  if (!pal.length) {
    const p = document.createElement('p');
    p.className = 'sheet-note';
    p.textContent = '写真を入れると、そこから拾った色がここに並びます。';
    box.appendChild(p);
  }
  pal.forEach(c => {
    const s = document.createElement('button');
    s.className = 'sw-btn';
    s.style.background = c.hex;
    s.style.color = readableOn(c.hex);
    s.textContent = c.hex.toUpperCase();
    s.onclick = () => placeColor(c.hex);
    box.appendChild(s);
  });
}
$('#color-input').oninput = (e) => { $('#color-hex').value = e.target.value; };
$('#color-add').onclick = () => placeColor($('#color-hex').value || $('#color-input').value);
$('#color-close').onclick = closeSheets;

/* --- 1枚表示から、その写真の色を取り出して置く --- */
$('#viewer-colors').onclick = async () => {
  const box = $('#viewer-pal');
  if (!box.hidden) { box.hidden = true; return; }
  if (!viewerItem || !viewerItem.imageId) return;
  const rec = S.imgs.get(viewerItem.imageId) || await dbGet('images', viewerItem.imageId);
  if (!rec) return;
  if (!rec.dom) {
    try {
      const col = await extractColors(rec.thumb || rec.full);
      rec.dom = col.dom; rec.hex = col.hex; rec.pal = col.pal;
      await dbPut('images', rec);
    } catch (e) { return toast('色を読み取れませんでした'); }
  }
  const list = [...new Set([rec.hex, ...(rec.pal || [])])].filter(Boolean);
  box.innerHTML = '';
  list.forEach(hex => {
    const s = document.createElement('button');
    s.className = 'sw-btn';
    s.style.background = hex;
    s.style.color = readableOn(hex);
    s.textContent = hex.toUpperCase();
    s.onclick = async () => {
      const near = { x: viewerItem.x + viewerItem.w + 30 + SWATCH_W / 2, y: viewerItem.y + SWATCH_H / 2 };
      $('#viewer').hidden = true;
      box.hidden = true;
      await placeColor(hex, near);
    };
    box.appendChild(s);
  });
  box.hidden = false;
};
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

/* --- さがす（メモ・文字・タグ・色） --- */
function renderSearchColors() {
  const box = $('#search-colors');
  if (!box) return;
  box.innerHTML = '';
  const pal = boardPalette(8);
  pal.forEach(p => {
    const s = document.createElement('span');
    const on = S.filter.hue != null && Math.abs(p.h - S.filter.hue) < 1;
    s.className = 'sw' + (on ? ' on' : '');
    s.style.background = p.hex;
    s.onclick = () => {
      S.filter.hue = on ? null : p.h;
      renderSearchColors();
      applyFilter();
    };
    box.appendChild(s);
  });
}
$('#btn-search').onclick = () => {
  $('#search-input').value = S.filter.q;
  renderSearchColors();
  applyFilter();
  openSheet('#sheet-search');
  setTimeout(() => $('#search-input').focus(), 60);
};
$('#search-input').oninput = (e) => { S.filter.q = e.target.value.trim(); applyFilter(); };
$('#search-clear').onclick = () => {
  S.filter = { q: '', hue: null };
  $('#search-input').value = '';
  renderSearchColors();
  applyFilter();
};
$('#search-close').onclick = closeSheets;
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
  pushHistory();
  it.z = Math.max(0, ...S.items.map(i => i.z || 0)) + 1;
  const el = itemEl(it.id); if (el) canvas.appendChild(el);
  await dbPut('items', it);
  S.items.sort((a, b) => (a.z || 0) - (b.z || 0));
  touchBoard();
};
$('#btn-item-big').onclick = async () => {
  const it = selItem(); if (!it) return;
  pushHistory();
  const f = it.w < 500 ? 1.5 : (it.w < 900 ? 1.35 : 0.5);
  it.w = Math.round(it.w * f); it.h = Math.round(it.h * f);
  updateItemEl(it); positionHandle();
  await dbPut('items', it); touchBoard();
};
/* ==========================================================================
   この1枚について（ひとこと・説明・タグ・区分け）
   タグは打たせず「押すだけ」にする。打たせる作りだと続かず、
   結局ほとんどが未整理のまま溜まってしまうため。
   選んだ複数枚にまとめて付けられるようにもしてある。
   ========================================================================== */
const NOTE = { targets: [], tags: [], section: '' };

/* このボードで今まで使ったタグを、よく使う順に集める */
function knownTags() {
  const count = new Map();
  S.items.forEach(i => (i.tags || []).forEach(t => count.set(t, (count.get(t) || 0) + 1)));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}
function knownSections() {
  const set = new Set();
  S.items.forEach(i => { if (i.section) set.add(i.section); });
  return [...set].sort();
}

function renderTagPicker() {
  const picked = $('#tag-picked'), sug = $('#tag-suggest');
  picked.innerHTML = '';
  NOTE.tags.forEach(t => {
    const c = document.createElement('button');
    c.className = 'chip on';
    c.innerHTML = '<span></span><span class="x">×</span>';
    c.firstChild.textContent = t;
    c.onclick = () => { NOTE.tags = NOTE.tags.filter(x => x !== t); renderTagPicker(); };
    picked.appendChild(c);
  });
  if (!NOTE.tags.length) {
    const e = document.createElement('div');
    e.className = 'tag-empty'; e.textContent = 'まだタグなし';
    picked.appendChild(e);
  }
  sug.innerHTML = '';
  knownTags().filter(t => !NOTE.tags.includes(t)).slice(0, 12).forEach(t => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = t;
    c.onclick = () => { NOTE.tags.push(t); renderTagPicker(); };
    sug.appendChild(c);
  });
}

function renderSectionPicker() {
  const box = $('#sec-picked');
  box.innerHTML = '';
  const mk = (name, label) => {
    const c = document.createElement('button');
    c.className = 'chip' + (NOTE.section === name ? ' on' : '');
    c.textContent = label;
    c.onclick = () => { NOTE.section = name; renderSectionPicker(); };
    return c;
  };
  box.appendChild(mk('', 'なし'));
  knownSections().forEach(sname => box.appendChild(mk(sname, sname)));
  const add = document.createElement('button');
  add.className = 'chip add';
  add.textContent = '＋ 新しい区分け';
  add.onclick = async () => {
    const v = await ask('区分けの名前', '');
    if (v) { NOTE.section = v.trim(); renderSectionPicker(); }
  };
  box.appendChild(add);
}

function addTypedTag() {
  const inp = $('#note-tags');
  inp.value.split(/[,、\s]+/).map(x => x.trim()).filter(Boolean)
    .forEach(t => { if (!NOTE.tags.includes(t)) NOTE.tags.push(t); });
  inp.value = '';
  renderTagPicker();
}
$('#tag-add-btn').onclick = addTypedTag;
$('#note-tags').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addTypedTag(); }
});

/* 1枚でも、選んだ複数枚でも開ける */
function openNoteSheet(targets) {
  NOTE.targets = targets;
  const one = targets.length === 1 ? targets[0] : null;
  $('#note-title').textContent = one ? 'この1枚について' : targets.length + ' 枚にまとめて';
  $('#note-scope').textContent = one
    ? '写真の下に出るのは「ひとこと」だけ。あとは「さがす」で使えます。'
    : 'タグと区分けが、選んだ ' + targets.length + ' 枚すべてに付きます。';
  // まとめて付けるときは、ひとこと/説明は触らない（上書き事故を防ぐ）
  $('#note-body').parentElement.querySelectorAll('#note-body,#note-desc').forEach(() => { });
  ['#note-body', '#note-desc'].forEach(sel => {
    const el = $(sel);
    const label = el.previousElementSibling;
    el.hidden = !one; if (label && label.classList.contains('fld-label')) label.hidden = !one;
  });
  if (one) {
    $('#note-body').value = one.note || '';
    $('#note-desc').value = one.desc || '';
    NOTE.tags = (one.tags || []).slice();
    NOTE.section = one.section || '';
  } else {
    NOTE.tags = [];
    NOTE.section = '';
  }
  $('#note-tags').value = '';
  renderTagPicker();
  renderSectionPicker();
  openSheet('#sheet-note');
  if (one) setTimeout(() => $('#note-body').focus(), 60);
}

$('#btn-item-note').onclick = () => {
  const it = selItem(); if (!it) return;
  if (it.type === 'text') return editTextItem(it);
  openNoteSheet([it]);
};
$('#note-cancel').onclick = closeSheets;
$('#note-save').onclick = async () => {
  const targets = NOTE.targets;
  if (!targets.length) return closeSheets();
  const one = targets.length === 1 ? targets[0] : null;
  const note = one ? $('#note-body').value.trim() : null;
  const desc = one ? $('#note-desc').value.trim() : null;
  closeSheets();
  pushHistory();
  for (const it of targets) {
    if (one) { it.note = note; it.desc = desc; it.tags = NOTE.tags.slice(); }
    else {
      // まとめて付けるときは、もとのタグに足す（消さない）
      const set = new Set([...(it.tags || []), ...NOTE.tags]);
      it.tags = [...set];
    }
    if (NOTE.section !== '' || one) it.section = NOTE.section;
    await dbPut('items', it);
    const el = itemEl(it.id);
    if (el) el.replaceWith(makeItemEl(it));
  }
  touchBoard();
  toast(one ? '保存しました' : targets.length + ' 枚に付けました');
};
$('#btn-item-move').onclick = openMoveSheet;
$('#mv-cancel').onclick = closeSheets;
$$('#mv-mode .chip').forEach(b => b.onclick = () => {
  mvMode = b.dataset.v;
  $$('#mv-mode .chip').forEach(x => x.classList.toggle('on', x === b));
});
$('#mv-here').onclick = async () => {
  const ids = mvBulk ? S.picked.slice() : (S.sel ? [S.sel] : []);
  if (!ids.length) return;
  closeSheets();
  const n = await duplicateItems(ids);
  if (mvBulk) { stopPicking(); mvBulk = false; }
  else if (n) selectItem(null);
  toast(n + ' 枚複製しました');
};
$('#btn-item-remove').onclick = async () => {
  const it = selItem(); if (!it) return;
  pushHistory();
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
/* ゴミ箱を空にする ＝ ここだけが本当に消える場所。
   どのボードからも使われなくなった画像の実体も消して、容量を返す。 */
$('#trash-empty-all').onclick = async () => {
  const all = await dbAll('items');
  const trashed = all.filter(i => i.trashedAt);
  if (!trashed.length) return;
  const ok = await confirmAsk(trashed.length + ' 枚を完全に消します。もう戻せません。');
  if (!ok) return;

  const before = (navigator.storage && navigator.storage.estimate)
    ? (await navigator.storage.estimate()).usage || 0 : 0;

  for (const it of trashed) await dbDel('items', it.id);

  // どのボードからも使われていない画像だけを消す
  const stillUsed = new Set(all.filter(i => !i.trashedAt).map(i => i.imageId).filter(Boolean));
  const images = await dbAll('images');
  let gone = 0;
  for (const rec of images) {
    if (stillUsed.has(rec.id)) continue;
    await dbDel('images', rec.id);
    gone++;
  }
  _srcIndex = null;
  releaseURLs();

  const after = (navigator.storage && navigator.storage.estimate)
    ? (await navigator.storage.estimate()).usage || 0 : 0;
  const freed = Math.max(0, before - after);

  clearHistory();   // 戻せないので、戻せるふりをしない
  closeSheets();
  if (S.view === 'board' && S.boardId) await openBoard(S.boardId); else await renderHome();
  toast(trashed.length + ' 枚を完全に消しました'
    + (gone ? '<br>写真の実体 ' + gone + ' 枚ぶん' : '')
    + (freed ? '（' + fmtBytes(freed) + ' 空きました）' : ''), 4200);
};

$('#menu-undo').onclick = async () => { closeSheets(); await undo(); };
$('#menu-redo').onclick = async () => { closeSheets(); await redo(); };
$('#menu-trash').onclick = () => { closeSheets(); openTrash(); };
$('#trash-close').onclick = closeSheets;
$('#menu-dup').onclick = () => {
  closeSheets();
  if (S.view !== 'board') return toast('先にボードを開いてください');
  findDuplicates();
};
$('#dup-close').onclick = closeSheets;
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
  const meta = e.metaKey || e.ctrlKey;

  if (meta && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    return void (e.shiftKey ? redo() : undo());
  }
  if (meta && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    if (!S.picking) startPicking(true);
    S.picked = S.items.map(i => i.id);
    updatePickUI();
    return void toast(S.picked.length + ' 枚えらびました');
  }
  if (meta && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    const ids = S.picking ? S.picked.slice() : (S.sel ? [S.sel] : []);
    if (!ids.length) return;
    return void duplicateItems(ids).then(n => toast(n + ' 枚複製しました'));
  }
  if (meta) return;   // ここから下はブラウザのショートカットと衝突させない

  // 矢印で細かく動かす（shiftで大きく）
  if (e.key.startsWith('Arrow') && (S.sel || S.picked.length)) {
    e.preventDefault();
    const step = e.shiftKey ? 20 : 2;
    const list = S.picking ? pickedItems() : [selItem()].filter(Boolean);
    if (!list.length) return;
    if (!nudgeSnap) { nudgeSnap = snapshotItems(); }
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { if (nudgeSnap) { pushHistory(nudgeSnap); nudgeSnap = null; } }, 600);
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    list.forEach(i => { i.x += dx; i.y += dy; updateItemEl(i); });
    positionHandle();
    dbPutMany('items', list);
    return;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); $('#btn-item-remove').click(); }
  if (e.key === 'f' || e.key === 'F') fitAll();
  if (e.key === 'a' || e.key === 'A') arrangeMasonry();
  if (e.key === 'g' || e.key === 'G') $('#btn-view').click();
  if (e.key === 'Escape' && S.picking) stopPicking();
});
let nudgeSnap = null, nudgeTimer = 0;

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
  loadSettings();
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

  const keepItem = (i) => (i.type === 'text' || i.type === 'color') ? true : !!imgMeta[i.imageId];

  const data = {
    app: 'MOOD BOARD',
    version: 1,
    exportedAt: nowISO(),
    boards: boards.map(b => ({ id: b.id, name: b.name })),
    items: items.filter(keepItem).map(i => ({
      id: i.id, boardId: i.boardId, imageId: i.imageId,
      type: i.type || 'photo', text: i.text || '',
      // 色見本の色は hex。color は古いビューアのために残してある
      hex: i.hex || '', color: i.hex || i.color || '',
      x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h),
      z: i.z || 0, note: i.note || '', desc: i.desc || '',
      tags: (i.tags || []).slice(), section: i.section || '',
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

  // 同期のための台帳。data.js はビューアが読む用、これは突き合わせる用。
  const manifest = {
    app: 'MOOD BOARD',
    version: 1,
    updatedAt: nowISO(),
    boards: boards.map(b => ({ id: b.id, name: b.name, createdAt: b.createdAt, updatedAt: b.updatedAt })),
    items: items.filter(keepItem).map(i => ({
      id: i.id, boardId: i.boardId, imageId: i.imageId,
      type: i.type || 'photo', text: i.text || '',
      hex: i.hex || '', color: i.hex || i.color || '',
      x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h),
      z: i.z || 0, note: i.note || '', desc: i.desc || '',
      tags: (i.tags || []).slice(), section: i.section || '',
      addedAt: i.addedAt || '', trashedAt: i.trashedAt || '',
      croppedFrom: i.croppedFrom || '', rotFrom: i.rotFrom || '', rot: i.rot || 0,
    })),
    images: Object.keys(imgMeta).map(id => ({ id, ...imgMeta[id] })),
  };

  files.unshift(
    { name: 'index.html', data: te.encode(shell['index.html']) },
    { name: 'viewer.css', data: te.encode(shell['viewer.css']) },
    { name: 'viewer.js', data: te.encode(shell['viewer.js']) },
    { name: 'data.js', data: te.encode('const MB_DATA = ' + JSON.stringify(data) + ';\n') },
    { name: 'manifest.json', data: te.encode(JSON.stringify(manifest, null, 1)) },
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
  a4p: { w: 210, h: 297, size: 'A4', orient: 'portrait', cols: 3 },
  a4l: { w: 297, h: 210, size: 'A4', orient: 'landscape', cols: 4 },
  a3p: { w: 297, h: 420, size: 'A3', orient: 'portrait', cols: 4 },
  a3l: { w: 420, h: 297, size: 'A3', orient: 'landscape', cols: 5 },
};
const MARGINS = { narrow: 6, normal: 10, wide: 18 };
const PRINT = { mode: 'board', paper: 'a4p', scope: 'all', note: 'on', margin: 'normal', cols: 'auto', gray: 'off' };
const pMargin = () => MARGINS[PRINT.margin] != null ? MARGINS[PRINT.margin] : MARGINS.normal;

function setPageStyle(paper) {
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
  const P = PAPER[paper];
  st.textContent = '@page{size:' + P.size + ' ' + P.orient + ';margin:' + pMargin() + 'mm}';
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
  const availW = P.w - pMargin() * 2;
  const availH = P.h - pMargin() * 2;
  const headH = 12;
  const withNote = PRINT.note === 'on';
  const bname = S.board ? S.board.name : 'MOOD BOARD';
  const stamp = new Date().toLocaleDateString('ja-JP');
  const items = (PRINT.scope === 'picked' && S.picked.length)
    ? S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean)
    : S.items;
  const paper = $('#paper');
  paper.innerHTML = '';
  paper.classList.toggle('gray', PRINT.gray === 'on');
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
      d.className = 'pi' + (it.type === 'text' ? ' pi-text' : '') + (it.type === 'color' ? ' pi-color' : '');
      d.style.left = (offX + (it.x - x1) * sc) + 'mm';
      d.style.top = (offY + (it.y - y1) * sc) + 'mm';
      d.style.width = (it.w * sc) + 'mm';
      d.style.height = (it.h * sc) + 'mm';
      if (it.type === 'color') {
        d.style.background = it.hex || '#888';
        const t = document.createElement('div');
        t.className = 'pcolor-hex'; t.textContent = (it.hex || '').toUpperCase();
        t.style.color = readableOn(it.hex);
        d.appendChild(t);
      } else if (it.type === 'text') {
        const t = document.createElement('div'); t.className = 'ptext-body'; t.textContent = it.text || '';
        d.appendChild(t);
      } else {
        const g = document.createElement('img'); g.src = printSrcOf(it);
        d.appendChild(g);
      }
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
      if (it.type === 'color') {
        d.classList.add('p-one-color');
        const sw = document.createElement('div');
        sw.className = 'pcolor-big';
        sw.style.background = it.hex || '#888';
        sw.style.color = readableOn(it.hex);
        sw.textContent = (it.hex || '').toUpperCase();
        d.appendChild(sw);
      } else if (it.type === 'text') {
        d.classList.add('p-one-text');
        const t = document.createElement('div'); t.className = 'ptext-body big'; t.textContent = it.text || '';
        d.appendChild(t);
      } else {
        const g = document.createElement('img'); g.src = printSrcOf(it);
        d.appendChild(g);
        if (withNote && it.note) {
          const c = document.createElement('div'); c.className = 'pcap'; c.textContent = it.note;
          d.appendChild(c);
        }
      }
      sheet.appendChild(d);
      paper.appendChild(sheet);
    });
    return items.length;
  }

  const cols = PRINT.cols === 'auto' ? P.cols : Math.max(1, parseInt(PRINT.cols, 10) || P.cols);
  const gap = 4;
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
      d.className = 'pi' + (it.type === 'text' ? ' pi-text' : '') + (it.type === 'color' ? ' pi-color' : '');
      if (it.type === 'color') {
        d.style.background = it.hex || '#888';
        d.style.aspectRatio = '1';
        const t = document.createElement('div');
        t.className = 'pcolor-hex'; t.textContent = (it.hex || '').toUpperCase();
        t.style.color = readableOn(it.hex);
        d.appendChild(t);
      } else if (it.type === 'text') {
        const t = document.createElement('div'); t.className = 'ptext-body'; t.textContent = it.text || '';
        d.appendChild(t);
      } else {
        const g = document.createElement('img'); g.src = printSrcOf(it);
        d.appendChild(g);
        if (withNote && it.note) {
          const c = document.createElement('div'); c.className = 'pcap'; c.textContent = it.note;
          d.appendChild(c);
        }
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

const PRINT_CHIPS = [['#pc-mode', 'mode'], ['#pc-paper', 'paper'], ['#pc-margin', 'margin'],
                     ['#pc-cols', 'cols'], ['#pc-scope', 'scope'], ['#pc-note', 'note'], ['#pc-gray', 'gray']];

function syncPrintChips() {
  PRINT_CHIPS.forEach(([sel, key]) => {
    $$(sel + ' .chip').forEach(b => b.classList.toggle('on', b.dataset.v === PRINT[key]));
  });
  $$('#pc-scope .chip').forEach(b => {
    if (b.dataset.v === 'picked') {
      b.disabled = S.picked.length === 0;
      if (b.disabled && PRINT.scope === 'picked') { PRINT.scope = 'all'; }
    }
  });
  // 「1行に何枚」は格子のときだけ意味がある
  $('#pc-cols-row').hidden = PRINT.mode !== 'grid';
  updatePrintCount();
}

/* 印刷する前に、何ページになるかを出しておく（紙を無駄にしないため） */
function updatePrintCount() {
  const el = $('#print-count');
  if (!el) return;
  let pages = 0;
  try { pages = buildPrint(); } catch (e) { pages = 0; }
  const P = PAPER[PRINT.paper];
  el.innerHTML = pages
    ? '<b>' + pages + ' ページ</b>になります（' + P.size + ' ' + (P.orient === 'portrait' ? 'たて' : 'よこ') + '）'
    : '印刷するものがありません';
}

PRINT_CHIPS.forEach(([sel, key]) => {
  $$(sel + ' .chip').forEach(b => b.onclick = () => {
    PRINT[key] = b.dataset.v;
    if (key === 'paper') paperTouched = true;
    syncPrintChips();
  });
});

$('#menu-print').onclick = () => {
  if (S.view !== 'board') { closeSheets(); return toast('先にボードを開いてください'); }
  suggestPaper();
  PRINT.scope = 'all';
  syncPrintChips();
  $('#sheet-print').querySelector('h2').textContent = '印刷 / PDF';
  openSheet('#sheet-print');
};

/* 選んでいる状態から直接。ここまで来た人は「選んだものだけ」を出したいので、
   対象を先に立てておく（≡ → 印刷 → 対象を切り替える、の3手を省く） */
$('#btn-bulk-print').onclick = () => {
  if (!S.picked.length) return;
  suggestPaper();
  PRINT.scope = 'picked';
  syncPrintChips();
  $('#sheet-print').querySelector('h2').textContent = '選んだ ' + S.picked.length + ' つを出す';
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

/* ==========================================================================
   重複をさがす
   見た目が近い写真を平均ハッシュ（aHash）で見つけてまとめる。
   写真そのものは消さず、ゴミ箱に入れるだけ（いつでも戻せる）。
   ========================================================================== */
async function hashImage(rec) {
  if (rec.ahash) return rec.ahash;
  try {
    const bmp = await createImageBitmap(rec.thumb || rec.full);
    const N = 8;
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, N, N);
    bmp.close && bmp.close();
    const d = ctx.getImageData(0, 0, N, N).data;
    const gray = [];
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      gray.push(g); sum += g;
    }
    const avg = sum / gray.length;
    const bits = gray.map(g => (g > avg ? '1' : '0')).join('');
    rec.ahash = bits;
    await dbPut('images', rec);
    return bits;
  } catch (e) { return null; }
}
function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
async function findDuplicates() {
  const recs = [...S.imgs.values()];
  if (recs.length < 2) { toast('写真が少ないので見つかりません'); return; }
  progCancelled = false;
  progOpen('似た写真をさがしています');
  for (let i = 0; i < recs.length; i++) {
    if (progCancelled) break;
    progSet(i, recs.length, (i + 1) + ' / ' + recs.length);
    await hashImage(recs[i]);
    if (i % 6 === 5) await new Promise(r => setTimeout(r, 0));
  }
  progClose();

  const parent = new Map(recs.map(r => [r.id, r.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      if (hamming(recs[i].ahash, recs[j].ahash) <= 4) union(recs[i].id, recs[j].id);
    }
  }
  const groups = new Map();
  for (const r of recs) {
    const root = find(r.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  }
  renderDupSheet([...groups.values()].filter(g => g.length >= 2));
}
function renderDupSheet(groups) {
  const box = $('#dup-groups');
  box.innerHTML = '';
  $('#dup-empty').hidden = groups.length > 0;
  groups.forEach(group => {
    group.sort((a, b) => (b.full.size || 0) - (a.full.size || 0));
    const row = document.createElement('div');
    row.className = 'dup-row';
    group.forEach((rec, idx) => {
      const cell = document.createElement('div');
      cell.className = 'dup-cell' + (idx === 0 ? ' keep' : '');
      const im = document.createElement('img');
      im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
      cell.appendChild(im);
      if (idx === 0) {
        const tag = document.createElement('div'); tag.className = 'dup-tag'; tag.textContent = '残す候補';
        cell.appendChild(tag);
      } else {
        const btn = document.createElement('button');
        btn.className = 'dup-x'; btn.textContent = 'ゴミ箱へ';
        btn.onclick = async () => {
          const targets = S.items.filter(i => i.imageId === rec.id && !i.trashedAt);
          if (!targets.length) return;
          pushHistory();
          const ids = new Set(targets.map(i => i.id));
          for (const it of targets) { it.trashedAt = nowISO(); await dbPut('items', it); }
          S.items = S.items.filter(i => !ids.has(i.id));
          targets.forEach(it => { const el = itemEl(it.id); if (el) el.remove(); });
          cell.remove();
          $('#board-empty').hidden = S.items.length > 0;
          renderPalette(); touchBoard();
          toast('ゴミ箱に入れました');
        };
        cell.appendChild(btn);
      }
      row.appendChild(cell);
    });
    box.appendChild(row);
  });
  openSheet('#sheet-dup');
}

/* 色順に並べる。無彩色は最後にまとめて明るさ順 */
async function arrangeByColor() {
  if (!S.items.length) return;
  progCancelled = false;
  await ensureColors(true);
  pushHistory();

  const keyed = S.items.map(it => {
    const rec = S.imgs.get(it.imageId);
    const dom = (rec && rec.dom) || { h: 0, s: 0, l: 0.5 };
    return { it, dom, gray: dom.s < 0.14 };
  });
  const colored = keyed.filter(k => !k.gray).sort((a, b) => a.dom.h - b.dom.h || b.dom.s - a.dom.s);
  const grays = keyed.filter(k => k.gray).sort((a, b) => b.dom.l - a.dom.l);
  const order = [...colored, ...grays].map(k => k.it);

  const colW = BASE_W, gap = gapPx(), n = order.length;
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

/* 「文字を置く」ノートを合成先のcanvasに描く（改行はそのまま、はみ出た分は折り返す） */
function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = ch; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}
function drawTextCardToCanvas(ctx, it, x, y, w, h, scale) {
  ctx.save();
  if (SET.shadow === 'on') {
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 14 * scale;
    ctx.shadowOffsetY = 5 * scale;
  }
  ctx.fillStyle = '#f4ecd0';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.fillStyle = '#2a2415';
  const fs = Math.max(10, 14 * scale);
  ctx.font = fs + 'px -apple-system,"Hiragino Sans",sans-serif';
  ctx.textBaseline = 'top';
  const pad = 12 * scale;
  const lines = wrapCanvasText(ctx, it.text || '', w - pad * 2);
  let ty = y + pad;
  for (const ln of lines) {
    if (ty > y + h - pad) break;
    ctx.fillText(ln, x + pad, ty);
    ty += fs * 1.4;
  }
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
    const bp = bgPreset();
    ctx.fillStyle = bp.bg;
    ctx.fillRect(0, 0, W, H);

    // 見出し
    ctx.fillStyle = bp.fg;
    ctx.font = '600 ' + Math.round(26 * scale) + 'px -apple-system,"Hiragino Sans",sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(S.board.name, PAD * scale, HEAD * scale * 0.45);
    ctx.fillStyle = bp.sub;
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
      const x = (it.x - b.x1 + PAD) * scale;
      const y = (it.y - b.y1 + PAD) * scale + HEAD * scale;
      const w = it.w * scale, h = it.h * scale;
      if (it.type === 'color') {
        ctx.save();
        if (SET.shadow === 'on') {
          ctx.shadowColor = 'rgba(0,0,0,.5)';
          ctx.shadowBlur = 14 * scale;
          ctx.shadowOffsetY = 5 * scale;
        }
        ctx.fillStyle = it.hex || '#888';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        ctx.fillStyle = readableOn(it.hex);
        ctx.font = Math.round(13 * scale) + 'px ui-monospace,Menlo,monospace';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText((it.hex || '').toUpperCase(), x + 10 * scale, y + h - 11 * scale);
        continue;
      }
      if (it.type === 'text') {
        drawTextCardToCanvas(ctx, it, x, y, w, h, scale);
        if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
        continue;
      }
      const rec = S.imgs.get(it.imageId);
      if (!rec) continue;
      try {
        const bmp = await createImageBitmap(rec.full);
        ctx.save();
        if (SET.shadow === 'on') {
          ctx.shadowColor = 'rgba(0,0,0,.55)';
          ctx.shadowBlur = 18 * scale;
          ctx.shadowOffsetY = 6 * scale;
        }
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

let mvBulk = false;
async function openBulkMoveSheet() {
  if (!S.picked.length) return;
  mvBulk = true;
  await openMoveSheet(true);
}
async function openMoveSheet(bulk) {
  if (!bulk) {
    mvBulk = false;
    const it = selItem();
    if (!it) return;
  }
  $('#mv-here span b').textContent = mvBulk ? 'このボードの中で複製（' + S.picked.length + ' 枚）' : 'このボードの中で複製';
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
  const ids = mvBulk ? S.picked.slice() : (S.sel ? [S.sel] : []);
  if (!ids.length) return;
  closeSheets();
  pushHistory();
  let n = 0;
  for (const id of ids) {
    const it = S.items.find(i => i.id === id);
    if (!it) continue;
    if (mvMode === 'copy') {
      const copy = { ...it, id: uid(), boardId, z: Date.now() % 100000 + n };
      delete copy.trashedAt;
      await dbPut('items', copy);
    } else {
      it.boardId = boardId;
      await dbPut('items', it);
      S.items = S.items.filter(i => i.id !== it.id);
      const el = itemEl(it.id); if (el) el.remove();
    }
    n++;
  }
  if (mvMode !== 'copy') {
    selectItem(null);
    $('#board-empty').hidden = S.items.length > 0;
    renderPalette();
  }
  if (mvBulk) stopPicking();
  mvBulk = false;
  const b = await dbGet('boards', boardId);
  if (b) { b.updatedAt = nowISO(); await dbPut('boards', b); }
  touchBoard();
  toast(n + ' 枚' + (mvMode === 'copy' ? 'コピーしました' : '移しました'));
}

/* --- 複数選択のときの操作 --- */
$('#btn-bulk-move').onclick = openBulkMoveSheet;

async function duplicateItems(ids) {
  const maxZ0 = Math.max(0, ...S.items.map(i => i.z || 0));
  let zk = 1;
  const copies = [];
  for (const id of ids) {
    const it = S.items.find(i => i.id === id);
    if (!it) continue;
    const copy = { ...it, id: uid(), x: it.x + 26, y: it.y + 26, z: maxZ0 + zk++ };
    delete copy.trashedAt;
    copies.push(copy);
  }
  if (!copies.length) return 0;
  pushHistory();
  await dbPutMany('items', copies);
  S.items.push(...copies);
  copies.forEach(c => canvas.appendChild(makeItemEl(c)));
  touchBoard();
  return copies.length;
}

/* ========================== そろえる =====================================
   選んだものを、きれいな位置関係に置き直す。
   ========================================================================== */
const pickedItems = () => S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean);

async function applyAlign(mode) {
  const list = pickedItems();
  if (list.length < 2) return toast('2枚以上えらんでください');
  if ((mode === 'distx' || mode === 'disty') && list.length < 3) {
    return toast('等間隔にするには3枚以上えらんでください');
  }
  pushHistory();
  const gap = gapPx();
  const L = Math.min(...list.map(i => i.x));
  const R = Math.max(...list.map(i => i.x + i.w));
  const T = Math.min(...list.map(i => i.y));
  const B = Math.max(...list.map(i => i.y + i.h));
  const CX = (L + R) / 2, CY = (T + B) / 2;

  if (mode === 'left') list.forEach(i => i.x = Math.round(L));
  else if (mode === 'right') list.forEach(i => i.x = Math.round(R - i.w));
  else if (mode === 'cx') list.forEach(i => i.x = Math.round(CX - i.w / 2));
  else if (mode === 'top') list.forEach(i => i.y = Math.round(T));
  else if (mode === 'bottom') list.forEach(i => i.y = Math.round(B - i.h));
  else if (mode === 'cy') list.forEach(i => i.y = Math.round(CY - i.h / 2));
  else if (mode === 'distx') {
    const s = [...list].sort((a, b) => a.x - b.x);
    const space = (R - L - s.reduce((n, i) => n + i.w, 0)) / (s.length - 1);
    let x = L;
    s.forEach(i => { i.x = Math.round(x); x += i.w + space; });
  } else if (mode === 'disty') {
    const s = [...list].sort((a, b) => a.y - b.y);
    const space = (B - T - s.reduce((n, i) => n + i.h, 0)) / (s.length - 1);
    let y = T;
    s.forEach(i => { i.y = Math.round(y); y += i.h + space; });
  } else if (mode === 'samew') {
    const w = Math.round(list.reduce((n, i) => n + i.w, 0) / list.length);
    list.forEach(i => { const r = i.h / i.w; i.w = w; i.h = Math.round(w * r); });
  } else if (mode === 'sameh') {
    const h = Math.round(list.reduce((n, i) => n + i.h, 0) / list.length);
    list.forEach(i => { const r = i.w / i.h; i.h = h; i.w = Math.round(h * r); });
  } else if (mode === 'row') {
    const s = [...list].sort((a, b) => a.x - b.x);
    let x = L;
    s.forEach(i => { i.x = Math.round(x); i.y = Math.round(CY - i.h / 2); x += i.w + gap; });
  } else if (mode === 'col') {
    const s = [...list].sort((a, b) => a.y - b.y);
    let y = T;
    s.forEach(i => { i.y = Math.round(y); i.x = Math.round(CX - i.w / 2); y += i.h + gap; });
  } else if (mode === 'stack') {
    [...list].forEach((i, n) => { i.x = Math.round(L + n * 18); i.y = Math.round(T + n * 18); });
  }

  list.forEach(updateItemEl);
  await dbPutMany('items', list);
  touchBoard();
}

$('#btn-bulk-align').onclick = () => {
  if (S.picked.length < 2) return toast('2枚以上えらんでください');
  $('#align-n').textContent = S.picked.length;
  openSheet('#sheet-align');
};
$$('#sheet-align .chip[data-align]').forEach(b => b.onclick = () => applyAlign(b.dataset.align));
$('#align-close').onclick = closeSheets;
$('#btn-bulk-trash').onclick = async () => {
  if (!S.picked.length) return;
  const n = S.picked.length;
  const ok = await confirmAsk(n + ' 枚をゴミ箱に入れます');
  if (!ok) return;
  pushHistory();
  const ids = new Set(S.picked);
  for (const id of ids) {
    const it = S.items.find(i => i.id === id);
    if (!it) continue;
    it.trashedAt = nowISO();
    await dbPut('items', it);
  }
  S.items = S.items.filter(i => !ids.has(i.id));
  stopPicking();
  if (S.mode === 'grid') renderGrid(); else renderCanvas();
  $('#board-empty').hidden = S.items.length > 0;
  renderPalette();
  touchBoard();
  toast(n + ' 枚をゴミ箱に入れました');
};

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
    const rec = it.imageId ? await dbGet('images', it.imageId) : null;
    const cell = document.createElement('div');
    cell.className = 'tr-cell';
    if (it.type === 'text') {
      const t = document.createElement('div'); t.className = 'tr-text'; t.textContent = it.text || '';
      cell.appendChild(t);
    } else {
      const im = document.createElement('img');
      if (rec) im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
      cell.appendChild(im);
    }
    const btn = document.createElement('button');
    btn.textContent = 'もどす';
    btn.onclick = () => restoreItem(it.id);
    cell.appendChild(btn);
    grid.appendChild(cell);
  }
  $('#trash-empty').hidden = trashed.length > 0;
  $('#trash-restore-all').hidden = trashed.length === 0;
  $('#trash-empty-all').hidden = trashed.length === 0;
  openSheet('#sheet-trash');
}

async function restoreItem(id) {
  const it = await dbGet('items', id);
  if (!it) return;
  pushHistory();
  delete it.trashedAt;
  it.z = Math.max(0, ...S.items.map(i => i.z || 0)) + 1;
  await dbPut('items', it);
  S.items.push(it);
  if (it.imageId) {
    const rec = await dbGet('images', it.imageId);
    if (rec) S.imgs.set(rec.id, rec);
  }
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
  if (trashed.length) pushHistory();
  for (const it of trashed) {
    delete it.trashedAt;
    await dbPut('items', it);
  }
  closeSheets();
  await openBoard(S.boardId);
  toast(trashed.length + ' 枚もどしました');
}

/* ==========================================================================
   ざっと眺める表示（Pinterestのように隙間なく詰める）
   キャンバスは「置いて考える」ため、こちらは「たくさん見る」ため。
   ========================================================================== */
function renderGrid() {
  const box = $('#grid-scroll');
  box.innerHTML = '';
  // 新しく入れたものが上に来るほうが探しやすい
  const list = [...S.items].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '') || (b.z || 0) - (a.z || 0));
  list.forEach((it, n) => {
    const cell = document.createElement('div');
    cell.className = 'gcell' + (it.type === 'text' ? ' gtext' : '') + (it.type === 'color' ? ' gcolor' : '');
    cell.dataset.id = it.id;
    cell.style.setProperty('--dl', Math.min(n * 22, 420) + 'ms');
    if (it.type === 'color') {
      cell.style.aspectRatio = '1';
      cell.style.background = it.hex || '#888';
      const t = document.createElement('div');
      t.className = 'sw-hex';
      t.textContent = (it.hex || '').toUpperCase();
      t.style.color = readableOn(it.hex);
      cell.appendChild(t);
    } else if (it.type === 'text') {
      cell.style.aspectRatio = (it.w / it.h).toFixed(3);
      const t = document.createElement('div');
      t.className = 'gtext-body';
      t.textContent = it.text || '';
      cell.appendChild(t);
    } else {
      const rec = S.imgs.get(it.imageId);
      const im = document.createElement('img');
      im.loading = 'lazy';
      // 読み込み前に高さを確保して、がたつかせない
      im.width = it.w; im.height = it.h;
      if (rec) im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
      cell.appendChild(im);
      if (it.note) {
        const nt = document.createElement('div');
        nt.className = 'gnote';
        nt.textContent = it.note;
        cell.appendChild(nt);
      }
    }
    cell.onclick = () => {
      if (S.picking) { togglePick(it.id); syncGridPick(); }
      else if (it.type === 'text') editTextItem(it);
      else if (it.type === 'color') copyHex(it.hex);
      else openViewer(it);
    };
    box.appendChild(cell);
  });
  syncGridPick();
  applyFilter();
}

function syncGridPick() {
  $$('#grid-scroll .gcell').forEach(cell => {
    const idx = S.picked.indexOf(cell.dataset.id);
    const badge = cell.querySelector('.gno');
    if (idx >= 0) {
      cell.classList.add('picked');
      if (badge) badge.textContent = idx + 1;
      else {
        const b = document.createElement('div');
        b.className = 'gno';
        b.textContent = idx + 1;
        cell.appendChild(b);
      }
    } else {
      cell.classList.remove('picked');
      if (badge) badge.remove();
    }
  });
}

function setViewMode(mode) {
  S.mode = mode;
  const grid = mode === 'grid';
  $('#canvas-wrap').hidden = grid;
  $('#grid-view').hidden = !grid;
  $('#zoom-readout').hidden = grid;
  $('#btn-view').classList.toggle('on', grid);
  if (grid) {
    selectItem(null);
    renderGrid();
  } else {
    renderCanvas();
    fitAll(true);
    requestAnimationFrame(() => revealItems());
  }
  // 並べ替え系はキャンバスでしか意味がない
  $('#btn-arrange').disabled = grid;
  $('#btn-fit').disabled = grid;
  try { localStorage.setItem('mb_mode', mode); } catch (e) { }
}

$('#btn-view').onclick = () => setViewMode(S.mode === 'grid' ? 'canvas' : 'grid');

/* ==========================================================================
   USBとつなぐ
   USBの中の MOOD BOARD フォルダを台帳（manifest.json）で突き合わせ、
   まだ無い写真だけをやりとりする。どちらに何が無いかが一目で分かるように。
   ※ フォルダに直接つなげるのは PCのChrome/Edge のみ（File System Access API）
   ========================================================================== */
const USB_FOLDER = 'MOOD BOARD';

/* 写真を持たないもの（文字カード・色見本）。imageId で突き合わせる所からは漏れるので、
   どこで数えるときも必ずこれを通す */
const isCardItem = (i) => i.type === 'text' || i.type === 'color';

/* 「3 枚」「3 枚 ＋ カード 2 つ」のように出す */
function countLabel(photos, cards) {
  return photos + ' 枚' + (cards ? ' ＋ カード ' + cards + ' つ' : '');
}
let usbRoot = null;      // MOOD BOARD フォルダ
let usbManifest = null;
let usbDiff = null;

const fsOK = () => typeof window.showDirectoryPicker === 'function';

/* 選んだフォルダを覚えておく（次回は選び直さずに済む） */
async function saveUsbHandle(handle) {
  try { await dbPut('meta', { key: 'usbHandle', value: handle, name: handle.name, at: nowISO() }); }
  catch (e) { /* 保存できない環境でも動作は続ける */ }
}
async function loadUsbHandle() {
  try { return await dbGet('meta', 'usbHandle'); } catch (e) { return null; }
}

async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  const q = await handle.queryPermission({ mode });
  if (q === 'granted') return true;
  const r = await handle.requestPermission({ mode });
  return r === 'granted';
}

/* 選んだフォルダの中から MOOD BOARD を探す。無ければそれ自身が中身か確認 */
async function resolveUsbRoot(dir, create = false) {
  // 選んだのが MOOD BOARD フォルダそのものだった場合
  try {
    await dir.getFileHandle('manifest.json');
    return dir;
  } catch (e) { /* 次へ */ }
  try {
    return await dir.getDirectoryHandle(USB_FOLDER, { create });
  } catch (e) {
    return create ? await dir.getDirectoryHandle(USB_FOLDER, { create: true }) : null;
  }
}

async function pickUSB() {
  if (!fsOK()) return;
  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'desktop' });
  } catch (e) { return; }         // 選ばずに閉じた
  await saveUsbHandle(dir);
  usbRoot = await resolveUsbRoot(dir, false) || dir;
  usbRoot._parent = dir;
  await refreshUsb(dir);
}

async function reconnectUSB() {
  const rec = await loadUsbHandle();
  if (!rec || !rec.value) return toast('前回のUSBが見つかりません');
  const ok = await ensurePermission(rec.value);
  if (!ok) return toast('USBへのアクセスが許可されませんでした');
  usbRoot = await resolveUsbRoot(rec.value, false) || rec.value;
  usbRoot._parent = rec.value;
  await refreshUsb(rec.value);
}

/* USBの台帳を読む */
async function readUsbManifest() {
  if (!usbRoot) return null;
  try {
    const fh = await usbRoot.getFileHandle('manifest.json');
    const txt = await (await fh.getFile()).text();
    return JSON.parse(txt);
  } catch (e) { return null; }
}

/* 突き合わせる */
async function computeUsbDiff() {
  const localImgs = await dbAll('images');
  const localIds = new Set(localImgs.map(r => r.id));
  const m = usbManifest;
  const usbImgs = (m && m.images) || [];
  const usbIds = new Set(usbImgs.map(i => i.id));

  // 文字カードと色見本は写真を持たないので、画像の突き合わせからは漏れる。
  // 別に数えておかないと「書き出したのに戻ってこない」状態になる。
  const localCards = (await dbAll('items')).filter(isCardItem);
  const localCardIds = new Set(localCards.map(i => i.id));
  const usbCards = ((m && m.items) || []).filter(isCardItem);
  const usbCardIds = new Set(usbCards.map(i => i.id));

  return {
    pull: usbImgs.filter(i => !localIds.has(i.id)),          // USBにあって手元に無い
    push: localImgs.filter(r => !usbIds.has(r.id)),          // 手元にあってUSBに無い
    same: usbImgs.filter(i => localIds.has(i.id)),
    pullCards: usbCards.filter(i => !localCardIds.has(i.id)),
    pushCards: localCards.filter(i => !usbCardIds.has(i.id)),
    hasManifest: !!m,
  };
}

async function refreshUsb(parentDir) {
  progOpen('USBを調べています');
  try {
    usbManifest = await readUsbManifest();
    usbDiff = await computeUsbDiff();
    progClose();
    renderUsbPanel(parentDir);
  } catch (e) {
    progClose();
    toast('USBを読めませんでした<br>' + e.message);
  }
}

function renderUsbPanel(parentDir) {
  $('#usb-intro').hidden = true;
  $('#usb-panel').hidden = false;
  const label = (parentDir && parentDir.name ? parentDir.name + ' / ' : '') + USB_FOLDER;
  $('#usb-name').textContent = usbDiff.hasManifest ? label : label + '（まだ空）';
  $('#usb-empty').hidden = usbDiff.hasManifest;

  // USB → この端末
  const pull = usbDiff.pull, pullCards = usbDiff.pullCards || [];
  $('#usb-pull-group').hidden = pull.length === 0 && pullCards.length === 0;
  $('#usb-pull-n').textContent = countLabel(pull.length, pullCards.length);
  fillUsbThumbs($('#usb-pull-thumbs'), pull, 'usb');

  // この端末 → USB
  const push = usbDiff.push, pushCards = usbDiff.pushCards || [];
  $('#usb-push-group').hidden = push.length === 0 && pushCards.length === 0;
  $('#usb-push-n').textContent = countLabel(push.length, pushCards.length);
  fillUsbThumbs($('#usb-push-thumbs'), push, 'local');

  $('#usb-same-group').hidden = usbDiff.same.length === 0;
  $('#usb-same-n').textContent = usbDiff.same.length + ' 枚';

  if (!pull.length && !push.length && !pullCards.length && !pushCards.length && usbDiff.hasManifest) {
    toast('ぜんぶ揃っています');
  }
}

/* 未同期のサムネを並べる（多いときは頭だけ） */
const usbThumbURLs = [];
async function fillUsbThumbs(box, list, kind) {
  box.innerHTML = '';
  const LIMIT = 18;
  let imgDir = null;
  if (kind === 'usb') {
    try { imgDir = await usbRoot.getDirectoryHandle('images'); } catch (e) { }
  }
  for (const entry of list.slice(0, LIMIT)) {
    const im = document.createElement('img');
    box.appendChild(im);
    if (kind === 'local') {
      im.src = blobURL(entry.id, 't', entry.thumb || entry.full);
    } else if (imgDir) {
      try {
        const f = await (await imgDir.getFileHandle(entry.file.split('/').pop())).getFile();
        const u = URL.createObjectURL(f);
        usbThumbURLs.push(u);
        im.src = u;
      } catch (e) { im.className = 'ph2'; }
    } else im.className = 'ph2';
  }
  if (list.length > LIMIT) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = 'ほか ' + (list.length - LIMIT) + ' 枚';
    box.appendChild(more);
  }
}
function releaseUsbThumbs() {
  usbThumbURLs.forEach(u => URL.revokeObjectURL(u));
  usbThumbURLs.length = 0;
}

/* ---------- USB → この端末 ---------- */
async function pullFromUSB() {
  if (!usbRoot || !usbDiff) return;
  if (!usbDiff.pull.length && !(usbDiff.pullCards || []).length) return;
  progOpen('USBから取り込んでいます');
  progCancelled = false;
  let ok = 0, ng = 0;
  try {
    // カードだけの差分なら images フォルダが無いこともある
    let imgDir = null;
    try { imgDir = await usbRoot.getDirectoryHandle('images'); }
    catch (e) { imgDir = null; }
    const list = imgDir ? usbDiff.pull : [];
    for (let i = 0; i < list.length; i++) {
      if (progCancelled) break;
      progSet(i, list.length, (i + 1) + ' / ' + list.length + ' 枚');
      const meta = list[i];
      try {
        const file = await (await imgDir.getFileHandle(meta.file.split('/').pop())).getFile();
        // サムネは手元で作り直す（USBには置いていない）
        let thumb = file;
        try {
          const dec = await decodeImage(file);
          thumb = await canvasToBlob(drawCanvas(dec.src, dec.w, dec.h, THUMB_EDGE), pickType(), THUMB_Q);
          dec.close();
        } catch (e) { /* サムネが作れなくても本体があればよい */ }
        await dbPut('images', {
          id: meta.id, full: file, thumb,
          w: meta.w, h: meta.h, srcUrl: meta.srcUrl || '', addedAt: meta.addedAt || nowISO(),
          hex: meta.hex, dom: (meta.hue !== undefined ? { h: meta.hue, s: meta.sat, l: meta.lum } : undefined),
        });
        ok++;
      } catch (e) { ng++; }
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }

    // ボードと配置も、手元に無いものを足す
    const m = usbManifest || {};
    const haveBoards = new Set((await dbAll('boards')).map(b => b.id));
    const newBoards = (m.boards || []).filter(b => !haveBoards.has(b.id));
    for (const b of newBoards) await dbPut('boards', { ...b, updatedAt: nowISO() });

    const haveItems = new Set((await dbAll('items')).map(i => i.id));
    const haveImgs = new Set((await dbAll('images')).map(r => r.id));
    const newItems = (m.items || [])
      .filter(i => !haveItems.has(i.id)
        && (isCardItem(i) || haveImgs.has(i.imageId)))
      .map(i => { const c = { ...i }; if (!c.trashedAt) delete c.trashedAt; return c; });
    if (newItems.length) await dbPutMany('items', newItems);

    _srcIndex = null;
    progClose();
    const gotCards = newItems.filter(isCardItem).length;
    toast(ok + ' 枚をこの端末に保存しました'
      + (gotCards ? '<br>文字・色のカード ' + gotCards + ' つも増えました' : '')
      + (newBoards.length ? '<br>ボード ' + newBoards.length + ' 個も増えました' : '')
      + (ng ? '<br>' + ng + ' 枚は読めませんでした' : ''), 5000);
    await refreshUsb(usbRoot._parent);
    if (S.view === 'board') await openBoard(S.boardId); else renderHome();
  } catch (e) {
    progClose();
    toast('取り込めませんでした<br>' + e.message);
  }
}

/* ---------- この端末 → USB ---------- */
async function pushToUSB() {
  if (!usbRoot) return;
  progOpen('USBに保存しています');
  progCancelled = false;
  try {
    const imgDir = await usbRoot.getDirectoryHandle('images', { create: true });
    const list = (usbDiff && usbDiff.push) || [];
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      if (progCancelled) break;
      progSet(i, list.length, (i + 1) + ' / ' + list.length + ' 枚');
      const rec = list[i];
      const ext = (rec.full.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const fh = await imgDir.getFileHandle(rec.id + '.' + ext, { create: true });
      const w = await fh.createWritable();
      await w.write(rec.full);
      await w.close();
      ok++;
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }

    // 台帳とビューアを書き直す（USB側にしか無いものは消さずに残す）
    progSet(1, 1, '台帳を書き直しています');
    const { files } = await buildViewerPayload(() => { });
    const keep = new Set(['index.html', 'viewer.css', 'viewer.js', 'data.js', 'manifest.json', 'README.txt']);
    const merged = await mergeManifest(files);
    for (const f of files) {
      if (!keep.has(f.name)) continue;
      const data = f.name === 'manifest.json' ? te.encode(JSON.stringify(merged, null, 1)) : f.data;
      const fh = await usbRoot.getFileHandle(f.name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
    }
    progClose();
    toast(ok + ' 枚をUSBに保存しました<br>他の端末でも、ここから取り込めます', 5000);
    await refreshUsb(usbRoot._parent);
  } catch (e) {
    progClose();
    toast('保存できませんでした<br>' + e.message);
  }
}

/* 新しい台帳は「USBにあったもの」＋「手元にあるもの」の和。片方だけのものを消さない */
async function mergeManifest(files) {
  const fresh = JSON.parse(new TextDecoder().decode(
    files.find(f => f.name === 'manifest.json').data));
  const old = usbManifest;
  if (!old) return fresh;
  const byId = (arr) => new Map((arr || []).map(x => [x.id, x]));
  const mergeList = (a, b) => {
    const m = byId(a);
    (b || []).forEach(x => { if (!m.has(x.id)) m.set(x.id, x); });
    return [...m.values()];
  };
  return {
    ...fresh,
    boards: mergeList(fresh.boards, old.boards),
    items: mergeList(fresh.items, old.items),
    images: mergeList(fresh.images, old.images),
  };
}

/* ---------- 配線 ---------- */
$('#menu-usb-sync').onclick = async () => {
  closeSheets();
  usbRoot = null; usbManifest = null; usbDiff = null;
  releaseUsbThumbs();
  $('#usb-intro').hidden = false;
  $('#usb-panel').hidden = true;
  $('#usb-unsupported').hidden = fsOK();
  $('#usb-pick').hidden = !fsOK();
  const rec = await loadUsbHandle();
  const has = !!(rec && rec.value) && fsOK();
  $('#usb-reconnect').hidden = !has;
  if (has) $('#usb-last').textContent = (rec.name || '') + '（' + (rec.at || '').slice(0, 10) + ' に接続）';
  openSheet('#sheet-usb');
};
$('#usb-pick').onclick = pickUSB;
$('#usb-reconnect').onclick = reconnectUSB;
$('#usb-refresh').onclick = () => refreshUsb(usbRoot && usbRoot._parent);
$('#usb-pull').onclick = pullFromUSB;
$('#usb-push').onclick = pushToUSB;
$('#usb-close').onclick = () => { releaseUsbThumbs(); closeSheets(); };

/* ==========================================================================
   切り抜き
   元の画像は消さずに残し、切り抜いた結果を「別の写真」として作る。
   こうすると、サムネ・色の抽出・USB同期・印刷など既存の仕組みがそのまま使える。
   item.croppedFrom に元のIDを控えるので、いつでも元の形に戻せる。
   ========================================================================== */
const CROP = { rect: null, ratio: 'free', nat: { w: 0, h: 0 }, fit: null, item: null, g: null };

function cropFitRect() {
  // 画面に収まるように縮小表示された画像の、実際の位置と大きさ
  const img = $('#crop-img'), stage = $('#crop-stage');
  const sr = stage.getBoundingClientRect(), ir = img.getBoundingClientRect();
  return { x: ir.left - sr.left, y: ir.top - sr.top, w: ir.width, h: ir.height };
}

function drawCropBox() {
  const b = $('#crop-box'), r = CROP.rect, f = CROP.fit;
  if (!r || !f) return;
  b.style.left = (f.x + r.x * f.w) + 'px';
  b.style.top = (f.y + r.y * f.h) + 'px';
  b.style.width = (r.w * f.w) + 'px';
  b.style.height = (r.h * f.h) + 'px';
  // 外側だけ暗くする（選んだ中はそのまま見える）
  $('#crop-shade').style.clipPath =
    'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,' +
    ' ' + (f.x + r.x * f.w) + 'px ' + (f.y + r.y * f.h) + 'px,' +
    ' ' + (f.x + r.x * f.w) + 'px ' + (f.y + (r.y + r.h) * f.h) + 'px,' +
    ' ' + (f.x + (r.x + r.w) * f.w) + 'px ' + (f.y + (r.y + r.h) * f.h) + 'px,' +
    ' ' + (f.x + (r.x + r.w) * f.w) + 'px ' + (f.y + r.y * f.h) + 'px,' +
    ' ' + (f.x + r.x * f.w) + 'px ' + (f.y + r.y * f.h) + 'px)';
}

/* 縦横比の指定があれば、それに合わせて高さを決め直す */
function applyCropRatio() {
  const r = CROP.rect, f = CROP.fit;
  if (CROP.ratio === 'free' || !r || !f) return;
  const target = parseFloat(CROP.ratio);            // 幅に対する高さの比（画面上の見た目で合わせる）
  const pxW = r.w * f.w, pxH = pxW / target;
  r.h = clamp(pxH / f.h, 0.05, 1);
  if (r.y + r.h > 1) r.y = Math.max(0, 1 - r.h);
}

async function openCrop() {
  const it = viewerItem;
  if (!it || !it.imageId) return toast('写真を選んでから切り抜いてください');
  const rec = S.imgs.get(it.imageId) || await dbGet('images', it.imageId);
  if (!rec) return;
  CROP.item = it;
  CROP.ratio = 'free';
  $$('#crop-ratios .ratio').forEach(b => b.classList.toggle('on', b.dataset.r === 'free'));

  const img = $('#crop-img');
  img.src = blobURL(rec.id, 'f', rec.full);
  $('#crop').hidden = false;
  await new Promise(r => { if (img.complete && img.naturalWidth) r(); else img.onload = r; });
  CROP.nat = { w: img.naturalWidth, h: img.naturalHeight };
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  CROP.fit = cropFitRect();
  // 最初は少し内側を選んだ状態にする（何をする画面か一目で分かる）
  CROP.rect = { x: .08, y: .08, w: .84, h: .84 };
  drawCropBox();
}

function closeCrop() { $('#crop').hidden = true; CROP.g = null; }

/* 画面の向きや大きさが変わると、画像の表示位置も変わる。基準を取り直す */
addEventListener('resize', () => {
  if ($('#crop').hidden || !CROP.rect) return;
  CROP.fit = cropFitRect();
  drawCropBox();
});

/* 画面の上での1点を、画像のなかの比率（0〜1）に直す */
function cropPoint(e) {
  const f = CROP.fit, sr = $('#crop-stage').getBoundingClientRect();
  return {
    x: clamp((e.clientX - sr.left - f.x) / f.w, 0, 1),
    y: clamp((e.clientY - sr.top - f.y) / f.h, 0, 1),
  };
}

$('#crop-stage').addEventListener('pointerdown', (e) => {
  if (!CROP.rect) return;
  const stage = $('#crop-stage');
  try { stage.setPointerCapture(e.pointerId); } catch (err) { }
  const h = e.target.classList && e.target.classList.contains('ch') ? e.target.dataset.h : null;
  const p = cropPoint(e);
  const r = CROP.rect;
  const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (h) CROP.g = { mode: 'corner', h, r0: { ...r } };
  else if (inside) CROP.g = { mode: 'move', p0: p, r0: { ...r } };
  else CROP.g = { mode: 'draw', p0: p };           // 外から引くと、新しく四角を描く
});

$('#crop-stage').addEventListener('pointermove', (e) => {
  if (!CROP.g || !CROP.rect) return;
  const p = cropPoint(e), g = CROP.g, r = CROP.rect;
  if (g.mode === 'draw') {
    r.x = Math.min(g.p0.x, p.x); r.y = Math.min(g.p0.y, p.y);
    r.w = Math.max(.05, Math.abs(p.x - g.p0.x)); r.h = Math.max(.05, Math.abs(p.y - g.p0.y));
    applyCropRatio();
  } else if (g.mode === 'move') {
    r.x = clamp(g.r0.x + (p.x - g.p0.x), 0, 1 - g.r0.w);
    r.y = clamp(g.r0.y + (p.y - g.p0.y), 0, 1 - g.r0.h);
  } else if (g.mode === 'corner') {
    const o = g.r0, right = o.x + o.w, bottom = o.y + o.h;
    if (g.h === 'nw') { r.x = Math.min(p.x, right - .05); r.y = Math.min(p.y, bottom - .05); r.w = right - r.x; r.h = bottom - r.y; }
    if (g.h === 'ne') { r.y = Math.min(p.y, bottom - .05); r.w = Math.max(.05, p.x - o.x); r.h = bottom - r.y; }
    if (g.h === 'sw') { r.x = Math.min(p.x, right - .05); r.w = right - r.x; r.h = Math.max(.05, p.y - o.y); }
    if (g.h === 'se') { r.w = Math.max(.05, p.x - o.x); r.h = Math.max(.05, p.y - o.y); }
    r.w = Math.min(r.w, 1 - r.x); r.h = Math.min(r.h, 1 - r.y);
    applyCropRatio();
  }
  drawCropBox();
});

const endCrop = () => { CROP.g = null; };
$('#crop-stage').addEventListener('pointerup', endCrop);
$('#crop-stage').addEventListener('pointercancel', endCrop);

$$('#crop-ratios .ratio').forEach(b => b.onclick = () => {
  CROP.ratio = b.dataset.r;
  $$('#crop-ratios .ratio').forEach(x => x.classList.toggle('on', x === b));
  applyCropRatio(); drawCropBox();
});
$('#crop-reset').onclick = () => { CROP.rect = { x: 0, y: 0, w: 1, h: 1 }; applyCropRatio(); drawCropBox(); };
$('#crop-cancel').onclick = closeCrop;
/* まわす（90度ずつ右へ）

   切り抜きと同じで、回した姿を別の写真として焼き込む。
   表示のときだけ傾けるやり方にすると、サムネ・色・USB・印刷・PDF・1枚画像の
   ぜんぶに同じ補正を入れて回ることになるので、ここで作ってしまう方が壊れない。

   it.rotFrom = 回す前の姿（原本）、it.rot = いまの角度。
   一周して 0 に戻ったときは、新しく作らずに原本へ戻すだけにしてある。 */
$('#viewer-rotate').onclick = async () => {
  const it = viewerItem;
  if (!it || !it.imageId) return;
  const base = it.rotFrom || it.imageId;
  const next = (((it.rot || 0) + 90) % 360);

  // 一周した。作らずに原本へ戻す
  if (next === 0) {
    const orig = S.imgs.get(base) || await dbGet('images', base);
    if (!orig) return toast('元の写真が見つかりませんでした');
    pushHistory();
    it.imageId = base;
    delete it.rotFrom; delete it.rot;
    it.h = Math.round(it.w * (orig.h / orig.w));
    await dbPut('items', it);
    S.imgs.set(orig.id, orig);
    const el0 = itemEl(it.id);
    if (el0) el0.replaceWith(makeItemEl(it));
    updateItemEl(it);
    touchBoard();
    renderPalette();
    await openViewer(it);
    return toast('元の向きに戻りました');
  }

  // 前に作った同じ向きがあれば、作り直さずにそれを使う
  // （写真を消さない方針なので、作りっぱなしにすると回すたびに増えてしまう）
  const cache = it.rotIds || {};
  if (cache[next]) {
    const had = S.imgs.get(cache[next]) || await dbGet('images', cache[next]);
    if (had) {
      pushHistory();
      it.rotFrom = base; it.rot = next; it.imageId = had.id;
      it.h = Math.round(it.w * (had.h / had.w));
      await dbPut('items', it);
      S.imgs.set(had.id, had);
      const elc = itemEl(it.id);
      if (elc) elc.replaceWith(makeItemEl(it));
      updateItemEl(it);
      touchBoard();
      renderPalette();
      await openViewer(it);
      return toast('まわしました（' + next + '度）');
    }
  }

  const rec = S.imgs.get(base) || await dbGet('images', base);
  if (!rec) return toast('写真が見つかりませんでした');
  progOpen('まわしています');
  try {
    const dec = await decodeImage(rec.full);
    const swap = (next % 180) !== 0;
    const c = document.createElement('canvas');
    c.width = swap ? dec.h : dec.w;
    c.height = swap ? dec.w : dec.h;
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2);
    g.rotate(next * Math.PI / 180);
    g.drawImage(dec.src, -dec.w / 2, -dec.h / 2);
    dec.close();
    const blob = await canvasToBlob(c, pickType(), FULL_Q);

    const made = await storeImage(blob, rec.srcUrl || '');
    pushHistory();
    it.rotFrom = base;                                  // 回す前の姿は消さずに控えておく
    it.rot = next;
    cache[next] = made.id; it.rotIds = cache;           // 次に同じ向きへ回すとき用
    it.imageId = made.id;
    it.h = Math.round(it.w * (made.h / made.w));        // 縦横が入れ替わるので形を直す
    await dbPut('items', it);
    S.imgs.set(made.id, made);
    const el = itemEl(it.id);
    if (el) el.replaceWith(makeItemEl(it));
    updateItemEl(it);
    progClose();
    touchBoard();
    ensureColors(false).then(() => renderPalette());
    await openViewer(it);
    toast('まわしました（' + next + '度）<br>もう一度押すとさらに回ります');
  } catch (e) {
    progClose();
    toast('まわせませんでした<br>' + e.message);
  }
};

$('#viewer-crop').onclick = openCrop;

$('#crop-ok').onclick = async () => {
  const it = CROP.item, r = CROP.rect;
  if (!it || !r) return;
  const rec = S.imgs.get(it.imageId) || await dbGet('images', it.imageId);
  if (!rec) return;
  progOpen('切り抜いています');
  try {
    const dec = await decodeImage(rec.full);
    const sx = Math.round(r.x * dec.w), sy = Math.round(r.y * dec.h);
    const sw = Math.max(1, Math.round(r.w * dec.w)), sh = Math.max(1, Math.round(r.h * dec.h));
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(dec.src, sx, sy, sw, sh, 0, 0, sw, sh);
    dec.close();
    const blob = await canvasToBlob(c, pickType(), FULL_Q);

    // 元の写真は消さずに残す。切り抜きは別の写真として作る
    const made = await storeImage(blob, rec.srcUrl || '');
    pushHistory();
    if (!it.croppedFrom) it.croppedFrom = it.imageId;   // 最初の切り抜きのときだけ元を控える
    it.imageId = made.id;
    delete it.rotFrom; delete it.rot; delete it.rotIds; // 切り抜いた姿が新しい原本になる
    it.h = Math.round(it.w * (made.h / made.w));        // 新しい形に合わせて高さを直す
    await dbPut('items', it);
    S.imgs.set(made.id, made);
    const el = itemEl(it.id);
    if (el) { el.replaceWith(makeItemEl(it)); }
    updateItemEl(it);
    progClose();
    closeCrop();
    $('#viewer').hidden = true;
    touchBoard();
    ensureColors(false).then(() => renderPalette());
    toast('切り抜きました<br>元の写真も残っています（1枚表示から「元の形に」）');
  } catch (e) {
    progClose();
    toast('切り抜けませんでした<br>' + e.message);
  }
};

/* 切り抜く前の写真に戻す（切り抜いた方も消さずに残しておく） */
$('#viewer-uncrop').onclick = async () => {
  const it = viewerItem;
  if (!it || !it.croppedFrom) return;
  const orig = await dbGet('images', it.croppedFrom);
  if (!orig) return toast('元の写真が見つかりませんでした');
  pushHistory();
  it.imageId = it.croppedFrom;
  delete it.croppedFrom;
  delete it.rotFrom; delete it.rot; delete it.rotIds;
  it.h = Math.round(it.w * (orig.h / orig.w));
  await dbPut('items', it);
  S.imgs.set(orig.id, orig);
  const el = itemEl(it.id);
  if (el) el.replaceWith(makeItemEl(it));
  updateItemEl(it);
  $('#viewer').hidden = true;
  touchBoard();
  renderPalette();
  toast('元の形に戻しました');
};


/* 選んだ複数枚にまとめてタグ・区分けを付ける（これが一番の時短になる） */
$('#btn-bulk-tag').onclick = () => {
  const targets = S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean);
  if (!targets.length) return;
  openNoteSheet(targets);
};

/* ==========================================================================
   区分けごとにまとめる
   同じ区分けのものを横一列に集め、段ごとに見出しを置く。
   これをやって初めて「区分け」が目に見えるものになる。
   ========================================================================== */
async function arrangeBySection() {
  if (!S.items.length) return;
  const gap = GAPS[SET.gap] !== undefined ? GAPS[SET.gap] : 20;
  const colW = BASE_W;

  // 区分けごとに分ける。区分け無しは最後にまとめる
  const groups = new Map();
  for (const it of S.items) {
    const key = it.section || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const names = [...groups.keys()].filter(n => n !== '').sort();
  if (groups.has('')) names.push('');            // 区分け無しは末尾
  if (names.length <= 1) {
    toast('区分けがまだありません<br>写真を選んで「タグ」から付けられます', 4200);
    return;
  }

  pushHistory();
  const wrapEl = $('#canvas-wrap');
  const perRow = Math.max(2, Math.floor(wrapEl.clientWidth / (colW + gap)) || 4);
  const HEAD = 56;                                // 見出しのための余白
  let y = 0;

  for (const name of names) {
    const list = groups.get(name);
    let col = 0, rowTop = y, rowH = 0;
    for (const it of list) {
      const ratio = it.h / it.w;
      it.w = colW; it.h = Math.round(colW * ratio);
      it.x = col * (colW + gap);
      it.y = rowTop;
      rowH = Math.max(rowH, it.h);
      updateItemEl(it);
      col++;
      if (col >= perRow) { col = 0; rowTop += rowH + gap; rowH = 0; }
    }
    y = rowTop + rowH + gap + HEAD;
  }
  await dbPutMany('items', S.items);
  // 見出しを描く位置を控えておく（描画は renderSectionLabels が行う）
  S.sectionLayout = names.map((name, i) => ({ name }));
  touchBoard();
  renderSectionLabels(groups, names, gap, HEAD);
  fitAll();
  revealItems();
  toast(names.filter(n=>n).length + ' つの区分けにまとめました');
}

/* 段の上に区分けの名前を置く。盤面の一部として扱うので、写真と一緒に動く */
function renderSectionLabels(groups, names, gap, HEAD) {
  canvas.querySelectorAll('.sec-label').forEach(e => e.remove());
  for (const name of names) {
    const list = groups.get(name);
    if (!list || !list.length) continue;
    const top = Math.min(...list.map(i => i.y));
    const left = Math.min(...list.map(i => i.x));
    const el = document.createElement('div');
    el.className = 'sec-label';
    el.textContent = name || '区分けなし';
    el.style.transform = 'translate(' + left + 'px,' + (top - HEAD + 12) + 'px)';
    canvas.appendChild(el);
  }
}

$('#arr-section').onclick = () => { closeSheets(); arrangeBySection(); };

/* ==========================================================================
   PDFにして送る
   外部ライブラリを使わない方針なので、PDFを自前で組み立てる。
   各ページは canvas で描いた絵を JPEG にして埋め込む（PDFはJPEGをそのまま入れられる）。
   この作りなら日本語も確実に出る（PDFに日本語フォントを埋め込む必要がない）。
   ========================================================================== */
const PDF_DPI = 150;                       // 印刷に耐える程度。大きすぎるとファイルが重い
const MM2PT = 72 / 25.4;

function pdfEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/* ページ（JPEGのバイト列と実寸）の配列から、1つのPDFを組み立てる */
function buildPDF(pages, title) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [0];                     // オブジェクト番号 → バイト位置
  let len = 0;
  const put = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b); len += b.length;
  };
  const obj = (num, body) => { offsets[num] = len; put(num + ' 0 obj\n'); put(body); put('\nendobj\n'); };

  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // 1=カタログ 2=ページ一覧 3=情報。以降、ページごとに3つ（ページ/中身/画像）
  const pageIds = pages.map((_, i) => 4 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' +
         pageIds.map(id => id + ' 0 R').join(' ') + '] >>');
  obj(3, '<< /Title (' + pdfEscape(title || 'MOOD BOARD') + ') /Producer (MOOD BOARD) >>');

  pages.forEach((pg, i) => {
    const pid = 4 + i * 3, cid = pid + 1, iid = pid + 2;
    const W = pg.wPt, H = pg.hPt;
    obj(pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W.toFixed(2) + ' ' + H.toFixed(2) + ']' +
             ' /Resources << /XObject << /Im0 ' + iid + ' 0 R >> >> /Contents ' + cid + ' 0 R >>');
    // 画像をページいっぱいに置く
    const stream = 'q\n' + W.toFixed(2) + ' 0 0 ' + H.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ\n';
    obj(cid, '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
    offsets[iid] = len;
    put(iid + ' 0 obj\n');
    put('<< /Type /XObject /Subtype /Image /Width ' + pg.px + ' /Height ' + pg.py +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.jpg.length + ' >>\nstream\n');
    put(pg.jpg);
    put('\nendstream\nendobj\n');
  });

  const xref = len;
  const total = 4 + pages.length * 3;
  let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (let i = 1; i < total; i++) x += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
  put(x);
  put('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

  return new Blob(chunks, { type: 'application/pdf' });
}

/* 盤面を1枚の絵にして、その絵をA4に収めたPDFにする */
async function exportBoardPDF(mode) {
  const items = (PRINT.scope === 'picked' && S.picked.length)
    ? S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean)
    : S.items.filter(i => !i.trashedAt);
  if (!items.length) return toast('PDFにするものがありません');

  const P = PAPER[PRINT.paper] || PAPER.a4p;
  const wPt = P.w * MM2PT, hPt = P.h * MM2PT;
  const px = Math.round(P.w / 25.4 * PDF_DPI), py = Math.round(P.h / 25.4 * PDF_DPI);

  progOpen('PDFを作っています');
  try {
    const pages = [];
    const makePage = async (draw) => {
      const c = document.createElement('canvas');
      c.width = px; c.height = py;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';            // 紙なので白地
      ctx.fillRect(0, 0, px, py);
      await draw(ctx, px, py);
      const blob = await canvasToBlob(c, 'image/jpeg', 0.88);
      pages.push({ jpg: new Uint8Array(await blob.arrayBuffer()), wPt, hPt, px, py });
    };

    const margin = Math.round(px * 0.06);
    const title = S.board ? S.board.name : 'MOOD BOARD';

    if (mode === 'one') {
      // 1枚ずつ、大きく
      for (let i = 0; i < items.length; i++) {
        if (progCancelled) break;
        progSet(i, items.length, (i + 1) + ' / ' + items.length + ' ページ');
        const it = items[i];
        await makePage(async (ctx, W, H) => {
          await drawPdfHeader(ctx, W, margin, title, (i + 1) + ' / ' + items.length);
          const top = margin + Math.round(px * 0.05);
          const box = { x: margin, y: top, w: W - margin * 2, h: H - top - margin - Math.round(px * 0.06) };
          await drawItemInto(ctx, it, box);
          const cap = [it.note, (it.tags || []).join(' / ')].filter(Boolean).join('   ');
          if (cap) {
            ctx.fillStyle = '#444';
            ctx.font = Math.round(px * 0.018) + 'px -apple-system,"Hiragino Sans",sans-serif';
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(cap, margin, H - margin);
          }
        });
        await new Promise(r => setTimeout(r, 0));
      }
    } else {
      // 盤面の配置のまま1ページに収める
      progSet(0, 1, '組んでいます');
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      items.forEach(it => {
        x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
        x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
      });
      const bw = x2 - x1, bh = y2 - y1;
      await makePage(async (ctx, W, H) => {
        const headH = Math.round(px * 0.055);
        await drawPdfHeader(ctx, W, margin, title, items.length + ' 枚');
        const area = { x: margin, y: margin + headH, w: W - margin * 2, h: H - margin * 2 - headH };
        const sc = Math.min(area.w / bw, area.h / bh);
        const offX = area.x + (area.w - bw * sc) / 2;
        const offY = area.y + (area.h - bh * sc) / 2;
        const ordered = [...items].sort((a, b) => (a.z || 0) - (b.z || 0));
        for (const it of ordered) {
          await drawItemInto(ctx, it, {
            x: offX + (it.x - x1) * sc, y: offY + (it.y - y1) * sc,
            w: it.w * sc, h: it.h * sc,
          }, true);
        }
      });
    }

    if (!pages.length) { progClose(); return; }
    const pdf = buildPDF(pages, title);
    progClose();
    const name = (title || 'moodboard').replace(/[\/\\:*?"<>|]/g, '_') + '.pdf';
    saveBlob(pdf, name);
    toast('PDFにしました（' + pages.length + 'ページ・' + fmtBytes(pdf.size) + '）<br>そのまま送れます', 5000);
  } catch (e) {
    progClose();
    toast('PDFにできませんでした<br>' + e.message, 4000);
  }
}

/* 見出し（ボード名と枚数）。日本語も絵として描くので確実に出る */
async function drawPdfHeader(ctx, W, margin, title, sub) {
  ctx.fillStyle = '#111';
  ctx.font = '600 ' + Math.round(W * 0.028) + 'px -apple-system,"Hiragino Sans",sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(title, margin, margin * 0.6);
  ctx.fillStyle = '#888';
  ctx.font = Math.round(W * 0.016) + 'px -apple-system,"Hiragino Sans",sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(sub + '   ' + new Date().toLocaleDateString('ja-JP'), W - margin, margin * 0.75);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = Math.max(1, W * 0.0012);
  ctx.beginPath();
  ctx.moveTo(margin, margin * 0.6 + W * 0.045);
  ctx.lineTo(W - margin, margin * 0.6 + W * 0.045);
  ctx.stroke();
}

/* 1つの要素（写真・文字カード・色見本）を、指定した枠に描く */
async function drawItemInto(ctx, it, box, exact) {
  if (it.type === 'text') {
    ctx.fillStyle = '#f4ecd0';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = '#2a241a';
    const fs = Math.max(9, box.h * 0.1);
    ctx.font = fs + 'px -apple-system,"Hiragino Sans",sans-serif';
    ctx.textBaseline = 'top';
    (it.text || '').split('\n').forEach((line, i) => {
      ctx.fillText(line, box.x + box.w * 0.06, box.y + box.h * 0.08 + i * fs * 1.5, box.w * 0.88);
    });
    return;
  }
  if (it.type === 'color') {
    ctx.fillStyle = it.color || '#888';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = '#fff';
    ctx.font = Math.max(8, box.h * 0.11) + 'px ui-monospace,Menlo,monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText((it.color || '').toUpperCase(), box.x + box.w * 0.06, box.y + box.h * 0.92);
    return;
  }
  const rec = S.imgs.get(it.imageId) || await dbGet('images', it.imageId);
  if (!rec) return;
  try {
    const dec = await decodeImage(rec.full);
    if (exact) {
      ctx.drawImage(dec.src, box.x, box.y, box.w, box.h);
    } else {
      // 枠の中に収める（はみ出さない）
      const sc = Math.min(box.w / dec.w, box.h / dec.h);
      const w = dec.w * sc, h = dec.h * sc;
      ctx.drawImage(dec.src, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
    }
    dec.close();
  } catch (e) { /* 読めない画像は飛ばす */ }
}

/* PDFの入口。印刷の設定（用紙・対象）をそのまま使う */
$('#pdf-go').onclick = () => {
  closeSheets();
  exportBoardPDF(PRINT.mode === 'one' ? 'one' : 'board');
};
$('#menu-pdf').onclick = () => {
  if (S.view !== 'board') { closeSheets(); return toast('先にボードを開いてください'); }
  suggestPaper();
  syncPrintChips();
  $('#sheet-print').querySelector('h2').textContent = '印刷 / PDF';
  openSheet('#sheet-print');
};
