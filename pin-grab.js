/* ==========================================================================
   MOOD BOARD — Pinterest まとめて持ち出し
   Pinterestのボードを開いた状態で、Chromeの Console にこれを貼って Enter。
   自動で最後までスクロールしながら画像を集め、縮小して1つのZIPにまとめます。
   出来たZIPを MOOD BOARD の「ZIPから読み込む」に入れれば、ボードごと復元されます。
   ※ 画像の取得はPinterestのページ上でだけ許可されているため、この手順が必要です。
   ========================================================================== */
(async () => {
  if (!/pinterest\./.test(location.hostname)) {
    alert('Pinterestのボードを開いた状態で実行してください');
    return;
  }
  const MAX_EDGE = 1800, QUALITY = 0.84, PARALLEL = 4;

  /* ---------- 進捗表示 ---------- */
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;z-index:2147483647;right:18px;bottom:18px;width:290px;' +
    'background:#111116;color:#ececed;border:1px solid #2c2c32;border-radius:12px;padding:16px;' +
    'font:13px/1.6 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;' +
    'box-shadow:0 10px 40px rgba(0,0,0,.5)';
  ui.innerHTML =
    '<div style="font-weight:600;letter-spacing:.14em;font-size:11px;margin-bottom:10px">MOOD BOARD</div>' +
    '<div id="mbg-msg">準備中…</div>' +
    '<div style="height:3px;background:#26262c;border-radius:2px;margin:10px 0 8px;overflow:hidden">' +
    '<div id="mbg-bar" style="height:100%;width:0;background:#ff5a36;transition:width .2s"></div></div>' +
    '<div id="mbg-sub" style="font-size:11px;color:#8b8b93"></div>' +
    '<button id="mbg-stop" style="margin-top:12px;width:100%;padding:8px;border:1px solid #2c2c32;' +
    'background:#1e1e22;color:#ececed;border-radius:8px;cursor:pointer;font:inherit">中止して、ここまでを保存</button>';
  document.body.appendChild(ui);
  const msg = ui.querySelector('#mbg-msg');
  const bar = ui.querySelector('#mbg-bar');
  const sub = ui.querySelector('#mbg-sub');
  let stopped = false;
  ui.querySelector('#mbg-stop').onclick = () => { stopped = true; msg.textContent = '止めています…'; };

  /* ---------- 1) スクロールしながらURLを集める ----------
     ページ上の <img> を全部拾うと、ボードの下に出る「他のアイデア（おすすめ）」まで
     一緒に取り込んでしまう。自分が保存したピンだけに絞るため、3つの条件で守る。
       ① ピンのリンク（/pin/…）の中にある画像だけを見る（アバターやUIの画像を除く）
       ② 「他のアイデア」の見出しより下にあるものは無視する
       ③ ボードに表示されている件数に達したら、そこで打ち切る
  */
  const STOP_WORDS = /他のアイデア|関連(する)?(ピン|アイデア)|おすすめ|さらに表示|More (ideas|like this)|Related|You might also like/i;

  // ②のための「ここから下はおすすめ」という境目を探す
  const findStopNode = () => {
    const cands = document.querySelectorAll('h1,h2,h3,h4,[role="heading"]');
    for (const h of cands) {
      const t = (h.textContent || '').trim();
      if (t && t.length < 40 && STOP_WORDS.test(t)) return h;
    }
    return null;
  };

  // ③ ボードが「ピン：167件」と出しているので、その数を上限にする
  const declaredCount = (() => {
    const t = document.body.innerText || '';
    const m = t.match(/ピン[\s:：]*([\d,]+)\s*件/) || t.match(/([\d,]+)\s*(?:件のピン|pins?)\b/i);
    const n = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const urls = new Set();
  const grab = () => {
    const stop = findStopNode();
    document.querySelectorAll('a[href^="/pin/"] img, a[href*="/pin/"] img').forEach(img => {
      // ② おすすめの見出しより後ろに現れたものは取らない
      if (stop && (stop.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      let best = img.currentSrc || img.src || '';
      if (img.srcset) {
        let bw = 0;
        img.srcset.split(',').forEach(s => {
          const p = s.trim().split(/\s+/);
          const n = parseFloat(p[1]) || 1;
          if (n >= bw) { bw = n; best = p[0]; }
        });
      }
      if (/i\.pinimg\.com/.test(best) && !/\/(30x30|60x60|75x75|140x140)\//.test(best)) urls.add(best);
    });
  };

  msg.textContent = '写真をさがしています';
  sub.textContent = declaredCount ? ('このボードのピン ' + declaredCount + ' 件') : '';
  let lastH = 0, same = 0;
  while (same < 4 && !stopped) {
    grab();
    sub.textContent = urls.size + ' 枚みつかりました'
      + (declaredCount ? '（ボードのピン ' + declaredCount + ' 件）' : '');
    // ③ ボードの件数に届いたら、そこから下は「おすすめ」なので打ち切る
    if (declaredCount && urls.size >= declaredCount) break;
    window.scrollBy(0, window.innerHeight * 0.9);
    await new Promise(r => setTimeout(r, 850));
    if (document.body.scrollHeight === lastH) same++;
    else { same = 0; lastH = document.body.scrollHeight; }
  }
  grab();
  let list = [...urls];
  // 念のため、件数を超えて拾っていたら先頭から件数ぶんだけ残す（DOMに現れた順＝ボードの並び順）
  let trimmed = 0;
  if (declaredCount && list.length > declaredCount) {
    trimmed = list.length - declaredCount;
    list = list.slice(0, declaredCount);
  }
  if (!list.length) { msg.textContent = '写真が見つかりませんでした'; return; }

  /* ---------- 2) 取得して縮小する ---------- */
  const canWebp = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  const TYPE = canWebp ? 'image/webp' : 'image/jpeg';
  const EXT = canWebp ? 'webp' : 'jpg';

  async function shrink(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise(r => c.toBlob(r, TYPE, QUALITY));
    const dim = { w: bmp.width, h: bmp.height };
    bmp.close && bmp.close();
    return { blob: out, ...dim };
  }

  const got = [];
  let done = 0, failed = 0;
  msg.textContent = '写真を集めています';

  async function worker(queue) {
    while (queue.length && !stopped) {
      const url = queue.pop();
      try {
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) throw 0;
        const raw = await res.blob();
        const s = await shrink(raw);
        got.push({ url, blob: s.blob, w: s.w, h: s.h });
      } catch (e) { failed++; }
      done++;
      bar.style.width = (done / list.length * 100).toFixed(1) + '%';
      sub.textContent = done + ' / ' + list.length + '　（失敗 ' + failed + '）';
    }
  }
  const queue = list.slice().reverse();
  await Promise.all(Array.from({ length: PARALLEL }, () => worker(queue)));
  if (!got.length) { msg.textContent = '1枚も取得できませんでした'; return; }

  /* ---------- 3) MOOD BOARD が読めるZIPに詰める ---------- */
  msg.textContent = 'まとめています';
  sub.textContent = got.length + ' 枚';

  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c >>> 0; }
    return t;
  })();
  const crc32 = (u8) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const te = new TextEncoder();
  function makeZip(entries) {
    const chunks = [], central = [];
    let offset = 0;
    for (const en of entries) {
      const nameB = te.encode(en.name), crc = crc32(en.data), size = en.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, nameB.length, true);
      chunks.push(new Uint8Array(lh.buffer), nameB, en.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + size;
    }
    let cdSize = 0;
    central.forEach(c => cdSize += c.length);
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true);
    eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
    eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(eo.buffer)], { type: 'application/zip' });
  }

  const uid = () => crypto.randomUUID();
  const now = new Date().toISOString();
  // ボード名は URL から取るのが一番あてになる（/ユーザー名/ボード名/）
  let boardName = '';
  const seg = location.pathname.split('/').filter(Boolean);
  if (seg.length >= 2 && !['search', 'pin', 'ideas', 'today'].includes(seg[0])) {
    boardName = decodeURIComponent(seg[1]).replace(/[-_]+/g, ' ').trim();
  }
  if (!boardName) {
    const h1 = document.querySelector('h1');
    boardName = (h1 && h1.textContent.trim()) || document.title.split(/[|｜]/)[0].trim() || 'Pinterest';
  }
  boardName = boardName.slice(0, 40);
  const boardId = uid();

  // 石積みに並べる
  const BASE = 260, GAP = 22;
  const cols = Math.max(2, Math.min(6, Math.round(Math.sqrt(got.length * 0.9))));
  const hs = new Array(cols).fill(0);

  const entries = [], images = [], items = [];
  for (let i = 0; i < got.length; i++) {
    const g = got[i];
    const id = uid();
    const name = 'images/' + id + '.' + EXT;
    entries.push({ name, data: new Uint8Array(await g.blob.arrayBuffer()) });
    images.push({ id, w: g.w, h: g.h, srcUrl: g.url, addedAt: now, file: name, type: TYPE });
    const c = hs.indexOf(Math.min(...hs));
    const ih = Math.round(BASE * g.h / g.w);
    items.push({
      id: uid(), boardId, imageId: id,
      x: c * (BASE + GAP), y: hs[c], w: BASE, h: ih, z: i, note: '', addedAt: now,
    });
    hs[c] += ih + GAP;
    if (i % 10 === 9) { sub.textContent = 'まとめています ' + (i + 1) + ' / ' + got.length; await new Promise(r => setTimeout(r, 0)); }
  }
  const meta = {
    app: 'MOOD BOARD', version: 1, exportedAt: now,
    boards: [{ id: boardId, name: boardName, createdAt: now, updatedAt: now }],
    items, images,
  };
  entries.unshift({ name: 'moodboard.json', data: te.encode(JSON.stringify(meta)) });

  const zip = makeZip(entries);
  const mb = (zip.size / 1048576).toFixed(1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = 'moodboard-pinterest-' + boardName.replace(/[\/\\:*?"<>|\s]/g, '_') + '.zip';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 8000);

  bar.style.width = '100%';
  msg.innerHTML = '<b>' + got.length + ' 枚 まとめました</b>';
  sub.innerHTML = mb + ' MB のZIPを保存しました。<br>MOOD BOARD の「ZIPから読み込む」に入れてください。'
    + (declaredCount ? '<br>このボードのピンは ' + declaredCount + ' 件です' : '')
    + (trimmed ? '<br>おすすめと思われる ' + trimmed + ' 枚は除きました' : '')
    + (failed ? '<br>（' + failed + ' 枚は取得できませんでした）' : '');
  ui.querySelector('#mbg-stop').textContent = '閉じる';
  ui.querySelector('#mbg-stop').onclick = () => ui.remove();
  console.log('%cMOOD BOARD: ' + got.length + ' 枚を ' + mb + ' MB のZIPにまとめました',
    'font-size:15px;color:#4ad991');
})();
