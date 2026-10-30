/* ==========================================================================
   MOOD BOARD — Pinterest まとめて持ち出し
   Pinterestのボードを開いた状態で、Chromeの Console にこれを貼って Enter。
   自動で最後までスクロールしながら画像を集め、縮小して1つのZIPにまとめます。
   出来たZIPを MOOD BOARD の「ZIPから読み込む」に入れれば、ボードごと復元されます。
   ※ 画像の取得はPinterestのページ上でだけ許可されているため、この手順が必要です。

   2026-10-26 作り直し（「ボードの全部が取れない」への対策）
   ・セクションのあるボードは、ボードを開いた画面にセクションの中のピンが出ない。
     → セクションも1つずつ開いて集め、MOOD BOARD では「区分け」としてまとめる
   ・スクロールしているのが画面全体とは限らない → いちばんピンを抱えている箱を探してスクロールする
   ・終わりの判断を「ページの高さが変わらない」から「新しいピンが増えなくなった」に変えた
     （下の「おすすめ」が無限に続くと、高さが変わり続けて終わらなかった）
   ・「おすすめ」の見出しは、ピンより下にあって、タブやボタンの中ではないものだけを境目にする
   ・最後に「ボードのピン◯件・取れた◯枚（本体◯・セクション◯）」と内訳を出す

   2026-10-27（本人「まだ全部取れない。ほかのアプリを動かすからかな」）
   ・ほかのアプリやタブに切り替えて Chrome の画面が隠れると、Chrome はページを止め、Pinterest は続きを読まなくなる。
     それを「最後まで来た」と取り違えて途中で終わっていた → 隠れている間は待ち、画面に戻ったら続きから集める
   ・集めている間は「触らないでください」の札を出し、ピンを押してほかの画面へ行かないよう、クリックを受け止める
   ・画面が眠らないようにする（Wake Lock）。タブの題名に進み具合・止まっていること・できたことを出す
   ・件数に届いていないうちは、粘ってから終える
   ・途中までの分をこのページ（Pinterest 側）に覚えておき、もう一度実行すると前回の分と合わせる（3日間）

   2026-10-30（本人「まだ全部取れない」）
   ・Pinterest の画像は、大きさ（originals・736x…）と拡張子（.jpg・.png）の組み合わせによって「ある・無い（403）」が写真ごとに違う。
     これまでは1枚につき1つのURLしか試さず、無ければ捨てていた → 大きい順に別の大きさ・拡張子も試す。通信の失敗はもう一度
   ・同じ写真の .png と .jpg を別の写真と数え、件数に届いたと思って早く終わることがあった → 拡張子を除いた名前で1枚と数える
   ・動画のピンの表紙（video の poster）も拾う
   ・件数に足りないまま終わりそうなら、上からもう一度ゆっくり見直す
   ・最後に「取れなかった理由」を出す。小さい画像しか無かった写真の数も
   ========================================================================== */
(async () => {
  // 動作確認用（Pinterestに似せた偽のページで試すとき）。ふだんは使わない
  const T = window.__MB_PIN_TEST || null;
  if (!T && !/pinterest\./.test(location.hostname)) {
    alert('Pinterestのボードを開いた状態で実行してください');
    return;
  }
  if (window.__mbGrabRunning) { alert('MOOD BOARD：もう集めています。右下の進み具合をご覧ください'); return; }
  window.__mbGrabRunning = true;
  const MAX_EDGE = 1800, QUALITY = 0.84, PARALLEL = 4;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const title0 = document.title;
  const setTitle = (t) => { document.title = t + '｜MOOD BOARD'; };

  /* ---------- 進捗表示 ---------- */
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;z-index:2147483647;right:18px;bottom:18px;width:300px;' +
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

  /* ---------- 「触らないでください」の札と、クリックよけ ----------
     画面いっぱいの透明な板でクリックとスクロールを受け止める（ピンを押すと別の画面へ移って、集めるのが止まるため）。
     進み具合の箱は板より上にあるので、「中止」は押せる */
  const shield = document.createElement('div');
  shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(10,10,14,.08);cursor:wait';
  shield.innerHTML =
    '<div id="mbg-sign" style="position:absolute;left:50%;top:18px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));' +
    'background:#ff5a36;color:#fff;border-radius:14px;padding:14px 20px;box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center;' +
    'font:14px/1.55 -apple-system,BlinkMacSystemFont,\'Hiragino Sans\',sans-serif">' +
    '<div id="mbg-sign-h" style="font-size:18px;font-weight:700;letter-spacing:.04em">✋ 集めています。触らないでください</div>' +
    '<div id="mbg-sign-s" style="margin-top:4px;opacity:.92">終わるまで、この画面を前に出したままにしてください。<br>' +
    'ほかのアプリやタブに切り替えると止まります（戻れば続きから集めます）</div></div>';
  ['wheel', 'touchmove'].forEach(t => shield.addEventListener(t, e => e.preventDefault(), { passive: false }));
  shield.addEventListener('click', () => { sign.animate([{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.06)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 260 }); });
  document.body.insertBefore(shield, ui);
  const sign = shield.querySelector('#mbg-sign');
  const signText = (h, s, bg) => { shield.querySelector('#mbg-sign-h').textContent = h; shield.querySelector('#mbg-sign-s').innerHTML = s; sign.style.background = bg || '#ff5a36'; };

  // ページを閉じる・再読み込みしようとしたら、確かめてもらう（集めた分が消えるため）
  const leaveGuard = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', leaveGuard);

  // 集め終わり（うまくいっても、いかなくても）：札・クリックよけ・確かめ・眠らない を外す
  function finish() {
    shield.remove();
    window.removeEventListener('beforeunload', leaveGuard);
    if (wake) { try { wake.release(); } catch (e) { } wake = null; }
    window.__mbGrabRunning = false;
  }
  // とちゅうで思わぬことが起きたとき（下の catch から呼ぶ）。札を外して、ここまでの分は次に合わせられると伝える
  window.__mbGrabFail = (e) => {
    finish();
    msg.textContent = 'とちゅうで止まりました（' + ((e && e.message) || e) + '）';
    sub.textContent = 'このページのまま、もう一度コードを貼って Enter すると、ここまでの分と合わせて集め直します';
    const b = ui.querySelector('#mbg-stop');
    b.textContent = '閉じる'; b.onclick = () => { ui.remove(); document.title = title0; };
  };

  // 画面が眠ると、隠れたのと同じで止まる。集めている間は眠らないようにする（できる Chrome だけ）
  let wake = null;
  async function keepAwake() {
    try {
      if (!wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      }
    } catch (e) { /* できなくても集めるのは続ける */ }
  }
  keepAwake();

  /* ---------- 画面が隠れている間は待つ ----------
     Chrome は隠れたページを止める（Pinterest は続きを読まない・こちらの待ち時間も伸びる）。
     隠れている間の「増えない」を数えると途中で終わってしまうので、戻るまで待つ */
  const isHidden = () => document.visibilityState === 'hidden';
  let pauses = 0, progressTitle = '集めています';
  async function whileHidden() {
    if (!isHidden()) return false;
    pauses++;
    setTitle('⏸ 止まっています');
    signText('⏸ 止まっています', 'この画面に戻ったので、続きから集めます。<br>終わるまで、ほかのアプリやタブに切り替えないでください', '#c2410c');
    await new Promise(r => {
      const f = () => { if (!isHidden()) { document.removeEventListener('visibilitychange', f); r(); } };
      document.addEventListener('visibilitychange', f);
    });
    await sleep(1500);                    // 戻った直後は、Pinterest がまだ描き直していない
    keepAwake();
    setTitle(progressTitle);
    setTimeout(() => { if (!isHidden()) signText('✋ 集めています。触らないでください', '終わるまで、この画面を前に出したままにしてください。<br>ほかのアプリやタブに切り替えると止まります（戻れば続きから集めます）'); }, 2500);
    return true;
  }
  setTitle(progressTitle);

  /* ---------- 前回の分（同じボードを、3日以内にもう一度実行したとき） ---------- */
  const SAVE_KEY = 'mbgrab:' + location.pathname + location.search;
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { prev = null; }
  if (!prev || !prev.groups || Date.now() - (prev.t || 0) > 3 * 864e5) prev = null;
  const prevUrls = (name) => { const g = prev && prev.groups.find(x => x.name === name); return g ? g.urls : []; };
  const saveProgress = (groups) => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ t: Date.now(), groups: groups.map(g => ({ name: g.name, urls: g.urls.map(p => asPick(p)[0]) })) })); } catch (e) { }
  };
  // 同じ写真の大きさ違い（236x・736x・originals）を1つに数えるための名前（URLの最後のファイル名）
  // 拡張子も除く（originals は .png、736x は .jpg のように、同じ写真でも拡張子が違うことがある）
  const picKey = (u) => { try { return (new URL(u).pathname.split('/').pop() || u).replace(/\.(jpe?g|png|gif|webp|avif)$/i, ''); } catch (e) { return u; } };
  // 1枚の写真は「候補のURLの並び（大きい順）」で持つ。前回の分（URLだけ）もそのまま混ぜられる
  const asPick = (p) => Array.isArray(p) ? p : [p];
  const mergeUrls = (a, b) => { const seen = new Set(), out = []; for (const p of [...a, ...b].map(asPick)) { const k = picKey(p[0]); if (!seen.has(k)) { seen.add(k); out.push(p); } } return out; };

  /* ---------- 見つけ方 ---------- */
  const STOP_WORDS = /他のアイデア|関連(する)?(ピン|アイデア)|おすすめ|さらに表示|アイデアをもっと|似(ている|た)(ピン|アイデア)|もっと見つける|More (ideas|like this|to explore)|Find (more|some) ideas|Explore more|Related|You might also like/i;
  const isPinImg = (u) => T ? T.isImg(u)
    : (/i\.pinimg\.com/.test(u) && !/\/(30x30|60x60|75x75|140x140)\//.test(u));

  // 画像のURLの候補を大きい順に（srcset の全部と、いま出ているもの）。いちばん上が無くても、次を試せるように
  const srcCands = (img) => {
    const list = [];
    if (img.srcset) img.srcset.split(',').forEach(s => {
      const p = s.trim().split(/\s+/);
      if (p[0]) list.push({ u: p[0], n: parseFloat(p[1]) || 1 });
    });
    list.sort((a, b) => b.n - a.n);
    const out = list.map(x => x.u);
    for (const u of [img.currentSrc, img.src]) if (u && !out.includes(u)) out.push(u);
    return out;
  };

  // スクロールしている箱を探す。画面全体とは限らないので、ピンをいちばん多く抱えている箱を選ぶ
  function findScroller(doc, win) {
    const root = doc.scrollingElement || doc.documentElement;
    let best = root, bestN = doc.querySelectorAll('a[href*="/pin/"]').length ? 0 : -1;
    const rootScrolls = root.scrollHeight > win.innerHeight + 50;
    if (rootScrolls) bestN = doc.querySelectorAll('a[href*="/pin/"]').length;
    doc.querySelectorAll('div,main,section').forEach(el => {
      if (el.clientHeight < win.innerHeight * 0.4 || el.scrollHeight <= el.clientHeight + 50) return;
      const oy = win.getComputedStyle(el).overflowY;
      if (!/(auto|scroll)/.test(oy)) return;
      const n = el.querySelectorAll('a[href*="/pin/"]').length;
      if (n > bestN) { best = el; bestN = n; }
    });
    return best;
  }

  // ボードに書かれている件数（「167 ピン」「ピン：167件」「167 Pins」）。見出しの近くだけを見る
  function readDeclared(doc) {
    if (T && T.declared) return T.declared(doc);
    const h1 = doc.querySelector('h1');
    let box = h1;
    for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
      const t = (box.innerText || '').slice(0, 600);
      const n = countIn(t);
      if (n > 0) return n;
    }
    return 0;
  }

  // 「60 ピン」「60 Pins」のような件数を読む
  const countIn = (t) => {
    const m = (t || '').match(/ピン[\s:：]*([\d,]+)\s*件/) || (t || '').match(/([\d,]+)\s*(?:件の)?\s*ピン/) || (t || '').match(/([\d,]+)\s*pins?\b/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) || 0 : 0;
  };

  // ボードのセクション（/ユーザー/ボード/セクション/）へのリンク。カードに出ている件数も読む
  function sectionLinks(doc) {
    let anchors;
    if (T) anchors = T.sectionAnchors(doc);
    else {
      const seg = location.pathname.split('/').filter(Boolean);
      if (seg.length !== 2 || ['search', 'pin', 'ideas', 'today'].includes(seg[0])) return [];
      const base = '/' + seg[0] + '/' + seg[1] + '/';
      anchors = [...doc.querySelectorAll('a[href]')].filter(a => {
        let p;
        try { p = new URL(a.getAttribute('href'), location.href).pathname; } catch (e) { return false; }
        if (!p.startsWith(base)) return false;
        const rest = p.slice(base.length).split('/').filter(Boolean);
        return rest.length === 1 && !rest[0].startsWith('_') && !/^(pins|more_ideas|organize|sections?|followers)$/i.test(rest[0]);
      });
    }
    const out = new Map();
    anchors.forEach(a => {
      const url = new URL(a.getAttribute('href'), location.href);
      if (out.has(url.href)) return;
      const t = (a.innerText || '').trim();
      const name = (t.split('\n')[0] || decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ')).slice(0, 40);
      out.set(url.href, { url: url.href, name, count: countIn(t) });
    });
    return [...out.values()];
  }

  /* ---------- 1つのページから、そのボード（またはセクション）のピンを集める ---------- */
  async function collect(doc, win, label, declared, gname) {
    // 始めた瞬間はまだページが短く、どの箱もスクロールしていないことがある。増えなくなったら探し直す
    let scroller = findScroller(doc, win);
    let isRoot = scroller === (doc.scrollingElement || doc.documentElement);
    const refind = () => { scroller = findScroller(doc, win); isRoot = scroller === (doc.scrollingElement || doc.documentElement); };
    const viewH = () => isRoot ? win.innerHeight : scroller.clientHeight;
    const top = () => isRoot ? win.scrollY : scroller.scrollTop;
    const scrollerTop = () => isRoot ? 0 : scroller.getBoundingClientRect().top;
    const yOf = (el) => el.getBoundingClientRect().top - scrollerTop() + top();   // 箱の中での縦位置
    const atBottom = () => top() + viewH() >= scroller.scrollHeight - 6;
    const scrollTo = (y) => isRoot ? win.scrollTo(0, y) : (scroller.scrollTop = y);

    const urls = new Map();       // 写真の名前 → 候補のURL（大きい順）
    const addPick = (cands) => {
      const k = picKey(cands[0]);
      const cur = urls.get(k);
      if (!cur) urls.set(k, cands.slice());
      else cands.forEach(u => { if (!cur.includes(u)) cur.push(u); });
    };
    let stopY = null, firstPinY = null;

    const findStopY = () => {
      if (firstPinY == null) return null;
      let y = null;
      doc.querySelectorAll('h1,h2,h3,h4,[role="heading"]').forEach(h => {
        const t = (h.textContent || '').trim();
        if (!t || t.length > 40 || !STOP_WORDS.test(t)) return;
        if (h.closest('[role="tablist"],[role="tab"],nav,header,button,a')) return;   // タブやボタンは境目にしない
        const hy = yOf(h);
        if (hy <= firstPinY) return;                                                   // ピンより上の見出しは境目にしない
        if (y == null || hy < y) y = hy;
      });
      return y;
    };
    const grab = () => {
      const s = findStopY();
      if (s != null && (stopY == null || s < stopY)) stopY = s;
      // 動画のピンは img が無く、video の表紙（poster）だけのことがある
      doc.querySelectorAll('a[href*="/pin/"] img, a[href*="/pin/"] video[poster]').forEach(el => {
        const y = yOf(el);
        if (firstPinY == null || y < firstPinY) firstPinY = y;
        if (stopY != null && y > stopY) return;           // おすすめの見出しより下は取らない
        const cands = (el.tagName === 'VIDEO' ? [el.poster] : srcCands(el)).filter(u => u && isPinImg(u));
        if (cands.length) addPick(cands);
      });
    };

    let stall = 0, last = -1, rounds = 0, savedAt = 0;
    while (!stopped) {
      if (await whileHidden()) { stall = 0; refind(); }                        // 隠れていた間の「増えない」は数えない
      grab();
      // 途中で閉じてしまっても、もう一度実行したときに合わせられるよう、ときどき覚えておく
      if (gname != null && urls.size - savedAt >= 40) { savedAt = urls.size; saveProgress([...groups, { name: gname, urls: mergeUrls([...urls.values()], prevUrls(gname)) }]); }
      sub.textContent = label + '：' + urls.size + ' 枚みつかりました' + (declared ? '（ボードのピン ' + declared + ' 件）' : '') + (prev ? '・前回の分と合わせます' : '');
      progressTitle = '集めています ' + urls.size + (declared ? ' / ' + declared : '');
      setTitle(progressTitle);
      if (declared && urls.size >= declared) break;                              // 件数に届いた
      if (stopY != null && top() + viewH() > stopY + viewH()) break;            // おすすめの中に入った
      if (urls.size > last) { last = urls.size; stall = 0; } else if (!isHidden()) stall++;
      if (stall === 2 || stall === 5 || stall === 12) refind();
      const patient = declared && urls.size < declared ? 2 : 1;                 // 件数に届いていないうちは粘る
      if (atBottom()) {
        if (stall >= 6 * patient) break;                                         // 下まで来て、もう増えない
        scrollTo(Math.max(0, top() - viewH() * (stall > 6 ? 1.5 : 0.5)));       // 少し戻して、読み込みを促す
        await sleep(500);
        scrollTo(scroller.scrollHeight);
        await sleep(1400);
      } else {
        if (stall >= 25 * patient) break;                                        // 下へ進んでも増えない（無限のおすすめ等）
        scrollTo(top() + viewH() * 0.8);
        await sleep(850);
      }
      if (++rounds > 3000) break;
    }
    grab();
    // 件数に足りないまま終わりそうなら、上からもう一度ゆっくり見直す（速く流したときに、読み込みが間に合わなかった分を拾う）
    if (!stopped && declared && urls.size < declared) {
      const before = urls.size;
      sub.textContent = label + '：' + urls.size + ' / ' + declared + ' 枚。足りない分を見直しています…';
      scrollTo(0); await sleep(1500);
      for (let k = 0; k < 2000 && !stopped; k++) {
        if (await whileHidden()) refind();
        grab();
        if (urls.size >= declared) break;
        if (stopY != null && top() > stopY) break;
        if (atBottom()) { await sleep(1500); grab(); break; }
        scrollTo(top() + viewH() * 0.5);
        await sleep(1100);
      }
      console.log('MOOD BOARD: 見直しで ' + (urls.size - before) + ' 枚ふえました（' + label + '）');
    }
    return [...urls.values()];
  }

  /* ---------- セクションは、見えない枠の中で1つずつ開いて集める ---------- */
  async function collectInFrame(url, label, expected, gname) {
    const f = document.createElement('iframe');
    // sandbox: 枠の中から、この画面ごと別のページへ移動させない（集めた分が消えないように）
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    f.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:2147483646;background:#fff;opacity:.98';
    f.src = url;
    document.body.appendChild(f);
    await new Promise(r => { f.onload = r; setTimeout(r, 20000); });
    for (let i = 0; i < 40; i++) {                                               // ピンが出るまで待つ（最大20秒）
      const d = f.contentDocument;
      if (d && d.querySelectorAll('a[href*="/pin/"] img').length) break;
      await sleep(500);
    }
    let list = [];
    try { list = await collect(f.contentDocument, f.contentWindow, label, expected || 0, gname); } catch (e) { console.warn('MOOD BOARD:', label, e); }
    f.remove();
    return list;
  }

  /* ---------- 1) 集める ---------- */
  const declared = readDeclared(document);
  const sections = sectionLinks(document);
  msg.textContent = '写真をさがしています';
  // セクションがあるボードは、本体の画面にボードの全件が出ない。
  // セクションのカードの件数がわかれば「本体に何枚あるはずか」を引き算で出し、そこで打ち切る
  // （おすすめの見出しを見つけ損ねても、おすすめを拾わないための守り）
  const secKnown = sections.length && sections.every(x => x.count > 0) && declared > 0;
  const mainExpected = !sections.length ? declared
    : (secKnown ? Math.max(0, declared - sections.reduce((a, x) => a + x.count, 0)) : 0);
  const groups = [];
  if (prev) sub.textContent = '前回の ' + prev.groups.reduce((a, g) => a + g.urls.length, 0) + ' 枚と合わせて集めます';
  if (!(secKnown && mainExpected === 0)) {               // 全部セクションに入っているボードは本体を見ない
    const mainList = mergeUrls(await collect(document, window, sections.length ? 'ボード本体' : 'ボード', mainExpected, ''), prevUrls(''));
    groups.push({ name: '', urls: mainExpected ? mainList.slice(0, mainExpected) : mainList, expected: mainExpected });
    saveProgress(groups);
  }
  for (let i = 0; i < sections.length && !stopped; i++) {
    msg.textContent = 'セクションを開いています（' + (i + 1) + ' / ' + sections.length + '）';
    const x = sections[i];
    const l = mergeUrls(await collectInFrame(x.url, 'セクション「' + x.name + '」', x.count, x.name), prevUrls(x.name));
    groups.push({ name: x.name, urls: x.count ? l.slice(0, x.count) : l, expected: x.count });
    saveProgress(groups);
  }

  // 同じ写真は1回だけ（大きさ違いも1つ）。並びはボード → セクションの順
  const seen = new Set(), list = [];
  for (const g of groups) for (const p of g.urls.map(asPick)) { const k = picKey(p[0]); if (!seen.has(k)) { seen.add(k); list.push({ cands: p, url: p[0], section: g.name }); } }
  let trimmed = 0;
  if (!sections.length && declared && list.length > declared) { trimmed = list.length - declared; list.length = declared; }
  if (!list.length) { finish(); msg.textContent = '写真が見つかりませんでした'; sub.textContent = report(); return; }

  function report() {
    const parts = groups.map(g => (g.name ? '「' + g.name + '」' : 'ボード本体') + ' ' + g.urls.length);
    return (declared ? 'ボードのピン ' + declared + ' 件 ／ ' : '') + '見つけた ' + list.length + ' 枚'
      + (sections.length ? '（' + parts.join('・') + '）' : '');
  }

  /* ---------- 2) 取得して縮小する ---------- */
  const canWebp = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  const TYPE = canWebp ? 'image/webp' : 'image/jpeg';
  const EXT = canWebp ? 'webp' : 'jpg';

  // Pinterest の画像の、ほかの大きさ・拡張子のURL（大きい順）。https://i.pinimg.com/736x/aa/bb/cc/名前.jpg の形のときだけ
  const SIZES = ['originals', '1200x', '736x', '564x', '474x', '236x'];
  function variantsOf(u) {
    const m = /^(https:\/\/i\.pinimg\.com\/)(originals|\d+x(?:\d+)?)\/(.+)\.(jpe?g|png|gif|webp)$/i.exec(u || '');
    if (!m) return [];
    const [, host, , path, ext] = m, out = [];
    for (const sz of SIZES) for (const e of (sz === 'originals' ? [ext, 'jpg', 'png', 'gif', 'webp'] : ['jpg'])) out.push(host + sz + '/' + path + '.' + e.toLowerCase());
    return out;
  }
  const isSmall = (u) => /\/(236x|474x)\//.test(u || '');
  const why = { gone: 0, net: 0, decode: 0 };
  let smallOnly = 0;
  // 候補を順に試す。403・404（その大きさは無い）なら次へ。通信の失敗・混み合い（429・5xx）は少し待ってもう一度
  async function fetchPic(cands) {
    const tries = [];
    for (const u of cands) if (!tries.includes(u)) tries.push(u);
    for (const u of cands) for (const v of variantsOf(u)) if (!tries.includes(v)) tries.push(v);
    let last = 'gone';
    for (const u of tries) {
      for (let a = 0; a < 3; a++) {
        try {
          const res = await fetch(u, { credentials: 'omit' });
          if (res.ok) return { blob: await res.blob(), url: u };
          if (res.status === 429 || res.status >= 500) { last = 'net'; await sleep(1200 * (a + 1)); continue; }
          last = 'gone'; break;
        } catch (e) { last = 'net'; await sleep(900 * (a + 1)); }
      }
    }
    throw new Error(last);
  }
  // createImageBitmap が読めない形式でも、img で読めれば使う
  async function decodeAny(blob) {
    try { return await createImageBitmap(blob); }
    catch (e) {
      const u = URL.createObjectURL(blob);
      try { const im = new Image(); im.src = u; await im.decode(); return im; }
      finally { setTimeout(() => URL.revokeObjectURL(u), 5000); }
    }
  }
  async function shrink(blob) {
    const bmp = await decodeAny(blob);
    const bw = bmp.width || bmp.naturalWidth, bh = bmp.height || bmp.naturalHeight;
    const scale = Math.min(1, MAX_EDGE / Math.max(bw, bh));
    const w = Math.max(1, Math.round(bw * scale));
    const h = Math.max(1, Math.round(bh * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise(r => c.toBlob(r, TYPE, QUALITY));
    const dim = { w: bw, h: bh };
    bmp.close && bmp.close();
    return { blob: out, ...dim };
  }

  const got = new Array(list.length);
  let done = 0, failed = 0;
  stopped = false;   // 集める途中で止めた場合も、見つけた分は取りに行く
  msg.textContent = '写真を集めています';
  progressTitle = '写真を取り込んでいます'; setTitle(progressTitle);

  async function worker(queue) {
    while (queue.length && !stopped) {
      const i = queue.pop();
      const { cands, section } = list[i];
      try {
        const r = await fetchPic(cands);
        let s;
        try { s = await shrink(r.blob); } catch (e) { why.decode++; throw e; }
        if (isSmall(r.url) && !isSmall(cands[0])) smallOnly++;
        got[i] = { url: r.url, section, blob: s.blob, w: s.w, h: s.h };
      } catch (e) {
        failed++;
        if (e && e.message === 'net') why.net++; else if (e && e.message === 'gone') why.gone++;
        console.warn('MOOD BOARD: 取れなかった写真', cands[0], e && e.message);
      }
      done++;
      bar.style.width = (done / list.length * 100).toFixed(1) + '%';
      sub.textContent = done + ' / ' + list.length + '　（失敗 ' + failed + '）';
      if (done % 10 === 0) setTitle(progressTitle = '取り込んでいます ' + done + ' / ' + list.length);
    }
  }
  const queue = list.map((_, i) => i).reverse();
  await Promise.all(Array.from({ length: PARALLEL }, () => worker(queue)));
  const ok = got.filter(Boolean);
  if (!ok.length) { finish(); msg.textContent = '1枚も取得できませんでした'; return; }

  /* ---------- 3) MOOD BOARD が読めるZIPに詰める ---------- */
  msg.textContent = 'まとめています';
  sub.textContent = ok.length + ' 枚';

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
  let boardName = (T && T.boardName) || '';
  const seg = location.pathname.split('/').filter(Boolean);
  if (!boardName && seg.length >= 2 && !['search', 'pin', 'ideas', 'today'].includes(seg[0])) {
    boardName = decodeURIComponent(seg[1]).replace(/[-_]+/g, ' ').trim();
  }
  if (!boardName) {
    const h1 = document.querySelector('h1');
    boardName = (h1 && h1.textContent.trim()) || document.title.split(/[|｜]/)[0].trim() || 'Pinterest';
  }
  boardName = boardName.slice(0, 40);
  const boardId = uid();

  // 石積みに並べる。セクションごとに段を分け、MOOD BOARD の「区分け」にする
  const BASE = 260, GAP = 22, HEAD = 56;
  const entries = [], images = [], items = [];
  let yBase = 0, z = 0;
  const bySec = new Map();
  ok.forEach(g => { if (!bySec.has(g.section)) bySec.set(g.section, []); bySec.get(g.section).push(g); });
  for (const [sec, arr] of bySec) {
    const cols = Math.max(2, Math.min(6, Math.round(Math.sqrt(arr.length * 0.9))));
    const hs = new Array(cols).fill(0);
    for (const g of arr) {
      const id = uid();
      const name = 'images/' + id + '.' + EXT;
      entries.push({ name, data: new Uint8Array(await g.blob.arrayBuffer()) });
      images.push({ id, w: g.w, h: g.h, srcUrl: g.url, addedAt: now, file: name, type: TYPE });
      const c = hs.indexOf(Math.min(...hs));
      const ih = Math.round(BASE * g.h / g.w);
      const it = { id: uid(), boardId, imageId: id, x: c * (BASE + GAP), y: yBase + hs[c], w: BASE, h: ih, z: z++, note: '', addedAt: now };
      if (sec) it.section = sec;
      items.push(it);
      hs[c] += ih + GAP;
      if (z % 10 === 9 && !isHidden()) { sub.textContent = 'まとめています ' + z + ' / ' + ok.length; await sleep(0); }
    }
    yBase += Math.max(...hs) + HEAD;
  }
  const meta = {
    app: 'MOOD BOARD', version: 1, exportedAt: now,
    boards: [{ id: boardId, name: boardName, createdAt: now, updatedAt: now }],
    items, images,
  };
  entries.unshift({ name: 'moodboard.json', data: te.encode(JSON.stringify(meta)) });

  const zip = makeZip(entries);
  const mb = (zip.size / 1048576).toFixed(1);
  const fileName = 'moodboard-pinterest-' + boardName.replace(/[\/\\:*?"<>|\s]/g, '_') + '.zip';
  if (T && T.onZip) {
    T.onZip({ zip, meta, report: report(), declared, sections: sections.length, failed, trimmed });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 8000);
  }

  bar.style.width = '100%';
  msg.innerHTML = '<b>' + ok.length + ' 枚 まとめました</b>';
  const short = declared && ok.length < declared ? declared - ok.length : 0;
  finish();
  setTitle('✓ できました ' + ok.length + ' 枚');
  if (!short) { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }
  sub.innerHTML = mb + ' MB のZIPを保存しました。<br>MOOD BOARD の「ZIPから読み込む」に入れてください。'
    + '<br>' + report()
    + (sections.length ? '<br>セクションは MOOD BOARD の「区分け」になります' : '')
    + (trimmed ? '<br>おすすめと思われる ' + trimmed + ' 枚は除きました' : '')
    + (failed ? '<br>（' + failed + ' 枚は取得できませんでした：'
      + [why.gone ? 'どの大きさの画像も無い ' + why.gone : '', why.net ? '通信の失敗 ' + why.net : '', why.decode ? '読めない形式 ' + why.decode : ''].filter(Boolean).join('・') + '）' : '')
    + (smallOnly ? '<br>' + smallOnly + ' 枚は、小さい画像しか残っていませんでした' : '')
    + (pauses ? '<br>途中で画面が隠れて ' + pauses + ' 回止まりましたが、続きから集めました' : '')
    + (short ? '<br><b>ボードの件数より ' + short + ' 枚少ないです。</b>非公開・削除済みのピンや動画のピンは取れません。'
      + '<br>このページのまま、もう一度コードを貼って Enter すると、<b>今回の分と合わせて</b>集め直します（3日以内）' : '');
  ui.querySelector('#mbg-stop').textContent = '閉じる';
  ui.querySelector('#mbg-stop').onclick = () => { ui.remove(); document.title = title0; };
  console.log('%cMOOD BOARD: ' + ok.length + ' 枚を ' + mb + ' MB のZIPにまとめました（' + report() + '）',
    'font-size:15px;color:#4ad991');
})().catch(e => {
  console.error('MOOD BOARD:', e);
  if (window.__mbGrabFail) window.__mbGrabFail(e);
  else window.__mbGrabRunning = false;
});
