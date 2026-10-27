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

/* ========================== Mac版かどうか =============================== */
/* Mac版（mac/MoodBoard.swift）の中で動いているときは、写真とボードを
   IndexedDB ではなく「ライブラリ」フォルダに本物のファイルで持つ。 */
const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mb);
const mbCall = (cmd, args) => window.webkit.messageHandlers.mb.postMessage(Object.assign({ cmd }, args || {}));

/* ========================== IndexedDB ==================================== */
const DB_NAME = 'moodboard';
const DB_VER = 1;
let _db = null;

function openDB() {
  if (NATIVE) return nativeLoad();
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
const idbGet = (s, k) => tx(s).then(o => new Promise((res, rej) => {
  const r = o.get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const idbAll = (s) => tx(s).then(o => new Promise((res, rej) => {
  const r = o.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
}));
const idbPut = (s, v) => tx(s, 'readwrite').then(o => new Promise((res, rej) => {
  const r = o.put(v); r.onsuccess = () => res(v); r.onerror = () => rej(r.error);
}));
const idbDel = (s, k) => tx(s, 'readwrite').then(o => new Promise((res, rej) => {
  const r = o.delete(k); r.onsuccess = () => res(); r.onerror = () => rej(r.error);
}));
const idbByIndex = (s, idx, key) => tx(s).then(o => new Promise((res, rej) => {
  const r = o.index(idx).getAll(key); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
}));
function idbPutMany(store, values) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const o = t.objectStore(store);
    values.forEach(v => o.put(v));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  }));
}


/* ========================== Mac版：ライブラリに保存 ======================= */
/* 4つの箱（boards / images / items / meta）を丸ごとメモリに持ち、変わった箱だけを
   data/<箱>.json に書き出す。写真の中身は photos/ と thumbs/ に1枚1ファイル。
   画像の記録の full / thumb は Blob ではなく NFile（場所・大きさ・形式）になる。
   中身が要るところは realBlob() を通す。表示は NFile.url をそのまま img.src に使う。 */
class NFile {
  constructor(path, size, type) {
    this.path = path; this.size = size || 0; this.type = type || 'image/jpeg';
    this.url = 'lib/' + path.split('/').map(encodeURIComponent).join('/');
  }
  toJSON() { return { path: this.path, size: this.size, type: this.type }; }
}
async function realBlob(b) {
  if (!(b instanceof NFile)) return b;
  const r = await fetch(b.url);
  if (!r.ok) throw new Error('写真のファイルが見つかりません: ' + b.path);
  const blob = await r.blob();
  return blob.type ? blob : new Blob([blob], { type: b.type });
}
const NS = { maps: {}, dirty: new Set(), timer: null, ready: null, info: null, chain: Promise.resolve(), failed: false };
const NKEY = (s) => s === 'meta' ? 'key' : 'id';
function nReviveImg(v) {
  const o = Object.assign({}, v);
  if (v.full && v.full.path) o.full = new NFile(v.full.path, v.full.size, v.full.type);
  if (v.thumb && v.thumb.path) o.thumb = new NFile(v.thumb.path, v.thumb.size, v.thumb.type);
  if (v.video && v.video.path) o.video = new NFile(v.video.path, v.video.size, v.video.type);
  return o;
}
function nativeLoad() {
  if (NS.ready) return NS.ready;
  NS.ready = mbCall('load').then(r => {
    NS.info = r;
    for (const s of ['boards', 'images', 'items', 'meta']) {
      const txt = r.stores[s];
      const arr = txt ? JSON.parse(txt) : [];
      NS.maps[s] = new Map(arr.map(v => [v[NKEY(s)], s === 'images' ? nReviveImg(v) : v]));
    }
    return NS;
  });
  return NS.ready;
}
/* IndexedDB と同じく、取り出すたびに別のコピーを渡す（呼び出し側が書き換えても保存されない） */
function nClone(s, v) {
  if (v === undefined) return undefined;
  if (s !== 'images') return structuredClone(v);
  const c = structuredClone(Object.assign({}, v, { full: null, thumb: null, video: null }));
  c.full = v.full; c.thumb = v.thumb;              // NFile は書き換えないので共有でよい
  if (v.video) c.video = v.video; else delete c.video;
  return c;
}
function nMarkDirty(s) {
  NS.dirty.add(s);
  clearTimeout(NS.timer);
  NS.timer = setTimeout(nFlush, 150);
}
function nFlush() {
  clearTimeout(NS.timer); NS.timer = null;
  const stores = [...NS.dirty]; NS.dirty.clear();
  for (const s of stores) {
    // 前の書き込みが終わってから書く（順番が入れ替わって古い中身で上書きしないように）
    NS.chain = NS.chain.then(() => mbCall('save', { store: s, text: JSON.stringify([...NS.maps[s].values()]) }))
      .then(() => { if (NS.failed) { NS.failed = false; toast('保存できるようになりました'); } })
      .catch(e => { NS.failed = true; NS.dirty.add(s); toast('保存できませんでした。ライブラリのフォルダ（USBメモリなど）が外れていないか確かめてください', 6000); });
  }
  return NS.chain;
}
window.mbFlush = () => nFlush();
function blobToB64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ''));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
const N_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'video/webm': 'webm' };
const N_CHUNK = 4 * 1024 * 1024;     // 大きいファイル（動画）は 4MB ずつ送って、向こうで継ぎ足す
async function nWriteImg(v) {
  const o = Object.assign({}, v);
  for (const [k, dir] of [['full', 'photos'], ['thumb', 'thumbs'], ['video', 'videos']]) {
    const b = v[k];
    if (!b || b instanceof NFile) continue;
    const type = b.type || (k === 'video' ? 'video/mp4' : 'image/jpeg');
    const path = dir + '/' + v.id + '.' + (N_EXT[type] || (k === 'video' ? 'mp4' : 'jpg'));
    if (b.size > N_CHUNK) {
      for (let off = 0; off < b.size; off += N_CHUNK) {
        await mbCall('putFile', { path, b64: await blobToB64(b.slice(off, off + N_CHUNK)), append: off > 0 });
      }
    } else {
      await mbCall('putFile', { path, b64: await blobToB64(b) });
    }
    o[k] = new NFile(path, b.size, type);
  }
  return o;
}
async function nGet(s, k) { await nativeLoad(); return nClone(s, NS.maps[s].get(k)); }
async function nAll(s) { await nativeLoad(); return [...NS.maps[s].values()].map(v => nClone(s, v)); }
async function nByIndex(s, idx, key) {
  await nativeLoad();
  return [...NS.maps[s].values()].filter(v => v[idx] === key).map(v => nClone(s, v));
}
async function nPut(s, v) {
  await nativeLoad();
  const stored = s === 'images' ? await nWriteImg(v) : v;
  NS.maps[s].set(stored[NKEY(s)], nClone(s, stored));
  nMarkDirty(s);
  return v;
}
async function nPutMany(s, values) { for (const v of values) await nPut(s, v); }
async function nDel(s, k) {
  await nativeLoad();
  const v = NS.maps[s].get(k);
  NS.maps[s].delete(k);
  nMarkDirty(s);
  // 写真のファイルは消さずに macOS のゴミ箱へ（ゴミ箱を空にするまでは戻せる）
  if (s === 'images' && v) {
    for (const f of [v.full, v.thumb, v.video]) if (f instanceof NFile) await mbCall('trashFile', { path: f.path }).catch(() => { });
  }
}
const dbGet = NATIVE ? nGet : idbGet;
const dbAll = NATIVE ? nAll : idbAll;
const dbPut = NATIVE ? nPut : idbPut;
const dbDel = NATIVE ? nDel : idbDel;
const dbByIndex = NATIVE ? nByIndex : idbByIndex;
const dbPutMany = NATIVE ? nPutMany : idbPutMany;

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

/* 日本語入力の「変換を確定する Enter」か。Safari（Mac版の中身）は確定の後に keyCode 229 の Enter を送ってくるので、
   isComposing だけでは見分けられない（確定しただけで、名前やタグが決まってしまっていた） */
const imeKey = (e) => e.isComposing || e.keyCode === 229;

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
      inp.onkeydown = null; area.onkeydown = null;
      res(val);
    };
    $('#prompt-ok').onclick = () => done(field.value.trim());
    $('#prompt-cancel').onclick = () => done(null);
    inp.onkeydown = (e) => {
      if (imeKey(e)) return;
      if (e.key === 'Enter') { e.preventDefault(); done(field.value.trim()); }
      else if (e.key === 'Escape') { e.preventDefault(); done(null); }
    };
    area.onkeydown = (e) => { if (e.key === 'Escape' && !imeKey(e)) { e.preventDefault(); done(null); } };
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
  blob = await realBlob(blob);
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

/* ========================== 動画 ==========================================
   動画は「表紙の止め絵（full・thumb）を持つ写真」として扱い、動画のファイルは rec.video に添える。
   こうすると、写真を前提にした処理（盤面・ストック・くらべる・PDF・印刷・色の抽出）は表紙でそのまま動く。
   動画を意識するのは、再生（1枚表示）・保存（Mac版の videos/）・書き出し（ZIP・USB）・送る（写真そのまま）だけ。
   動画は作り直さない（ブラウザでは変換できない）。 */
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const isVideoFile = (f) => !!f && ((f.type || '').startsWith('video/') || VIDEO_EXT.test(f.name || ''));
const isVideoRec = (rec) => !!(rec && rec.video);
function fmtDur(sec) {
  const t = Math.max(0, Math.round(sec || 0));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}
/* 動画の表紙を作る（少し進めたところの1コマ） */
async function videoStill(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  try {
    v.src = url;
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error('この動画は読めません'));
      setTimeout(() => rej(new Error('この動画は読めません')), 20000);
    });
    const dur = isFinite(v.duration) ? v.duration : 0;
    v.currentTime = Math.min(0.5, dur / 4 || 0);
    await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) throw new Error('この動画は読めません');
    const big = drawCanvas(v, w, h, FULL_EDGE);
    const small = drawCanvas(big, big.width, big.height, THUMB_EDGE);
    return { full: await canvasToBlob(big, 'image/jpeg', 0.86), thumb: await canvasToBlob(small, 'image/jpeg', THUMB_Q), w, h, dur };
  } finally {
    v.removeAttribute('src'); v.load();
    URL.revokeObjectURL(url);
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
  if (blob instanceof NFile) return blob.url;      // Mac版：ファイルをそのまま見せる
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
  black: { bg: '#0e0e10', dot: '#24242a', fg: '#ececed', sub: '#8b8b93' },
  gray:  { bg: '#3b3b42', dot: '#55555e', fg: '#f1f1f3', sub: '#b6b6bd' },
  white: { bg: '#f4f4f5', dot: '#d9d9de', fg: '#1a1a1c', sub: '#6d6d75' },
  paper: { bg: '#efe9dc', dot: '#d8cdb6', fg: '#2a2415', sub: '#7a6f57' },
};
/* 差し色は「選んだもの」にだけ使う。ボタンなどは白黒が基本 */
const ACCENTS = {
  blue:  { light: '#2f6df6', dark: '#5b93ff' },
  coral: { light: '#e2553b', dark: '#ff7457' },
  green: { light: '#1b9a68', dark: '#3ccf92' },
  mono:  { light: '#111114', dark: '#f4f4f6' },
};
const GAPS = { tight: 8, normal: 20, loose: 40 };
const FONTS = { normal: 16, large: 17.5, xlarge: 19 };
const SET = {
  // クラウド（Mac版）：取り込んだ写真を、写真アプリ（iCloud 写真）／クラウド用フォルダにも自動で入れるか
  autoPhotos: 'off', autoFolder: 'off',
  // 言語：はじめは Mac（ブラウザ）の言語に合わせる。日本語以外なら英語
  lang: (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en',
  theme: 'auto',      // auto＝Macの設定に合わせる / light / dark
  accent: 'blue',
  bg: 'auto',         // auto＝テーマに合わせる（明るい→しろ、暗い→くろ）
  dots: 'on',
  shadow: 'on',
  gap: 'normal',
  font: 'normal',     // 文字の大きさ（remを土台にしているので全体が一緒に変わる）
  snap: 'on',         // 動かすとき、隣とそろう位置に吸い付く
  drag: 'select',     // マウスで何もない所をドラッグ：select＝囲んで選ぶ / pan＝盤面を動かす
  wheel: 'pan',       // pan＝2本指で動かす / zoom＝2本指で拡大
  motion: 'smooth',   // smooth / calm
};
const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
const resolvedTheme = () => (SET.theme === 'light' || SET.theme === 'dark')
  ? SET.theme : (darkQuery && darkQuery.matches ? 'dark' : 'light');
/* 盤面の色の名前。「自動」はテーマで決まる */
const boardBgName = () => SET.bg === 'auto' ? (resolvedTheme() === 'dark' ? 'black' : 'white') : SET.bg;
const bgPreset = () => BG_PRESETS[boardBgName()] || BG_PRESETS.black;
const gapPx = () => GAPS[SET.gap] != null ? GAPS[SET.gap] : GAPS.normal;

function loadSettings() {
  try {
    const raw = localStorage.getItem('mb_settings');
    if (raw) {
      const saved = JSON.parse(raw);
      // デザイン刷新（2026-10-21）より前の保存には theme が無い。
      // そのころは背景の既定が「くろ」で、選んでいなくても保存されていたので、新しい既定の「自動」へ移す
      if (!('theme' in saved)) {
        if (saved.bg === 'black') saved.bg = 'auto';
        saved.theme = 'auto';
      }
      Object.assign(SET, saved);
    }
  } catch (e) { /* 読めなくても既定値で動く */ }
  applySettings();
  // Macの明るさ設定が変わったら、自動のときだけ追従する
  if (darkQuery) {
    const onChange = () => { if (SET.theme === 'auto') applySettings(); };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onChange);
    else darkQuery.addListener(onChange);
  }
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
  const keepSel = S.sel;            // 右のパネルで直しながら ⌘Z を押すので、選んでいたものは選んだままにする
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
  if (keepSel && S.items.some(i => i.id === keepSel)) selectItem(keepSel);
  if (S.picking) { S.picked = S.picked.filter(id => S.items.some(i => i.id === id)); updatePickUI(); }
  renderInspector(true);
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
  const theme = resolvedTheme();
  const root = document.documentElement;
  root.dataset.theme = theme;
  const ac = ACCENTS[SET.accent] || ACCENTS.blue;
  root.style.setProperty('--accent', ac[theme]);
  // Safari のツールバーの色を、画面の上端に合わせる
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#121214' : '#ffffff');

  const p = bgPreset();
  root.style.setProperty('--board-bg', p.bg);
  root.style.setProperty('--board-dot', SET.dots === 'on' ? p.dot : 'transparent');
  root.style.setProperty('--board-fg', p.fg);
  // 影は1枚でなく重ねる（遠く＋近く）。明るい盤面では黒を弱める
  const light = boardBgName() === 'white' || boardBgName() === 'paper';
  const shadow = light
    ? '0 1px 2px rgba(0,0,0,.10), 0 8px 24px rgba(0,0,0,.12)'
    : '0 1px 2px rgba(0,0,0,.28), 0 8px 24px rgba(0,0,0,.42)';
  root.style.setProperty('--item-shadow', SET.shadow === 'on' ? shadow : 'none');
  root.style.fontSize = (FONTS[SET.font] || FONTS.normal) + 'px';
  document.body.classList.toggle('calm', SET.motion === 'calm');
  // 盤面の明暗をCSSから見分けられるようにする
  const bn = boardBgName();
  ['black','gray','white','paper'].forEach(n => document.body.classList.toggle('board-' + n, bn === n));
  try { localStorage.setItem('mb_settings', JSON.stringify(SET)); } catch (e) { }
  setCornerArt();
  // 言語（画面に出た日本語を、その場で英語に置き換える。i18n.js）
  if (window.MB_I18N && MB_I18N.lang !== SET.lang) {
    MB_I18N.set(SET.lang);
    if (NATIVE) mbCall('lang', { lang: SET.lang }).catch(() => { });
  }
}

/* 盤面の写真の角丸は、四隅に「盤面の背景色の小片」を重ねて見せる（CSS の .cn）。
   その小片の絵を、いまの背景色で作り直す。背景色が変わらなければ何もしない */
let _cnBg = '';
function setCornerArt() {
  const wrap = document.getElementById('canvas-wrap'), cv = document.getElementById('canvas');
  if (!wrap || !cv) return;
  const bg = getComputedStyle(wrap).backgroundColor;    // 色の層だけ（ドットは模様の層なので入らない）
  const r = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-photo')) || 6;
  const key = bg + '/' + r;
  if (key === _cnBg) return;
  _cnBg = key;
  const svg = (d) => 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + r + '" height="' + r + '"><path fill="' + bg + '" d="' + d + '"/></svg>') + '")';
  cv.style.setProperty('--cn-r', r + 'px');
  cv.style.setProperty('--cn-tl', svg('M0 0H' + r + 'A' + r + ' ' + r + ' 0 0 0 0 ' + r + 'Z'));
  cv.style.setProperty('--cn-tr', svg('M' + r + ' 0H0A' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'Z'));
  cv.style.setProperty('--cn-bl', svg('M0 ' + r + 'H' + r + 'A' + r + ' ' + r + ' 0 0 1 0 0Z'));
  cv.style.setProperty('--cn-br', svg('M' + r + ' ' + r + 'H0A' + r + ' ' + r + ' 0 0 0 ' + r + ' 0Z'));
}

/* ========================== ホーム ======================================= */
async function renderHome() {
  if (typeof STOCK !== 'undefined') { syncStockDock(); if (STOCK.on) loadStock(); }
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
    // 表紙は写真から選ぶ。文字カードや色見本は画像を持たないので、以前は空の枠になっていた。
    // 同じ写真の複製は1回だけ（大1＋小2の寄せ集めにする）
    const seen = new Set();
    const photos = its.filter(i => i.imageId && !seen.has(i.imageId) && seen.add(i.imageId));
    const shown = photos.slice(0, 3);
    thumbs.className = 'bc-thumbs' + (shown.length === 1 ? ' one' : shown.length === 2 ? ' two' : '');
    if (shown.length) {
      shown.forEach(p => {
        const im = document.createElement('img');
        im.loading = 'lazy';
        im.decoding = 'async';
        im.dataset.imageId = p.imageId;
        thumbs.appendChild(im);
      });
    } else {
      // 写真が無いボードは、色見本の色を並べる（無ければ無地）
      const colors = its.filter(i => i.type === 'color').slice(0, 3);
      if (colors.length > 1) thumbs.classList.add(colors.length === 2 ? 'two' : 'three');
      else thumbs.classList.add('one');
      (colors.length ? colors : [null]).forEach(c => {
        const d = document.createElement('div');
        d.className = 'ph';
        if (c) d.style.background = c.hex || '#888';
        thumbs.appendChild(d);
      });
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
  const lead = $('#home-lead');
  if (lead) lead.textContent = boards.length ? boards.length + ' 個のボード ・ ' + allItems.length + ' 枚' : '';

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
  if (NATIVE) {
    // Mac版：ライブラリのフォルダの大きさと、そのディスクの空き
    statTxt += imgCount + ' 枚の写真をライブラリ「' + NS.info.name + '」に保存中';
    const st = await mbCall('libStats').catch(() => null);
    if (st) statTxt += '<br>' + fmtBytes(st.bytes) + ' 使用（空き ' + fmtBytes(st.free) + '）';
  } else {
  statTxt += imgCount + ' 枚の写真をこの端末に保存中';
  }
  if (!NATIVE && navigator.storage && navigator.storage.estimate) {
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
  // 前のボードの「描く」・右のパネル・選ぶドックを片付ける（⌥⌘→ などで直接移ると、前のボードの中身が残っていた）
  quitDrawing();
  setDock('board');
  clearHistory();   // 履歴はボードごと。別のボードには持ち込まない
  $('#view-home').hidden = true;
  $('#view-board').hidden = false;
  $('#btn-back').hidden = false;
  $('#app-title').textContent = S.board.name;
  document.body.classList.remove('at-home');
  $('#board-sub').textContent = S.items.length + ' 個';
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
  quitDrawing();
  setDock('board');
  renderHome();
}

async function touchBoard() {
  if (!S.board) return;
  S.board.updatedAt = nowISO();
  await dbPut('boards', S.board);
  $('#board-sub').textContent = S.items.length + ' 個';
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

/* ==========================================================================
   アイテムの描き方（共通）
   画面・グリッド・印刷（HTML）と、1枚画像・PDF（canvas）で同じ見た目になるよう、
   写真の補正・反転・傾き・不透明度と、新しい種類（描いた線・チェックリスト・吹き出し）の
   描き方をここにまとめる。どれも非破壊（元の写真は触らず、何度でもやり直せる）。
   ========================================================================== */
const ADJ0 = { bri: 0, con: 0, sat: 0, warm: 0 };
const hasAdj = (it) => !!(it.adj && (it.adj.bri || it.adj.con || it.adj.sat || it.adj.warm));

/* 画面用の filter。canvas 側の adjustPixels と同じ順番・同じ式（CSSの仕様の式）にそろえてある */
function photoCssFilter(it) {
  const a = it.adj || ADJ0;
  const f = [];
  if (a.bri) f.push('brightness(' + (1 + a.bri / 100).toFixed(3) + ')');
  if (a.con) f.push('contrast(' + (1 + a.con / 100).toFixed(3) + ')');
  if (a.sat) f.push('saturate(' + Math.max(0, 1 + a.sat / 100).toFixed(3) + ')');
  return f.join(' ');
}
/* 色温度：暖かい＝橙、冷たい＝青を「ソフトライト」で重ねる。CSS にも canvas にも同じ合成がある */
function warmOverlay(warm) {
  if (!warm) return '';
  const a = Math.min(1, Math.abs(warm) / 100) * 0.45;
  return warm > 0 ? 'rgba(255,136,24,' + a.toFixed(3) + ')' : 'rgba(36,118,255,' + a.toFixed(3) + ')';
}
/* 位置。傾きは写真の中心で回す（.item の transform-origin は中心） */
function itemTransform(it) {
  return 'translate(' + it.x + 'px,' + it.y + 'px)' + (it.tilt ? ' rotate(' + it.tilt + 'deg)' : '');
}
const flipCss = (it) => (it.flipX || it.flipY) ? 'scale(' + (it.flipX ? -1 : 1) + ',' + (it.flipY ? -1 : 1) + ')' : '';

/* 描いた線・図形の形を、SVG のパス文字列にする。canvas 側も同じ文字列を Path2D に渡して描く */
function drawPathD(it) {
  const p = it.pts || [];
  const f = (n) => (Math.round(n * 10) / 10);
  const sw = it.sw || 4, vw = it.vw || it.w, vh = it.vh || it.h, m = sw / 2;
  if (it.shape === 'rect') return 'M' + f(m) + ' ' + f(m) + 'H' + f(vw - m) + 'V' + f(vh - m) + 'H' + f(m) + 'Z';
  if (it.shape === 'ellipse') {
    const rx = Math.max(1, vw / 2 - m), ry = Math.max(1, vh / 2 - m), cx = vw / 2, cy = vh / 2;
    return 'M' + f(cx - rx) + ' ' + f(cy) + 'A' + f(rx) + ' ' + f(ry) + ' 0 1 0 ' + f(cx + rx) + ' ' + f(cy) +
           'A' + f(rx) + ' ' + f(ry) + ' 0 1 0 ' + f(cx - rx) + ' ' + f(cy) + 'Z';
  }
  if (!p.length) return '';
  if (it.shape === 'line' || it.shape === 'arrow') {
    const [a, b] = [p[0], p[p.length - 1]];
    let d = 'M' + f(a[0]) + ' ' + f(a[1]) + 'L' + f(b[0]) + ' ' + f(b[1]);
    if (it.shape === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const L = Math.max(10, sw * 3.6), sp = 0.5;
      const h1 = [b[0] - L * Math.cos(ang - sp), b[1] - L * Math.sin(ang - sp)];
      const h2 = [b[0] - L * Math.cos(ang + sp), b[1] - L * Math.sin(ang + sp)];
      d += 'M' + f(h1[0]) + ' ' + f(h1[1]) + 'L' + f(b[0]) + ' ' + f(b[1]) + 'L' + f(h2[0]) + ' ' + f(h2[1]);
    }
    return d;
  }
  // ペン：点と点の中間を通る2次曲線でつなぐ（手描きの線がなめらかに見える）
  if (p.length < 3) return 'M' + p.map(q => f(q[0]) + ' ' + f(q[1])).join('L');
  let d = 'M' + f(p[0][0]) + ' ' + f(p[0][1]);
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    d += 'Q' + f(p[i][0]) + ' ' + f(p[i][1]) + ' ' + f(mx) + ' ' + f(my);
  }
  const z = p[p.length - 1];
  return d + 'L' + f(z[0]) + ' ' + f(z[1]);
}
function drawSvgMarkup(it, cls) {
  const vw = it.vw || it.w, vh = it.vh || it.h, d = drawPathD(it);
  const sw = it.sw || 4, col = it.stroke || '#111114';
  return '<svg class="' + (cls || '') + '" viewBox="0 0 ' + vw + ' ' + vh + '" preserveAspectRatio="none" width="100%" height="100%">' +
    '<path class="hit" d="' + d + '" fill="none" stroke="transparent" stroke-width="' + Math.max(18, sw * 3) + '" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path class="ink" d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
/* チェックリスト：1行1項目。行の頭に ★ を付けると「必須」（撮影の「必ず撮る／できれば」） */
function listRows(it) {
  return (it.rows || []).map(r => ({ t: r.t || '', done: !!r.done, must: !!r.must }));
}
function fillListEl(box, it) {
  box.innerHTML = '';
  if (it.title) {
    const h = document.createElement('div'); h.className = 'list-title'; h.textContent = it.title; box.appendChild(h);
  }
  const ul = document.createElement('ul');
  listRows(it).forEach((r, i) => {
    const li = document.createElement('li');
    li.className = (r.done ? 'done' : '') + (r.must ? ' must' : '');
    li.dataset.row = i;
    const c = document.createElement('span'); c.className = 'chk';
    const t = document.createElement('span'); t.className = 'lt'; t.textContent = r.t;
    li.append(c, t); ul.appendChild(li);
  });
  box.appendChild(ul);
}
/* 写真に付けた「参考ポイント」（光・ポーズ…）を、左上の小さな札にする */
function refBadge(it) {
  if (!it.refs || !it.refs.length) return null;
  const b = document.createElement('div');
  b.className = 'ref-badge';
  b.textContent = it.refs.join('・');
  return b;
}

/* 写真の見た目（補正・反転・不透明度・固定）を、要素に当てる。作るときも変えたときもこれを通す */
function applyPhotoLook(el, it) {
  const im = el.querySelector(':scope > img');
  if (im) {
    im.style.filter = photoCssFilter(it);
    im.style.transform = flipCss(it);
  }
  let w = el.querySelector(':scope > .warm');
  const wc = it.adj ? warmOverlay(it.adj.warm) : '';
  if (wc) {
    if (!w) { w = document.createElement('div'); w.className = 'warm fx'; if (im) im.after(w); else el.prepend(w); }
    w.style.background = wc;
  } else if (w) w.remove();
  el.classList.toggle('has-warm', !!wc);
  el.style.setProperty('--op', it.opacity != null && it.opacity < 1 ? it.opacity : 1);
  el.classList.toggle('locked', !!it.locked);
  const old = el.querySelector(':scope > .ref-badge'); if (old) old.remove();
  const rb = refBadge(it); if (rb) el.appendChild(rb);
  // しるし（◎○△✕）。大きさは写真の幅に合わせる（引いて見ても点として見える）
  const om = el.querySelector(':scope > .mk'); if (om) om.remove();
  if (it.imageId) {
    const mb = markBadge(S.imgs.get(it.imageId));
    if (mb) { mb.style.setProperty('--mks', Math.round(clamp(it.w * 0.13, 24, 56)) + 'px'); el.appendChild(mb); }
  }
}

function makeItemEl(it) {
  const el = document.createElement('div');
  el.className = 'item' + (it.type === 'text' ? ' text-item' : '') + (it.type === 'color' ? ' color-item' : '')
    + (it.type === 'draw' ? ' draw-item' : '') + (it.type === 'list' ? ' list-item' : '')
    + (it.type === 'text' && it.style === 'bubble' ? ' bubble tail-' + (it.tail || 'bl') : '');
  if (it.imageId) el.classList.add('photo-item');
  el.dataset.id = it.id;
  el.style.width = it.w + 'px';
  el.style.height = it.h + 'px';
  el.style.transform = itemTransform(it);
  if (it.type === 'draw') {
    el.innerHTML = drawSvgMarkup(it, 'fx');
    applyPhotoLook(el, it);
    return el;
  }
  if (it.type === 'list') {
    const box = document.createElement('div'); box.className = 'list-body fx';
    fillListEl(box, it); el.appendChild(box);
    applyPhotoLook(el, it);
    return el;
  }
  if (it.type === 'color') {
    el.style.background = it.hex || '#888';
    const t = document.createElement('div');
    t.className = 'sw-hex';
    t.textContent = (it.hex || '').toUpperCase();
    t.style.color = readableOn(it.hex);
    el.appendChild(t);
    applyPhotoLook(el, it);
    return el;
  }
  if (it.type === 'text') {
    const t = document.createElement('div');
    t.className = 'note-body fx';
    t.textContent = it.text || '';
    el.appendChild(t);
    const cc = cardColors(it);
    if (cc) { el.style.setProperty('--card-bg', cc.bg); el.style.setProperty('--card-fg', cc.fg); }
    applyPhotoLook(el, it);
    return el;
  }
  const rec = S.imgs.get(it.imageId);
  if (rec) {
    const im = document.createElement('img');
    im.className = 'fx';
    im.decoding = 'async';          // 写真の展開を描画と並行させる（開いた瞬間に固まらない）
    im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
    im.alt = '';
    el.appendChild(im);
    if (isVideoRec(rec)) { el.classList.add('video-item'); el.appendChild(inspEl('i', 'vbadge', '▶ ' + fmtDur(rec.dur))); }
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
  // 角丸に見せるための四隅の小片（切り抜くと盤面を動かすたびに重いので、上に重ねる。CSS の .cn を参照）
  const cn = document.createElement('i'); cn.className = 'cn'; el.appendChild(cn);
  applyPhotoLook(el, it);
  return el;
}

/* ========================== さがす（メモ・文字・タグ・色） ================ */
function itemMatchesFilter(it) {
  const f = S.filter;
  if (!f.q && f.hue == null) return true;
  let ok = true;
  if (f.q) {
    const hay = ((it.note || '') + ' ' + (it.desc || '') + ' ' + (it.text || '') + ' '
                 + ((it.tags || []).join(' ')) + ' ' + (it.section || '') + ' ' + ((it.refs || []).join(' ')) + ' '
                 + (it.title || '') + ' ' + ((it.rows || []).map(r => r.t).join(' '))).toLowerCase();
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
  el.style.transform = itemTransform(it);
  // 取っ手で大きさを変えている間、右のパネルの数字も追いかける（1フレームに1回だけ）
  if (it.id === S.sel && !INSP_RAF) INSP_RAF = requestAnimationFrame(() => { INSP_RAF = 0; syncInspectorSize(); });
}
var INSP_RAF = 0;
/* 見た目の属性（補正・反転・不透明度・固定・参考ポイント）が変わったとき */
function refreshItemLook(it) {
  const el = itemEl(it.id);
  if (el) { updateItemEl(it); applyPhotoLook(el, it); }
}
/* 中身ごと作り直す（描いた線・チェックリスト・文字の中身が変わったとき） */
function rebuildItemEl(it) {
  const el = itemEl(it.id);
  if (!el) return;
  const fresh = makeItemEl(it);
  if (el.classList.contains('sel')) fresh.classList.add('sel');
  el.replaceWith(fresh);
  if (S.sel === it.id) selectItem(it.id);
}

/* 盤面の位置は即座に書く（1つのstyle書き込みで、ブラウザが1フレームにまとめてくれる）。
   倍率の表示・取っ手・選択番号の大きさ合わせは、トラックパッドだと1フレームに何度も
   呼ばれるので、次の描画の直前に1回だけやる */
let camExtrasRAF = 0;
function applyCam() {
  canvas.style.transform = 'translate(' + S.cam.x + 'px,' + S.cam.y + 'px) scale(' + S.cam.k + ')';
  if (camExtrasRAF) return;
  camExtrasRAF = requestAnimationFrame(() => {
    camExtrasRAF = 0;
    $('#zoom-val').textContent = Math.round(S.cam.k * 100);
    positionHandle();
    scalePickBadges();
  });
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
/* ※ 以前は1枚ごとに `void el.offsetWidth`（レイアウトの強制計算）をループの中で呼んでいて、
     167枚なら167回レイアウトが走っていた。外す→1回だけ計算→付け直す、の3段にまとめる。
   ※ 枚数が多いと、1枚ずつ時間差で動かすだけで重くなる。多いときは盤面ごと1回で出す。 */
const REVEAL_PER_ITEM_MAX = 90;
function revealItems() {
  const b = boardBounds();
  if (!b) return;
  if (SET.motion === 'calm') return;
  const els = new Map();
  canvas.querySelectorAll('.item').forEach(el => els.set(el.dataset.id, el));

  if (S.items.length > REVEAL_PER_ITEM_MAX) {
    canvas.classList.remove('reveal');
    void canvas.offsetWidth;
    canvas.classList.add('reveal');
    return;
  }
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const maxD = Math.max(1, Math.hypot(b.w, b.h) / 2);
  const list = [];
  for (const it of S.items) {
    const el = els.get(it.id);
    if (!el) continue;
    const d = Math.hypot(it.x + it.w / 2 - cx, it.y + it.h / 2 - cy) / maxD;
    el.style.setProperty('--dl', Math.round(d * 220) + 'ms');
    el.classList.remove('in');
    list.push(el);
  }
  void canvas.offsetWidth;          // ここで1回だけ計算させて、アニメーションを鳴らし直す
  list.forEach(el => el.classList.add('in'));
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
  // 速さに上限をかける（どんなに強くはじいても、盤面が見えなくなるほどは飛ばさない）
  const VMAX = 3.2;   // px/ms
  const sp = Math.hypot(vx, vy);
  if (sp > VMAX) { vx = vx / sp * VMAX; vy = vy / sp * VMAX; }
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
/* 並べ直したときだけ、写真を新しい位置まですべらせる（ドラッグ中は付けない） */
let animMoveTimer = 0;
function animateMoves(ms = 480) {
  if (SET.motion === 'calm') return;
  canvas.classList.add('anim-move');
  clearTimeout(animMoveTimer);
  animMoveTimer = setTimeout(() => canvas.classList.remove('anim-move'), ms);
}

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

  const panG = () => ({ mode: 'pan', cam0: { ...S.cam }, sx: e.clientX, sy: e.clientY, moved: false,
    lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 });
  // 反転して見ている間は見るだけ（左右が逆なので、動かすと指と逆に動いてしまう）
  if (VIEW.mirror) { G = panG(); return; }
  // 描いている間は、なぞったところが線になる
  if (DRAW.on) {
    const p = toCanvas(e.clientX, e.clientY);
    G = { mode: 'draw', pts: [[p.x, p.y]], sx: e.clientX, sy: e.clientY, moved: false };
    drawLiveStart();
    return;
  }

  const onHandle = e.target.classList && e.target.classList.contains('handle');
  const it = itemFromEvent(e);
  const selLocked = S.sel && (selItem() || {}).locked;

  if (onHandle && S.sel && !selLocked) {
    const sel = S.items.find(i => i.id === S.sel);
    G = { mode: 'resize', it: sel, w0: sel.w, h0: sel.h, sx: e.clientX, sy: e.clientY, moved: false, snap: snapshotItems() };
  } else if (it && !S.picking && it.locked) {
    // 固定したものは動かさない。押せば選べるが、ドラッグは盤面の移動になる
    G = panG(); G.tapSel = it.id;
  } else if (it && !S.picking) {
    G = { mode: 'drag', it, x0: it.x, y0: it.y, sx: e.clientX, sy: e.clientY, moved: false, startId: it.id, snap: snapshotItems() };
    // チェックリストの四角を押したら、ドラッグではなくチェックの付け外し
    const li = e.target.closest && e.target.classList.contains('chk') && e.target.closest('li');
    if (li && it.type === 'list') G.chkRow = +li.dataset.row;
    // つかんだら手前に出す（見た目だけ即時）
    const el = itemEl(it.id);
    if (el) canvas.appendChild(el);
  } else if (it && S.picking) {
    G = { mode: 'tap-pick', it, sx: e.clientX, sy: e.clientY, moved: false };
  } else if (e.button === 1 || spaceHeld) {
    // 中ボタン / スペース＋ドラッグ は、いつでも盤面を動かす
    G = { mode: 'pan', cam0: { ...S.cam }, sx: e.clientX, sy: e.clientY, moved: false,
          lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 };
  } else if (S.picking || e.shiftKey || (e.pointerType === 'mouse' && SET.drag !== 'pan')) {
    // 何もないところからのドラッグは、枠で囲んで選ぶ。
    // マウスはこれが既定（指は盤面移動のままにしないとスマホで動かせなくなる）。設定で「動かす」にもできる
    const auto = !S.picking;
    if (auto) startPicking(true);
    G = { mode: 'marquee', sx: e.clientX, sy: e.clientY, moved: false, base: S.picked.slice(), auto };
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
    S.cam.x = G.cam0.x + (VIEW.mirror ? -dx : dx);
    S.cam.y = G.cam0.y + dy;
    const t = performance.now();
    const ddt = t - G.lastT;
    // 直近の速度を少しならして拾う（1フレームの跳ねに引きずられないように）。
    // ※ 4ms 未満の間隔は測らない。Safari は同じ瞬間にイベントを2回送ることがあり、
    //   距離÷ほぼ0秒で速さが桁違いになって、指を離したあと盤面が遠くへ飛んでいった
    if (ddt >= 4) {
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
  } else if (G.mode === 'draw') {
    drawLiveMove(G, e);
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
    } else if (g.chkRow != null) {
      await toggleListRow(g.it, g.chkRow);
    } else {
      selectItem(g.it.id);
      const t = Date.now();
      if (lastTap.id === g.it.id && t - lastTap.t < 320) {
        if (g.it.type === 'text') editTextItem(g.it);
        else if (g.it.type === 'list') editListItem(g.it);
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
    // 自動で選ぶモードに入ったのに何も囲めなかったら、元に戻す（ただのクリックで選択を外す動きと同じ）
    if (g.auto && !S.picked.length) stopPicking();
  } else if (g.mode === 'draw') {
    await finishDraw(g);
  } else if (g.mode === 'pan') {
    if (!g.moved) selectItem(g.tapSel || null);
    else if (performance.now() - g.lastT < 90 && Math.hypot(g.vx, g.vy) > 0.12) glide(VIEW.mirror ? -g.vx : g.vx, g.vy);
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
    // 反転して見ている間は、見えている位置と盤面の位置が左右逆
    const cx = VIEW.mirror ? r.width - (e.clientX - r.left) : e.clientX - r.left;
    zoomAt(cx, e.clientY - r.top, clamp(S.cam.k * zoomFactorFor(dy), 0.05, 6));
    return;
  }

  const sx = VIEW.mirror ? -1 : 1;
  // shift＋ホイールは横スクロール（マウスは縦にしか回せないため）
  if (e.shiftKey && !d.x) { S.cam.x -= sx * d.y; }
  else { S.cam.x -= sx * d.x; S.cam.y -= d.y; }
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
    const it = S.items.find(i => i.id === id);
    if (el) {
      el.classList.add('sel');
      // 固定したものは大きさも変えられないので、取っ手を出さない
      if (!(it && it.locked)) {
        handleEl = document.createElement('div');
        handleEl.className = 'handle';
        el.appendChild(handleEl);
        positionHandle();
      }
    }
    // 1枚ぶんの操作は右のパネルに畳んだので、下のドックは切り替えない（以前は 'item' のドックに替えていた）
    setDock(S.picking ? 'select' : 'board');
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
  // 描いている間は、何をしても描くときのドックのまま
  if (typeof DRAW !== 'undefined' && DRAW.on) which = 'draw';
  $('#board-dock').hidden = which !== 'board';
  $('#select-dock').hidden = which !== 'select';
  $('#item-dock').hidden = which !== 'item';
  $('#draw-dock').hidden = which !== 'draw';
  renderInspector();
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
  return S.picked.filter(id => { const it = S.items.find(i => i.id === id); return it && !!it.imageId; }).length;
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
  if ($('#btn-bulk-send')) $('#btn-bulk-send').disabled = S.picked.length < 1;
  if (S.mode === 'grid') syncGridPick();
  renderInspector();
}

/* ========================== くらべる ===================================== */
/* くらべる対象：ボードの中のもの（id）か、ストックの写真（'img:' + 写真のid） */
const cmpItem = (id) => String(id).startsWith('img:') ? { id, imageId: String(id).slice(4) } : S.items.find(i => i.id === id);
async function openCompare(ids) {
  ids = ids.filter(id => { const it = cmpItem(id); return it && !!it.imageId; });
  const stage = $('#compare-stage');
  stage.innerHTML = '';

  if (S.cmpLayout === 'overlay') {
    if (ids.length !== 2) { toast('「かさねる」は2枚を選んでください'); S.cmpLayout = 'row'; return openCompare(ids); }
    stage.className = 'overlay';
    stage.style.gridTemplateColumns = '';
    const recs = [];
    for (const id of ids) {
      const it = cmpItem(id);
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
    const it = cmpItem(id);
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
    const mb = markBadge(rec); if (mb) cell.appendChild(mb);
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
async function openViewer(it, opts = {}) {
  if (!it.imageId) return;
  const rec = await dbGet('images', it.imageId);
  if (!rec) return toast('画像が見つかりません');
  viewerItem = it;
  if (!opts.keepList) VLIST = viewerListFor(it);   // ← → で前後へ行くための並び
  // ストックから開いたときは、ボードの上の写真を変える道具（まわす・切り抜く・盤面に置く）を出さない
  $('#viewer').classList.toggle('from-stock', !!it.stock);
  resetViewerTools();
  const un = $('#viewer-uncrop');
  if (un) un.hidden = !it.croppedFrom;
  $('#viewer-pal').hidden = true;
  viewerBlob = rec.full; viewerName = (it.note || 'image') + '.' + (rec.full.type.split('/')[1] || 'jpg');
  $('#viewer-img').src = blobURL(rec.id, 'f', rec.full);
  // 動画：表紙ではなく動画そのものを再生する。写真用の道具（切り抜く・まわす・色・スポイト・ガイド・情報）は出さない
  const vid = $('#viewer-video'), isVid = isVideoRec(rec);
  $('#viewer').classList.toggle('is-video', isVid);
  vid.hidden = !isVid;
  $('#viewer-img').hidden = isVid;
  if (isVid) {
    viewerBlob = rec.video;
    viewerName = (it.note || 'video') + '.' + (N_EXT[rec.video.type] || 'mp4');
    vid.poster = blobURL(rec.id, 'f', rec.full);
    vid.src = blobURL(rec.id, 'v', rec.video);
    vid.play().catch(() => { });
  } else stopViewerVideo();
  const bits = [rec.w + '×' + rec.h, fmtBytes((isVideoRec(rec) ? rec.video : rec.full).size)];
  if (isVideoRec(rec)) bits.unshift('▶ ' + fmtDur(rec.dur));
  try { if (rec.srcUrl) bits.push(new URL(rec.srcUrl).hostname); } catch (e) { }
  const pos = syncViewerNav();
  if (pos) bits.unshift(pos);
  $('#viewer-meta').textContent = bits.join('  ·  ');
  syncViewerMarks();
  $('#viewer').hidden = false;
}

/* ========================== ボードへ入れる =============================== */
const BASE_W = 260;   // 置いたときの標準の幅

/* 新しく入れる画像の置き場所を決める（既存には触らない）。
   取り込み1回ぶんの「置き始める基準（いまある分の下）」を最初に1回だけ決め、
   新しい分は写真の縦横比どおりに石積みで詰める。
   ※ 以前は1枚置くたびに「いまの一番下」を取り直していたうえ、位置の番号に既存の枚数まで
     足していたため、置くほど基準が下へずれて縦一列の階段になり、全体表示が数%まで縮んでいた */
function beginPlacement(total, atCenter) {
  const b = atCenter ? null : boardBounds();
  const gap = gapPx();
  const wrapEl = $('#canvas-wrap');
  const screenRatio = wrapEl.clientWidth / Math.max(1, wrapEl.clientHeight);
  const avgH = BASE_W * 1.2;     // 縦長の写真が多い前提のおおよその高さ
  const cols = clamp(Math.round(Math.sqrt(screenRatio * total * (avgH + gap) / (BASE_W + gap))), 1, 8);
  const width = cols * BASE_W + (cols - 1) * gap;
  return {
    x0: b ? b.x1 : viewCenterCanvas().x - width / 2,
    y0: b ? b.y2 + gap * 3 : viewCenterCanvas().y - 160,
    gap, heights: new Array(cols).fill(0),
  };
}
function placeNext(P, ratio) {
  const c = P.heights.indexOf(Math.min(...P.heights));
  const spot = { x: P.x0 + c * (BASE_W + P.gap), y: P.y0 + P.heights[c] };
  P.heights[c] += Math.round(BASE_W * (ratio || 1)) + P.gap;
  return spot;
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
/* 付箋・吹き出しの色（it.bg）。決めていなければ null（今までの色のまま） */
const CARD_COLORS = [['#f4ecd0', 'クリーム'], ['#ffffff', '白'], ['#f6d6dc', 'ピンク'], ['#d4e6f6', '水色'],
                     ['#d6efe0', 'ミント'], ['#f7f0b4', 'レモン'], ['#e4e4e7', 'グレー'], ['#1c1c1f', '黒']];
function cardColors(it) {
  if (!it || !it.bg) return null;
  return { bg: it.bg, fg: readableOn(it.bg) === 'rgba(255,255,255,.85)' || /^rgba\(255/.test(readableOn(it.bg)) ? '#f4f4f5' : '#1f1d18' };
}
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

async function storeImage(blob, srcUrl, extra) {
  if (isVideoFile(blob)) {
    const v = await videoStill(blob);
    const type = blob.type || ({ mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' }[(blob.name || '').split('.').pop().toLowerCase()] || 'video/mp4');
    const rec = { id: uid(), full: v.full, thumb: v.thumb, video: blob.type ? blob : new Blob([blob], { type }), w: v.w, h: v.h, dur: v.dur, srcUrl: srcUrl || '', addedAt: nowISO() };
    if (extra) Object.assign(rec, extra);
    await dbPut('images', rec);
    cloudAuto(rec);
    return rec;
  }
  const exif = await readExif(blob);     // 作り直すと消えるので、その前に元のファイルから読む
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
  if (exif) rec.exif = exif;
  if (extra) Object.assign(rec, extra);     // 例：連続スクショのタグ・撮った画面の題名（srcTitle）
  await dbPut('images', rec);
  cloudAuto(rec);
  if (srcUrl && _srcIndex) _srcIndex.set(srcUrl, rec);
  return rec;
}

/* ---------- 端末の写真から ---------- */
async function importFiles(files, opts = {}) {
  const list = Array.from(files).filter(f => f.type.startsWith('image/') || isVideoFile(f) || /\.(jpe?g|png|gif|webp|avif|heic)$/i.test(f.name));
  if (!list.length) return toast('画像が見つかりませんでした');
  pushHistory();
  progOpen('写真を取り込んでいます');
  let ok = 0, ng = 0, heic = 0;
  const place = beginPlacement(list.length, opts.atCenter);
  for (let i = 0; i < list.length; i++) {
    if (progCancelled) break;
    progSet(i, list.length, (i + 1) + ' / ' + list.length + ' 枚目');
    try {
      // Mac版でほかのアプリなどから渡されたものは、ここで初めて中身を読む（何千枚でもメモリを食わない）
      const file = list[i].load ? await list[i].load() : list[i];
      const m = list[i].meta;
      const rec = await storeImage(file, '', m && (m.title || m.from) ? Object.assign({}, m.title ? { srcTitle: m.title } : {}, m.from ? { from: m.from } : {}) : null);
      const it = await addImageToBoard(rec, placeNext(place, rec.h / rec.w));
      // 連続スクショ：どこで撮ったか（タグ）と、まとめる区分け
      if (m && (m.tags || m.section)) {
        if (m.tags && m.tags.length) it.tags = [...new Set([...(it.tags || []), ...m.tags])];
        if (m.section) it.section = m.section;
        await dbPut('items', it);
      }
      if (m && m.cap) CAP_STACK.push({ item: it.id, image: rec.id });     // ⌃⌥Z で取り出せるように
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
  if (heic) msg += '<br>' + heic + ' 枚はHEIC形式で、このブラウザでは開けませんでした。<br>' + heicHint();
  if (ng - heic > 0) msg += '<br>' + (ng - heic) + ' 枚は読めない形式でした';
  toast(msg, (ng ? 7000 : 2400));
}

/* HEIC（iPhone・一部の Android の写真）が読めなかったときの手がかり。端末ごとに言い方を変える */
function heicHint() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'カメラの設定で「高効率の写真（HEIF）」をオフにすると、これから撮る写真はJPEGになります';
  if (/iPhone|iPad/i.test(ua)) return 'iPhoneの 設定 → カメラ → フォーマット を「互換性優先」にすると、これから撮る写真はJPEGになります';
  return 'Mac版の MOOD BOARD か Safari なら開けます';
}

/* ---------- URLから（Pinterestもここ） ---------- */
async function importUrls(text) {
  const urls = [...new Set(
    text.split(/[\s,]+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s))
  )];
  if (!urls.length) return toast('URLが見つかりませんでした');
  // ボードを開いていないとき（ストックで貼り付けた）は、どのボードにも載せずストックへ
  // （以前はボードの無い写真の置き場所が作られ、行き場のない記録が残っていた）
  const toStock = S.view !== 'board' || !S.boardId;

  if (!toStock) pushHistory();
  progOpen('取り込んでいます');
  let ok = 0, dup = 0, ng = 0;
  const failed = [];
  const place = toStock ? null : beginPlacement(urls.length);

  for (let i = 0; i < urls.length; i++) {
    if (progCancelled) break;
    progSet(i, urls.length,
      (i + 1) + ' / ' + urls.length + '<br>保存 ' + ok + ' ・ 重複 ' + dup + ' ・ 失敗 ' + ng);
    const url = urls[i];
    try {
      const hit = await findBySrc(url);
      if (hit) {
        if (!toStock && !S.items.some(it => it.imageId === hit.id)) {
          await addImageToBoard(hit, placeNext(place, hit.h / hit.w));
        }
        dup++;
        continue;
      }
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') && blob.size < 200) throw new Error('画像ではない');
      const rec = await storeImage(blob, url);
      if (!toStock) await addImageToBoard(rec, placeNext(place, rec.h / rec.w));
      ok++;
    } catch (e) {
      ng++;
      failed.push(url);
    }
    if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
  }
  progClose();
  if (toStock) {
    if (S.view === 'home') { if (!STOCK.on) showStock(true); else await loadStock(); }
  } else {
    await touchBoard();
    $('#board-empty').hidden = S.items.length > 0;
    if (S.mode === 'grid') renderGrid(); else fitAll();
  }

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
  // 描いた線・矢印・丸は「この写真のここ」を指す書き込みなので、並べ直しでは動かさない
  const items = arrangeable();
  if (!items.length) return;
  pushHistory();
  animateMoves();
  const n = items.length;
  const colW = BASE_W, gap = gapPx();
  // 並べ終わった形が画面の縦横比に近くなる列数を選ぶ
  const wrapEl = $('#canvas-wrap');
  const screenRatio = wrapEl.clientWidth / Math.max(1, wrapEl.clientHeight);
  const avgH = items.reduce((a, i) => a + (i.h / i.w) * colW, 0) / n;
  const ideal = Math.sqrt(screenRatio * n * (avgH + gap) / (colW + gap));
  const cols = clamp(Math.round(ideal), 1, 8);
  const heights = new Array(cols).fill(0);
  const order = [...items].sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
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
  await dbPutMany('items', items);
  touchBoard();
  fitAll();
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
      entries.push({ name, data: new Uint8Array(await (await realBlob(r.full)).arrayBuffer()) });
      const m = { id: r.id, w: r.w, h: r.h, srcUrl: r.srcUrl, addedAt: r.addedAt, file: name, type: r.full.type };
      // ストックのタグ・撮影データ・撮った画面の題名も持っていく（以前は落ちていた）
      ['tags', 'exif', 'srcTitle', 'dur', 'mark'].forEach(k => { if (r[k] != null && r[k] !== '') m[k] = r[k]; });
      if (isVideoRec(r)) {
        const vb = await realBlob(r.video);
        m.video = 'videos/' + r.id + '.' + (N_EXT[vb.type] || 'mp4');
        m.videoType = vb.type || 'video/mp4';
        entries.push({ name: m.video, data: new Uint8Array(await vb.arrayBuffer()) });
      }
      imgMeta.push(m);
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
      const rec = { id: nid, full: blob, thumb, w: m.w, h: m.h, srcUrl: m.srcUrl || '', addedAt: m.addedAt || nowISO() };
      ['tags', 'exif', 'srcTitle', 'dur', 'mark'].forEach(k => { if (m[k] != null) rec[k] = m[k]; });
      if (m.video && byName.get(m.video)) rec.video = new Blob([byName.get(m.video).data], { type: m.videoType || 'video/mp4' });
      await dbPut('images', rec);
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
        const ni = { ...it, id: uid(), boardId: bid, imageId: iid };
        // 切り抜き・回転の「元の写真」への印も、新しい番号に付け替える
        // （以前は古い番号のままで、別の端末で読み込むと「元の形に」「まわす」が効かなかった）
        for (const k of ['croppedFrom', 'rotFrom']) {
          if (!ni[k]) continue;
          if (imgMap.has(ni[k])) ni[k] = imgMap.get(ni[k]); else delete ni[k];
        }
        if (ni.rotIds) {
          const r = {};
          for (const [deg, oid] of Object.entries(ni.rotIds)) if (imgMap.has(oid)) r[deg] = imgMap.get(oid);
          if (Object.keys(r).length) ni.rotIds = r; else delete ni.rotIds;
        }
        if (!ni.rotFrom) { delete ni.rot; }
        newItems.push(ni);
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
  $('#scrim').classList.remove('clear');
  $$('.sheet').forEach(s => s.hidden = true);
  if (typeof ADJ !== 'undefined' && ADJ) closeAdjust();
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
const SET_CHIPS = [['#st-autophotos', 'autoPhotos'], ['#st-autofolder', 'autoFolder'], ['#st-lang', 'lang'], ['#st-theme', 'theme'], ['#st-accent', 'accent'],
                   ['#st-bg', 'bg'], ['#st-dots', 'dots'], ['#st-shadow', 'shadow'],
                   ['#st-gap', 'gap'], ['#st-font', 'font'], ['#st-snap', 'snap'],
                   ['#st-drag', 'drag'], ['#st-wheel', 'wheel'], ['#st-motion', 'motion']];
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

/* いれる。ストックから開くときは、ボードに置くもの（色・文字・URL）を隠す */
function openAddSheet(forStock) {
  ['#add-color', '#add-text', '#add-url'].forEach(sel => { const b = $(sel); if (b) b.hidden = !!forStock; });
  ['#add-photosapp', '#add-capture', '#add-inbox'].forEach(sel => { const b = $(sel); if (b) b.hidden = !NATIVE; });
  const ph = $('#add-photos b'); if (ph) ph.textContent = NATIVE ? '写真のファイルから' : 'スマホの写真から';
  openSheet('#sheet-add');
}
$('#btn-add').onclick = () => openAddSheet(false);
$('#add-photosapp').onclick = () => { closeSheets(); mbCall('photosApp'); };
$('#add-capture').onclick = () => { closeSheets(); window.webkit.messageHandlers.mb && mbCall('capture'); };
$('#add-inbox').onclick = () => { closeSheets(); mbCall('revealInbox'); };
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
  if (f && f.length) importAnywhere([...f]);
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
$('#zoom-readout').onclick = () => fitAll();   // 倍率の表示を押すと全体を表示（以前の「ぜんたい」）

/* --- 1枚を選んでいるときの操作 --- */
function selItem() { return S.items.find(i => i.id === S.sel); }
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
const NOTE = { targets: [], tags: [], section: '', refs: [] };

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
  if (e.key === 'Enter' && !imeKey(e)) { e.preventDefault(); addTypedTag(); }
});

/* 1枚でも、選んだ複数枚でも開ける */
/* 参考にするところ：ファッション撮影では、参考写真ごとに「何を使うのか」
   （光・ポーズ・構図…）を書き添えておくと、チームに意図が伝わる */
const REF_PRESET = ['光', 'ポーズ', '構図', '色', 'スタイリング', 'ヘアメイク', '質感', '場所', '雰囲気'];
function renderRefRow() {
  const box = $('#ref-row');
  if (!box) return;
  box.innerHTML = '';
  REF_PRESET.forEach(r => {
    const b = document.createElement('button');
    b.className = 'chip' + (NOTE.refs.includes(r) ? ' on' : '');
    b.textContent = r;
    b.onclick = () => {
      const i = NOTE.refs.indexOf(r);
      if (i >= 0) NOTE.refs.splice(i, 1); else NOTE.refs.push(r);
      renderRefRow();
    };
    box.appendChild(b);
  });
}
const sortRefs = (list) => REF_PRESET.filter(r => list.includes(r)).concat(list.filter(r => !REF_PRESET.includes(r)));
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
    NOTE.refs = (one.refs || []).slice();
  } else {
    NOTE.tags = [];
    NOTE.section = '';
    NOTE.refs = [];
  }
  renderRefRow();
  $('#note-tags').value = '';
  renderTagPicker();
  renderSectionPicker();
  openSheet('#sheet-note');
  if (one) setTimeout(() => $('#note-body').focus(), 60);
}

$('#btn-item-note').onclick = () => {
  const it = selItem(); if (!it) return;
  if (it.type === 'text') return editTextItem(it);
  if (it.type === 'list') return editListItem(it);
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
    if (one) { it.note = note; it.desc = desc; it.tags = NOTE.tags.slice(); it.refs = sortRefs(NOTE.refs); }
    else {
      // まとめて付けるときは、もとのタグ・参考ポイントに足す（消さない）
      it.tags = [...new Set([...(it.tags || []), ...NOTE.tags])];
      it.refs = sortRefs([...new Set([...(it.refs || []), ...NOTE.refs])]);
    }
    if (!it.refs.length) delete it.refs;
    if (NOTE.section !== '' || one) it.section = NOTE.section;
    await dbPut('items', it);
    rebuildItemEl(it);     // 以前は作り直すと選択の枠と取っ手が消えていた
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
function stopViewerVideo() {
  const v = $('#viewer-video');
  if (!v) return;
  v.pause();
  if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
}
$('#viewer-close').onclick = () => { $('#viewer').hidden = true; stopViewerVideo(); resetViewerTools(); };
/* 保存するときの名前は「ボード名_ひとこと（無ければ番号）」。
   以前は全部 image.webp になり、何枚保存しても同じ名前だった。
   WebP は開けないアプリ（投稿先など）があるので、JPEG にして渡す */
$('#viewer-save').onclick = async () => {
  if (!viewerBlob) return;
  const board = (S.board && S.board.name) || 'MOOD BOARD';
  const idx = viewerItem ? S.items.indexOf(viewerItem) : -1;
  const label = (viewerItem && viewerItem.note) || String(idx + 1).padStart(2, '0');
  let blob = await realBlob(viewerBlob);
  let ext = (blob.type.startsWith('video/') ? (N_EXT[blob.type] || 'mp4') : (blob.type.split('/')[1] || 'jpg')).replace('jpeg', 'jpg');
  if (blob.type === 'image/webp') {
    try {
      const d = await decodeImage(blob);
      const c = drawCanvas(d.src, d.w, d.h, Infinity);
      d.close();
      blob = await canvasToBlob(c, 'image/jpeg', 0.92);
      ext = 'jpg';
    } catch (e) { /* 変換できなければそのまま */ }
  }
  saveBlob(blob, (board + '_' + label + '.' + ext).replace(/[\/\\:*?"<>|]/g, '_'));
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
  const ok = await confirmAsk(NATIVE
    ? trashed.length + ' 枚を完全に消します。ボードには戻せません。（写真のファイルは Mac のゴミ箱に移すので、そこからは取り出せます）'
    : trashed.length + ' 枚を完全に消します。もう戻せません。');
  if (!ok) return;

  const before = (navigator.storage && navigator.storage.estimate)
    ? (await navigator.storage.estimate()).usage || 0 : 0;

  for (const it of trashed) await dbDel('items', it.id);

  // 消すのは「いま空にしたゴミ箱の中のものだけが使っていた写真」だけ。
  // ボードに載せずにストックへ入れた写真や、切り抜き・回転の元の姿は消さない
  // （以前は「どのボードにも使われていない写真」を全部消していたので、ストックが消えるところだった）
  const live = all.filter(i => !i.trashedAt);
  const stillUsed = new Set(live.flatMap(i => [i.imageId, i.croppedFrom, i.rotFrom, ...Object.values(i.rotIds || {})]).filter(Boolean));
  const candidates = new Set(trashed.map(i => i.imageId).filter(Boolean));
  let gone = 0;
  for (const id of candidates) {
    if (stillUsed.has(id)) continue;
    await dbDel('images', id);
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
  // 確かめる窓（はい／いいえ）が出ている間：Esc で「やめる」。ほかのキーで後ろを動かさない
  // （以前は Esc で後ろの画面だけ戻り、窓が残っていた）
  if (!$('#prompt').hidden) { if (e.key === 'Escape') { e.preventDefault(); $('#prompt-cancel').click(); } return; }
  // 取り込み・書き出しの途中：Esc は「やめる」。ほかのキーは効かせない
  // （途中で Esc でボード一覧へ戻ると、残りの写真がどのボードにも入らず宙に浮いていた）
  if (!$('#progress').hidden) { if (e.key === 'Escape') progCancelled = true; return; }
  // 切り抜き中：Esc で切り抜きだけやめる、⏎ で切り抜く（以前は Esc で後ろの1枚表示が閉じ、切り抜きだけ残っていた）
  if (!$('#crop').hidden) {
    if (e.key === 'Escape') closeCrop();
    else if (e.key === 'Enter') { e.preventDefault(); $('#crop-ok').click(); }
    return;
  }
  // プレゼン中：左右でめくる、Esc で終わる
  if (PR) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); return stepSlide(1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); return stepSlide(-1); }
    if (e.key === 'Escape') return stopPresent();
    return;
  }
  // Esc は上に重なっているものから閉じる（シート → 1枚表示 → みくらべ）
  if (e.key === 'Escape' && !$('#scrim').hidden) return closeSheets();
  // 描いている間：Esc で終わる
  if (DRAW.on && e.key === 'Escape') return stopDraw();
  // 1枚表示のスポイトとガイドは Esc で先に外す
  if (!$('#viewer').hidden && e.key === 'Escape' && (VW.eyedrop || VW.guide || VW.info)) { resetViewerTools(); return; }
  if (e.key === 'Escape') {
    if (!$('#viewer').hidden) { $('#viewer').hidden = true; stopViewerVideo(); return void resetViewerTools(); }
    if (!$('#compare').hidden) return closeCompare();
    if (S.picking) return stopPicking();
    if (S.sel) return selectItem(null);
    if (S.view === 'board') return goHome();
  }
  // 1枚表示：← → で前後の写真、1〜4 でしるし（0 で外す）、ストックから開いたときはスペースで閉じる（Finder の「クイックルック」と同じ）
  if (!$('#viewer').hidden && $('#scrim').hidden && !kmod(e) && !e.altKey && e.target.tagName !== 'VIDEO') {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); return void viewerStep(e.key === 'ArrowRight' ? 1 : -1); }
    if (/^[0-4]$/.test(e.key)) { e.preventDefault(); return void viewerMark(+e.key); }
    if (e.key === ' ' && $('#viewer').classList.contains('from-stock')) {
      e.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();   // 離したときに、しるしのボタンなどを押さない
      $('#viewer').hidden = true; stopViewerVideo(); return void resetViewerTools();
    }
  }
  // 1枚表示・みくらべ・シートを開いている間は、後ろの盤面やストックをキーで動かさない
  // （見えないところで写真が動いたり、はずれたり、ボードが替わったりしていた）。説明書・設定などの共通キーだけ効かせる
  if (!$('#viewer').hidden || !$('#compare').hidden || !$('#scrim').hidden) return void runKeymap(e, 'any');
  if (S.view === 'home' && STOCK.on && stockKey(e)) return;
  if (runKeymap(e, 'any')) return;
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
  if (runKeymap(e, 'board')) return;
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

  // Delete・F・A・G などは KEYMAP に移した
  if (e.key === 'Escape' && S.picking) stopPicking();
});
let nudgeSnap = null, nudgeTimer = 0;

/* --- PCからのドラッグ&ドロップ --- */
['dragover', 'drop'].forEach(t => document.addEventListener(t, e => e.preventDefault()));
document.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (S.view !== 'board') {
    if (S.view === 'home' && dt.files && dt.files.length) { showStock(true); return importToStock([...dt.files]); }
    return toast('先にボードを開いてください');
  }
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
  document.body.classList.add('at-home');
  await renderHome();
  // 開発中(localhost)は登録しない。古いキャッシュを掴んで混乱するため（?sw=1 を付けたときだけ、試験のために登録する）
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  if ('serviceWorker' in navigator && !NATIVE && (!isLocal || /[?&]sw=1\b/.test(location.search))) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  handleLaunchParams();
})();

/* ---- ホーム画面のアプリとして開かれたとき ----
   ?shared=…  Android の「共有」から MOOD BOARD を選んだ（sw.js が受け取って置いておいた写真・URL をストックへ）
   ?open=stock / ?open=new  アイコンを長押ししたときのメニュー（manifest の shortcuts） */
async function handleLaunchParams() {
  const q = new URLSearchParams(location.search);
  const shared = q.get('shared'), open = q.get('open');
  if (!shared && !open) return;
  history.replaceState(null, '', location.pathname);    // 再読み込みで二度入らないように
  if (open === 'stock') return showStock(true);
  if (open === 'new') return newBoard();
  if (shared === '0') return toast('共有されたものを受け取れませんでした');
  if (!('caches' in window)) return;
  try {
    const c = await caches.open('moodboard-share');
    // 前に受け取ったまま取り込めなかった分も、いっしょに入れる
    const keys = (await c.keys()).filter(r => new URL(r.url).pathname.includes('/__shared/'));
    const files = []; let text = '';
    for (const r of keys) {
      const res = await c.match(r);
      if (!res) continue;
      if (/\/text$/.test(new URL(r.url).pathname)) { text += '\n' + await res.text(); continue; }
      const b = await res.blob();
      files.push(new File([b], decodeURIComponent(res.headers.get('X-Name') || 'shared'), { type: b.type || res.headers.get('Content-Type') || '' }));
    }
    showStock(true);
    if (files.length) await importToStock(files);
    const urls = text.match(/https?:\/\/\S+/g) || [];
    if (urls.length) await importUrls(urls.join('\n'));
    else if (!files.length) toast('写真が見つかりませんでした');
    // 受け取った控えは、取り込んだら片付ける（元の写真は共有した側のアプリに残っている）
    for (const r of keys) await c.delete(r);
  } catch (e) { toast('共有されたものを受け取れませんでした'); }
}

/* ---- Android の「戻る」 ----
   ホーム画面のアプリ（PWA）では、戻るボタン・戻るジェスチャーで画面の履歴を戻る。何もしないとアプリごと閉じてしまう。
   開いているもの（シート・1枚表示・ボードなど）があるあいだは「戻るための印」を1つ積んでおき、
   戻られたら Esc と同じ順で一番上のものを閉じる。何も開いていない（ボード一覧）なら、戻るでアプリを閉じられる */
const BACK = { on: !NATIVE && (/Android/i.test(navigator.userAgent) || matchMedia('(display-mode: standalone)').matches), armed: false };
function backClosable() {
  return !$('#prompt').hidden || !$('#progress').hidden || !$('#crop').hidden || !$('#scrim').hidden || !!PR || DRAW.on
    || !$('#viewer').hidden || !$('#compare').hidden || S.picking || !!S.sel || S.view === 'board' || (STOCK.on && STOCK.sel.size > 0);
}
function closeTopmost() {
  if (!$('#prompt').hidden) return void $('#prompt-cancel').click();
  if (!$('#progress').hidden) return void (progCancelled = true);
  if (!$('#crop').hidden) return closeCrop();
  if (!$('#scrim').hidden) return closeSheets();
  if (PR) return stopPresent();
  if (DRAW.on) return stopDraw();
  if (!$('#viewer').hidden) { $('#viewer').hidden = true; stopViewerVideo(); return resetViewerTools(); }
  if (!$('#compare').hidden) return closeCompare();
  if (S.picking) return stopPicking();
  if (S.sel) return selectItem(null);
  if (S.view === 'board') return goHome();
  if (STOCK.on && STOCK.sel.size) { STOCK.sel.clear(); syncStockCells(); syncStockDock(); }
}
function armBack() {
  if (!BACK.on || BACK.armed || !backClosable()) return;
  history.pushState({ mbBack: 1 }, '');
  BACK.armed = true;
}
if (BACK.on) {
  addEventListener('popstate', () => {
    BACK.armed = false;
    closeTopmost();
    setTimeout(armBack, 0);
  });
  // 開いたり選んだりするのは、たいてい触ったとき。触ったあと（と、少し遅れて開くもののために少しあと）に見直す
  ['click', 'pointerup', 'keyup'].forEach(t => addEventListener(t, () => { setTimeout(armBack, 0); setTimeout(armBack, 400); }, true));
}

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
    files.push({ name, data: new Uint8Array(await (await realBlob(r.full)).arrayBuffer()) });
    let vname = '';
    if (isVideoRec(r)) {
      const vb = await realBlob(r.video);
      vname = 'videos/' + r.id + '.' + (N_EXT[vb.type] || 'mp4');
      files.push({ name: vname, data: new Uint8Array(await vb.arrayBuffer()) });
    }
    imgMeta[r.id] = {
      file: name, w: r.w, h: r.h, srcUrl: r.srcUrl || '',
      ...(vname ? { video: vname, dur: r.dur || 0 } : {}),
      hex: r.hex || '#808080',
      // h は画像の高さで使っているので、色相は hue にする（衝突させない）
      hue: r.dom ? Math.round(r.dom.h) : 0,
      sat: r.dom ? +r.dom.s.toFixed(3) : 0,
      lum: r.dom ? +r.dom.l.toFixed(3) : 0.5,
    };
    if (i % 5 === 4) await new Promise(res => setTimeout(res, 0));
  }

  const keepItem = (i) => isCardItem(i) ? true : !!imgMeta[i.imageId];

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
      ...exportExtras(i),
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
      ...exportExtras(i),
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
      let vidDir = null;
      for (let i = 0; i < files.length; i++) {
        progSet(i, files.length, '書き込み中  ' + (i + 1) + ' / ' + files.length);
        const f = files[i];
        const isImg = f.name.startsWith('images/'), isVid = f.name.startsWith('videos/');
        if (isVid && !vidDir) vidDir = await root.getDirectoryHandle('videos', { create: true });
        const handle = await (isImg ? imgDir : isVid ? vidDir : root)
          .getFileHandle(isImg || isVid ? f.name.slice(7) : f.name, { create: true });
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
  const all = (PRINT.scope === 'picked' && S.picked.length)
    ? S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean)
    : S.items;
  // 描いた線は位置関係あっての書き込みなので、「ボードのまま」のときだけ印刷する
  const items = PRINT.mode === 'board' ? all : all.filter(i => i.type !== 'draw');
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
    sheet.appendChild(printHead(bname, items.filter(i => i.imageId).length + ' photos   ' + stamp));
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
      if (it.tilt) d.style.transform = 'rotate(' + it.tilt + 'deg)';
      const painted = PRINT_PAINTED.get(it.id);
      if (painted) {
        // 補正・反転・描いた線・チェックリスト・吹き出しは、画面と同じに描いた画像で並べる
        d.className = d.className.replace(/\s*pi-text|\s*pi-color/g, '') + ' pi-painted';
        const g = document.createElement('img'); g.src = painted; d.appendChild(g);
      } else if (it.type === 'color') {
        d.style.background = it.hex || '#888';
        const t = document.createElement('div');
        t.className = 'pcolor-hex'; t.textContent = (it.hex || '').toUpperCase();
        t.style.color = readableOn(it.hex);
        d.appendChild(t);
      } else if (it.type === 'text') {
        const t = document.createElement('div'); t.className = 'ptext-body'; t.textContent = it.text || '';
        const pc = cardColors(it); if (pc) { d.style.background = pc.bg; t.style.color = pc.fg; }
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
      const painted = PRINT_PAINTED.get(it.id);
      if (painted) {
        // 補正・反転・描いた線・チェックリスト・吹き出しは、画面と同じに描いた画像で並べる
        d.className = d.className.replace(/\s*pi-text|\s*pi-color/g, '') + ' pi-painted';
        const g = document.createElement('img'); g.src = painted; d.appendChild(g);
      } else if (it.type === 'color') {
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
    sheet.appendChild(printHead(bname, items.filter(i => i.imageId).length + ' photos   ' + stamp));
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
      const painted = PRINT_PAINTED.get(it.id);
      if (painted) {
        // 補正・反転・描いた線・チェックリスト・吹き出しは、画面と同じに描いた画像で並べる
        d.className = d.className.replace(/\s*pi-text|\s*pi-color/g, '') + ' pi-painted';
        const g = document.createElement('img'); g.src = painted; d.appendChild(g);
      } else if (it.type === 'color') {
        d.style.background = it.hex || '#888';
        d.style.aspectRatio = '1';
        const t = document.createElement('div');
        t.className = 'pcolor-hex'; t.textContent = (it.hex || '').toUpperCase();
        t.style.color = readableOn(it.hex);
        d.appendChild(t);
      } else if (it.type === 'text') {
        const t = document.createElement('div'); t.className = 'ptext-body'; t.textContent = it.text || '';
        const pc = cardColors(it); if (pc) { d.style.background = pc.bg; t.style.color = pc.fg; }
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

/* 印刷用：補正・反転・描いた線・チェックリスト・吹き出しは、画面と同じに描いた画像にして並べる */
let PRINT_PAINTED = new Map();
const needsPainted = (it) => it.type === 'draw' || it.type === 'list' || it.style === 'bubble' ||
  hasAdj(it) || !!it.flipX || !!it.flipY || (it.opacity != null && it.opacity < 1);
async function preparePrintPainted() {
  PRINT_PAINTED = new Map();
  const items = (PRINT.scope === 'picked' && S.picked.length)
    ? S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean) : S.items;
  for (const it of items) {
    if (!needsPainted(it)) continue;
    const sc = 1600 / Math.max(it.w, it.h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(it.w * sc)); c.height = Math.max(1, Math.round(it.h * sc));
    await paintItem(c.getContext('2d'), { ...it, tilt: 0 }, { x: 0, y: 0, w: c.width, h: c.height },
      { scale: sc, shadow: false, note: false, radius: 0 });
    // 写真は JPEG で軽く。透けるもの（線・うすくした写真）は PNG
    const png = !it.imageId || (it.opacity != null && it.opacity < 1);
    PRINT_PAINTED.set(it.id, c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.92));
  }
}
async function doPrint() {
  await preparePrintPainted();
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
  const bmp = await createImageBitmap(await realBlob(blob));
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
    const bmp = await createImageBitmap(await realBlob(rec.thumb || rec.full));
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
  // 描いた線・矢印・丸は「この写真のここ」を指す書き込みなので、並べ直しでは動かさない
  const items = arrangeable();
  if (!items.length) return;
  progCancelled = false;
  await ensureColors(true);
  pushHistory();
  animateMoves();

  const keyed = items.map(it => {
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
  await dbPutMany('items', items);
  touchBoard();
  fitAll();
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
   canvas に1つ描く（1枚画像・PDF 共通）
   画面と同じ見た目になるよう、傾き・反転・不透明度・補正・色温度・角丸をここで再現する。
   box は書き出し先での位置と大きさ。opt.scale は「画面の1px が書き出し先で何pxか」。
   ========================================================================== */
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/* 写真の補正を、CSS の brightness → contrast → saturate と同じ順番・同じ式で画素にかける
   （画面の見た目と書き出しの色をそろえるため。ブラウザの ctx.filter には頼らない） */
function adjustPixels(c, adj) {
  const bri = 1 + (adj.bri || 0) / 100, con = 1 + (adj.con || 0) / 100;
  const s = Math.max(0, 1 + (adj.sat || 0) / 100);
  if (bri === 1 && con === 1 && s === 1) return;
  const g = c.getContext('2d');
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  const m = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
             0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
             0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
  const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    if (bri !== 1) { r = cl(r * bri); gg = cl(gg * bri); b = cl(b * bri); }
    if (con !== 1) { r = cl((r - 0.5) * con + 0.5); gg = cl((gg - 0.5) * con + 0.5); b = cl((b - 0.5) * con + 0.5); }
    if (s !== 1) {
      const R = m[0] * r + m[1] * gg + m[2] * b, G = m[3] * r + m[4] * gg + m[5] * b, B = m[6] * r + m[7] * gg + m[8] * b;
      r = cl(R); gg = cl(G); b = cl(B);
    }
    d[i] = r * 255; d[i + 1] = gg * 255; d[i + 2] = b * 255;
  }
  g.putImageData(id, 0, 0);
}
/* 写真を、切り取り→反転→補正→色温度 の順に仕上げた作業用 canvas を返す */
async function renderPhotoCanvas(it, w, h) {
  const rec = S.imgs.get(it.imageId) || (it.imageId ? await dbGet('images', it.imageId) : null);
  if (!rec) return null;
  const dec = await decodeImage(rec.full);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  // 枠いっぱいに収める（画面の object-fit:cover と同じ）
  const ir = dec.w / dec.h, br = c.width / c.height;
  let sx = 0, sy = 0, sw = dec.w, sh = dec.h;
  if (ir > br) { sw = dec.h * br; sx = (dec.w - sw) / 2; } else { sh = dec.w / br; sy = (dec.h - sh) / 2; }
  g.save();
  if (it.flipX || it.flipY) {
    g.translate(it.flipX ? c.width : 0, it.flipY ? c.height : 0);
    g.scale(it.flipX ? -1 : 1, it.flipY ? -1 : 1);
  }
  g.drawImage(dec.src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  g.restore();
  dec.close();
  if (hasAdj(it)) adjustPixels(c, it.adj);
  const wc = it.adj ? warmOverlay(it.adj.warm) : '';
  if (wc) {
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = wc; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}
function paintListCard(ctx, it, x, y, w, h, sc) {
  const pad = 14 * sc;
  let ty = y + pad;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  if (it.title) {
    ctx.fillStyle = '#18181b';
    ctx.font = '700 ' + (14 * sc) + 'px -apple-system,"Hiragino Sans",sans-serif';
    ctx.fillText(it.title, x + pad, ty, w - pad * 2);
    ty += 14 * sc * 1.9;
  }
  const fs = 13 * sc, box = 15 * sc;
  for (const r of listRows(it)) {
    if (ty + fs > y + h - pad * 0.6) break;
    // チェック欄
    roundRectPath(ctx, x + pad, ty + 1 * sc, box, box, 4 * sc);
    if (r.done) { ctx.fillStyle = '#18181b'; ctx.fill(); }
    else { ctx.lineWidth = 1.5 * sc; ctx.strokeStyle = '#9a9aa0'; ctx.stroke(); }
    if (r.done) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2 * sc; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x + pad + box * 0.22, ty + 1 * sc + box * 0.52);
      ctx.lineTo(x + pad + box * 0.42, ty + 1 * sc + box * 0.72);
      ctx.lineTo(x + pad + box * 0.8, ty + 1 * sc + box * 0.3);
      ctx.stroke();
    }
    const tx = x + pad + box + 8 * sc;
    ctx.font = (r.must ? '700 ' : '') + fs + 'px -apple-system,"Hiragino Sans",sans-serif';
    let label = r.t;
    if (r.must) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f6df6';
      ctx.fillText('★', tx, ty);
      label = '  ' + label;
    }
    ctx.fillStyle = r.done ? '#9a9aa0' : '#18181b';
    const lines = wrapCanvasText(ctx, label, x + w - pad - tx);
    for (const ln of lines) {
      if (ty + fs > y + h - pad * 0.6) break;
      ctx.fillText(ln, tx, ty);
      if (r.done) { const tw = ctx.measureText(ln).width; ctx.fillRect(tx, ty + fs * 0.55, tw, Math.max(1, sc)); }
      ty += fs * 1.45;
    }
    ty += 8 * sc * 0.6;
  }
}
async function paintItem(ctx, it, box, opt = {}) {
  const sc = opt.scale || (box.w / Math.max(1, it.w));
  const alpha = it.opacity != null && it.opacity < 1 ? it.opacity : 1;
  const shadow = !!opt.shadow && SET.shadow === 'on' && it.type !== 'draw';
  const radius = (opt.radius != null ? opt.radius : 14) * sc;
  ctx.save();
  // 傾きは中心で回す（画面と同じ）
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (it.tilt) ctx.rotate(it.tilt * Math.PI / 180);
  const x = -box.w / 2, y = -box.h / 2, w = box.w, h = box.h;
  const drop = () => {
    if (!shadow || alpha < 1) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.42)'; ctx.shadowBlur = 16 * sc; ctx.shadowOffsetY = 6 * sc;
    roundRectPath(ctx, x, y, w, h, radius); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
  };
  try {
    if (it.type === 'draw') {
      const vw = it.vw || it.w, vh = it.vh || it.h;
      ctx.globalAlpha = alpha;
      ctx.translate(x, y); ctx.scale(w / vw, h / vh);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = it.stroke || '#111114'; ctx.lineWidth = it.sw || 4;
      ctx.stroke(new Path2D(drawPathD(it)));
    } else if (it.type === 'color') {
      drop();
      ctx.globalAlpha = alpha;
      roundRectPath(ctx, x, y, w, h, radius); ctx.fillStyle = it.hex || '#888'; ctx.fill();
      ctx.fillStyle = readableOn(it.hex);
      ctx.font = '600 ' + Math.max(8, 11 * sc) + 'px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText((it.hex || '').toUpperCase(), x + 10 * sc, y + h - 9 * sc);
    } else if (it.type === 'text') {
      ctx.globalAlpha = alpha;
      drawTextCardToCanvas(ctx, it, x, y, w, h, sc, !!opt.shadow);
    } else if (it.type === 'list') {
      drop();
      ctx.globalAlpha = alpha;
      roundRectPath(ctx, x, y, w, h, radius); ctx.fillStyle = '#ffffff'; ctx.fill();
      paintListCard(ctx, it, x, y, w, h, sc);
    } else {
      const pc = await renderPhotoCanvas(it, w, h);
      if (!pc) return;
      drop();
      ctx.save();
      roundRectPath(ctx, x, y, w, h, radius); ctx.clip();
      ctx.globalAlpha = alpha;
      ctx.drawImage(pc, x, y, w, h);
      if (opt.note !== false && it.note) {
        const gh = 46 * sc;
        const g = ctx.createLinearGradient(0, y + h - gh, 0, y + h);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.85)');
        ctx.fillStyle = g; ctx.fillRect(x, y + h - gh, w, gh);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.font = Math.round(13 * sc) + 'px -apple-system,"Hiragino Sans",sans-serif';
        ctx.fillText(it.note, x + 9 * sc, y + h - 13 * sc, w - 18 * sc);
      }
      ctx.restore();
    }
  } catch (e) { /* 描けないものは飛ばす */ }
  finally { ctx.restore(); }
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
function drawTextCardToCanvas(ctx, it, x, y, w, h, scale, withShadow = true) {
  const bubble = it.style === 'bubble';
  const r = (bubble ? 18 : 14) * scale;
  const cc = cardColors(it);
  const fillCol = cc ? cc.bg : (bubble ? '#ffffff' : '#f4ecd0');
  const shape = () => {
    roundRectPath(ctx, x, y, w, h, r);
    if (bubble) {
      // 尻尾（左下・右下・左上・右上）
      const t = it.tail || 'bl', s = 15 * scale, off = 33 * scale;
      const bx = t[1] === 'l' ? x + off : x + w - off;
      if (t[0] === 'b') { ctx.moveTo(bx - s * 0.7, y + h - 1); ctx.lineTo(bx, y + h + s * 0.9); ctx.lineTo(bx + s * 0.7, y + h - 1); }
      else { ctx.moveTo(bx - s * 0.7, y + 1); ctx.lineTo(bx, y - s * 0.9); ctx.lineTo(bx + s * 0.7, y + 1); }
      ctx.closePath();
    }
  };
  ctx.save();
  if (withShadow && SET.shadow === 'on') {
    ctx.shadowColor = 'rgba(0,0,0,' + (bubble ? '.22' : '.4') + ')';
    ctx.shadowBlur = 14 * scale;
    ctx.shadowOffsetY = 5 * scale;
  }
  ctx.fillStyle = fillCol;
  shape(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = cc ? cc.fg : (bubble ? '#18181b' : '#2a2415');
  const fs = Math.max(8, (bubble ? 13.5 : 14) * scale);
  ctx.font = fs + 'px -apple-system,"Hiragino Sans",sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const pad = (bubble ? 15 : 12) * scale;
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
    // ※ 以前は縮小の下限を0.4にしていたため、盤面が広いとキャンバスがブラウザの上限を超えて
    //   何も返ってこず「作れませんでした」になっていた。下限は設けず、長辺 MAXEDGE に必ず収める
    const scale = Math.min(MAXEDGE / Math.max(w0, h0), 2.2);
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
    ctx.fillText(S.items.filter(i => i.imageId).length + ' photos   ' + new Date().toLocaleDateString('ja-JP'),
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
      const box = {
        x: (it.x - b.x1 + PAD) * scale,
        y: (it.y - b.y1 + PAD) * scale + HEAD * scale,
        w: it.w * scale, h: it.h * scale,
      };
      await paintItem(ctx, it, box, { scale, shadow: true });
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }

    // 1枚画像にも区分けの見出しを描く（PDFと揃える）
    drawSectionLabels(ctx, S.items, {
      x1: b.x1, y1: b.y1 - HEAD,          // 1枚画像は上に見出し帯があるぶんずらす
      sc: scale, offX: PAD * scale, offY: PAD * scale + HEAD * scale,
    }, W);

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
  animateMoves();
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
  } else if (mode === 'samearea') {
    // 幅をそろえると横長だけ小さく見える。面積をそろえると見た目の重さが均等になる
    const A = list.reduce((n, i) => n + i.w * i.h, 0) / list.length;
    list.forEach(i => { const r = i.w / Math.max(1, i.h); i.w = Math.round(Math.sqrt(A * r)); i.h = Math.round(i.w / r); });
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
    if (it.type === 'text' || it.type === 'list') {
      const t = document.createElement('div'); t.className = 'tr-text';
      t.textContent = it.type === 'list' ? '☑ ' + (it.title || 'チェックリスト') : (it.text || '');
      cell.appendChild(t);
    } else if (it.type === 'color') {
      cell.style.background = it.hex || '#888';
    } else if (it.type === 'draw') {
      cell.classList.add('tr-draw');
      cell.insertAdjacentHTML('beforeend', drawSvgMarkup(it, ''));
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
  // 描いた線は盤面の位置関係あっての書き込みなので、ここ（並べて眺める表示）には出さない
  const list = [...S.items].filter(i => i.type !== 'draw')
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '') || (b.z || 0) - (a.z || 0));
  list.forEach((it, n) => {
    const cell = document.createElement('div');
    cell.className = 'gcell' + (it.type === 'text' ? ' gtext' : '') + (it.type === 'color' ? ' gcolor' : '')
      + (it.type === 'list' ? ' glist' : '') + (it.style === 'bubble' ? ' gbubble' : '');
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
    } else if (it.type === 'list') {
      cell.style.aspectRatio = (it.w / it.h).toFixed(3);
      const box = document.createElement('div'); box.className = 'list-body';
      fillListEl(box, it); cell.appendChild(box);
    } else if (it.type === 'text') {
      cell.style.aspectRatio = (it.w / it.h).toFixed(3);
      const t = document.createElement('div');
      t.className = 'gtext-body';
      t.textContent = it.text || '';
      const gc = cardColors(it); if (gc) { cell.style.background = gc.bg; t.style.color = gc.fg; }
      cell.appendChild(t);
    } else {
      const rec = S.imgs.get(it.imageId);
      const im = document.createElement('img');
      im.loading = 'lazy';
      // 読み込み前に高さを確保して、がたつかせない
      im.width = it.w; im.height = it.h;
      if (rec) im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
      // 補正・反転・不透明度はグリッドでも同じに見せる（傾きはまっすぐ並べる表示なので付けない）
      im.style.filter = photoCssFilter(it);
      im.style.transform = flipCss(it);
      if (it.opacity != null && it.opacity < 1) im.style.opacity = it.opacity;
      cell.appendChild(im);
      const wc = it.adj ? warmOverlay(it.adj.warm) : '';
      if (wc) { const w = document.createElement('div'); w.className = 'warm'; w.style.background = wc; cell.appendChild(w); cell.classList.add('has-warm'); }
      const rb = refBadge(it); if (rb) cell.appendChild(rb);
      const mb = markBadge(rec); if (mb) cell.appendChild(mb);
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
      else if (it.type === 'list') editListItem(it);
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
const isCardItem = (i) => i.type === 'text' || i.type === 'color' || i.type === 'draw' || i.type === 'list';
/* 書き出し（USB・台帳）に、補正・反転・傾き・描いた線・チェックリストなどの項目も含める */
const EXTRA_KEYS = ['style', 'tail', 'bg', 'shape', 'vw', 'vh', 'sw', 'stroke', 'title', 'flipX', 'flipY', 'tilt', 'opacity', 'locked'];
function exportExtras(i) {
  const o = {};
  EXTRA_KEYS.forEach(k => { if (i[k] != null && i[k] !== '' && i[k] !== false) o[k] = i[k]; });
  if (i.adj) o.adj = { ...i.adj };
  if (i.pts) o.pts = i.pts.map(p => p.slice());
  if (i.rows) o.rows = i.rows.map(r => ({ ...r }));
  if (i.refs && i.refs.length) o.refs = i.refs.slice();
  return o;
}

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
      await w.write(await realBlob(rec.full));
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
  if (viewerItem && isVideoRec(S.imgs.get(viewerItem.imageId))) return toast('動画は切り抜けません');
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

    const made = await storeImage(blob, rec.srcUrl || '', Object.assign({ derived: true }, rec.mark ? { mark: rec.mark } : {}));   // 切り抜き・まわすで途中にできた写真（しるしは引き継ぐ）
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
    const made = await storeImage(blob, rec.srcUrl || '', Object.assign({ derived: true }, rec.mark ? { mark: rec.mark } : {}));   // 切り抜き・まわすで途中にできた写真（しるしは引き継ぐ）
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
  // 描いた線・矢印・丸は「この写真のここ」を指す書き込みなので、並べ直しでは動かさない
  const items = arrangeable();
  if (!items.length) return;
  const gap = GAPS[SET.gap] !== undefined ? GAPS[SET.gap] : 20;
  const colW = BASE_W;

  // 区分けごとに分ける。区分け無しは最後にまとめる
  const groups = new Map();
  for (const it of items) {
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
  animateMoves();
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
  await dbPutMany('items', items);
  // 見出しを描く位置を控えておく（描画は renderSectionLabels が行う）
  S.sectionLayout = names.map((name, i) => ({ name }));
  touchBoard();
  renderSectionLabels(groups, names, gap, HEAD);
  fitAll();
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
async function exportBoardPDF(mode, opts = {}) {
  // opts.items: 描くものを直接渡す（送る から）／ opts.returnBlob: 保存せずに中身を返す
  const all = opts.items || ((PRINT.scope === 'picked' && S.picked.length)
    ? S.picked.map(id => S.items.find(i => i.id === id)).filter(Boolean)
    : S.items.filter(i => !i.trashedAt));
  // 描いた線は位置関係あっての書き込みなので、1枚ずつのときは入れない
  const items = mode === 'one' ? all.filter(i => i.type !== 'draw') : all;
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
        // 区分けの見出しも描く。画面の見出しは要素として持っていないので、
        // ここで同じ位置を計算し直す（これが無いと渡した相手に区分けが伝わらない）
        drawSectionLabels(ctx, items, { x1, y1, sc, offX, offY }, W);
      });
    }

    if (!pages.length) { progClose(); return; }
    const pdf = buildPDF(pages, title);
    progClose();
    const name = (title || 'moodboard').replace(/[\/\\:*?"<>|]/g, '_') + '.pdf';
    if (opts.returnBlob) return { blob: pdf, name };
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
  const en = window.MB_I18N && MB_I18N.lang === 'en';
  ctx.fillText((window.MB_I18N ? MB_I18N.tr(sub) : sub) + '   ' + new Date().toLocaleDateString(en ? 'en-US' : 'ja-JP'), W - margin, margin * 0.75);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = Math.max(1, W * 0.0012);
  ctx.beginPath();
  ctx.moveTo(margin, margin * 0.6 + W * 0.045);
  ctx.lineTo(W - margin, margin * 0.6 + W * 0.045);
  ctx.stroke();
}

/* 1つの要素（写真・文字カード・色見本）を、指定した枠に描く */
async function drawItemInto(ctx, it, box, exact) {
  let b = box;
  if (!exact) {
    // 枠の中に、縦横比を保って収める（はみ出さない）
    const r = it.w / Math.max(1, it.h), br = box.w / Math.max(1, box.h);
    const w = r > br ? box.w : box.h * r, h = r > br ? box.w / r : box.h;
    b = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }
  await paintItem(ctx, it, b, { shadow: false });
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


/* PDF・1枚画像に、区分けの見出しを描く */
function drawSectionLabels(ctx, items, t, W) {
  const groups = new Map();
  items.forEach(it => {
    const key = it.section || '';
    if (!key) return;                       // 区分け無しには見出しを出さない
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  });
  if (!groups.size) return;
  ctx.save();
  ctx.fillStyle = '#9a9a9a';
  ctx.font = '600 ' + Math.round(W * 0.019) + 'px -apple-system,"Hiragino Sans",sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const [name, list] of groups) {
    const top = Math.min(...list.map(i => i.y));
    const left = Math.min(...list.map(i => i.x));
    const x = t.offX + (left - t.x1) * t.sc;
    const y = t.offY + (top - t.y1) * t.sc - Math.round(W * 0.009);
    ctx.fillText(name, x, y);
  }
  ctx.restore();
}

/* ==========================================================================
   道具（2026-10-22）
   あちこちに散らばっていた道具（切り抜きは1枚表示、色を置くは「いれる」…）を
   1つの入口にまとめ、写真家・スタイリスト・絵描きが使う確認の手段を足した。
   調べたもの：PureRef 2.0/2.1（描画・図形・反転・不透明度・ランダム配置・面積をそろえる）、
   Milanote（矢印・チェックリスト・ルックごとのチェック）、
   ファッション撮影の段取り（参考ごとに「何を使うか」を書き添える、必須/できればのショットリスト、
   表紙・見開き・SNSで切れるよう余白を残す＝比率のガイド）。
   ========================================================================== */
var VIEW = { gray: false, mirror: false };
var DRAW = { on: false, shape: 'pen', color: '#111114', w: 4, colorChosen: false, live: null };
var ADJ = null;
const isPhoto = (it) => !!(it && it.imageId);
const arrangeable = () => S.items.filter(i => i.type !== 'draw');
const maxZ = () => Math.max(0, ...S.items.map(i => i.z || 0));
function toolTargets() {
  if (S.picking) return pickedItems();
  const it = selItem();
  return it ? [it] : [];
}
async function saveItems(list) { if (list.length) await dbPutMany('items', list); touchBoard(); }
/* 新しく作ったものを盤面に足す（共通） */
async function addItemToBoard(it) {
  await dbPut('items', it);
  S.items.push(it);
  const el = makeItemEl(it);
  canvas.appendChild(el);
  if (SET.motion !== 'calm') el.classList.add('in');
  $('#board-empty').hidden = true;
  touchBoard();
  return it;
}

/* ---------- 道具シート ---------- */
function openTools() {
  const t = toolTargets(), photos = t.filter(isPhoto);
  $('#tools-target').textContent = t.length
    ? (t.length === 1 ? '「選んだものに」は、いま選んでいる1つにかかります。'
                      : '「選んだものに」は、選んでいる ' + t.length + ' 個にまとめてかかります。')
    : '写真などを選んでから開くと、「選んだものに」の道具が使えます。';
  $$('#sheet-tools .tool').forEach(b => {
    const need = b.dataset.need;
    let ok = true;
    if (need === 'any') ok = t.length > 0;
    else if (need === 'photo') ok = photos.length > 0;
    else if (need === 'canvas') ok = S.mode !== 'grid';
    else if (need === 'bubble') ok = t.some(i => i.type === 'text' && i.style === 'bubble');
    b.classList.toggle('need', !ok);
    b.dataset.ok = ok ? '1' : '';
  });
  $('#sheet-tools .tool[data-tool="gray"]').classList.toggle('on', VIEW.gray);
  $('#sheet-tools .tool[data-tool="mirror"]').classList.toggle('on', VIEW.mirror);
  const lk = $('#sheet-tools .tool[data-tool="lock"] span');
  if (lk) lk.textContent = t.length && t.every(i => i.locked) ? '固定をはずす' : '固定';
  openSheet('#sheet-tools');
}
$('#btn-tools').onclick = openTools;
$('#btn-item-tools').onclick = openTools;
$('#tools-close').onclick = closeSheets;
$$('#sheet-tools .tool').forEach(b => b.onclick = () => {
  if (!b.dataset.ok) {
    const need = b.dataset.need;
    return toast(need === 'canvas' ? 'キャンバスの表示で使えます（右上のボタンで切り替え）'
      : need === 'bubble' ? '吹き出しを選んでから使います'
      : need === 'photo' ? '写真を選んでから使います'
      : '写真などを選んでから使います');
  }
  runTool(b.dataset.tool);
});

async function runTool(tool) {
  const t = toolTargets(), photos = t.filter(isPhoto);
  switch (tool) {
    case 'pen': case 'arrow': case 'rect': closeSheets(); return startDraw(tool);
    case 'bubble': closeSheets(); return addBubble();
    case 'list': closeSheets(); return addChecklist();
    case 'text': closeSheets(); return $('#add-text').click();
    case 'color': closeSheets(); renderColorSheet(); return openSheet('#sheet-color');
    case 'adjust': case 'tilt': case 'opacity': return openAdjust(t, tool);
    case 'flipx': case 'flipy': closeSheets(); return flipItems(photos, tool === 'flipx' ? 'flipX' : 'flipY');
    case 'lock': closeSheets(); return toggleLock(t);
    case 'front': case 'back': closeSheets(); return reorder(t, tool);
    case 'tail': closeSheets(); return cycleTail(t);
    case 'crop': case 'eyedrop': case 'guide': case 'info': {
      // 写真用の道具（1枚表示でも、動画のときは出していない）。選んだ中の最初の「写真」にかける
      const still = photos.find(it => !isVideoRec(S.imgs.get(it.imageId)));
      if (!still) return toast('動画には使えません。写真を選んでください');
      closeSheets(); await openViewer(still);
      if (tool === 'crop') return $('#viewer-crop').click();
      if (tool === 'eyedrop') return setEyedrop(true);
      return tool === 'guide' ? cycleGuide() : toggleInfo(true);
    }
    case 'harmony': return openHarmony(t);
    case 'gray': closeSheets(); return setView('gray', !VIEW.gray);
    case 'mirror': closeSheets(); return setView('mirror', !VIEW.mirror);
    case 'present': closeSheets(); return startPresent();
    case 'scatter': closeSheets(); return scatterItems((t.length >= 2 ? t : S.items).filter(i => i.type !== 'draw'));
    case 'area': closeSheets(); return normalizeArea((t.length >= 2 ? t : S.items).filter(i => i.type !== 'draw'));
  }
}

/* ---------- 選んだものに：反転・固定・重なり順・しっぽ ---------- */
async function flipItems(list, key) {
  if (!list.length) return;
  pushHistory();
  list.forEach(it => { it[key] = !it[key]; refreshItemLook(it); });
  await saveItems(list);
  toast(key === 'flipX' ? '左右を反転しました' : '上下を反転しました');
}
async function toggleLock(list) {
  if (!list.length) return;
  pushHistory();
  const on = !list.every(i => i.locked);
  list.forEach(it => { it.locked = on; refreshItemLook(it); });
  await saveItems(list);
  if (S.sel) selectItem(S.sel);       // 取っ手の有無を付け直す
  toast(on ? '固定しました。触っても動きません（ならべるでは動きます）' : '固定をはずしました', 3000);
}
async function reorder(list, where) {
  if (!list.length) return;
  pushHistory();
  if (where === 'front') { let z = maxZ(); list.forEach(it => { it.z = ++z; }); }
  else { let z = Math.min(0, ...S.items.map(i => i.z || 0)); [...list].reverse().forEach(it => { it.z = --z; }); }
  S.items.sort((a, b) => (a.z || 0) - (b.z || 0));
  // 画面の重なりも z の順に並べ直す（区分けの見出しは一番上のまま）
  S.items.forEach(it => { const el = itemEl(it.id); if (el) canvas.appendChild(el); });
  canvas.querySelectorAll('.sec-label').forEach(l => canvas.appendChild(l));
  await saveItems(list);
  toast(where === 'front' ? 'いちばん前にしました' : 'いちばん後ろにしました');
}
const TAILS = ['bl', 'br', 'tr', 'tl'];
async function cycleTail(list) {
  const bubbles = list.filter(i => i.type === 'text' && i.style === 'bubble');
  if (!bubbles.length) return;
  pushHistory();
  bubbles.forEach(it => { it.tail = TAILS[(TAILS.indexOf(it.tail || 'bl') + 1) % TAILS.length]; rebuildItemEl(it); });
  await saveItems(bubbles);
}

/* ---------- 写真を整える（補正・かたむき・不透明度） ---------- */
function adjVal(it, k) {
  if (k === 'tilt') return it.tilt || 0;
  if (k === 'opacity') return Math.round((it.opacity != null ? it.opacity : 1) * 100);
  return (it.adj && it.adj[k]) || 0;
}
const fmtAdj = (k, v) => k === 'opacity' ? v + '%' : k === 'tilt' ? v + '°' : (v > 0 ? '+' : '') + v;
function syncAdjustUI(it) {
  $$('#sheet-adjust .sl-row').forEach(r => {
    const inp = r.querySelector('input'), out = r.querySelector('output');
    const v = adjVal(it, inp.dataset.k);
    inp.value = v; out.textContent = fmtAdj(inp.dataset.k, v);
    inp.style.setProperty('--p', ((v - inp.min) / (inp.max - inp.min) * 100) + '%');
  });
}
/* 整えている写真が、シートに隠れないよう上のほうに来るように盤面を動かす */
function focusItemAbove(it) {
  const w = $('#canvas-wrap');
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const fit = Math.min((w.clientWidth * 0.7) / it.w, (w.clientHeight * 0.36) / it.h);
  if (S.cam.k > fit) S.cam.k = clamp(fit, 0.05, 6);
  S.cam.x = w.clientWidth / 2 - cx * S.cam.k;
  S.cam.y = w.clientHeight * 0.24 - cy * S.cam.k;
  smoothCam(460); applyCam();
}
function openAdjust(list, focus) {
  if (!list.length) return;
  const photos = list.filter(isPhoto);
  // ※ openSheet は最初に他のシートを閉じ、そのとき「整えている途中」を確定する。
  //   先に ADJ を作ると、開いた瞬間に確定されて何も効かなくなるので、シートを開いてから作る
  openSheet('#sheet-adjust');
  ADJ = { list, snap: snapshotItems(), changed: false };
  $('#adjust-target').textContent = list.length === 1 ? '動かすと、その場で写真に反映されます。'
    : list.length + ' 個にまとめてかかります（補正は写真だけ）。';
  $$('#sheet-adjust .sl-row').forEach(r => {
    const inp = r.querySelector('input');
    const photoOnly = ['bri', 'con', 'sat', 'warm'].includes(inp.dataset.k);
    inp.disabled = photoOnly && !photos.length;
    r.classList.toggle('off', inp.disabled);
  });
  $$('#sheet-adjust .adj-quick .chip').forEach(b => { b.disabled = b.dataset.q !== 'reset' && !photos.length; });
  syncAdjustUI(list[0]);
  $('#scrim').classList.add('clear');            // 写真が見えるよう、後ろを暗くしない
  if (S.mode !== 'grid') focusItemAbove(list[0]);
  if (focus === 'tilt' || focus === 'opacity') {
    const r = $('#sheet-adjust input[data-k="' + focus + '"]');
    if (r) setTimeout(() => r.focus(), 80);
  }
}
$$('#sheet-adjust input[type=range]').forEach(inp => {
  inp.oninput = () => {
    if (!ADJ) return;
    const k = inp.dataset.k, v = +inp.value;
    inp.parentElement.querySelector('output').textContent = fmtAdj(k, v);
    inp.style.setProperty('--p', ((v - inp.min) / (inp.max - inp.min) * 100) + '%');
    for (const it of ADJ.list) {
      if (k === 'tilt') { if (v) it.tilt = v; else delete it.tilt; }
      else if (k === 'opacity') { if (v >= 100) delete it.opacity; else it.opacity = v / 100; }
      else if (isPhoto(it)) { it.adj = Object.assign({}, ADJ0, it.adj || {}); it.adj[k] = v; }
      refreshItemLook(it);
    }
    ADJ.changed = true;
  };
  // つまみをダブルクリックすると0に戻す（写真アプリの定番）
  inp.ondblclick = () => { inp.value = inp.dataset.k === 'opacity' ? 100 : 0; inp.oninput(); };
});
$$('#sheet-adjust .adj-quick .chip').forEach(b => b.onclick = () => {
  if (!ADJ) return;
  const q = b.dataset.q;
  for (const it of ADJ.list) {
    if (q === 'reset') { delete it.adj; delete it.tilt; delete it.opacity; delete it.flipX; delete it.flipY; }
    else if (q === 'flipx' && isPhoto(it)) it.flipX = !it.flipX;
    else if (q === 'flipy' && isPhoto(it)) it.flipY = !it.flipY;
    else if (q === 'bw' && isPhoto(it)) {
      it.adj = Object.assign({}, ADJ0, it.adj || {});
      it.adj.sat = it.adj.sat === -100 ? 0 : -100;
    }
    refreshItemLook(it);
  }
  ADJ.changed = true;
  syncAdjustUI(ADJ.list[0]);
});
async function closeAdjust() {
  const a = ADJ; ADJ = null;
  if (!a) return;
  if (a.changed) {
    a.list.forEach(it => { if (it.adj && !hasAdj(it)) delete it.adj; });
    pushHistory(a.snap);
    await saveItems(a.list);
  }
}
$('#adjust-done').onclick = closeSheets;

/* ---------- 見る：白黒で見る・反転して見る ---------- */
/* 絵描きや写真家の定番の確かめ方。白黒にすると色に惑わされず明暗の配分が見え、
   左右を反転すると見慣れて気づかなくなった構図のかたよりが見える */
function setView(k, on) {
  VIEW[k] = on;
  $('#canvas-wrap').classList.toggle('view-' + k, on);
  $('#pill-' + k).hidden = !on;
  if (k === 'mirror' && on) { if (S.picking) stopPicking(); selectItem(null); }
  if (on) toast(k === 'gray' ? '白黒で表示しています。明暗の配分を見るときに'
                             : '左右を反転して表示しています。構図のかたよりを見るときに（この間は動かせません）', 3200);
}
$('#pill-gray').onclick = () => setView('gray', false);
$('#pill-mirror').onclick = () => setView('mirror', false);

/* ---------- かく：ペン・線・矢印・四角・丸 ---------- */
function syncDrawDock() {
  $$('#draw-dock .dtool').forEach(b => b.classList.toggle('on', b.dataset.shape === DRAW.shape));
  $$('#draw-dock .dcol').forEach(b => b.classList.toggle('on', b.dataset.c === DRAW.color));
  $$('#draw-dock .dwid').forEach(b => b.classList.toggle('on', +b.dataset.w === DRAW.w));
}
function startDraw(tool) {
  if (S.mode === 'grid') return toast('キャンバスの表示で使えます');
  if (S.picking) stopPicking();
  selectItem(null);
  DRAW.on = true;
  DRAW.shape = tool === 'arrow' ? 'arrow' : tool === 'rect' ? 'rect' : (tool === 'pen' ? 'pen' : DRAW.shape);
  // 線の色は、選び直すまで盤面の明るさに合わせる（暗い盤面に黒い線は見えない）
  if (!DRAW.colorChosen) DRAW.color = (boardBgName() === 'black' || boardBgName() === 'gray') ? '#ffffff' : '#111114';
  syncDrawDock();
  setDock('draw');
  $('#canvas-wrap').classList.add('drawing');
  toast('なぞると描けます。shift を押すとまっすぐ／正円に。終わったら「おわる」', 3200);
}
function stopDraw() {
  quitDrawing();
  setDock(S.picking ? 'select' : 'board');
}
/* 描くのをやめるだけ（ドックは呼んだ側で戻す）。ボードを移るときにも使う */
function quitDrawing() {
  if (typeof DRAW === 'undefined' || !DRAW.on) return;
  DRAW.on = false;
  drawLiveEnd();
  $('#canvas-wrap').classList.remove('drawing');
}
$$('#draw-dock .dtool').forEach(b => b.onclick = () => { DRAW.shape = b.dataset.shape; syncDrawDock(); });
$$('#draw-dock .dcol').forEach(b => b.onclick = () => { DRAW.color = b.dataset.c; DRAW.colorChosen = true; syncDrawDock(); });
$$('#draw-dock .dwid').forEach(b => b.onclick = () => { DRAW.w = +b.dataset.w; syncDrawDock(); });
$('#draw-done').onclick = stopDraw;

/* 描いている途中の線（盤面と一緒に拡大縮小されるよう #canvas の中に置く） */
function drawLiveStart() {
  drawLiveEnd();
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'draw-live');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  canvas.appendChild(svg);
  DRAW.live = path;
}
function drawLiveEnd() { const s = canvas.querySelector('.draw-live'); if (s) s.remove(); DRAW.live = null; }
/* shift を押していたら、線は45度刻み、四角と丸は正方形・正円にそろえる */
function constrainEnd(a, b, shape, shift) {
  if (!shift) return b;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (shape === 'line' || shape === 'arrow') {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(dx, dy);
    return [a[0] + Math.cos(ang) * L, a[1] + Math.sin(ang) * L];
  }
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + Math.sign(dx || 1) * m, a[1] + Math.sign(dy || 1) * m];
}
function drawLiveMove(g, e) {
  const p = toCanvas(e.clientX, e.clientY);
  const sw = DRAW.w / S.cam.k;
  if (DRAW.shape === 'pen') {
    const last = g.pts[g.pts.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5 / S.cam.k) return;   // 細かすぎる点は捨てる
    g.pts.push([p.x, p.y]);
  } else {
    g.pts = [g.pts[0], constrainEnd(g.pts[0], [p.x, p.y], DRAW.shape, e.shiftKey)];
  }
  if (!DRAW.live) return;
  const tmp = { shape: DRAW.shape, sw, vw: 0, vh: 0, w: 0, h: 0, pts: g.pts };
  if (DRAW.shape === 'rect' || DRAW.shape === 'ellipse') {
    const [a, b] = g.pts;
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
    tmp.vw = Math.abs(b[0] - a[0]); tmp.vh = Math.abs(b[1] - a[1]);
    DRAW.live.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
  } else DRAW.live.removeAttribute('transform');
  DRAW.live.setAttribute('d', drawPathD(tmp));
  DRAW.live.setAttribute('stroke', DRAW.color);
  DRAW.live.setAttribute('stroke-width', sw);
}
async function finishDraw(g) {
  drawLiveEnd();
  const shape = DRAW.shape, sw = DRAW.w / S.cam.k;
  let pts = g.pts;
  if (shape === 'pen') { if (pts.length < 2) return; }
  else if (pts.length < 2 || Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 6 / S.cam.k) return;
  let x1, y1, x2, y2;
  if (shape === 'rect' || shape === 'ellipse') {
    // 四角と丸は、引いた2点がそのまま枠。線の太さは内側に収める
    x1 = Math.min(pts[0][0], pts[1][0]); y1 = Math.min(pts[0][1], pts[1][1]);
    x2 = Math.max(pts[0][0], pts[1][0]); y2 = Math.max(pts[0][1], pts[1][1]);
  } else {
    // 線は太さぶん（矢印は矢じりぶん）余白をとって、はみ出さないようにする
    const pad = sw * (shape === 'arrow' ? 4.2 : 0.8) + 2 / S.cam.k;
    x1 = Math.min(...pts.map(p => p[0])) - pad; y1 = Math.min(...pts.map(p => p[1])) - pad;
    x2 = Math.max(...pts.map(p => p[0])) + pad; y2 = Math.max(...pts.map(p => p[1])) + pad;
  }
  const w = Math.max(x2 - x1, sw * 2 + 2), h = Math.max(y2 - y1, sw * 2 + 2);
  const r1 = (n) => Math.round(n * 10) / 10;
  const it = {
    id: uid(), boardId: S.boardId, type: 'draw', shape,
    x: Math.round(x1), y: Math.round(y1), w: Math.round(w), h: Math.round(h),
    vw: Math.round(w), vh: Math.round(h),
    pts: shape === 'rect' || shape === 'ellipse' ? [] : pts.map(p => [r1(p[0] - Math.round(x1)), r1(p[1] - Math.round(y1))]),
    stroke: DRAW.color, sw: r1(sw),
    z: maxZ() + 1, note: '', tags: [], addedAt: nowISO(),
  };
  pushHistory();
  await addItemToBoard(it);
}

/* ---------- かく：吹き出し・チェックリスト ---------- */
async function addBubble() {
  const v = await ask('吹き出しのことば', '', true);
  if (v === null || !v.trim()) return;
  pushHistory();
  const c = viewCenterCanvas();
  const lines = v.split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil(ln.length / 14)), 0);
  const w = 232, h = Math.round(clamp(30 + lines * 22, 64, 320));
  const it = {
    id: uid(), boardId: S.boardId, type: 'text', style: 'bubble', tail: 'bl', text: v,
    x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h,
    z: maxZ() + 1, note: '', tags: [], addedAt: nowISO(),
  };
  await addItemToBoard(it);
  selectItem(it.id);
}
async function editChecklist(it) {
  const title = await ask('チェックリストの見出し（例：撮るカット・持ち物）', it ? (it.title || '') : 'ショットリスト');
  if (title === null) return null;
  const sample = '★全身・正面\n★バストアップ\n手元のアップ\n後ろ姿';
  const body = await ask('1行に1項目。頭に ★ を付けると「必須」',
    it ? listRows(it).map(r => (r.must ? '★' : '') + r.t).join('\n') : sample, true);
  if (body === null) return null;
  // 同じ文の項目は、チェック済みかどうかを引き継ぐ
  const prev = new Map((it ? listRows(it) : []).map(r => [r.t, r.done]));
  const rows = body.split('\n').map(x => x.trim()).filter(Boolean).map(line => {
    const must = /^[★☆*＊]/.test(line);
    const t = line.replace(/^[★☆*＊]\s*/, '');
    return { t, must, done: !!prev.get(t) };
  });
  return { title: title.trim(), rows };
}
const listHeight = (r) => Math.round(30 + (r.title ? 27 : 0) + r.rows.reduce((n, x) => n + 26 * Math.max(1, Math.ceil(x.t.length / 15)), 0));
async function addChecklist() {
  const r = await editChecklist(null);
  if (!r) return;
  pushHistory();
  const c = viewCenterCanvas(), w = 250, h = listHeight(r);
  const it = {
    id: uid(), boardId: S.boardId, type: 'list', title: r.title, rows: r.rows,
    x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h,
    z: maxZ() + 1, note: '', tags: [], addedAt: nowISO(),
  };
  await addItemToBoard(it);
  selectItem(it.id);
}
async function editListItem(it) {
  const r = await editChecklist(it);
  if (!r) return;
  pushHistory();
  it.title = r.title; it.rows = r.rows;
  it.h = Math.max(it.h, listHeight(r));
  await dbPut('items', it);
  rebuildItemEl(it);
  touchBoard();
}
async function toggleListRow(it, i) {
  const rows = listRows(it);
  if (!rows[i]) return;
  pushHistory();
  rows[i].done = !rows[i].done;
  it.rows = rows;
  await dbPut('items', it);
  rebuildItemEl(it);
  touchBoard();
}

/* ---------- ならべる：ランダムに散らす・面積をそろえる ---------- */
async function scatterItems(list) {
  list = list.filter(Boolean);
  if (list.length < 2) return toast('2つ以上あるときに使えます');
  pushHistory();
  animateMoves(640);
  const b = boardBounds();
  const n = list.length;
  const avgW = list.reduce((a, i) => a + i.w, 0) / n, avgH = list.reduce((a, i) => a + i.h, 0) / n;
  const wrapEl = $('#canvas-wrap');
  const cols = Math.max(1, Math.round(Math.sqrt(n * wrapEl.clientWidth / Math.max(1, wrapEl.clientHeight))));
  // 少し重なるくらいに詰め、位置と角度をゆらす（コラージュの見た目）
  const cellW = avgW * 0.8, cellH = avgH * 0.74;
  const ox = b ? b.x1 : 0, oy = b ? b.y1 : 0;
  const order = [...list].sort(() => Math.random() - 0.5);
  let z = maxZ();
  order.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    it.x = Math.round(ox + c * cellW + (Math.random() - 0.5) * cellW * 0.4);
    it.y = Math.round(oy + r * cellH + (Math.random() - 0.5) * cellH * 0.4);
    const t = Math.round((Math.random() - 0.5) * 14);
    if (t) it.tilt = t; else delete it.tilt;
    it.z = ++z;
    updateItemEl(it);
    const el = itemEl(it.id); if (el) canvas.appendChild(el);
  });
  S.items.sort((a, b2) => (a.z || 0) - (b2.z || 0));
  await saveItems(list);
  fitAll();
  toast('ランダムに散らしました。もう一度押すと別の散らし方になります', 2800);
}
async function normalizeArea(list) {
  list = list.filter(Boolean);
  if (list.length < 2) return toast('2つ以上あるときに使えます');
  pushHistory();
  animateMoves();
  // 幅をそろえると横長の写真だけ小さく見える。面積をそろえると見た目の重さが均等になる
  const A = list.reduce((a, i) => a + i.w * i.h, 0) / list.length;
  list.forEach(it => {
    const r = it.w / Math.max(1, it.h);
    it.w = Math.round(Math.sqrt(A * r)); it.h = Math.round(it.w / r);
    if (it.vw) { /* 描いた線は viewBox で伸び縮みするので、そのままでよい */ }
    updateItemEl(it);
  });
  await saveItems(list);
  toast('面積をそろえました。「ならべる」で詰め直すときれいに並びます', 2800);
}

/* ---------- 色：配色をつくる ---------- */
function hexToHsl(hex) {
  const n = parseInt((normalizeHex(hex) || '#888888').slice(1), 16);
  return rgb2hsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}
const HARMONIES = [
  ['補色', '反対側の色。強い対比', (h) => [h, { ...h, h: h.h + 180 }]],
  ['類似色', '隣どうしの色。まとまりが出る', (h) => [{ ...h, h: h.h - 30 }, h, { ...h, h: h.h + 30 }]],
  ['トライアド', '3等分の色。にぎやか', (h) => [h, { ...h, h: h.h + 120 }, { ...h, h: h.h + 240 }]],
  ['分裂補色', '補色の両隣。対比をやわらげる', (h) => [h, { ...h, h: h.h + 150 }, { ...h, h: h.h + 210 }]],
  ['トーン', '同じ色の明るさ違い', (h) => [-0.26, -0.13, 0, 0.13, 0.26].map(d => ({ ...h, l: h.l + d }))],
  ['くすませる', '彩度を落として落ち着かせる', (h) => [0, 0.25, 0.45, 0.65].map(d => ({ ...h, s: h.s * (1 - d) }))],
];
let HARM = { base: '#c8b8a0', near: null };
function openHarmony(targets) {
  // もとの色：選んだ色見本 → 選んだ写真の代表色 → ボードの色 → 既定
  const col = targets.find(i => i.type === 'color');
  const ph = targets.find(isPhoto);
  const rec = ph && S.imgs.get(ph.imageId);
  const pal = boardPalette(1);
  HARM.base = (col && col.hex) || (rec && rec.hex) || (pal[0] && pal[0].hex) || HARM.base;
  const anchor = col || ph || null;
  HARM.near = anchor ? { x: anchor.x, y: anchor.y + anchor.h + 40 } : null;
  $('#harm-input').value = normalizeHex(HARM.base) || '#c8b8a0';
  renderHarmony();
  openSheet('#sheet-harmony');
}
function renderHarmony() {
  const base = normalizeHex(HARM.base) || '#c8b8a0';
  $('#harm-hex').textContent = base.toUpperCase();
  const h = hexToHsl(base);
  const box = $('#harm-rows'); box.innerHTML = '';
  HARMONIES.forEach(([name, desc, fn]) => {
    const hexes = fn(h).map(c => hslToHex(c.h, c.s, c.l));
    const row = document.createElement('div'); row.className = 'harm-row';
    const head = document.createElement('div'); head.className = 'harm-head';
    head.innerHTML = '<b></b><i></i>';
    head.querySelector('b').textContent = name; head.querySelector('i').textContent = desc;
    const sw = document.createElement('div'); sw.className = 'harm-sw';
    hexes.forEach(x => { const s = document.createElement('span'); s.style.background = x; s.title = x.toUpperCase(); sw.appendChild(s); });
    const put = document.createElement('button'); put.className = 'chip'; put.textContent = '置く';
    put.onclick = () => placeSwatchRow(hexes, name);
    row.append(head, sw, put); box.appendChild(row);
  });
}
$('#harm-input').oninput = (e) => { HARM.base = e.target.value; renderHarmony(); };
$('#harm-close').onclick = closeSheets;
async function placeSwatchRow(hexes, name) {
  closeSheets();
  if (S.mode === 'grid') setViewMode('canvas');
  pushHistory();
  const gap = 12, sz = 120;
  const c = HARM.near || viewCenterCanvas();
  const x0 = HARM.near ? c.x : c.x - (hexes.length * (sz + gap) - gap) / 2;
  let z = maxZ();
  for (let i = 0; i < hexes.length; i++) {
    await addItemToBoard({
      id: uid(), boardId: S.boardId, type: 'color', hex: hexes[i],
      x: Math.round(x0 + i * (sz + gap)), y: Math.round(c.y), w: sz, h: sz,
      z: ++z, note: '', tags: [], section: '', addedAt: nowISO(),
    });
  }
  renderPalette();
  toast(name + 'を ' + hexes.length + ' 色置きました');
}

/* ---------- 見る：プレゼン（1つずつ大きく見せる） ---------- */
let PR = null;
function presentList() {
  // 読む順：上の段から、同じ段なら左から（段の高さは写真のおおよその高さ）
  const list = S.items.filter(i => i.type !== 'draw');
  const band = list.length ? list.reduce((a, i) => a + i.h, 0) / list.length * 0.6 : 200;
  return list.sort((a, b) => (Math.floor(a.y / band) - Math.floor(b.y / band)) || (a.x - b.x));
}
function startPresent() {
  const list = presentList();
  if (!list.length) return toast('見せるものがありません');
  PR = { list, i: 0 };
  $('#present').hidden = false;
  showSlide();
  const el = $('#present');
  // 全画面は、できなくても見せられる（拒否されると Promise が失敗するので、それも受け止める）
  try {
    const fs = el.requestFullscreen || el.webkitRequestFullscreen;
    const p = fs && fs.call(el);
    if (p && p.catch) p.catch(() => { });
  } catch (e) { }
}
async function showSlide() {
  if (!PR) return;
  const it = PR.list[PR.i];
  const st = $('#present-stage');
  st.innerHTML = '';
  const W = st.clientWidth * 0.92, H = st.clientHeight * 0.9;
  const sc = Math.min(W / it.w, H / it.h);
  const w = Math.round(it.w * sc), h = Math.round(it.h * sc);
  if (isPhoto(it)) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = await renderPhotoCanvas(it, w * dpr, h * dpr);
    if (!PR || PR.list[PR.i] !== it) return;      // 速くめくったとき、古い1枚を出さない
    if (c) { c.className = 'pr-photo'; c.style.width = w + 'px'; c.style.height = h + 'px'; st.appendChild(c); }
  } else {
    const c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
    c.className = 'pr-photo';
    const g = c.getContext('2d');
    await paintItem(g, { ...it, tilt: 0 }, { x: 0, y: 0, w: c.width, h: c.height }, { shadow: false });
    st.appendChild(c);
  }
  $('#present-count').textContent = (PR.i + 1) + ' / ' + PR.list.length;
  $('#present-cap').textContent = [it.note, (it.refs || []).join('・'), it.desc].filter(Boolean).join('　');
}
function stepSlide(d) { if (!PR) return; PR.i = (PR.i + d + PR.list.length) % PR.list.length; showSlide(); }
function stopPresent() {
  PR = null;
  $('#present').hidden = true;
  $('#present-stage').innerHTML = '';
  try { if (document.fullscreenElement) document.exitFullscreen(); else if (document.webkitFullscreenElement) document.webkitExitFullscreen(); } catch (e) { }
}
$('#present-prev').onclick = () => stepSlide(-1);
$('#present-next').onclick = () => stepSlide(1);
$('#present-close').onclick = stopPresent;
(() => {   // 指でめくる
  let sx = null;
  $('#present-stage').addEventListener('pointerdown', e => { sx = e.clientX; });
  $('#present-stage').addEventListener('pointerup', e => {
    if (sx == null) return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 50) stepSlide(dx < 0 ? 1 : -1);
    else stepSlide(e.clientX > window.innerWidth / 2 ? 1 : -1);
  });
})();
document.addEventListener('fullscreenchange', () => { if (PR && !document.fullscreenElement) { /* 全画面だけ抜けたときはそのまま */ } });

/* ---------- 1枚表示の道具：スポイト・構図ガイド・撮影データ ---------- */
let VW = { eyedrop: false, guide: 0, info: false, pixels: null, pixelsFor: null, picked: null };
function viewerImageRect() {
  const img = $('#viewer-img'), st = $('#viewer-stage').getBoundingClientRect();
  const r = img.getBoundingClientRect();
  const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
  const sc = Math.min(r.width / iw, r.height / ih);
  const w = iw * sc, h = ih * sc;
  return { x: r.left - st.left + (r.width - w) / 2, y: r.top - st.top + (r.height - h) / 2, w, h, iw, ih, sl: st.left, stp: st.top };
}
function resetViewerTools() {
  VW.eyedrop = false; VW.guide = 0; VW.info = false; VW.picked = null;
  $('#viewer-pick').hidden = true; $('#viewer-guide').hidden = true; $('#viewer-info').hidden = true;
  $('#viewer').classList.remove('eyedrop');
  $('#viewer-eyedrop').classList.remove('on'); $('#viewer-info-btn').classList.remove('on');
  $('#viewer-guide-btn').textContent = 'ガイド'; $('#viewer-guide-btn').classList.remove('on');
}
/* スポイト：写真の1点の色をつまむ（まわりの5×5の平均。1画素だとノイズを拾う） */
function setEyedrop(on) {
  VW.eyedrop = on;
  $('#viewer').classList.toggle('eyedrop', on);
  $('#viewer-eyedrop').classList.toggle('on', on);
  if (!on) $('#viewer-pick').hidden = true;
  else toast('写真の、色をとりたいところを押してください');
}
async function viewerPixels() {
  if (!viewerItem) return null;
  if (VW.pixelsFor === viewerItem.imageId && VW.pixels) return VW.pixels;
  const rec = S.imgs.get(viewerItem.imageId) || await dbGet('images', viewerItem.imageId);
  if (!rec) return null;
  const dec = await decodeImage(rec.full);
  const c = drawCanvas(dec.src, dec.w, dec.h, 1200);
  dec.close();
  VW.pixels = c; VW.pixelsFor = viewerItem.imageId;
  return c;
}
$('#viewer-stage').addEventListener('click', async (e) => {
  if (!VW.eyedrop) return;
  if (e.target.closest('#viewer-pick') || e.target.closest('#viewer-info')) return;
  const R = viewerImageRect();
  const lx = e.clientX - R.sl - R.x, ly = e.clientY - R.stp - R.y;
  if (lx < 0 || ly < 0 || lx > R.w || ly > R.h) return;
  const c = await viewerPixels(); if (!c) return;
  const px = Math.floor(lx / R.w * c.width), py = Math.floor(ly / R.h * c.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  const x0 = clamp(px - 2, 0, c.width - 5), y0 = clamp(py - 2, 0, c.height - 5);
  const d = g.getImageData(x0, y0, 5, 5).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  const hex = toHex(Math.round(r / n), Math.round(gg / n), Math.round(b / n));
  VW.picked = hex;
  $('#vp-sw').style.background = hex;
  $('#vp-hex').textContent = hex.toUpperCase();
  const pk = $('#viewer-pick');
  pk.hidden = false;
  // 押した場所の近くに出す（画面からはみ出さないように）
  const sr = $('#viewer-stage').getBoundingClientRect();
  pk.style.left = clamp(e.clientX - sr.left - pk.offsetWidth / 2, 8, sr.width - pk.offsetWidth - 8) + 'px';
  pk.style.top = clamp(e.clientY - sr.top + 18, 8, sr.height - pk.offsetHeight - 8) + 'px';
});
$('#viewer-eyedrop').onclick = () => setEyedrop(!VW.eyedrop);
$('#vp-copy').onclick = (e) => { e.stopPropagation(); if (VW.picked) copyHex(VW.picked); };
$('#vp-place').onclick = async (e) => {
  e.stopPropagation();
  if (!VW.picked || !viewerItem) return;
  const it = viewerItem, hex = VW.picked;
  $('#viewer').hidden = true; resetViewerTools();
  await placeColor(hex, { x: it.x + it.w + 30 + SWATCH_W / 2, y: it.y + SWATCH_H / 2 });
};

/* 構図ガイド：三分割・黄金比・対角線と、使う先の比率（SNS・誌面）の枠 */
const GUIDES = [
  ['なし'], ['三分割', 'grid', 1 / 3], ['黄金比', 'grid', 0.382], ['対角線', 'diag'],
  ['4:5 縦投稿', 'ratio', 4 / 5], ['9:16 ストーリー', 'ratio', 9 / 16], ['1:1', 'ratio', 1],
  ['16:9 横', 'ratio', 16 / 9], ['A判 誌面', 'ratio', 1 / Math.SQRT2],
];
function cycleGuide() {
  VW.guide = (VW.guide + 1) % GUIDES.length;
  drawGuide();
}
function drawGuide() {
  const g = GUIDES[VW.guide], svg = $('#viewer-guide'), btn = $('#viewer-guide-btn');
  btn.textContent = VW.guide ? 'ガイド：' + g[0] : 'ガイド';
  btn.classList.toggle('on', !!VW.guide);
  if (!VW.guide) { svg.hidden = true; return; }
  const R = viewerImageRect();
  svg.hidden = false;
  svg.setAttribute('style', 'left:' + R.x + 'px;top:' + R.y + 'px;width:' + R.w + 'px;height:' + R.h + 'px');
  svg.setAttribute('viewBox', '0 0 ' + R.w + ' ' + R.h);
  const W = R.w, H = R.h, L = (x1, y1, x2, y2) => '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
  let inner = '';
  if (g[1] === 'grid') {
    const a = g[2], b = 1 - g[2];
    inner = '<g class="gl">' + L(W * a, 0, W * a, H) + L(W * b, 0, W * b, H) + L(0, H * a, W, H * a) + L(0, H * b, W, H * b) + '</g>';
    inner += '<g class="gp">' + [[a, a], [b, a], [a, b], [b, b]].map(([x, y]) => '<circle cx="' + W * x + '" cy="' + H * y + '" r="4"/>').join('') + '</g>';
  } else if (g[1] === 'diag') {
    inner = '<g class="gl">' + L(0, 0, W, H) + L(W, 0, 0, H) + L(W / 2, 0, W / 2, H) + L(0, H / 2, W, H / 2) + '</g>';
  } else {
    // その比率で切り取れる一番大きな枠を真ん中に置き、外側を暗くする
    const r = g[2];
    let fw = W, fh = W / r;
    if (fh > H) { fh = H; fw = H * r; }
    const fx = (W - fw) / 2, fy = (H - fh) / 2;
    inner = '<path class="gs" fill-rule="evenodd" d="M0 0H' + W + 'V' + H + 'H0Z M' + fx + ' ' + fy + 'h' + fw + 'v' + fh + 'h' + (-fw) + 'Z"/>' +
            '<rect class="gf" x="' + fx + '" y="' + fy + '" width="' + fw + '" height="' + fh + '"/>' +
            '<text class="gt" x="' + (fx + 10) + '" y="' + (fy + 22) + '">' + g[0] + '</text>';
  }
  svg.innerHTML = inner;
}
$('#viewer-guide-btn').onclick = cycleGuide;
window.addEventListener('resize', () => { if (!$('#viewer').hidden && VW.guide) drawGuide(); });

/* 撮影データ（カメラ・レンズ・絞り・シャッター・ISO）とヒストグラム */
function fmtExif(x) {
  if (!x) return [];
  const out = [];
  const cam = [x.make, x.model].filter(Boolean).join(' ').replace(/^(\S+)\s+\1\s/i, '$1 ');
  if (cam) out.push(['カメラ', cam]);
  if (x.lens) out.push(['レンズ', x.lens]);
  const set = [];
  if (x.focal) set.push(Math.round(x.focal) + 'mm' + (x.focal35 && Math.round(x.focal35) !== Math.round(x.focal) ? '（35mm換算 ' + x.focal35 + 'mm）' : ''));
  if (x.f) set.push('f/' + (+x.f).toFixed(1).replace(/\.0$/, ''));
  if (x.exp) set.push(x.exp >= 1 ? x.exp + '秒' : '1/' + Math.round(1 / x.exp));
  if (x.iso) set.push('ISO ' + x.iso);
  if (set.length) out.push(['設定', set.join('　')]);
  if (x.date) out.push(['撮影日', x.date.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1/$2/$3')]);
  return out;
}
async function histogramSvg(rec) {
  try {
    const bmp = await createImageBitmap(await realBlob(rec.thumb || rec.full));
    const c = document.createElement('canvas'); c.width = 160; c.height = Math.max(1, Math.round(160 * bmp.height / bmp.width));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const bins = new Array(64).fill(0);
    for (let i = 0; i < d.length; i += 4) bins[Math.min(63, (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) >> 2)]++;
    const mx = Math.max(...bins) || 1, W = 256, H = 64;
    let p = 'M0 ' + H;
    bins.forEach((v, i) => { p += 'L' + (i * W / 63).toFixed(1) + ' ' + (H - v / mx * H).toFixed(1); });
    p += 'L' + W + ' ' + H + 'Z';
    // 端に山が張り付いていたら、白飛び・黒つぶれの目安
    const n = d.length / 4, lo = (bins[0] + bins[1]) / n, hi = (bins[62] + bins[63]) / n;
    const warn = [lo > 0.04 ? '暗部がつぶれ気味' : '', hi > 0.04 ? '明部が飛び気味' : ''].filter(Boolean).join('・');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="histo"><path d="' + p + '"/></svg>' +
           '<div class="histo-legend"><span>暗い</span><span>' + (warn || '明暗のかたより') + '</span><span>明るい</span></div>';
  } catch (e) { return ''; }
}
async function toggleInfo(on) {
  VW.info = on == null ? !VW.info : on;
  $('#viewer-info-btn').classList.toggle('on', VW.info);
  const box = $('#viewer-info');
  if (!VW.info || !viewerItem) { box.hidden = true; return; }
  const rec = S.imgs.get(viewerItem.imageId) || await dbGet('images', viewerItem.imageId);
  if (!rec) return;
  const rows = [['大きさ', rec.w + ' × ' + rec.h + '　' + fmtBytes(rec.full.size)]].concat(fmtExif(rec.exif));
  if (rec.srcUrl) { try { rows.push(['出どころ', new URL(rec.srcUrl).hostname]); } catch (e) { } }
  if (!rec.exif) rows.push(['撮影データ', 'この写真には残っていません（ネットの画像やスクショには無いことが多い）']);
  box.innerHTML = '<div class="vi-rows"></div>' + await histogramSvg(rec);
  const list = box.querySelector('.vi-rows');
  rows.forEach(([k, v]) => { const r = document.createElement('div'); r.innerHTML = '<b></b><span></span>'; r.querySelector('b').textContent = k; r.querySelector('span').textContent = v; list.appendChild(r); });
  box.hidden = false;
}
$('#viewer-info-btn').onclick = () => toggleInfo();

/* ---------- 撮影データを取り込み時に読む（JPEG の Exif） ----------
   取り込むと画像を作り直すので、その前に元のファイルから読んでおく。
   位置情報（GPS）は読まない（家の場所が分かってしまうため）。 */
async function readExif(blob) {
  try {
    const isJpeg = /jpe?g/i.test(blob.type || '') || /\.jpe?g$/i.test(blob.name || '');
    if (!isJpeg) return null;
    const dv = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 10 < dv.byteLength) {
      const marker = dv.getUint16(off), len = dv.getUint16(off + 2);
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) return parseExifTiff(dv, off + 10);
      off += 2 + len;
    }
  } catch (e) { /* 読めなければ無しでよい */ }
  return null;
}
function parseExifTiff(dv, start) {
  const le = dv.getUint16(start) === 0x4949;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const readIFD = (ifdOff, tags) => {
    const base = start + ifdOff, res = {};
    if (base + 2 > dv.byteLength) return res;
    const n = u16(base);
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), name = tags[tag];
      if (!name) continue;
      const size = (SZ[type] || 1) * cnt;
      const vo = size > 4 ? start + u32(e + 8) : e + 8;
      if (vo + size > dv.byteLength) continue;
      let v;
      if (type === 2) { v = ''; for (let k = 0; k < cnt; k++) { const ch = dv.getUint8(vo + k); if (!ch) break; v += String.fromCharCode(ch); } v = v.trim(); }
      else if (type === 3) v = u16(vo);
      else if (type === 4) v = u32(vo);
      else if (type === 5) v = u32(vo) / (u32(vo + 4) || 1);
      else if (type === 10) v = dv.getInt32(vo, le) / (dv.getInt32(vo + 4, le) || 1);
      if (v !== '' && v != null) res[name] = v;
    }
    return res;
  };
  const ifd0 = readIFD(u32(start + 4), { 0x010F: 'make', 0x0110: 'model', 0x8769: 'exif' });
  const out = { make: ifd0.make, model: ifd0.model };
  if (ifd0.exif) Object.assign(out, readIFD(ifd0.exif, {
    0x829A: 'exp', 0x829D: 'f', 0x8827: 'iso', 0x9003: 'date', 0x920A: 'focal', 0xA405: 'focal35', 0xA434: 'lens',
  }));
  Object.keys(out).forEach(k => out[k] == null && delete out[k]);
  return Object.keys(out).length ? out : null;
}

/* ---------- ⌘V で貼り付けて入れる ----------
   どのサイトでも「画像をコピー」→ ここで ⌘V で1枚ずつ入れられる（自分で保存するのと同じ）。
   まとめて自動で集めることを禁じているサイト（Instagram・models.com）向けの、正しい入れ方。 */
document.addEventListener('paste', async (e) => {
  if (S.view !== 'board' && S.view !== 'home') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (!$('#prompt').hidden) return;
  if (!$('#progress').hidden || !$('#crop').hidden) return;   // 取り込み・切り抜きの途中は受け付けない
  const cd = e.clipboardData;
  if (!cd) return;
  const files = Array.from(cd.files || []).filter(f => f.type.startsWith('image/') || isVideoFile(f));
  const text = cd.getData('text/plain') || '';
  const isUrl = /https?:\/\/\S+/.test(text);
  if (!files.length && !isUrl) return;
  e.preventDefault();
  closeSheets(); closeOverlays();   // 入ったものが見えるように、上に重なっているものは閉じる（1枚表示の裏に入っていた）
  // ボード一覧で貼ったときもストックへ入れる（以前は「ストック」を開いているときしか受け付けず、黙って何も起きなかった）
  if (S.view === 'home' && !STOCK.on) showStock(true);
  if (files.length) return S.view === 'board' ? importFiles(files, { atCenter: true }) : importToStock(files);
  return importUrls(text);
});

/* ========================== Mac版のつなぎ ================================ */
if (NATIVE) {
  document.documentElement.classList.add('native');

  // 印刷：Mac版では window.print() が動かないので、アプリ側の印刷を呼ぶ。
  // 用紙と向き・余白はアプリ側にも伝える（@page だけでは効かないため）
  window.print = () => {
    const P = PAPER[PRINT.paper] || PAPER.a4p;
    mbCall('print', { paperW: Math.min(P.w, P.h), paperH: Math.max(P.w, P.h), landscape: P.orient === 'landscape', margin: pMargin() })
      .catch(() => { })
      .finally(() => window.dispatchEvent(new Event('afterprint')));
  };

  // 窓の上の帯を、画面の背景色にそろえる（テーマや盤面の色が変わったら追いかける）
  let lastBg = '';
  const sendTheme = () => {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!m) return;
    const hex = '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
    if (hex !== lastBg) { lastBg = hex; mbCall('theme', { bg: hex }).catch(() => { }); }
  };
  new MutationObserver(() => requestAnimationFrame(sendTheme))
    .observe(document.documentElement, { attributes: true, subtree: false });
  new MutationObserver(() => requestAnimationFrame(sendTheme))
    .observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(sendTheme));
  requestAnimationFrame(sendTheme);

  // USBとつなぐ：Mac版ではフォルダに直接つなげない代わりに、ライブラリそのものをUSBに置ける
  const usbNote = $('#usb-unsupported');
  if (usbNote) usbNote.innerHTML = '<b>Mac版では、ライブラリそのものをUSBメモリに置けます。</b><br>'
    + '設定（歯車）→ ライブラリ →「場所を変える…」でUSBメモリを選ぶと、写真とボードがそのままUSBに入ります。'
    + '<br>USBに入れて持ち歩き、別のMacの MOOD BOARD で開くこともできます。';

  // 設定：ライブラリの場所
  const lib = $('#st-library');
  if (lib) {
    lib.hidden = false;
    const fill = async () => {
      await nativeLoad();
      $('#st-lib-path').textContent = NS.info.lib;
      const st = await mbCall('libStats').catch(() => null);
      $('#st-lib-stats').textContent = st
        ? NS.maps.images.size + ' 枚・' + fmtBytes(st.bytes) + '（空き ' + fmtBytes(st.free) + '）' + (st.removable ? '・USBメモリなど' : '')
        : '';
    };
    const btn = $('#btn-settings');
    if (btn) btn.addEventListener('click', () => setTimeout(fill, 0));
    fill();
    $('#st-lib-reveal').onclick = () => mbCall('reveal');
    $('#st-lib-change').onclick = async () => {
      await nFlush();
      const changed = await mbCall('chooseLibrary').catch(() => false);
      if (!changed) return;   // 変わったらアプリ側が読み込み直す
    };
  }
}


/* ========================== 選んだものの設定パネル（右側） =================
   写真をタップすると、その場でタグ・大きさ・見た目などを変えられる。変えたらすぐ盤面に効く
   （保存ボタンは無い。元にもどす ⌘Z で戻せる）。
   以前は1枚選ぶと下のドックが「道具・大きく・メモ・うつす・はずす」に切り替わり、
   何枚か選ぶと8つのボタンが並んでいた。それをここに畳んだ（本人「ボタンが多すぎる」）。
   盤面には重ねない：パネルの幅だけ盤面を狭める（#view-board.with-insp）。 */
var INSP = { key: '', typing: false, histDone: false };
function inspTargets() {
  if (S.view !== 'board') return [];
  if (S.picking) return pickedItems();
  const it = selItem();
  return it ? [it] : [];
}
const inspEl = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
function inspSec(body, title, hint) {
  const s = inspEl('section', 'insp-sec');
  const h = inspEl('div', 'insp-h', title);
  if (hint) h.appendChild(inspEl('i', '', hint));
  s.appendChild(h); body.appendChild(s);
  return s;
}
function inspChip(label, on, fn, extra) {
  const c = inspEl('button', 'chip' + (on === true ? ' on' : on === 'part' ? ' part' : '') + (extra ? ' ' + extra : ''), label);
  c.onclick = fn;
  return c;
}
function inspAction(label, svg, fn, danger) {
  const b = inspEl('button', 'insp-act' + (danger ? ' danger' : ''));
  b.innerHTML = '<svg viewBox="0 0 24 24">' + svg + '</svg><span></span>';
  b.lastChild.textContent = label;
  b.onclick = fn;
  return b;
}
const INSP_ICON = {
  view: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.6"/>',
  crop: '<path d="M6 2v14a2 2 0 002 2h14"/><path d="M2 6h14a2 2 0 012 2v14"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  move: '<path d="M4 12h13M13 7l5 5-5 5"/><path d="M20 4v16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  compare: '<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 14h10v6H7z"/>',
  adjust: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
};

/* 変更を盤面とファイルに反映する。how: 'look'（見た目だけ）/'rebuild'（中身ごと作り直す）/'pos'（位置と大きさ） */
async function inspApply(list, fn, how, noHist) {
  if (!list.length) return;
  if (!noHist) pushHistory();
  list.forEach(it => {
    fn(it);
    if (how === 'rebuild') rebuildItemEl(it);
    else if (how === 'pos') updateItemEl(it);
    else refreshItemLook(it);
  });
  await saveItems(list);
}

/* 選んでいるものが変わったときだけ組み立て直す（打っている途中で作り直すと、入力が切れるため） */
function renderInspector(force) {
  const box = $('#inspector');
  if (!box) return;
  const list = inspTargets();
  const drawing = typeof DRAW !== 'undefined' && DRAW.on;
  const show = list.length > 0 && !drawing;
  box.hidden = !show;
  $('#view-board').classList.toggle('with-insp', show);
  if (!show) { INSP.key = ''; return; }
  const key = (S.picking ? 'P:' : 'S:') + list.map(i => i.id).join(',');
  if (!force && key === INSP.key) { syncInspectorSize(); return; }
  INSP.key = key;
  const body = $('#insp-body');
  const keepScroll = body.scrollTop;
  body.innerHTML = '';
  if (list.length === 1 && !S.picking) buildInspOne(body, list[0]);
  else buildInspMany(body, list);
  body.scrollTop = force ? keepScroll : 0;
}

/* ---- 1つ選んだとき ---- */
function buildInspOne(body, it) {
  const photo = !!it.imageId, kind = it.type || 'photo';
  $('#insp-title').textContent = (photo && isVideoRec(S.imgs.get(it.imageId))) ? '動画' : { photo: 'この写真', text: it.style === 'bubble' ? '吹き出し' : '文字', list: 'チェックリスト', color: '色見本', draw: '描いた線' }[kind] || 'えらんだもの';

  // よく使う操作
  const acts = inspEl('div', 'insp-acts');
  const vrec = photo && isVideoRec(S.imgs.get(it.imageId));
  if (photo) {
    acts.appendChild(inspAction(vrec ? '再生' : '大きく見る', INSP_ICON.view, () => openViewer(it)));
    if (!vrec) acts.appendChild(inspAction('切り抜く', INSP_ICON.crop, async () => { await openViewer(it); $('#viewer-crop').click(); }));
  }
  if (kind === 'text') acts.appendChild(inspAction('文字を直す', INSP_ICON.edit, () => editTextItem(it)));
  if (kind === 'list') acts.appendChild(inspAction('中身を直す', INSP_ICON.edit, () => editListItem(it)));
  acts.appendChild(inspAction('複製', INSP_ICON.dup, async () => { const n = await duplicateItems([it.id]); if (n) toast('複製しました'); }));
  acts.appendChild(inspAction('うつす', INSP_ICON.move, () => openMoveSheet()));
  acts.appendChild(inspAction('はずす', INSP_ICON.trash, () => $('#btn-item-remove').click(), true));
  body.appendChild(acts);
  if (photo) inspMarkBlock(body, [it]);

  // ひとこと・説明（写真と色見本）
  if (photo || kind === 'color') {
    const s = inspSec(body, 'ひとこと', '写真の下に出る');
    const inp = inspEl('input', 'fld-input'); inp.type = 'text'; inp.value = it.note || ''; inp.placeholder = '金具の感じ';
    s.appendChild(inp);
    inspText(inp, it, 'note', true);
    if (photo) {
      const s2 = inspSec(body, '説明', '長く書きたいとき');
      const ta = inspEl('textarea', 'fld-area'); ta.value = it.desc || ''; ta.rows = 3;
      ta.placeholder = 'どこが良いのか、どう使うつもりか';
      s2.appendChild(ta);
      inspText(ta, it, 'desc', false);
    }
  }
  if (kind === 'text') inspCardColorBlock(body, [it]);
  if (kind === 'draw') inspStrokeBlock(body, [it]);
  if (kind !== 'draw') inspTagBlocks(body, [it], photo);
  inspSizeBlock(body, it);
  inspLookBlock(body, [it]);
  inspOrderBlock(body, [it]);
}

/* 打つたびに保存する（最初の1文字のときだけ「元にもどす」の控えを取る） */
function inspText(el, it, field, rebuild) {
  let t = null;
  el.addEventListener('focus', () => { INSP.typing = true; INSP.histDone = false; });
  el.addEventListener('blur', () => { INSP.typing = false; });
  el.addEventListener('input', () => {
    if (!INSP.histDone) { pushHistory(); INSP.histDone = true; }
    clearTimeout(t);
    t = setTimeout(async () => {
      it[field] = el.value.trim();
      if (!it[field]) delete it[field];
      if (rebuild) rebuildItemEl(it);
      await saveItems([it]);
    }, 280);
  });
}

/* ---- タグ・区分け・参考にするところ（1つでも、まとめてでも） ---- */
function inspTagBlocks(body, list, withRefs) {
  const has = (it, k, v) => (it[k] || []).includes(v);
  const state = (k, v) => { const n = list.filter(it => has(it, k, v)).length; return n === list.length ? true : n ? 'part' : false; };
  // 全部に付いていれば外す、そうでなければ全部に付ける
  const toggle = (k, v) => { const on = state(k, v) === true; return inspApply(list, it => {
    const cur = new Set(it[k] || []);
    if (on) cur.delete(v); else cur.add(v);
    it[k] = k === 'refs' ? sortRefs([...cur]) : [...cur];
    if (!it[k].length) delete it[k];
  }, 'rebuild').then(() => renderInspector(true)); };

  if (withRefs) {
    const s = inspSec(body, '参考にするところ', 'この写真の「何を」使うか');
    const row = inspEl('div', 'tag-row');
    REF_PRESET.forEach(r => row.appendChild(inspChip(r, state('refs', r), () => toggle('refs', r))));
    s.appendChild(row);
  }

  const s = inspSec(body, 'タグ', list.length > 1 ? '押すと ' + list.length + ' 枚すべてに付く／外れる' : '押すだけで付け外し');
  const row = inspEl('div', 'tag-row');
  const mine = [...new Set(list.flatMap(it => it.tags || []))];
  mine.forEach(t => row.appendChild(inspChip(t, state('tags', t), () => toggle('tags', t))));
  knownTags().filter(t => !mine.includes(t)).slice(0, 10).forEach(t => row.appendChild(inspChip(t, false, () => toggle('tags', t), 'sug')));
  s.appendChild(row);
  const add = inspEl('input', 'fld-input'); add.type = 'text'; add.placeholder = '新しいタグを打って Enter';
  add.addEventListener('focus', () => { INSP.typing = true; });
  add.addEventListener('blur', () => { INSP.typing = false; });
  add.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || imeKey(e)) return;
    e.preventDefault();
    const tags = add.value.split(/[,、\s]+/).map(x => x.trim()).filter(Boolean);
    if (!tags.length) return;
    inspApply(list, it => { it.tags = [...new Set([...(it.tags || []), ...tags])]; }, 'rebuild').then(() => renderInspector(true));
  });
  s.appendChild(add);

  const s2 = inspSec(body, '区分け', 'ボードの中のグループ');
  const row2 = inspEl('div', 'tag-row');
  const secs = new Set(list.map(it => it.section || ''));
  const cur = secs.size === 1 ? [...secs][0] : null;
  const setSec = (v) => inspApply(list, it => { if (v) it.section = v; else delete it.section; }, 'rebuild').then(() => renderInspector(true));
  row2.appendChild(inspChip('なし', cur === '', () => setSec('')));
  knownSections().forEach(n => row2.appendChild(inspChip(n, cur === n, () => setSec(n))));
  row2.appendChild(inspChip('＋ 新しい区分け', false, async () => { const v = await ask('区分けの名前', ''); if (v) setSec(v.trim()); }, 'add'));
  s2.appendChild(row2);
}

/* ---- 大きさ ---- */
function inspSizeBlock(body, it) {
  const s = inspSec(body, '大きさ');
  const row = inspEl('div', 'insp-size');
  const w = inspEl('input', 'fld-input num'); w.type = 'number'; w.min = 20; w.id = 'insp-w';
  const h = inspEl('input', 'fld-input num'); h.type = 'number'; h.min = 20; h.id = 'insp-h';
  w.value = Math.round(it.w); h.value = Math.round(it.h);
  const keep = it.type !== 'text' && it.type !== 'list';     // 写真や線は縦横比を保つ
  const apply = (nw, nh) => inspApply([it], x => { x.w = Math.max(20, Math.round(nw)); x.h = Math.max(20, Math.round(nh)); }, it.type === 'draw' ? 'rebuild' : 'pos')
    .then(() => { positionHandle(); syncInspectorSize(); });
  w.onchange = () => { const v = +w.value || it.w; apply(v, keep ? v * it.h / it.w : it.h); };
  h.onchange = () => { const v = +h.value || it.h; apply(keep ? v * it.w / it.h : it.w, v); };
  row.append(inspEl('span', 'lbl', 'よこ'), w, inspEl('span', 'lbl', 'たて'), h);
  s.appendChild(row);
  const q = inspEl('div', 'tag-row');
  q.appendChild(inspChip('小さく', false, () => apply(it.w * 0.8, it.h * 0.8)));
  q.appendChild(inspChip('大きく', false, () => apply(it.w * 1.25, it.h * 1.25)));
  if (it.imageId) {
    const rec = S.imgs.get(it.imageId);
    if (rec && rec.w && rec.h) q.appendChild(inspChip('元の縦横比', false, () => apply(it.w, it.w * rec.h / rec.w)));
  }
  s.appendChild(q);
}
function syncInspectorSize() {
  const it = !S.picking && selItem();
  const w = $('#insp-w'), h = $('#insp-h');
  if (!it || !w || !h || document.activeElement === w || document.activeElement === h) return;
  w.value = Math.round(it.w); h.value = Math.round(it.h);
}

/* ---- 見た目（不透明度・かたむき・反転・補正） ---- */
function inspSlider(sec, label, min, max, val, unit, onLive) {
  const row = inspEl('div', 'sl-row');
  const lab = inspEl('label', '', label);
  const r = inspEl('input'); r.type = 'range'; r.min = min; r.max = max; r.step = 1; r.value = val;
  const out = inspEl('output', '', val + unit);
  const paint = () => { r.style.setProperty('--p', ((r.value - min) / (max - min) * 100) + '%'); out.textContent = r.value + unit; };
  paint();
  let started = false;
  r.addEventListener('input', () => { if (!started) { pushHistory(); started = true; } paint(); onLive(+r.value, false); });
  r.addEventListener('change', () => { started = false; onLive(+r.value, true); });
  row.append(lab, r, out);
  sec.appendChild(row);
}
function inspLookBlock(body, list) {
  const s = inspSec(body, '見た目');
  const g = inspEl('div', 'sl-group');
  const first = list[0];
  const live = (fn) => (v, end) => { list.forEach(it => { fn(it, v); refreshItemLook(it); }); if (end) saveItems(list); };
  inspSlider(g, '不透明度', 10, 100, Math.round((first.opacity != null ? first.opacity : 1) * 100), '%',
    live((it, v) => { if (v >= 100) delete it.opacity; else it.opacity = v / 100; }));
  if (list.length === 1 && first.type !== 'draw') {
    inspSlider(g, 'かたむき', -45, 45, first.tilt || 0, '°', live((it, v) => { if (v) it.tilt = v; else delete it.tilt; }));
  }
  s.appendChild(g);
  const photos = list.filter(isPhoto);
  if (photos.length) {
    const q = inspEl('div', 'tag-row');
    q.appendChild(inspChip('左右反転', photos.every(p => p.flipX), () => flipItems(photos, 'flipX').then(() => renderInspector(true))));
    q.appendChild(inspChip('上下反転', photos.every(p => p.flipY), () => flipItems(photos, 'flipY').then(() => renderInspector(true))));
    q.appendChild(inspChip('明るさ・色を整える…', false, () => openAdjust(photos, 'adjust')));
    s.appendChild(q);
  }
}

/* ---- 重なり・固定 ---- */
function inspOrderBlock(body, list) {
  const s = inspSec(body, '重なりと固定');
  const q = inspEl('div', 'tag-row');
  q.appendChild(inspChip('いちばん前', false, () => reorder(list, 'front')));
  q.appendChild(inspChip('いちばん後ろ', false, () => reorder(list, 'back')));
  q.appendChild(inspChip(list.every(i => i.locked) ? '固定中（押すと外す）' : '固定する', list.every(i => i.locked), () => toggleLock(list).then(() => renderInspector(true))));
  s.appendChild(q);
}

/* ---- 何枚か選んだとき ---- */
function buildInspMany(body, list) {
  $('#insp-title').textContent = list.length + ' 枚えらんでいます';
  if (!list.length) return;
  const photos = list.filter(isPhoto);
  const acts = inspEl('div', 'insp-acts');
  const cmp = inspAction('くらべる', INSP_ICON.compare, () => $('#btn-compare-go').click());
  cmp.disabled = photos.length < 2 || photos.length > 6;
  if (cmp.disabled) cmp.title = '写真を2〜6枚えらぶと使えます';
  acts.appendChild(cmp);
  acts.appendChild(inspAction('送る', INSP_ICON.send, () => openSend()));
  acts.appendChild(inspAction('複製', INSP_ICON.dup, async () => { const n = await duplicateItems(S.picked.slice()); if (n) toast(n + ' 枚複製しました'); }));
  acts.appendChild(inspAction('うつす', INSP_ICON.move, () => $('#btn-bulk-move').click()));
  acts.appendChild(inspAction('はずす', INSP_ICON.trash, () => $('#btn-bulk-trash').click(), true));
  body.appendChild(acts);
  if (photos.length) inspMarkBlock(body, photos);

  if (list.every(i => i.type === 'text')) inspCardColorBlock(body, list);
  if (list.every(i => i.type === 'draw')) inspStrokeBlock(body, list);
  inspTagBlocks(body, list, photos.length === list.length);

  if (list.length >= 2) {
    const s = inspSec(body, 'そろえる');
    const grid = inspEl('div', 'insp-align');
    [['left', '左'], ['cx', '中央'], ['right', '右'], ['distx', '横に等間隔'],
     ['top', '上'], ['cy', '真ん中'], ['bottom', '下'], ['disty', '縦に等間隔'],
     ['samew', '幅'], ['sameh', '高さ'], ['samearea', '面積'], ['row', '横一列'], ['col', '縦一列'], ['stack', '重ねる']]
      .forEach(([m, l]) => grid.appendChild(inspChip(l, false, () => applyAlign(m))));
    s.appendChild(grid);
  }
  inspLookBlock(body, list);
  inspOrderBlock(body, list);
}

$('#insp-close').onclick = () => { if (S.picking) stopPicking(); else selectItem(null); };

/* ========================== キーボードのショートカット ======================
   1つの表にまとめ、「押したとき」「Mac版のメニュー」「一覧（⌘/）」の3つで同じものを使う。
   where: 'any'（どこでも）/ 'board'（ボードを開いているとき）。m が無いものは一覧に出すだけ
   （押したときの処理は keydown の中に別にある：⌘Z・⌘A・⌘D・矢印・Esc・スペース＋ドラッグ） */
const kmod = (e) => e.metaKey || e.ctrlKey;
const kis = (e, k) => (e.key || '').toLowerCase() === k;
const plain = (e) => !kmod(e) && !e.altKey;
const keyTargets = () => toolTargets();
const KEYMAP = [
  { id: 'newBoard', g: 'ボード', keys: '⌘N', name: '新しいボード', where: 'any', m: e => kmod(e) && !e.shiftKey && kis(e, 'n'), run: () => newBoard() },
  { id: 'nextBoard', g: 'ボード', keys: '⌥⌘→', name: '次のボード', where: 'board', m: e => kmod(e) && e.altKey && e.key === 'ArrowRight', run: () => stepBoard(1) },
  { id: 'prevBoard', g: 'ボード', keys: '⌥⌘←', name: '前のボード', where: 'board', m: e => kmod(e) && e.altKey && e.key === 'ArrowLeft', run: () => stepBoard(-1) },
  { id: 'home', g: 'ボード', keys: 'Esc', name: 'ボード一覧へ戻る（何も選んでいないとき）', where: 'board', run: () => goHome() },
  { id: 'import', g: 'いれる', keys: '⌘O', name: '写真をいれる', where: 'board', m: e => kmod(e) && !e.shiftKey && kis(e, 'o'), run: () => pickPhotos() },
  { id: 'paste', g: 'いれる', keys: '⌘V', name: 'コピーした画像を貼り付ける' },
  { id: 'pickAll', g: 'えらぶ', keys: '⌘A', name: 'ぜんぶ選ぶ' },
  { id: 'pickMode', g: 'えらぶ', keys: 'E', name: '選ぶモードに入る／出る', where: 'board', m: e => plain(e) && !e.shiftKey && kis(e, 'e'), run: () => S.picking ? stopPicking() : startPicking() },
  { id: 'unpick', g: 'えらぶ', keys: 'Esc', name: '選ぶのをやめる' },
  { id: 'undo', g: '直す', keys: '⌘Z ／ ⇧⌘Z', name: '元にもどす ／ やり直す', where: 'board', run: () => undo() },
  { id: 'redo', g: '直す', where: 'board', run: () => redo() },
  { id: 'dup', g: '直す', keys: '⌘D', name: '複製', where: 'board', run: () => { const ids = S.picking ? S.picked.slice() : (S.sel ? [S.sel] : []); if (ids.length) duplicateItems(ids).then(n => toast(n + ' 枚複製しました')); } },
  { id: 'copy', g: '直す', keys: '⌘C', name: '写真をコピー（ほかのアプリに貼れる）', where: 'board', m: e => kmod(e) && !e.shiftKey && kis(e, 'c') && !String(window.getSelection() || ''), run: () => copySelectedPhoto() },
  { id: 'remove', g: '直す', keys: '⌫', name: 'はずす（ゴミ箱へ）', where: 'board', m: e => plain(e) && (e.key === 'Delete' || e.key === 'Backspace'), run: () => removeSelected() },
  { id: 'nudge', g: '直す', keys: '矢印 ／ ⇧＋矢印', name: '少し動かす ／ 大きく動かす' },
  { id: 'front', g: '直す', keys: ']', name: 'いちばん前へ', where: 'board', m: e => plain(e) && e.key === ']', run: () => reorder(keyTargets(), 'front') },
  { id: 'back', g: '直す', keys: '[', name: 'いちばん後ろへ', where: 'board', m: e => plain(e) && e.key === '[', run: () => reorder(keyTargets(), 'back') },
  { id: 'flipX', g: '直す', keys: '⇧H', name: '左右反転', where: 'board', m: e => plain(e) && e.shiftKey && kis(e, 'h'), run: () => flipItems(keyTargets().filter(isPhoto), 'flipX') },
  { id: 'flipY', g: '直す', keys: '⇧V', name: '上下反転', where: 'board', m: e => plain(e) && e.shiftKey && kis(e, 'v'), run: () => flipItems(keyTargets().filter(isPhoto), 'flipY') },
  { id: 'lock', g: '直す', keys: '⇧⌘L', name: '固定する／外す', where: 'board', m: e => kmod(e) && e.shiftKey && kis(e, 'l'), run: () => toggleLock(keyTargets()) },
  { id: 'view', g: '見る', keys: '⏎', name: '大きく見る（写真を1枚選んで）', where: 'board', m: e => plain(e) && e.key === 'Enter', run: () => { const p = keyTargets().find(isPhoto); if (p) openViewer(p); } },
  { id: 'mark1', g: 'しるし', keys: '1', name: '◎ 本命（もう一度で外す）', where: 'board', m: e => plain(e) && e.key === '1', run: () => markKey(1) },
  { id: 'mark2', g: 'しるし', keys: '2', name: '○ 候補', where: 'board', m: e => plain(e) && e.key === '2', run: () => markKey(2) },
  { id: 'mark3', g: 'しるし', keys: '3', name: '△ 保留', where: 'board', m: e => plain(e) && e.key === '3', run: () => markKey(3) },
  { id: 'mark4', g: 'しるし', keys: '4', name: '✕ 見送り', where: 'board', m: e => plain(e) && e.key === '4', run: () => markKey(4) },
  { id: 'mark0', g: 'しるし', keys: '0', name: 'しるしを外す', where: 'board', m: e => plain(e) && e.key === '0', run: () => markKey(0) },
  { id: 'fit', g: '見る', keys: 'F ／ ⌘0', name: '全体を見る', where: 'board', m: e => (plain(e) && !e.shiftKey && kis(e, 'f')) || (kmod(e) && e.key === '0'), run: () => fitAll() },
  { id: 'zoom100', g: '見る', keys: '⌘1', name: '等倍（100%）', where: 'board', m: e => kmod(e) && e.key === '1', run: () => zoomCenter(1, true) },
  { id: 'zoomIn', g: '見る', keys: '⌘＋ ／ ⌘−', name: '拡大 ／ 縮小', where: 'board', m: e => kmod(e) && ['+', '=', ';'].includes(e.key), run: () => zoomCenter(1.25) },
  { id: 'zoomOut', g: '見る', where: 'board', m: e => kmod(e) && ['-', '_'].includes(e.key), run: () => zoomCenter(0.8) },
  { id: 'grid', g: '見る', keys: 'G', name: 'グリッド表示との切り替え', where: 'board', m: e => plain(e) && !e.shiftKey && kis(e, 'g'), run: () => $('#btn-view').click() },
  { id: 'compare', g: '見る', keys: 'C', name: 'くらべる（写真を2〜6枚選んで）', where: 'board', m: e => plain(e) && !e.shiftKey && kis(e, 'c'), run: () => { const n = pickedImageCount(); if (S.picking && n >= 2 && n <= 6) openCompare(S.picked); else toast('写真を2〜6枚えらぶと、くらべられます'); } },
  { id: 'pan', g: '見る', keys: 'スペース＋ドラッグ', name: '盤面を動かす' },
  { id: 'gray', g: '見る', name: '白黒で見る', where: 'board', run: () => setView('gray', !VIEW.gray) },
  { id: 'mirror', g: '見る', name: '反転して見る', where: 'board', run: () => setView('mirror', !VIEW.mirror) },
  { id: 'present', g: '見る', name: 'プレゼン', where: 'board', run: () => startPresent() },
  { id: 'pen', g: 'かく', keys: 'P', name: 'ペン', where: 'board', m: e => plain(e) && !e.shiftKey && kis(e, 'p'), run: () => startDraw('pen') },
  { id: 'line', g: 'かく', keys: 'L', name: '線・矢印', where: 'board', m: e => plain(e) && !e.shiftKey && kis(e, 'l'), run: () => startDraw('arrow') },
  { id: 'shape', g: 'かく', keys: 'R', name: '四角・丸', where: 'board', m: e => plain(e) && !e.shiftKey && kis(e, 'r'), run: () => startDraw('rect') },
  { id: 'text', g: 'かく', keys: 'T', name: '文字を置く', where: 'board', m: e => plain(e) && !e.shiftKey && kis(e, 't'), run: () => $('#add-text').click() },
  { id: 'arrange', g: 'ならべる', keys: 'A', name: '石積みにならべる', where: 'board', m: e => plain(e) && !e.shiftKey && kis(e, 'a'), run: () => arrangeMasonry() },
  { id: 'tools', g: '道具', keys: '⌘K', name: '道具を開く', where: 'board', m: e => kmod(e) && !e.shiftKey && kis(e, 'k'), run: () => openTools() },
  { id: 'find', g: '道具', keys: '⌘F', name: 'さがす', where: 'board', m: e => kmod(e) && !e.shiftKey && kis(e, 'f'), run: () => $('#btn-search').click() },
  { id: 'send', g: '送る', keys: '⌘P', name: '送る・印刷・PDF', where: 'board', m: e => kmod(e) && !e.shiftKey && kis(e, 'p'), run: () => openSend() },
  { id: 'png', g: '送る', keys: '⇧⌘E', name: '1枚の画像に書き出す', where: 'board', m: e => kmod(e) && e.shiftKey && kis(e, 'e'), run: () => exportBoardPNG() },
  { id: 'stock', g: 'ボード', name: 'ストックを開く', where: 'any', run: () => { if (S.view === 'board') goHome(); showStock(true); } },
  { id: 'exportAll', g: '送る', name: 'まるごと書き出し（ZIP）', where: 'any', run: () => exportAll() },
  { id: 'zip', g: 'いれる', name: 'ZIPから読み込む', where: 'any', run: () => pickZip() },
  { id: 'dupFind', g: '道具', name: '重複をさがす', where: 'any', run: () => $('#menu-dup').click() },
  { id: 'trash', g: 'ボード', name: 'ゴミ箱', where: 'board', run: () => openTrash() },
  { id: 'settings', g: 'そのほか', keys: '⌘,', name: '設定', where: 'any', m: e => kmod(e) && e.key === ',', run: () => $('#btn-settings').click() },
  { id: 'keys', g: 'そのほか', keys: '⌘/', name: 'このショートカット一覧', where: 'any', m: e => kmod(e) && e.key === '/', run: () => openKeys() },
  { id: 'help', g: 'そのほか', keys: '？ ／ ⌘?', name: '使い方（説明書）', where: 'any', m: e => e.key === '?' && !e.altKey, run: () => openHelp() },
];
let lastKeyRun = { id: '', t: 0 };
function runKeymap(e, where) {
  for (const k of KEYMAP) {
    if (!k.m || !k.run || (k.where !== where)) continue;
    if (!k.m(e)) continue;
    e.preventDefault();
    lastKeyRun = { id: k.id, t: Date.now() };
    k.run();
    return true;
  }
  return false;
}
/* Mac版のメニューから呼ばれる。キーで既に動いた直後なら二重に動かさない */
window.mbMenu = (id) => {
  const k = KEYMAP.find(x => x.id === id);
  if (!k || !k.run) return;
  if (lastKeyRun.id === id && Date.now() - lastKeyRun.t < 400) return;
  if (!$('#progress').hidden) return toast('いまの作業が終わってからにしてください');
  // しるし：1枚表示で見ている写真・ストックで選んでいる写真にも付けられる
  if (/^mark\d$/.test(id)) {
    const n = +id.slice(4);
    if (!$('#viewer').hidden) return void viewerMark(n);
    if (S.view === 'home' && STOCK.on && STOCK.sel.size) return void setMarks([...STOCK.sel], n);
  }
  if (k.where === 'board' && S.view !== 'board') return toast('先にボードを開いてください');
  closeSheets();
  // 説明書・設定などはシートで上に開くのでそのまま。それ以外は、1枚表示・みくらべ・切り抜き・プレゼンの後ろで動かないよう先に閉じる
  if (!['help', 'keys', 'settings'].includes(id)) closeOverlays();
  k.run();
};
function closeOverlays() {
  if (!$('#crop').hidden) closeCrop();
  if (PR) stopPresent();
  if (!$('#viewer').hidden) { $('#viewer').hidden = true; stopViewerVideo(); resetViewerTools(); }
  if (!$('#compare').hidden) closeCompare();
}

function zoomCenter(f, absolute) {
  const w = $('#canvas-wrap');
  zoomAt(w.clientWidth / 2, w.clientHeight / 2, clamp(absolute ? f : S.cam.k * f, 0.05, 6));
}
async function stepBoard(dir) {
  const boards = (await dbAll('boards')).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  if (boards.length < 2) return toast('ほかのボードがありません');
  const i = boards.findIndex(b => b.id === S.boardId);
  const next = boards[(i + dir + boards.length) % boards.length];
  await openBoard(next.id);
  toast(next.name);
}
function removeSelected() {
  if (S.picking && S.picked.length) return $('#btn-bulk-trash').click();
  if (S.sel) return $('#btn-item-remove').click();
}
function pickPhotos() {
  if (NATIVE) return mbCall('pickFiles', { kind: 'images' }).then(nativeImportList).catch(() => { });
  $('#file-input').click();
}
/* 選んだ写真を、ほかのアプリに貼れる形（PNG）でコピーする。Safari系は「押した瞬間に」書く必要があるので、
   中身は後から埋まる約束（Promise）で渡す */
function copySelectedPhoto() {
  const p = keyTargets().filter(isPhoto);
  if (p.length !== 1) return toast('写真を1枚えらぶと、コピーできます');
  const rec = S.imgs.get(p[0].imageId);
  if (!rec || !navigator.clipboard || !window.ClipboardItem) return toast('この環境ではコピーできません');
  const png = (async () => {
    const dec = await decodeImage(rec.full);
    const c = drawCanvas(dec.src, dec.w, dec.h, 4096);
    dec.close();
    return canvasToBlob(c, 'image/png');
  })();
  navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    .then(() => toast('写真をコピーしました。ほかのアプリに貼り付けられます'), () => toast('コピーできませんでした'));
}

/* 一覧（⌘/） */
function openKeys() {
  const box = $('#keys-list');
  box.innerHTML = '';
  const groups = new Map();
  KEYMAP.filter(k => k.keys && k.name).forEach(k => { if (!groups.has(k.g)) groups.set(k.g, []); groups.get(k.g).push(k); });
  for (const [g, list] of groups) {
    box.appendChild(inspEl('div', 'keys-g', g));
    const t = inspEl('div', 'keys-t');
    list.forEach(k => { const r = inspEl('div', 'keys-r'); r.append(inspEl('kbd', '', k.keys), inspEl('span', '', k.name)); t.appendChild(r); });
    box.appendChild(t);
  }
  openSheet('#sheet-keys');
}
$('#keys-close').onclick = closeSheets;
$('#menu-keys').onclick = () => { closeSheets(); openKeys(); };

/* ========================== Mac版：ほかから渡された写真を受け取る ===========
   「写真をいれる…」のメニュー・Dockのアイコンへのドロップ・Finderの「このアプリケーションで開く」・
   ほかのアプリの共有・ショートカット。どれも Mac版の側が合言葉付きで渡してくる（mb://app/ext/<合言葉>） */
function lazyNativeFiles(list) {
  return (list || []).map(f => ({
    name: f.name, type: f.type || '', size: f.size || 0,
    meta: (f.tags || f.section || f.title || f.cap || f.from) ? { tags: f.tags || [], section: f.section || '', title: f.title || '', cap: !!f.cap, from: f.from || '' } : null,
    load: async () => {
      const r = await fetch('ext/' + f.token);
      if (!r.ok) throw new Error('読めませんでした: ' + f.name);
      const b = await r.blob();
      return new File([b], f.name, { type: f.type || b.type });
    },
  }));
}
async function nativeImportList(list) {
  const files = lazyNativeFiles(list);
  if (!files.length) return;
  const zips = files.filter(f => /\.zip$/i.test(f.name));
  for (const z of zips) await importZip(await z.load());
  const imgs = files.filter(f => !/\.zip$/i.test(f.name));
  if (!imgs.length) return;
  await importAnywhere(imgs);
}
/* ボードを開いていればそのボードへ。開いていなければストック（どのボードにも載せない）へ */
async function importAnywhere(files) {
  if (S.view === 'board' && S.boardId) return importFiles(files);
  if (typeof importToStock === 'function') return importToStock(files);
  toast('先にボードを開いてください');
}
window.mbOpenFiles = (list, opts) => (opts && opts.to === 'stock')
  ? importToStock(lazyNativeFiles(list).filter(f => !/\.zip$/i.test(f.name)))
  : nativeImportList(list);
function pickZip() {
  if (NATIVE) return mbCall('pickFiles', { kind: 'zip' }).then(nativeImportList).catch(() => { });
  $('#menu-import').click();
}

/* ========================== ストック（取り込んだ写真の全部） ================
   ボードに入れた写真も、どのボードにも載せずに取り込んだ写真も、ここに全部並ぶ。
   ・何千枚でも重くならないよう、240枚ずつ描き足す（見えてきたら次を描く）
   ・さがす：タグ・ひとこと・説明・区分け・ボード名・取ってきたサイト・カメラ
   ・ボードの写真が「ゴミ箱」に入っているだけのもの、切り抜き・回転の元の姿は出さない */
var STOCK = { on: false, all: [], list: [], info: new Map(), sel: new Set(), anchor: null, shown: 0, q: '', filter: 'all' };
const STOCK_CHUNK = 240;

function showStock(on) {
  STOCK.on = !!on;
  $('#seg-boards').classList.toggle('on', !STOCK.on);
  $('#seg-stock').classList.toggle('on', STOCK.on);
  $('#home-boards').hidden = STOCK.on;
  $('#stock-view').hidden = !STOCK.on;
  if (!STOCK.on) STOCK.sel.clear();
  syncStockDock();
  if (STOCK.on) loadStock();
}
$('#seg-boards').onclick = () => showStock(false);
$('#seg-stock').onclick = () => showStock(true);

async function loadStock() {
  const [images, items, boards] = await Promise.all([dbAll('images'), dbAll('items'), dbAll('boards')]);
  const bname = new Map(boards.map(b => [b.id, b.name]));
  const refs = new Map(), sources = new Set();
  for (const it of items) {
    for (const k of [it.croppedFrom, it.rotFrom, ...Object.values(it.rotIds || {})]) if (k && k !== it.imageId) sources.add(k);
    if (!it.imageId) continue;
    const r = refs.get(it.imageId) || { active: [], trashed: 0 };
    if (it.trashedAt) r.trashed++; else r.active.push(it);
    refs.set(it.imageId, r);
  }
  STOCK.all = images.filter(rec => {
    const r = refs.get(rec.id);
    if (r && r.active.length) return true;
    if (r && r.trashed) return false;            // ボードのゴミ箱に入っているだけ
    if (rec.derived) return false;               // 切り抜き・まわすの途中でできて、いまは使っていない写真
    return !sources.has(rec.id);                 // 切り抜き・回転の元の姿は出さない
  }).sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  STOCK.info = new Map();
  for (const rec of STOCK.all) {
    const act = (refs.get(rec.id) || { active: [] }).active;
    const tags = [...new Set([...(rec.tags || []), ...act.flatMap(i => i.tags || [])])];
    const boardsOf = [...new Set(act.map(i => bname.get(i.boardId)).filter(Boolean))];
    let host = '';
    try { host = rec.srcUrl ? new URL(rec.srcUrl).hostname : ''; } catch (e) { }
    const ex = rec.exif || {};
    const text = [...tags, ...act.map(i => [i.note, i.desc, i.section, (i.refs || []).join(' ')].join(' ')),
      ...boardsOf, host, rec.srcTitle, ex.make, ex.model, ex.lens].filter(Boolean).join(' ').toLowerCase();
    STOCK.info.set(rec.id, { tags, boards: boardsOf, loose: !act.length, text });
  }
  for (const id of [...STOCK.sel]) if (!STOCK.info.has(id)) STOCK.sel.delete(id);
  if (STOCK.simRef && !STOCK.info.has(STOCK.simRef)) { STOCK.simRef = null; if (STOCK.sort === 'similar') STOCK.sort = 'new'; }
  syncStockTools();
  renderStockFilters();
  applyStockFilter();
  syncStockDock();
}

function renderStockFilters() {
  const box = $('#stock-filters');
  box.innerHTML = '';
  const loose = STOCK.all.filter(r => STOCK.info.get(r.id).loose).length;
  const tagCount = new Map();
  STOCK.all.forEach(r => STOCK.info.get(r.id).tags.forEach(t => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
  const chips = [['all', 'すべて ' + STOCK.all.length], ['loose', 'ボードに無い ' + loose]];
  const vids = STOCK.all.filter(isVideoRec).length;
  if (vids) chips.push(['video', '動画 ' + vids]);
  for (let k = 1; k < MARKS.length; k++) {
    const n = STOCK.all.filter(r => r.mark === k).length;
    if (n || STOCK.filter === 'mark:' + k) chips.push(['mark:' + k, MARKS[k].s + ' ' + MARKS[k].name + ' ' + n]);
  }
  [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).forEach(([t, n]) => chips.push(['tag:' + t, t + ' ' + n]));
  chips.forEach(([v, label]) => {
    const c = inspEl('button', 'chip' + (STOCK.filter === v ? ' on' : ''), label);
    c.onclick = () => { STOCK.filter = (STOCK.filter === v && v !== 'all') ? 'all' : v; renderStockFilters(); applyStockFilter(); };
    box.appendChild(c);
  });
  // 「色味が近い順」で並べているあいだは、基準の写真と、やめるボタン
  if (STOCK.sort === 'similar' && STOCK.simRef) {
    const c = inspEl('button', 'chip on sim', '◐ 色味が近い順 ✕');
    c.title = '押すと、新しい順に戻します';
    c.onclick = () => { STOCK.sort = 'new'; STOCK.simRef = null; syncStockTools(); renderStockFilters(); applyStockFilter(); };
    box.prepend(c);
  }
}
function applyStockFilter() {
  const words = STOCK.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  STOCK.list = STOCK.all.filter(r => {
    const inf = STOCK.info.get(r.id);
    if (STOCK.filter === 'loose' && !inf.loose) return false;
    if (STOCK.filter === 'video' && !isVideoRec(r)) return false;
    if (STOCK.filter.startsWith('tag:') && !inf.tags.includes(STOCK.filter.slice(4))) return false;
    if (STOCK.filter.startsWith('mark:') && String(r.mark || 0) !== STOCK.filter.slice(5)) return false;
    if (STOCK.shape && shapeOf(r) !== STOCK.shape) return false;
    if (STOCK.color && !colorMatch(r, STOCK.color)) return false;
    return words.every(w => inf.text.includes(w));
  });
  STOCK.list = sortStock(STOCK.list);
  const n = STOCK.all.length;
  $('#stock-lead').textContent = !n ? '' :
    (STOCK.list.length === n ? n + ' 枚' : STOCK.list.length + ' / ' + n + ' 枚') + '　押して選ぶ・ダブルクリックで大きく見る';
  $('#stock-empty').hidden = n > 0;
  $('#stock-grid').innerHTML = '';
  STOCK.shown = 0;
  renderStockMore();
}
function renderStockMore() {
  const grid = $('#stock-grid');
  const end = Math.min(STOCK.list.length, STOCK.shown + STOCK_CHUNK);
  const frag = document.createDocumentFragment();
  for (let i = STOCK.shown; i < end; i++) frag.appendChild(stockCell(STOCK.list[i]));
  grid.appendChild(frag);
  STOCK.shown = end;
  $('#stock-more').hidden = STOCK.shown >= STOCK.list.length;
}
function stockCell(rec) {
  const c = document.createElement('button');
  c.className = 'scell' + (STOCK.sel.has(rec.id) ? ' on' : '');
  c.dataset.id = rec.id;
  const inf = STOCK.info.get(rec.id);
  c.title = inf.boards.length ? 'ボード：「' + inf.boards.join('・') + '」' : 'どのボードにも載っていません';   // 「」で囲むと英語の辞書が当たる
  const im = document.createElement('img');
  im.loading = 'lazy'; im.decoding = 'async'; im.alt = '';
  im.src = blobURL(rec.id, 't', rec.thumb || rec.full);
  c.appendChild(im);
  if (inf.loose) c.appendChild(inspEl('i', 'loose'));
  if (isVideoRec(rec)) c.appendChild(inspEl('i', 'vbadge', '▶ ' + fmtDur(rec.dur)));
  const mb = markBadge(rec); if (mb) c.appendChild(mb);
  return c;
}
// 下まで見えてきたら、次の240枚を描く
if ('IntersectionObserver' in window) {
  new IntersectionObserver((ents) => {
    if (ents.some(e => e.isIntersecting) && STOCK.on && STOCK.shown < STOCK.list.length) renderStockMore();
  }, { root: $('#home-scroll'), rootMargin: '1200px' }).observe($('#stock-more'));
}
let stockQT = 0;
$('#stock-q').addEventListener('input', () => {
  clearTimeout(stockQT);
  stockQT = setTimeout(() => { STOCK.q = $('#stock-q').value; applyStockFilter(); }, 160);
});

/* 押して選ぶ（shiftで範囲）・ダブルクリックで大きく見る */
$('#stock-grid').addEventListener('click', (e) => {
  const c = e.target.closest('.scell'); if (!c) return;
  const id = c.dataset.id;
  if (e.shiftKey && STOCK.anchor) {
    const ids = STOCK.list.map(r => r.id);
    const a = ids.indexOf(STOCK.anchor), b = ids.indexOf(id);
    if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => STOCK.sel.add(x));
  } else {
    if (STOCK.sel.has(id)) STOCK.sel.delete(id); else STOCK.sel.add(id);
    STOCK.anchor = id;
  }
  syncStockCells();
  syncStockDock();
});
$('#stock-grid').addEventListener('dblclick', (e) => {
  const c = e.target.closest('.scell'); if (!c) return;
  openStockViewer(c.dataset.id);
});
function syncStockCells() {
  $$('#stock-grid .scell').forEach(c => c.classList.toggle('on', STOCK.sel.has(c.dataset.id)));
}
function syncStockDock() {
  if (!$('#stock-dock')) return;
  const n = STOCK.sel.size;
  $('#home-dock').hidden = STOCK.on;
  $('#stock-dock').hidden = !STOCK.on || n > 0;
  $('#stock-sel-dock').hidden = !STOCK.on || n === 0;
  $('#stock-count').textContent = n + ' まい';
  $('#btn-stock-compare').disabled = n < 2 || n > 6;
}
function stockSelRecs() { return [...STOCK.sel].map(id => STOCK.all.find(r => r.id === id)).filter(Boolean); }
function openStockViewer(id) {
  const rec = STOCK.all.find(r => r.id === id);
  if (rec) openViewer({ id: 'img:' + id, imageId: id, note: '', stock: true });
}
function stockKey(e) {
  const meta = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape' && STOCK.sel.size) { STOCK.sel.clear(); syncStockCells(); syncStockDock(); return true; }
  if (meta && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); STOCK.list.forEach(r => STOCK.sel.add(r.id)); syncStockCells(); syncStockDock(); return true; }
  if (meta && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); $('#stock-q').focus(); return true; }
  if (!meta && (e.key === 'Delete' || e.key === 'Backspace') && STOCK.sel.size) { e.preventDefault(); stockDelete(); return true; }
  if (!meta && e.key === 'Enter' && STOCK.sel.size === 1) { e.preventDefault(); openStockViewer([...STOCK.sel][0]); return true; }
  // スペースで大きく見る（Finder のクイックルック）。もう一度スペースで閉じる
  if (!meta && e.key === ' ' && STOCK.sel.size) {
    e.preventDefault();
    // 押した写真（ボタン）にピントが残っていると、スペースを離したときにもう一度押したことになり、選択が外れる
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    openStockViewer(STOCK.anchor && STOCK.sel.has(STOCK.anchor) ? STOCK.anchor : [...STOCK.sel][0]);
    return true;
  }
  if (!meta && !e.altKey && /^[0-4]$/.test(e.key) && STOCK.sel.size) { e.preventDefault(); setMarks([...STOCK.sel], +e.key); return true; }
  return false;
}

/* ==========================================================================
   しるし（◎ 本命・○ 候補・△ 保留・✕ 見送り）  2026-10-27
   比べて選ぶための目印（Eagle の星・FigJam のスタンプにあたるもの）。写真そのもの（images の記録）に付けるので、
   どのボード・グリッド・ストック・くらべる でも同じしるしが見える。
   1〜4 のキーで付け、0 で外す（ボードで選んでいるとき・ストックで選んでいるとき・1枚表示で見ているとき）。
   同じしるしをもう一度付けると外れる
   ========================================================================== */
const MARKS = [null,
  { s: '◎', name: '本命', c: '#ff5a36' },
  { s: '○', name: '候補', c: '#1f9d63' },
  { s: '△', name: '保留', c: '#d08a00' },
  { s: '✕', name: '見送り', c: '#6b6b74' }];
const markOf = (rec) => (rec && MARKS[rec.mark]) || null;
function markBadge(rec) {
  const m = markOf(rec);
  if (!m) return null;
  const b = inspEl('i', 'mk', m.s);
  b.style.setProperty('--mkc', m.c);
  b.title = m.name;
  return b;
}
/* 画像の id ごとに、しるしを付ける（mark：1〜4、0＝外す）。付けたしるしを返す */
async function setMarks(ids, mark) {
  ids = [...new Set(ids)].filter(Boolean);
  const recs = [];
  for (const id of ids) {
    const r = S.imgs.get(id) || STOCK.all.find(x => x.id === id) || await dbGet('images', id);
    if (r) recs.push(r);
  }
  if (!recs.length) return 0;
  const nv = mark && recs.every(r => (r.mark || 0) === mark) ? 0 : mark;
  for (const r of recs) {
    // 盤面とストックが別々に持っている同じ写真の記録も、そろえておく
    for (const c of new Set([r, S.imgs.get(r.id), STOCK.all.find(x => x.id === r.id)])) {
      if (!c) continue;
      if (nv) c.mark = nv; else delete c.mark;
    }
  }
  await dbPutMany('images', recs);
  refreshMarks(new Set(recs.map(r => r.id)));
  toast(nv ? MARKS[nv].s + ' ' + MARKS[nv].name + (recs.length > 1 ? '（' + recs.length + ' 枚）' : '') : 'しるしを外しました', 1400);
  return nv;
}
/* 画面に出ているしるしを付け直す */
function refreshMarks(idset) {
  canvas.querySelectorAll('.item.photo-item').forEach(el => {
    const it = S.items.find(i => i.id === el.dataset.id);
    if (it && idset.has(it.imageId)) applyPhotoLook(el, it);
  });
  $$('#grid-scroll .gcell').forEach(cell => {
    const it = S.items.find(i => i.id === cell.dataset.id);
    if (!it || !idset.has(it.imageId)) return;
    const old = cell.querySelector(':scope > .mk'); if (old) old.remove();
    const b = markBadge(S.imgs.get(it.imageId)); if (b) cell.appendChild(b);
  });
  $$('#stock-grid .scell').forEach(c => {
    if (!idset.has(c.dataset.id)) return;
    const old = c.querySelector(':scope > .mk'); if (old) old.remove();
    const b = markBadge(STOCK.all.find(r => r.id === c.dataset.id)); if (b) c.appendChild(b);
  });
  if (!$('#viewer').hidden) syncViewerMarks();
  if (STOCK.on) renderStockFilters();
  if (!$('#sheet-stockmore').hidden) renderMarkRow($('#stockmore-marks'), stockSelRecs().map(r => r.id));
  if (!$('#inspector').hidden) renderInspector(true);
}
/* しるしの4つのボタン（右のパネル・ストックの「…」で使う）。ids：画像の id */
function renderMarkRow(box, ids, after) {
  box.innerHTML = '';
  const row = inspEl('div', 'mark-row');
  const recs = ids.map(id => S.imgs.get(id) || STOCK.all.find(r => r.id === id)).filter(Boolean);
  const cur = recs.length && recs.every(r => (r.mark || 0) === (recs[0].mark || 0)) ? (recs[0].mark || 0) : -1;
  for (let k = 1; k < MARKS.length; k++) {
    const m = MARKS[k];
    const b = inspEl('button', 'mark-btn' + (cur === k ? ' on' : ''), m.s);
    b.style.setProperty('--mkc', m.c);
    b.title = m.name + '（' + k + '）';
    b.appendChild(inspEl('span', '', m.name));
    b.onclick = async () => { await setMarks(ids, k); if (after) after(); };
    row.appendChild(b);
  }
  box.appendChild(row);
}
function inspMarkBlock(body, list) {
  const ids = list.filter(isPhoto).map(it => it.imageId);
  if (!ids.length) return;
  const s = inspSec(body, 'しるし', '1〜4キー・0で外す');
  const box = inspEl('div');
  s.appendChild(box);
  renderMarkRow(box, ids);
}
/* キーで付ける（ボード）：選んでいる写真に */
function markKey(n) {
  const ids = keyTargets().filter(isPhoto).map(it => it.imageId);
  if (!ids.length) return toast('写真を選んでから、1〜4 でしるしを付けます', 2200);
  return setMarks(ids, n);
}

/* ==========================================================================
   1枚表示で前後へ（← →・左右にスワイプ）  2026-10-27
   写真アプリや Eagle のように、1枚ずつ見ながら しるし を付けていける。
   ストックから開いたら、いまストックに並んでいる順。ボードから開いたら、上から順（グリッド表示ならグリッドの順）。
   いくつか選んでいるときは、選んだものだけを選んだ順に
   ========================================================================== */
let VLIST = [];
function viewerListFor(it) {
  if (it.stock) return STOCK.list.map(r => 'img:' + r.id);
  let ph = S.items.filter(i => i.imageId);
  if (S.picking && S.picked.length >= 2) {
    const pk = S.picked.map(id => ph.find(i => i.id === id)).filter(Boolean);
    if (pk.some(i => i.id === it.id)) return pk.map(i => i.id);
  }
  ph = S.mode === 'grid'
    ? ph.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '') || (b.z || 0) - (a.z || 0))
    : ph.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return ph.map(i => i.id);
}
const viewerKey = () => viewerItem ? (viewerItem.stock ? 'img:' + viewerItem.imageId : viewerItem.id) : '';
async function viewerStep(dir) {
  if (!viewerItem || VLIST.length < 2) return;
  const i = VLIST.indexOf(viewerKey());
  const j = i + dir;
  if (i < 0 || j < 0 || j >= VLIST.length) return toast(dir > 0 ? '最後の写真です' : '最初の写真です', 1200);
  const id = VLIST[j];
  const it = id.startsWith('img:') ? { id, imageId: id.slice(4), note: '', stock: true } : S.items.find(x => x.id === id);
  if (!it) return;
  stopViewerVideo();
  await openViewer(it, { keepList: true });
  // ボードでは、見ている写真を選んだ状態にしておく（閉じたとき、どれを見ていたか分かるように）
  if (!it.stock && !S.picking && S.view === 'board') selectItem(it.id);
}
function syncViewerNav() {
  const i = VLIST.indexOf(viewerKey());
  const many = VLIST.length > 1 && i >= 0;
  $('#viewer-prev').hidden = !many || i === 0;
  $('#viewer-next').hidden = !many || i === VLIST.length - 1;
  return many ? (i + 1) + ' / ' + VLIST.length : '';
}
function syncViewerMarks() {
  const box = $('#viewer-marks');
  if (!viewerItem) return;
  const rec = S.imgs.get(viewerItem.imageId) || STOCK.all.find(r => r.id === viewerItem.imageId);
  const cur = (rec && rec.mark) || 0;
  box.innerHTML = '';
  for (let k = 1; k < MARKS.length; k++) {
    const m = MARKS[k];
    const b = inspEl('button', cur === k ? 'on' : '', m.s);
    b.style.setProperty('--mkc', m.c);
    b.title = m.name + '（' + k + '）';
    b.onclick = (e) => { e.stopPropagation(); viewerMark(k); };
    box.appendChild(b);
  }
}
async function viewerMark(n) {
  if (!viewerItem || !viewerItem.imageId) return;
  // 盤面とストックの記録が無ければ（ボードの写真をストックを開かずに見ているなど）、ここで読む
  if (!S.imgs.get(viewerItem.imageId) && !STOCK.all.find(r => r.id === viewerItem.imageId)) {
    const r = await dbGet('images', viewerItem.imageId); if (r) S.imgs.set(r.id, r);
  }
  await setMarks([viewerItem.imageId], n);
}
$('#viewer-prev').onclick = (e) => { e.stopPropagation(); viewerStep(-1); };
$('#viewer-next').onclick = (e) => { e.stopPropagation(); viewerStep(1); };
// 携帯：左右にさっと払うと前後へ（スポイト中は払わない）
(() => {
  let sw = null;
  const st = $('#viewer-stage');
  st.addEventListener('pointerdown', (e) => { if (!VW.eyedrop && e.isPrimary) sw = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  st.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y, quick = Date.now() - sw.t < 600;
    sw = null;
    if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && !e.target.closest('video')) viewerStep(dx < 0 ? 1 : -1);
  });
  st.addEventListener('pointercancel', () => { sw = null; });
})();

/* ==========================================================================
   ストックの並べ替え・絞り込み（Eagle：色・形・評価／mymind：ふと見返す・近い雰囲気）  2026-10-27
   ========================================================================== */
Object.assign(STOCK, { sort: 'new', shape: '', color: null, seed: 1, simRef: null });
const STOCK_COLORS = [
  ['red', '赤', '#e0453a', { h: 0 }], ['orange', '橙', '#ee8a2c', { h: 28 }], ['yellow', '黄', '#e9c534', { h: 52 }],
  ['green', '緑', '#4fa55a', { h: 120 }], ['teal', '青緑', '#2fa6a0', { h: 175 }], ['blue', '青', '#3a74d8', { h: 218 }],
  ['purple', '紫', '#8a56c9', { h: 275 }], ['pink', '桃', '#e46aa6', { h: 330 }],
  ['white', '白', '#f4f4f2', { n: 'w' }], ['gray', '灰', '#9a9aa0', { n: 'g' }], ['black', '黒', '#1c1c1f', { n: 'k' }]];
const shapeOf = (r) => { const q = (r.h || 1) / (r.w || 1); return q > 1.12 ? 'tall' : q < 1 / 1.12 ? 'wide' : 'square'; };
function colorMatch(rec, key) {
  const d = rec.dom; if (!d) return false;
  const c = STOCK_COLORS.find(x => x[0] === key); if (!c) return true;
  const want = c[3];
  if (want.n) {
    if (want.n === 'w') return d.l >= 0.78 || (d.s < 0.14 && d.l >= 0.68);
    if (want.n === 'k') return d.l <= 0.2;
    return d.s < 0.14 && d.l > 0.2 && d.l < 0.68;
  }
  if (d.s < 0.14 || d.l <= 0.12 || d.l >= 0.9) return false;
  const dh = Math.min(Math.abs(d.h - want.h), 360 - Math.abs(d.h - want.h));
  return dh <= (want.h === 52 ? 16 : 24);
}
/* 色の順：あざやかなものは色相で、白黒っぽいものは明るさで後ろに */
const colorRank = (r) => { const d = r.dom; if (!d) return 9e9; return d.s < 0.14 ? 1000 + (1 - d.l) * 100 : d.h + (1 - d.l) * 0.5; };
/* 色の近さ（パレットどうしを Lab で比べる。いちばん目立つ色は2回数える） */
const LAB = new WeakMap();
function hexToLab(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  const lin = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const r = lin(n >> 16 & 255), g = lin(n >> 8 & 255), b = lin(n & 255);
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function labsOf(rec) {
  let v = LAB.get(rec);
  if (!v) { v = [rec.hex, rec.hex, ...(rec.pal || [])].filter(Boolean).map(hexToLab); LAB.set(rec, v); }
  return v;
}
function paletteDist(A, B) {
  if (!A.length || !B.length) return 9e9;
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  let s1 = 0, s2 = 0;
  for (const p of A) { let m = 9e9; for (const q of B) m = Math.min(m, d(p, q)); s1 += m; }
  for (const q of B) { let m = 9e9; for (const p of A) m = Math.min(m, d(p, q)); s2 += m; }
  return (s1 / A.length + s2 / B.length) / 2;
}
function shuffled(list, seed) {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function sortStock(list) {
  switch (STOCK.sort) {
    case 'old': return list.slice().reverse();
    case 'mark': return list.slice().sort((a, b) => ((a.mark || 9) - (b.mark || 9)));
    case 'color': return list.slice().sort((a, b) => colorRank(a) - colorRank(b));
    case 'random': return shuffled(list, STOCK.seed);
    case 'similar': {
      const ref = STOCK.all.find(r => r.id === STOCK.simRef);
      if (!ref) return list;
      const A = labsOf(ref);
      const dist = new Map(list.map(r => [r.id, r.id === ref.id ? -1 : paletteDist(A, labsOf(r)) + Math.abs(((r.dom && r.dom.l) || .5) - ((ref.dom && ref.dom.l) || .5)) * 30]));
      return list.slice().sort((a, b) => dist.get(a.id) - dist.get(b.id));
    }
    default: return list;
  }
}
/* 色で並べる・しぼる・近い順のために、まだ色を調べていない写真を調べる（1回だけ。結果は写真の記録に残る） */
async function ensureStockColors() {
  const need = STOCK.all.filter(r => !r.dom);
  if (!need.length) return true;
  progOpen('色を調べています');
  for (let i = 0; i < need.length; i++) {
    if (progCancelled) break;
    progSet(i, need.length, (i + 1) + ' / ' + need.length);
    const rec = need[i];
    try {
      const col = await extractColors(rec.thumb || rec.full);
      rec.dom = col.dom; rec.hex = col.hex; rec.pal = col.pal;
      await dbPut('images', rec);
    } catch (e) { rec.dom = { h: 0, s: 0, l: 0.5 }; rec.hex = '#808080'; rec.pal = []; }
    if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
  }
  const done = !progCancelled;
  progClose();
  return done;
}
function syncStockTools() {
  $('#stock-sort').value = STOCK.sort === 'similar' ? 'new' : STOCK.sort;
  $('#stock-shuffle').hidden = STOCK.sort !== 'random';
  $$('#stock-shape button').forEach(b => b.classList.toggle('on', STOCK.shape === b.dataset.v));
  $$('#stock-colors button').forEach(b => b.classList.toggle('on', STOCK.color === b.dataset.v));
  const sz = SET.stockSize || 'm';
  $$('#stock-size button').forEach(b => b.classList.toggle('on', sz === b.dataset.v));
  $('#stock-grid').classList.toggle('size-s', sz === 's');
  $('#stock-grid').classList.toggle('size-l', sz === 'l');
}
STOCK_COLORS.forEach(([v, name, hex]) => {
  const b = document.createElement('button');
  b.dataset.v = v; b.title = name; b.setAttribute('aria-label', name);
  b.style.setProperty('--c', hex);
  b.onclick = async () => {
    const next = STOCK.color === v ? null : v;
    if (next && !(await ensureStockColors())) return;
    STOCK.color = next; syncStockTools(); applyStockFilter();
  };
  $('#stock-colors').appendChild(b);
});
$('#stock-sort').onchange = async () => {
  const v = $('#stock-sort').value;
  if (v === 'color' && !(await ensureStockColors())) { syncStockTools(); return; }
  STOCK.sort = v;
  if (v === 'random') STOCK.seed = (Date.now() % 2147483647) || 1;
  syncStockTools(); applyStockFilter(); renderStockFilters();
};
$('#stock-shuffle').onclick = () => { STOCK.seed = (STOCK.seed * 48271 + 11) % 2147483647 || 1; applyStockFilter(); };
$$('#stock-shape button').forEach(b => b.onclick = () => { STOCK.shape = STOCK.shape === b.dataset.v ? '' : b.dataset.v; syncStockTools(); applyStockFilter(); });
$$('#stock-size button').forEach(b => b.onclick = () => {
  SET.stockSize = b.dataset.v;
  try { localStorage.setItem('mb_settings', JSON.stringify(SET)); } catch (e) { }
  syncStockTools();
});
/* 1枚えらんで「色味が近い順」（mymind の Same Vibe・Cosmos の似た画像にあたるもの。ここでは色の近さで並べる） */
async function stockSimilar(id) {
  if (!id) return toast('写真を1枚えらんでください');
  if (!(await ensureStockColors())) return;
  STOCK.simRef = id; STOCK.sort = 'similar';
  STOCK.sel.clear(); syncStockDock();
  closeSheets();
  syncStockTools(); renderStockFilters(); applyStockFilter();
  $('#home-scroll').scrollTop = 0;
  toast('色味が近い順に並べました', 1600);
}
$('#stock-similar').onclick = () => { const r = stockSelRecs(); stockSimilar(r.length === 1 ? r[0].id : null); };
syncStockTools();

/* ---- 取り込む（どのボードにも載せない） ---- */
async function importToStock(files) {
  const list = Array.from(files).filter(f => (f.type || '').startsWith('image/') || isVideoFile(f) || /\.(jpe?g|png|gif|webp|avif|heic|heif|tiff?|bmp)$/i.test(f.name || ''));
  if (!list.length) return toast('画像が見つかりませんでした');
  progOpen('ストックに取り込んでいます');
  let ok = 0, ng = 0, heic = 0;
  for (let i = 0; i < list.length; i++) {
    if (progCancelled) break;
    progSet(i, list.length, (i + 1) + ' / ' + list.length + ' 枚目');
    try {
      const file = list[i].load ? await list[i].load() : list[i];
      const m = list[i].meta;
      const srec = await storeImage(file, '', m ? Object.assign({}, m.tags && m.tags.length ? { tags: m.tags } : {}, m.title ? { srcTitle: m.title } : {}, m.from ? { from: m.from } : {}) : null);
      if (m && m.cap) CAP_STACK.push({ image: srec.id });
      ok++;
    } catch (e) { ng++; if (e.heic) heic++; }
    if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
  }
  progClose();
  _srcIndex = null;
  if (S.view === 'home') { if (!STOCK.on) showStock(true); else await loadStock(); }
  toast(ok + ' 枚をストックに入れました' + (ng - heic > 0 ? '<br>' + (ng - heic) + ' 枚は読めない形式でした' : '')
    + (heic ? '<br>' + heic + ' 枚はHEIC形式で、この環境では開けませんでした<br>' + heicHint() : ''), ng ? 6000 : 2400);
}
$('#btn-stock-add').onclick = () => openAddSheet(true);
$('#btn-stock-newboard').onclick = () => newBoard();
$('#btn-stock-cancel').onclick = () => { STOCK.sel.clear(); syncStockCells(); syncStockDock(); };

/* ---- ボードへ入れる ---- */
async function openPickBoard(onPick) {
  const boards = (await dbAll('boards')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const box = $('#pickboard-list');
  box.innerHTML = '';
  const add = inspEl('button', 'row-btn');
  add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span><b>あたらしいボード</b></span>';
  add.onclick = async () => {
    const name = await ask('ボードの名前', '');
    if (name === null) return;
    const b = { id: uid(), name: name || '無題のボード', createdAt: nowISO(), updatedAt: nowISO() };
    await dbPut('boards', b);
    closeSheets(); onPick(b.id);
  };
  box.appendChild(add);
  boards.forEach(b => {
    const r = inspEl('button', 'row-btn');
    r.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/></svg><span><b></b></span>';
    r.querySelector('b').textContent = b.name;
    r.onclick = () => { closeSheets(); onPick(b.id); };
    box.appendChild(r);
  });
  openSheet('#sheet-pickboard');
}
$('#pickboard-cancel').onclick = closeSheets;
$('#btn-stock-toboard').onclick = () => {
  const recs = stockSelRecs();
  if (!recs.length) return;
  openPickBoard(async (boardId) => {
    STOCK.sel.clear();
    await openBoard(boardId);
    pushHistory();
    const place = beginPlacement(recs.length);
    for (const rec of recs) {
      const full = await dbGet('images', rec.id);
      if (!full) continue;
      S.imgs.set(full.id, full);
      await addImageToBoard(full, placeNext(place, full.h / full.w));
    }
    $('#board-empty').hidden = S.items.length > 0;
    await touchBoard();
    fitAll();
    renderPalette();
    toast(recs.length + ' 枚をボードに入れました');
  });
};
$('#btn-stock-compare').onclick = () => {
  const ids = [...STOCK.sel];
  if (ids.length >= 2 && ids.length <= 6) openCompare(ids.map(id => 'img:' + id));
};
$('#btn-stock-send').onclick = () => openSend({ recs: stockSelRecs() });
$('#btn-stock-more').onclick = () => {
  $('#stockmore-title').textContent = STOCK.sel.size + ' 枚えらんでいます';
  $('#stock-view-big').disabled = STOCK.sel.size !== 1;
  $('#stock-similar').disabled = STOCK.sel.size !== 1;
  renderMarkRow($('#stockmore-marks'), [...STOCK.sel]);
  openSheet('#sheet-stockmore');
};
$('#stockmore-close').onclick = closeSheets;
$('#stock-view-big').onclick = () => { closeSheets(); if (STOCK.sel.size === 1) openStockViewer([...STOCK.sel][0]); };
$('#stock-pickall').onclick = () => { closeSheets(); STOCK.list.forEach(r => STOCK.sel.add(r.id)); syncStockCells(); syncStockDock(); };
$('#stock-tag').onclick = async () => {
  closeSheets();
  const recs = stockSelRecs();
  if (!recs.length) return;
  const v = await ask(recs.length + ' 枚に付けるタグ（カンマや空白で区切って、いくつでも）', '');
  if (!v) return;
  const tags = v.split(/[,、\s]+/).map(x => x.trim()).filter(Boolean);
  for (const r of recs) {
    const rec = await dbGet('images', r.id);
    if (!rec) continue;
    rec.tags = [...new Set([...(rec.tags || []), ...tags])];
    await dbPut('images', rec);
  }
  await loadStock();
  toast(recs.length + ' 枚にタグを付けました');
};
async function stockDelete() {
  const ids = [...STOCK.sel];
  const loose = ids.filter(id => (STOCK.info.get(id) || {}).loose);
  if (!loose.length) return toast('えらんだ写真は、どれもボードに載っています。<br>ボードから外すと、ここからも消せるようになります', 4200);
  const skip = ids.length - loose.length;
  const ok = await confirmAsk(loose.length + ' 枚をストックから消します。'
    + (NATIVE ? '（写真のファイルは Mac のゴミ箱に移すので、そこからは取り出せます）' : 'もう戻せません。')
    + (skip ? '\nボードに載っている ' + skip + ' 枚はそのまま残します。' : ''));
  if (!ok) return;
  for (const id of loose) { await dbDel('images', id); STOCK.sel.delete(id); }
  _srcIndex = null;
  releaseURLs();
  await loadStock();
  toast(loose.length + ' 枚をストックから消しました');
}
$('#stock-delete').onclick = () => { closeSheets(); stockDelete(); };

/* ========================== 送る（比べたいものを人に渡す） =================
   選んだ写真から「くらべるシート（番号付きで1ページに並べたPDF）」「1枚の画像」「1枚ずつのPDF」
   「写真そのまま」「盤面のまま（PDF）」を作り、Mac版なら共有（AirDrop・メール・メッセージ…）へ、
   ブラウザなら保存（または共有）する。ボードで選んだものからも、ストックで選んだものからも使える */
const SEND = { entries: [], kind: 'sheet', orient: 'auto', cap: 'on', board: false, whole: false };
function sendTargets(opts) {
  if (opts.recs) {
    opts.recs.forEach(r => S.imgs.set(r.id, r));     // 描くときに写真を引けるように
    return { entries: opts.recs.map(r => ({ id: 'img:' + r.id, imageId: r.id, w: r.w, h: r.h, note: '' })), board: false, whole: false };
  }
  if (S.view !== 'board') return { entries: [], board: false, whole: false };
  const sel = toolTargets().filter(i => i.type !== 'draw');
  if (sel.length) return { entries: sel, board: true, whole: false };
  return { entries: S.items.filter(i => !i.trashedAt && i.type !== 'draw'), board: true, whole: true };
}
function openSend(opts = {}) {
  const t = sendTargets(opts);
  if (!t.entries.length) return toast('送るものがありません');
  Object.assign(SEND, t);
  const photos = SEND.entries.filter(isPhoto).length;
  $('#send-title').textContent = SEND.whole ? 'このボードを送る' : SEND.entries.length + ' 枚を送る';
  $('#send-scope').textContent = SEND.whole ? 'ボードの全部（' + SEND.entries.length + ' 個）' : 'えらんだ ' + SEND.entries.length + ' 個' + (photos !== SEND.entries.length ? '（うち写真 ' + photos + ' 枚）' : '');
  $('#send-name').value = (S.view === 'board' && S.board ? S.board.name : 'MOOD BOARD') + (SEND.whole ? '' : '（' + SEND.entries.length + '枚）');
  $('#send-kind [data-v="board"]').hidden = !SEND.board;
  if (SEND.kind === 'board' && !SEND.board) SEND.kind = 'sheet';
  $('#send-share').textContent = NATIVE ? '送る…（AirDrop・メールなど）' : '送る…';
  $('#send-share').hidden = !NATIVE && !(navigator.canShare && navigator.share);
  $('#send-print').hidden = !SEND.board;
  syncSendSheet();
  openSheet('#sheet-send');
}
function syncSendSheet() {
  $$('#send-kind .chip').forEach(c => c.classList.toggle('on', c.dataset.v === SEND.kind));
  $$('#send-orient .chip').forEach(c => c.classList.toggle('on', c.dataset.v === SEND.orient));
  $$('#send-cap .chip').forEach(c => c.classList.toggle('on', c.dataset.v === SEND.cap));
  $('#send-orient-row').hidden = !['sheet', 'pages'].includes(SEND.kind);
  $('#send-cap-row').hidden = !['sheet', 'image', 'pages'].includes(SEND.kind);
  const n = SEND.entries.length;
  $('#send-hint').textContent = {
    sheet: '番号付きで並べたPDF（1ページに12枚まで。多いときは続きのページへ）。「3番の光がいい」のように話せます',
    image: 'LINE やインスタのDMにそのまま貼れる、1枚の画像（JPEG）',
    pages: '1ページに1枚ずつ、大きく入ったPDF（' + n + 'ページ）',
    files: '写真を1枚ずつのファイルで。名前は「タイトル_番号_ひとこと」',
    board: 'いまの盤面の並びのまま、1ページのPDF',
  }[SEND.kind];
}
[['#send-kind', 'kind'], ['#send-orient', 'orient'], ['#send-cap', 'cap']].forEach(([sel, key]) => {
  $$(sel + ' .chip').forEach(c => c.onclick = () => { SEND[key] = c.dataset.v; syncSendSheet(); });
});
const safeName = (t) => (t || 'MOOD BOARD').replace(/[\/\\:*?"<>|\n\r]/g, '_').trim().slice(0, 80) || 'MOOD BOARD';

/* 番号付きの格子を1ページに描く。cells: [{it, no}] */
async function drawSendGrid(ctx, W, H, cells, title, sub, cap) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const margin = Math.round(W * 0.05);
  const headH = Math.round(W * 0.06);
  await drawPdfHeader(ctx, W, margin, title, sub);
  const area = { x: margin, y: margin + headH, w: W - margin * 2, h: H - margin * 2 - headH };
  const n = cells.length, gap = Math.round(W * 0.018);
  const capH = cap ? Math.round(W * 0.03) : 0;
  const asp = cells.reduce((a, c) => a + (c.it.h / Math.max(1, c.it.w)), 0) / Math.max(1, n);   // 平均の 高さ/幅
  // いちばん写真が大きく見える列の数を選ぶ
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (area.w - gap * (cols - 1)) / cols;
    const ch = (area.h - gap * (rows - 1)) / rows - capH;
    if (ch <= 0) continue;
    const size = Math.min(cw, ch / asp);
    if (size > best.size) best = { cols, size };
  }
  const cols = best.cols, rows = Math.ceil(n / cols);
  const cw = (area.w - gap * (cols - 1)) / cols;
  const ch = (area.h - gap * (rows - 1)) / rows;
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x = area.x + col * (cw + gap), y = area.y + row * (ch + gap);
    const box = { x, y, w: cw, h: ch - capH };
    const { it, no } = cells[i];
    // ひとことは写真の下に別に書くので、写真の中には重ねない
    await drawItemInto(ctx, cap ? Object.assign({}, it, { note: '' }) : it, box);
    if (!cap) continue;
    // 番号（写真の左上）とひとこと（写真の下）
    const r = Math.round(W * 0.014);
    const ir = it.w / Math.max(1, it.h), br = box.w / Math.max(1, box.h);
    const pw = ir > br ? box.w : box.h * ir, ph = ir > br ? box.w / ir : box.h;
    const px0 = box.x + (box.w - pw) / 2, py0 = box.y + (box.h - ph) / 2;
    ctx.fillStyle = 'rgba(17,17,20,.86)';
    ctx.beginPath(); ctx.arc(px0 + r * 1.5, py0 + r * 1.5, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.stroke();   // 黒っぽい写真の上でも番号が見えるように
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 ' + Math.round(r * 1.15) + 'px -apple-system,"Hiragino Sans",sans-serif';
    ctx.fillText(String(no), px0 + r * 1.5, py0 + r * 1.55);
    // しるし（写真の右上）。送った相手にも、どれが本命か分かるように
    const mk = it.imageId ? markOf(S.imgs.get(it.imageId) || STOCK.all.find(x => x.id === it.imageId)) : null;
    if (mk) {
      const mx = px0 + pw - r * 1.5, my = py0 + r * 1.5;
      ctx.fillStyle = mk.c; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.round(r * 1.2) + 'px -apple-system,"Hiragino Sans",sans-serif';
      ctx.fillText(mk.s, mx, my + r * 0.05);
    }
    const text = [it.note, (it.refs || []).join('・')].filter(Boolean).join('　');
    if (text) {
      ctx.fillStyle = '#333'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = Math.round(capH * 0.52) + 'px -apple-system,"Hiragino Sans",sans-serif';
      let t = text;
      while (t.length > 1 && ctx.measureText(t).width > Math.max(pw, cw * 0.6)) t = t.slice(0, -2) + '…';
      ctx.fillText(t, px0, Math.min(py0 + ph + capH * 0.2, y + ch - capH * 0.8));
    }
  }
}

async function makeSendFiles() {
  const title = $('#send-name').value.trim() || 'MOOD BOARD';
  const base = safeName(title);
  const entries = SEND.entries;
  const cap = SEND.cap === 'on';
  const kind = SEND.kind;
  if (kind === 'board') {
    const r = await exportBoardPDF('board', { items: entries, returnBlob: true });
    return r ? [{ name: base + '.pdf', blob: r.blob }] : [];
  }
  if (kind === 'files') {
    const out = [];
    const photos = entries.filter(isPhoto);
    progOpen('写真を用意しています');
    try {
      for (let i = 0; i < photos.length; i++) {
        if (progCancelled) break;
        progSet(i, photos.length, (i + 1) + ' / ' + photos.length);
        const it = photos[i];
        const rec = S.imgs.get(it.imageId) || await dbGet('images', it.imageId);
        if (!rec) continue;
        let blob = await realBlob(isVideoRec(rec) ? rec.video : rec.full);
        let ext = (blob.type.startsWith('video/') ? (N_EXT[blob.type] || 'mp4') : (blob.type.split('/')[1] || 'jpg')).replace('jpeg', 'jpg');
        if (!blob.type.startsWith('video/') && !/^(jpe?g|png|gif)$/.test(ext)) {            // WebP や HEIC は開けない相手がいるので JPEG に
          const dec = await decodeImage(blob);
          const c = drawCanvas(dec.src, dec.w, dec.h, 4096); dec.close();
          blob = await canvasToBlob(c, 'image/jpeg', 0.92); ext = 'jpg';
        }
        const no = String(i + 1).padStart(2, '0');
        out.push({ name: base + '_' + no + (it.note ? '_' + safeName(it.note).slice(0, 30) : '') + '.' + ext, blob });
      }
    } finally { progClose(); }
    return out;
  }
  // くらべるシート・1枚の画像・1枚ずつ
  const portrait = SEND.orient === 'p' || (SEND.orient === 'auto' && kind === 'pages' && entries.every(i => i.h >= i.w));
  const land = SEND.orient === 'l' || (SEND.orient === 'auto' && kind === 'sheet' && entries.length >= 2) || (!portrait && kind === 'pages');
  const P = land ? { w: 297, h: 210 } : { w: 210, h: 297 };
  const px = Math.round(P.w / 25.4 * PDF_DPI), py = Math.round(P.h / 25.4 * PDF_DPI);
  const date = new Date().toLocaleDateString('ja-JP');
  progOpen('作っています');
  try {
    if (kind === 'image') {
      // 横2400px。行の数に合わせて高さを決める
      const W = 2400, n = entries.length;
      const cols = Math.max(1, Math.min(6, Math.round(Math.sqrt(n * 1.3))));
      const rows = Math.ceil(n / cols);
      const asp = entries.reduce((a, it) => a + it.h / Math.max(1, it.w), 0) / n;
      const cw = (W * 0.9 - W * 0.018 * (cols - 1)) / cols;
      const H = Math.round(W * 0.05 * 2 + W * 0.06 + rows * (cw * Math.min(1.5, Math.max(0.6, asp)) + (cap ? W * 0.03 : 0)) + (rows - 1) * W * 0.018);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      progSet(0, 1, '組んでいます');
      await drawSendGrid(c.getContext('2d'), W, H, entries.map((it, i) => ({ it, no: i + 1 })), title, n + ' 枚', cap);
      return [{ name: base + '.jpg', blob: await canvasToBlob(c, 'image/jpeg', 0.9) }];
    }
    const per = kind === 'pages' ? 1 : 12;
    const pages = [];
    const total = Math.ceil(entries.length / per);
    for (let p = 0; p < total; p++) {
      if (progCancelled) break;
      progSet(p, total, (p + 1) + ' / ' + total + ' ページ');
      const cells = entries.slice(p * per, p * per + per).map((it, i) => ({ it, no: p * per + i + 1 }));
      const c = document.createElement('canvas'); c.width = px; c.height = py;
      const sub = (total > 1 ? (p + 1) + ' / ' + total + '　' : '') + entries.length + ' 枚';
      await drawSendGrid(c.getContext('2d'), px, py, cells, title, sub, cap);
      const blob = await canvasToBlob(c, 'image/jpeg', 0.88);
      pages.push({ jpg: new Uint8Array(await blob.arrayBuffer()), wPt: P.w * MM2PT, hPt: P.h * MM2PT, px, py });
      await new Promise(r => setTimeout(r, 0));
    }
    if (!pages.length) return [];
    return [{ name: base + '.pdf', blob: buildPDF(pages, title) }];
  } finally { progClose(); }
}

async function sendOut(how) {
  let files;
  try { files = await makeSendFiles(); }
  catch (e) { return toast('作れませんでした<br>' + (e && e.message || e), 4200); }
  if (!files || !files.length) return toast('作れるものがありませんでした');
  closeSheets();
  const size = files.reduce((a, f) => a + f.blob.size, 0);
  if (NATIVE) {
    const payload = [];
    for (const f of files) payload.push({ name: f.name, b64: await blobToB64(f.blob) });
    const btn = $('#send-share').getBoundingClientRect();
    const r = await mbCall(how === 'share' ? 'share' : 'saveFiles', { files: payload, x: btn.left + btn.width / 2, y: btn.top }).catch(e => { toast('送れませんでした<br>' + e, 4200); return null; });
    if (r && how !== 'share') toast(files.length + ' 個のファイルを保存しました（' + fmtBytes(size) + '）');
    return;
  }
  if (how === 'share' && navigator.canShare) {
    const fs = files.map(f => new File([f.blob], f.name, { type: f.blob.type }));
    if (navigator.canShare({ files: fs })) {
      try { await navigator.share({ files: fs, title: files[0].name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
  }
  if (files.length > 1) {
    const zip = await makeZip(await Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) }))));
    saveBlob(zip, safeName($('#send-name').value) + '.zip');
  } else saveBlob(files[0].blob, files[0].name);
  toast('保存しました（' + fmtBytes(size) + '）');
}
$('#send-share').onclick = () => sendOut('share');
$('#send-save').onclick = () => sendOut('save');
$('#send-print').onclick = () => { closeSheets(); PRINT.scope = (S.picking && S.picked.length) ? 'picked' : 'all'; $('#menu-print').click(); };
$('#btn-bulk-send').onclick = () => openSend();

/* ========================== Macの「ショートカット」と使う ==================== */
async function openShortcutsGuide() {
  $('#sc-web-note').hidden = NATIVE;
  let path = '';
  if (NATIVE) { await nativeLoad(); path = NS.info.lib.replace(/\/$/, '') + '/取り込み'; }
  $('#sc-inbox').textContent = path || '（Mac版のライブラリの中）';
  $('#sc-inbox-open').disabled = !NATIVE;
  $('#sc-inbox-copy').disabled = !NATIVE;
  $('#sc-inbox-open').onclick = () => mbCall('revealInbox');
  $('#sc-inbox-copy').onclick = () => navigator.clipboard.writeText(path).then(() => toast('場所をコピーしました。ショートカットの保存先に貼り付けられます'), () => toast('コピーできませんでした'));
  openSheet('#sheet-shortcuts');
}
$('#sc-close').onclick = closeSheets;
$('#menu-shortcuts').onclick = () => { closeSheets(); openShortcutsGuide(); };
KEYMAP.push({ id: 'shortcutsGuide', g: 'そのほか', name: 'Macの「ショートカット」と使う', where: 'any', run: () => openShortcutsGuide() });

/* ---- 付箋・吹き出しの色（設定パネル） ---- */
function inspCardColorBlock(body, list) {
  const s = inspSec(body, '付箋の色');
  const row = inspEl('div', 'insp-swatches');
  const cur = new Set(list.map(i => i.bg || ''));
  CARD_COLORS.forEach(([hex, name]) => {
    const b = inspEl('button', 'insp-sw' + (cur.size === 1 && ([...cur][0] || (list[0].style === 'bubble' ? '#ffffff' : '#f4ecd0')) === hex ? ' on' : ''));
    b.style.setProperty('--c', hex);
    b.title = name;
    b.onclick = () => inspApply(list, it => {
      const def = it.style === 'bubble' ? '#ffffff' : '#f4ecd0';
      if (hex === def) delete it.bg; else it.bg = hex;      // いつもの色に戻したら、色の指定ごと外す
    }, 'rebuild').then(() => renderInspector(true));
    row.appendChild(b);
  });
  s.appendChild(row);
}
/* ---- 描いた線の色と太さ（設定パネル） ---- */
const STROKE_COLORS = [['#111114', '黒'], ['#ffffff', '白'], ['#e2453a', '赤'], ['#2f6df6', '青'], ['#f2b705', '黄'], ['#1b9a68', '緑'], ['#e55a9b', 'ピンク']];
function inspStrokeBlock(body, list) {
  const s = inspSec(body, '線の色と太さ');
  const row = inspEl('div', 'insp-swatches');
  const cur = new Set(list.map(i => (i.stroke || '').toLowerCase()));
  STROKE_COLORS.forEach(([hex, name]) => {
    const b = inspEl('button', 'insp-sw' + (cur.size === 1 && cur.has(hex) ? ' on' : ''));
    b.style.setProperty('--c', hex);
    b.title = name;
    b.onclick = () => inspApply(list, it => { it.stroke = hex; }, 'rebuild').then(() => renderInspector(true));
    row.appendChild(b);
  });
  s.appendChild(row);
  const q = inspEl('div', 'tag-row');
  [[2, '細い'], [4, 'ふつう'], [8, '太い']].forEach(([w, label]) => {
    q.appendChild(inspChip(label, list.every(i => (i.sw || 4) === w), () => inspApply(list, it => { it.sw = w; }, 'rebuild').then(() => renderInspector(true))));
  });
  s.appendChild(q);
}

/* ========================== 連続スクショ：直前の1枚を取り出す（⌃⌥Z） ========
   撮った1枚はすぐ入るので、取り消すときは入れたもの（盤面の1つ・ストックの1枚）を取り出す */
var CAP_STACK = [];
window.mbUndoCapture = async () => {
  const last = CAP_STACK.pop();
  if (!last) return;
  if (last.item) {
    const it = S.items.find(i => i.id === last.item);
    if (it) {
      S.items = S.items.filter(i => i.id !== it.id);
      const el = itemEl(it.id); if (el) el.remove();
      if (S.sel === it.id) selectItem(null);
      $('#board-empty').hidden = S.items.length > 0;
    }
    await dbDel('items', last.item);
  }
  await dbDel('images', last.image);           // 撮ったばかりで、ほかに使っていない
  _srcIndex = null;
  if (S.view === 'home' && STOCK.on) await loadStock();
  toast('直前のスクショを取り消しました');
};

/* ========================== クラウドへ（iCloud 写真・Google フォト・Amazon Photos） ==========
   同期は自分では作らず、写真のサービスに任せる（本人の方針）。MOOD BOARD は「そこへ入れやすく」するだけ。
   ・写真アプリ（iCloud 写真）：アルバム「MOOD BOARD」に入れる。iCloud 写真がオンなら iPhone にも届く
   ・クラウド用フォルダ：ピクチャ/MOOD BOARD 書き出し/。Google ドライブ（パソコン版）や Amazon Photos のアプリに
     このフォルダをバックアップ先として登録すると、Google フォト・Amazon Photos に上がる
   送る › から選んだものだけ／設定で「自動で」にすると、取り込むたびに入れる（写真アプリから来たものは写真アプリへは戻さない） */
const cloudName = (rec, base, i, note) => {
  const f = isVideoRec(rec) ? rec.video : rec.full;
  const ext = (f.type && f.type.startsWith('video/')) ? (N_EXT[f.type] || 'mp4') : ((f.type || 'image/jpeg').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  return safeName(base) + (i != null ? '_' + String(i + 1).padStart(2, '0') : '') + (note ? '_' + safeName(note).slice(0, 30) : '') + '.' + ext;
};
const cloudFile = (rec) => { const f = isVideoRec(rec) ? rec.video : rec.full; return f instanceof NFile ? f.path : null; };

async function sendToCloud(where) {
  if (!NATIVE) return toast('Mac版で使えます');
  const base = $('#send-name').value.trim() || 'MOOD BOARD';
  const items = [];
  let i = 0;
  for (const it of SEND.entries.filter(isPhoto)) {
    const rec = NS.maps.images.get(it.imageId);
    const path = rec && cloudFile(rec);
    if (path) items.push({ path, name: cloudName(rec, base, i++, it.note) });
  }
  if (!items.length) return toast('送れる写真がありません');
  closeSheets();
  const board = S.view === 'board' && S.board ? S.board.name : '';
  try {
    if (where === 'photos') {
      const r = await mbCall('toPhotos', { items, album: 'MOOD BOARD' + (board ? ' – ' + board : '') });
      toast(r.count + ' 枚を写真アプリのアルバム「' + r.album + '」に入れました<br>iCloud 写真がオンなら、iPhone にも届きます', 5200);
    } else {
      const r = await mbCall('exportFolder', { items, sub: board || 'ストック' });
      toast(r.count + ' 枚をクラウド用フォルダに置きました<br>Google フォト・Amazon Photos のアプリが上げてくれます', 5200);
    }
  } catch (e) { toast('入れられませんでした<br>' + e, 6000); }
}

/* 設定が「自動で」なら、取り込んだ写真をすぐクラウドにも入れる（まとめて1回に） */
const CLOUD_Q = { photos: [], folder: [], t: 0 };
function cloudAuto(rec) {
  if (!NATIVE || !rec || rec.derived) return;      // 切り抜き・まわすでできた写真は送らない（まわすたびに増えてしまう）
  if (SET.autoPhotos !== 'on' && SET.autoFolder !== 'on') return;
  CLOUD_Q.pending = CLOUD_Q.pending || [];
  CLOUD_Q.pending.push(rec.id);
  clearTimeout(CLOUD_Q.t);
  CLOUD_Q.t = setTimeout(flushCloudAuto, 1500);
}
async function flushCloudAuto() {
  const ids = CLOUD_Q.pending || []; CLOUD_Q.pending = [];
  const recs = ids.map(id => NS.maps.images.get(id)).filter(r => r && cloudFile(r));
  if (!recs.length) return;
  const stamp = (r) => (r.addedAt || '').slice(0, 10) + '_' + r.id.slice(0, 8);
  if (SET.autoPhotos === 'on') {
    const items = recs.filter(r => r.from !== 'photos').map(r => ({ path: cloudFile(r), name: cloudName(r, stamp(r)) }));
    if (items.length) mbCall('toPhotos', { items, album: 'MOOD BOARD' }).catch(e => toast('写真アプリに入れられませんでした<br>' + e, 6000));
  }
  if (SET.autoFolder === 'on') {
    const items = recs.map(r => ({ path: cloudFile(r), name: cloudName(r, stamp(r)) }));
    mbCall('exportFolder', { items, sub: 'すべて' }).catch(() => { });
  }
}
$('#send-photos').onclick = () => sendToCloud('photos');
$('#send-folder').onclick = () => sendToCloud('folder');
$('#st-cloud-open').onclick = () => mbCall('revealExport');
if (NATIVE) { $('#st-cloud').hidden = false; $('#send-cloud').hidden = false; }

