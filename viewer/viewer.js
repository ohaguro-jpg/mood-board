/* ==========================================================================
   MOOD BOARD — USB VIEWER
   USBから index.html を直接開いても動くよう、fetch を一切使わない。
   データは data.js が MB_DATA として渡してくる。
   ========================================================================== */
'use strict';

const D = (typeof MB_DATA !== 'undefined') ? MB_DATA : { boards: [], items: [], images: {} };
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const V = {
  boardId: null,
  items: [],
  cam: { x: 0, y: 0, k: 1 },
  picked: [],
  cmpLayout: 'row',
  cmpFill: false,
  print: { mode: 'board', paper: 'a4p', scope: 'all', note: 'on' },
};

const plane = $('#plane');
const stage = $('#stage');

/* ========================== ボードのタブ ================================= */
function buildTabs() {
  const box = $('#hud-boards');
  box.innerHTML = '';
  D.boards.forEach(b => {
    const t = document.createElement('button');
    t.className = 'tab';
    t.textContent = b.name;
    t.onclick = () => openBoard(b.id);
    t.dataset.id = b.id;
    box.appendChild(t);
  });
}

function openBoard(id) {
  V.boardId = id;
  V.picked = [];
  V.items = D.items.filter(i => i.boardId === id).sort((a, b) => (a.z || 0) - (b.z || 0));
  $$('#hud-boards .tab').forEach(t => t.classList.toggle('on', t.dataset.id === id));
  $('#ro-count').textContent = String(V.items.length).padStart(3, '0');
  render();
  fit(true);
  requestAnimationFrame(() => { fit(false); reveal(); });
  renderVPalette();
  syncBar();
}

/* ========================== 配置 ========================================= */
function render() {
  plane.innerHTML = '';
  for (const it of V.items) plane.appendChild(makeEl(it));
}

function makeEl(it) {
  const img = D.images[it.imageId];
  const el = document.createElement('div');
  el.className = 'ph';
  el.dataset.id = it.id;
  el.style.width = it.w + 'px';
  el.style.height = it.h + 'px';
  el.style.transform = 'translate(' + it.x + 'px,' + it.y + 'px)';
  const im = document.createElement('img');
  im.src = img ? img.file : '';
  im.alt = it.note || '';
  im.draggable = false;
  el.appendChild(im);
  const fr = document.createElement('div');
  fr.className = 'frame';
  el.appendChild(fr);
  if (it.note) {
    const c = document.createElement('div');
    c.className = 'cap';
    c.textContent = it.note;
    el.appendChild(c);
  }
  return el;
}

function elOf(id) { return plane.querySelector('.ph[data-id="' + id + '"]'); }

function bounds() {
  if (!V.items.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const it of V.items) {
    x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
    x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

function applyCam() {
  plane.style.transform = 'translate(' + V.cam.x + 'px,' + V.cam.y + 'px) scale(' + V.cam.k + ')';
  $('#ro-zoom').textContent = String(Math.round(V.cam.k * 100)).padStart(3, '0');
  plane.querySelectorAll('.no').forEach(n => n.style.transform = 'scale(' + (1 / V.cam.k) + ')');
}

let smoothT = 0;
function smooth(ms = 560) {
  plane.classList.add('smooth');
  clearTimeout(smoothT);
  smoothT = setTimeout(() => plane.classList.remove('smooth'), ms);
}

function fit(instant) {
  const b = bounds();
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!b) { V.cam = { x: W / 2, y: H / 2, k: 1 }; applyCam(); return; }
  const pad = 44;
  const k = clamp(Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h), 0.04, 2.2);
  V.cam.k = k;
  V.cam.x = (W - b.w * k) / 2 - b.x1 * k;
  V.cam.y = (H - b.h * k) / 2 - b.y1 * k;
  if (!instant) smooth();
  applyCam();
}

/* 中心から外へ、順に立ち上げる */
function reveal() {
  const b = bounds();
  if (!b) return;
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const maxD = Math.max(1, Math.hypot(b.w, b.h) / 2);
  for (const it of V.items) {
    const el = elOf(it.id);
    if (!el) continue;
    const d = Math.hypot(it.x + it.w / 2 - cx, it.y + it.h / 2 - cy) / maxD;
    el.style.setProperty('--dl', Math.round(d * 320) + 'ms');
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
  }
}

/* 並べ直す（石積み） */
function arrange() {
  if (!V.items.length) return;
  const colW = 260, gap = 22, n = V.items.length;
  const ratio = stage.clientWidth / Math.max(1, stage.clientHeight);
  const avgH = V.items.reduce((a, i) => a + (i.h / i.w) * colW, 0) / n;
  const cols = clamp(Math.round(Math.sqrt(ratio * n * (avgH + gap) / (colW + gap))), 1, 10);
  const hs = new Array(cols).fill(0);
  for (const it of V.items) {
    const c = hs.indexOf(Math.min(...hs));
    const r = it.h / it.w;
    it.w = colW; it.h = Math.round(colW * r);
    it.x = c * (colW + gap); it.y = hs[c];
    hs[c] += it.h + gap;
    const el = elOf(it.id);
    if (el) {
      el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
      el.style.transform = 'translate(' + it.x + 'px,' + it.y + 'px)';
    }
  }
  fit();
  reveal();
}

/* 色の順に並べる（USBに書き出すとき色情報も一緒に入る） */
function arrangeColor() {
  if (!V.items.length) return;
  const keyed = V.items.map(it => {
    const im = D.images[it.imageId] || {};
    // im.h は画像の高さ。色相は hue
    const h = im.hue || 0, sat = (im.sat === undefined ? 0 : im.sat), l = (im.lum === undefined ? 0.5 : im.lum);
    return { it, h, sat, l, gray: sat < 0.14 };
  });
  if (keyed.every(k => k.sat === 0)) return arrange();   // 色情報がなければ通常の整列
  const colored = keyed.filter(k => !k.gray).sort((a, b) => a.h - b.h || b.sat - a.sat);
  const grays = keyed.filter(k => k.gray).sort((a, b) => b.l - a.l);
  const order = [...colored, ...grays].map(k => k.it);

  const colW = 260, gap = 22, n = order.length;
  const ratio = stage.clientWidth / Math.max(1, stage.clientHeight);
  const avgH = order.reduce((a, i) => a + (i.h / i.w) * colW, 0) / n;
  const cols = clamp(Math.round(Math.sqrt(ratio * n * (avgH + gap) / (colW + gap))), 1, 10);

  let y = 0, rowH = 0;
  order.forEach((it, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) { y += rowH + gap; rowH = 0; }
    const r = it.h / it.w;
    it.w = colW; it.h = Math.round(colW * r);
    it.x = col * (colW + gap);
    it.y = y;
    rowH = Math.max(rowH, it.h);
    const el = elOf(it.id);
    if (el) {
      el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
      el.style.transform = 'translate(' + it.x + 'px,' + it.y + 'px)';
    }
  });
  fit();
  reveal();
}

/* ボードの代表色 */
function boardPalette(max = 6) {
  const counts = new Map();
  for (const it of V.items) {
    const im = D.images[it.imageId];
    if (!im || im.hex === undefined) continue;
    const sat = im.sat || 0, l = (im.lum === undefined ? 0.5 : im.lum);
    const gray = sat < 0.14;
    const key = gray ? 'g' + Math.round(l * 5) : 'h' + Math.round((im.hue || 0) / 24);
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { n: 1, hex: im.hex, h: im.hue || 0, l, gray });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, max)
    .sort((a, b) => (a.gray === b.gray) ? (a.gray ? b.l - a.l : a.h - b.h) : (a.gray ? 1 : -1));
}

function renderVPalette() {
  const box = $('#v-palette');
  if (!box) return;
  const pal = boardPalette();
  box.innerHTML = '';
  if (pal.length < 2) return;
  pal.forEach(p => {
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = p.hex;
    sw.title = p.hex.toUpperCase() + '（クリックでコピー）';
    sw.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(p.hex); };
    box.appendChild(sw);
  });
}

/* ========================== パン・ズーム ================================= */
let glideRAF = 0;
function stopGlide() { cancelAnimationFrame(glideRAF); glideRAF = 0; }
function glide(vx, vy) {
  stopGlide();
  let last = performance.now();
  const step = (t) => {
    const dt = Math.min(48, t - last); last = t;
    const dec = Math.pow(0.935, dt / 16.67);
    vx *= dec; vy *= dec;
    V.cam.x += vx * dt; V.cam.y += vy * dt;
    applyCam();
    if (Math.hypot(vx, vy) > 0.015) glideRAF = requestAnimationFrame(step);
  };
  glideRAF = requestAnimationFrame(step);
}

let drag = null;
stage.addEventListener('pointerdown', (e) => {
  stopGlide();
  plane.classList.remove('smooth');
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('grabbing');
  drag = {
    x0: V.cam.x, y0: V.cam.y, sx: e.clientX, sy: e.clientY, moved: false,
    lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0,
    target: e.target.closest('.ph'),
  };
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (Math.hypot(dx, dy) > 4) drag.moved = true;
  V.cam.x = drag.x0 + dx;
  V.cam.y = drag.y0 + dy;
  const t = performance.now(), ddt = t - drag.lastT;
  if (ddt > 0) {
    drag.vx = drag.vx * 0.4 + ((e.clientX - drag.lastX) / ddt) * 0.6;
    drag.vy = drag.vy * 0.4 + ((e.clientY - drag.lastY) / ddt) * 0.6;
    drag.lastX = e.clientX; drag.lastY = e.clientY; drag.lastT = t;
  }
  applyCam();
});
function endDrag(e) {
  if (!drag) return;
  stage.classList.remove('grabbing');
  const d = drag; drag = null;
  if (!d.moved) {
    if (d.target) togglePick(d.target.dataset.id);
    else clearPick();
  } else if (performance.now() - d.lastT < 90 && Math.hypot(d.vx, d.vy) > 0.12) {
    glide(d.vx, d.vy);
  }
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

stage.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.ph');
  if (el) openSolo(el.dataset.id);
});

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const wx = (cx - V.cam.x) / V.cam.k, wy = (cy - V.cam.y) / V.cam.k;
  const k = clamp(V.cam.k * (e.deltaY < 0 ? 1.14 : 1 / 1.14), 0.04, 4);
  V.cam.k = k;
  V.cam.x = cx - wx * k;
  V.cam.y = cy - wy * k;
  smooth(200);
  applyCam();
}, { passive: false });

/* ========================== 選ぶ ========================================= */
function togglePick(id) {
  const i = V.picked.indexOf(id);
  if (i >= 0) V.picked.splice(i, 1);
  else {
    if (V.picked.length >= 6) return;
    V.picked.push(id);
  }
  syncPick();
}
function clearPick() { V.picked = []; syncPick(); }
function syncPick() {
  plane.querySelectorAll('.ph').forEach(el => {
    const idx = V.picked.indexOf(el.dataset.id);
    const badge = el.querySelector('.no');
    if (idx >= 0) {
      el.classList.add('pick');
      if (badge) badge.textContent = idx + 1;
      else {
        const b = document.createElement('div');
        b.className = 'no';
        b.textContent = idx + 1;
        b.style.transformOrigin = '0 0';
        b.style.transform = 'scale(' + (1 / V.cam.k) + ')';
        el.appendChild(b);
      }
    } else {
      el.classList.remove('pick');
      if (badge) badge.remove();
    }
  });
  syncBar();
}
function syncBar() {
  $('#ro-pick').textContent = V.picked.length;
  $('#b-compare').disabled = V.picked.length < 2;
  $('#b-clear').disabled = V.picked.length === 0;
}

/* ========================== くらべる ===================================== */
function openCmp() {
  if (V.picked.length < 2) return;
  const st = $('#cmp-stage');
  st.innerHTML = '';
  st.className = V.cmpLayout + (V.cmpFill ? ' fill' : '');
  if (V.cmpLayout === 'grid') {
    st.style.gridTemplateColumns = V.picked.length <= 4 ? '1fr 1fr' : '1fr 1fr 1fr';
  } else st.style.gridTemplateColumns = '';

  V.picked.forEach((id, n) => {
    const it = V.items.find(i => i.id === id);
    if (!it) return;
    const img = D.images[it.imageId];
    const cell = document.createElement('div');
    cell.className = 'cell';
    const im = document.createElement('img');
    im.src = img ? img.file : '';
    im.style.setProperty('--dl', (n * 70) + 'ms');
    cell.appendChild(im);
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = String(n + 1).padStart(2, '0') + (img ? '  ' + img.w + '×' + img.h : '');
    cell.appendChild(tag);
    if (it.note) {
      const c = document.createElement('div'); c.className = 'cap'; c.textContent = it.note;
      cell.appendChild(c);
    }
    cellZoom(cell, im);
    st.appendChild(cell);
  });
  $$('#cmp-bar .lay').forEach(b => b.classList.toggle('on', b.dataset.lay === V.cmpLayout));
  $('#cmp-fill').classList.toggle('on', V.cmpFill);
  $('#cmp').hidden = false;
}
function closeCmp() { $('#cmp').hidden = true; $('#cmp-stage').innerHTML = ''; }

/* セルごとに独立ズーム（ホイール＋ドラッグ） */
function cellZoom(cell, img) {
  const s = { x: 0, y: 0, k: 1 };
  const apply = () => img.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px) scale(' + s.k + ')';
  let d = null;
  cell.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cell.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const wx = (cx - s.x) / s.k, wy = (cy - s.y) / s.k;
    const k = clamp(s.k * (e.deltaY < 0 ? 1.16 : 1 / 1.16), 1, 10);
    s.k = k; s.x = cx - wx * k; s.y = cy - wy * k;
    if (k === 1) { s.x = 0; s.y = 0; }
    apply();
  }, { passive: false });
  cell.addEventListener('pointerdown', (e) => {
    if (s.k <= 1) return;
    cell.setPointerCapture(e.pointerId);
    d = { x0: s.x, y0: s.y, sx: e.clientX, sy: e.clientY };
  });
  cell.addEventListener('pointermove', (e) => {
    if (!d) return;
    s.x = d.x0 + (e.clientX - d.sx); s.y = d.y0 + (e.clientY - d.sy);
    apply();
  });
  cell.addEventListener('pointerup', () => { d = null; });
  cell.addEventListener('dblclick', () => { s.x = 0; s.y = 0; s.k = 1; apply(); });
}

/* ========================== 1枚 ========================================= */
function openSolo(id) {
  const it = V.items.find(i => i.id === id);
  if (!it) return;
  const img = D.images[it.imageId];
  $('#solo-img').src = img ? img.file : '';
  const bits = [];
  if (img) bits.push(img.w + ' × ' + img.h);
  if (it.note) bits.push(it.note);
  if (img && img.srcUrl) { try { bits.push(new URL(img.srcUrl).hostname); } catch (e) { } }
  $('#solo-meta').textContent = bits.join('   ·   ');
  $('#solo').hidden = false;
}

/* ========================== 印刷 ========================================= */
const PAPER = {
  a4p: { w: 210, h: 297, orient: 'portrait', cols: 3 },
  a4l: { w: 297, h: 210, orient: 'landscape', cols: 4 },
};
const MARGIN = 10;

function pageStyle(paper) {
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
  st.textContent = '@page{size:A4 ' + PAPER[paper].orient + ';margin:' + MARGIN + 'mm}';
}

function printItems() {
  const src = V.print.scope === 'picked' && V.picked.length
    ? V.picked.map(id => V.items.find(i => i.id === id)).filter(Boolean)
    : V.items;
  return src;
}

function sheetHead(title, sub) {
  const h = document.createElement('div');
  h.className = 'sheet-head';
  const t = document.createElement('h3'); t.textContent = title;
  const s = document.createElement('span'); s.textContent = sub;
  h.append(t, s);
  return h;
}

function buildPrint() {
  const P = PAPER[V.print.paper];
  const availW = P.w - MARGIN * 2;
  const availH = P.h - MARGIN * 2;
  const headH = 12;
  const withNote = V.print.note === 'on';
  const board = D.boards.find(b => b.id === V.boardId);
  const bname = board ? board.name : 'MOOD BOARD';
  const stamp = (D.exportedAt || '').slice(0, 10);
  const items = printItems();
  const paper = $('#paper');
  paper.innerHTML = '';
  pageStyle(V.print.paper);
  if (!items.length) return 0;

  const imgOf = (it) => D.images[it.imageId];

  if (V.print.mode === 'board') {
    // ボードの配置をそのまま1枚に落とし込む
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    items.forEach(it => {
      x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
      x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
    });
    const bw = x2 - x1, bh = y2 - y1;
    const bodyH = availH - headH;
    const sc = Math.min(availW / bw, bodyH / bh);
    const offX = (availW - bw * sc) / 2;
    const offY = (bodyH - bh * sc) / 2;

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.appendChild(sheetHead(bname, items.length + ' photos   ' + stamp));
    const holder = document.createElement('div');
    holder.className = 'p-board';
    holder.style.height = bodyH + 'mm';
    items.forEach(it => {
      const im = imgOf(it);
      const d = document.createElement('div');
      d.className = 'pi';
      d.style.left = (offX + (it.x - x1) * sc) + 'mm';
      d.style.top = (offY + (it.y - y1) * sc) + 'mm';
      d.style.width = (it.w * sc) + 'mm';
      d.style.height = (it.h * sc) + 'mm';
      const g = document.createElement('img');
      g.src = im ? im.file : '';
      d.appendChild(g);
      holder.appendChild(d);
    });
    sheet.appendChild(holder);
    paper.appendChild(sheet);
    return 1;
  }

  if (V.print.mode === 'one') {
    items.forEach((it, n) => {
      const im = imgOf(it);
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      sheet.appendChild(sheetHead(bname, (n + 1) + ' / ' + items.length));
      const d = document.createElement('div');
      d.className = 'p-one';
      const g = document.createElement('img');
      g.src = im ? im.file : '';
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

  // grid: 行を組んで、用紙の高さで折り返す
  const cols = PAPER[V.print.paper].cols;
  const gap = 4;
  const cellW = (availW - gap * (cols - 1)) / cols;
  const rows = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  const rowH = (row) => {
    let m = 0;
    row.forEach(it => { m = Math.max(m, cellW * (it.h / it.w)); });
    return m + (withNote && row.some(i => i.note) ? 6 : 0);
  };

  let sheet = null, used = 0, holder = null, page = 0;
  const newSheet = () => {
    page++;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.appendChild(sheetHead(bname, items.length + ' photos   ' + stamp));
    holder = document.createElement('div');
    holder.className = 'p-grid';
    holder.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
    sheet.appendChild(holder);
    paper.appendChild(sheet);
    used = headH;
  };
  newSheet();
  for (const row of rows) {
    const h = rowH(row) + gap;
    if (used + h > availH && used > headH) newSheet();
    used += h;
    row.forEach(it => {
      const im = imgOf(it);
      const d = document.createElement('div');
      d.className = 'pi';
      const g = document.createElement('img');
      g.src = im ? im.file : '';
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
  if (!pages) return;
  // 画像の読み込みを待ってから印刷ダイアログを出す
  const imgs = Array.from($('#paper').querySelectorAll('img'));
  const ready = imgs.map(i => i.complete ? Promise.resolve()
    : new Promise(r => { i.onload = i.onerror = r; }));
  Promise.all(ready).then(() => setTimeout(() => window.print(), 60));
}

/* ========================== 配線 ========================================= */
$('#b-fit').onclick = () => fit();
$('#b-arrange').onclick = arrange;
$('#b-color').onclick = arrangeColor;
$('#b-compare').onclick = openCmp;
$('#b-clear').onclick = clearPick;
$('#b-print').onclick = () => { suggestPaper(); syncPc(); $('#printcfg').hidden = false; };
$('#cmp-close').onclick = closeCmp;
$('#cmp-fill').onclick = () => { V.cmpFill = !V.cmpFill; openCmp(); };
$('#cmp-print').onclick = () => { V.print.scope = 'picked'; suggestPaper(); syncPc(); $('#printcfg').hidden = false; };
$$('#cmp-bar .lay').forEach(b => b.onclick = () => { V.cmpLayout = b.dataset.lay; openCmp(); });
$('#solo-close').onclick = () => { $('#solo').hidden = true; };
$('#solo').onclick = (e) => { if (e.target.id === 'solo') $('#solo').hidden = true; };

/* ボードが横長なら A4よこ を先に出す */
let paperTouched = false;
function suggestPaper() {
  if (paperTouched) return;
  const items = printItems();
  if (!items.length) return;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  items.forEach(it => {
    x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
    x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
  });
  V.print.paper = ((x2 - x1) / Math.max(1, y2 - y1)) > 1.15 ? 'a4l' : 'a4p';
}

function syncPc() {
  [['#pc-mode', 'mode'], ['#pc-paper', 'paper'], ['#pc-scope', 'scope'], ['#pc-note', 'note']]
    .forEach(([sel, key]) => {
      $$(sel + ' .b').forEach(b => b.classList.toggle('on', b.dataset.v === V.print[key]));
    });
  $$('#pc-scope .b').forEach(b => {
    if (b.dataset.v === 'picked') b.disabled = V.picked.length === 0;
  });
}
[['#pc-mode', 'mode'], ['#pc-paper', 'paper'], ['#pc-scope', 'scope'], ['#pc-note', 'note']]
  .forEach(([sel, key]) => {
    $$(sel + ' .b').forEach(b => b.onclick = () => {
      V.print[key] = b.dataset.v;
      if (key === 'paper') paperTouched = true;
      syncPc();
    });
  });
$('#pc-cancel').onclick = () => { $('#printcfg').hidden = true; };
$('#pc-go').onclick = () => { $('#printcfg').hidden = true; doPrint(); };

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#solo').hidden) return void ($('#solo').hidden = true);
    if (!$('#printcfg').hidden) return void ($('#printcfg').hidden = true);
    if (!$('#cmp').hidden) return closeCmp();
    return clearPick();
  }
  const k = e.key.toLowerCase();
  if (k === 'f') fit();
  if (k === 'a') arrange();
  if (k === 's') arrangeColor();
  if (k === 'c' && V.picked.length >= 2) openCmp();
  if (k === 'p') { e.preventDefault(); suggestPaper(); syncPc(); $('#printcfg').hidden = false; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const i = D.boards.findIndex(b => b.id === V.boardId);
    if (D.boards.length > 1) openBoard(D.boards[(i + (e.shiftKey ? -1 : 1) + D.boards.length) % D.boards.length].id);
  }
});

window.addEventListener('resize', () => { if (V.items.length) fit(true); });
window.addEventListener('afterprint', () => { $('#paper').innerHTML = ''; });

/* ========================== 起動 ========================================= */
(function init() {
  if (!D.boards.length) {
    $('#hud-title').textContent = 'MOOD BOARD — 中身がありません';
    $('#boot').hidden = true;
    return;
  }
  buildTabs();
  openBoard(D.boards[0].id);
  syncPc();
  setTimeout(() => { const b = $('#boot'); if (b) b.remove(); }, 1400);
})();
