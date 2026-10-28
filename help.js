/* ==========================================================================
   MOOD BOARD — 使い方（説明書）
   右上の「？」・？キー・Mac版のメニュー「ヘルプ › MOOD BOARD の使い方（⌘?）」で開く。
   日本語と英語を別々に書いてある（長い文なので、辞書の置き換えではなく、ここで言語ごとに持つ）。
   各行は [何が, 何ができる, Mac版だけか]。機能を足したら、ここにも1行足すこと（両方の言語に）。
   ========================================================================== */
const HELP = {
  ja: {
    title: '使い方', search: 'さがす（例：スクショ、送る、タグ）', macOnly: 'Mac版', empty: '見つかりませんでした',
    intro: 'MOOD BOARD は、集めた写真を並べて見比べるためのアプリです。Mac版では、写真は「ピクチャ › MOOD BOARD」に保存され、あなたが送らない限りネットには出ていきません。',
    sections: [
      ['はじめに', [
        ['① ボードをつくる', 'ホームの「あたらしいボード」。テーマごとに1枚つくります（例：SS27 撮影、ロケ地、ヘア）。'],
        ['② 写真をいれる', '下の「いれる」から。ドラッグ＆ドロップや ⌘V の貼り付けでも入ります。'],
        ['③ 並べて見比べる', '写真はつかんで動かせます。右下の角で大きさを変えられます。2本指で盤面を動かし、ピンチで拡大します。'],
        ['④ 人に送る', '写真をいくつか選んで「送る」。番号付きの「くらべるシート」（PDF）にして、AirDrop やメールで渡せます。'],
      ]],
      ['画面のみかた', [
        ['ホーム：ボード｜ストック｜インスタ', '「ボード」はテーマごとの盤面の一覧。「ストック」は取り込んだ写真の全部。「インスタ」は、インスタに上げたらどう並ぶかを試す画面です。'],
        ['下のドック', 'いれる（写真などを入れる）・さがす（メモやタグで探す）・えらぶ（何枚かまとめて選ぶ）・ならべる（並べ直す）・道具（描く・整える・見る）。'],
        ['右のパネル', '写真を押すと右に出ます。ひとこと・タグ・大きさ・不透明度・反転などを、その場で変えられます。✕ か Esc で閉じます。'],
        ['右上のボタン', '表示の切り替え（グリッド）・使い方（？）・設定（歯車）・メニュー（≡）。盤面の右上には倍率（押すと全体を表示）と、このボードの色。'],
      ]],
      ['写真をいれる', [
        ['ファイルから', '「いれる」→「写真のファイルから」。フォルダを選ぶと中の写真をまとめて入れます。'],
        ['動画', '写真と同じように入れられます（mp4・mov など）。盤面では表紙に ▶ と長さが出て、ダブルクリックで再生。PDF や印刷には表紙が入り、「写真そのまま」で送ると動画のファイルが渡ります。'],
        ['写真アプリから', '「いれる」→「写真アプリから」。iPhone で撮った写真もそのまま入ります。許可は要りません。', true],
        ['ドラッグ＆ドロップ', 'Finder やブラウザから盤面へ。Dock の MOOD BOARD のアイコンに落としても入ります。'],
        ['貼り付け（⌘V）', 'ブラウザで画像を右クリック →「画像をコピー」→ MOOD BOARD で ⌘V。'],
        ['画像のURLから', '画像のアドレスを何行でも貼り付けて取り込みます。'],
        ['Pinterest から', '「いれる」→「Pinterestからまとめて」。Chrome で自分のボードを開き、出てくるコードを貼るだけ。セクションも「区分け」として入ります。集めている間は「✋ 触らないでください」の札が出ます。Chrome を前に出したまま待ってください（ほかのアプリに切り替えると止まり、戻れば続きます）。足りないときは、もう一度貼ると前回の分と合わせます。'],
        ['連続スクショ', 'どのアプリでも ⌃⌥S（control＋option＋S）。初めてのときだけ、ドラッグで範囲を決めるか、クリックでその窓まるごと。以後は押すたびに、その場で MOOD BOARD に入ります（開いているボード。ボードを開いていなければストック）。⌃⌥Z で直前の1枚を取り消し。範囲を変える・止まったら自動で撮る・終わるは、メニューバーの「◉」から。', true],
        ['取り込みフォルダ', '「ピクチャ › MOOD BOARD › 取り込み」に入れた写真は、自動でストックへ。スクショの保存先にしておくと便利です（⌘⇧5 → オプション → 保存先）。', true],
        ['共有ボタンから', '写真アプリや Safari の「共有」→ MOOD BOARD。最初に システム設定 › 一般 › ログイン項目と機能拡張 › 共有 でオンにします。', true],
        ['ZIP から', 'メニュー（≡）→「ZIPから読み込む」。バックアップや Pinterest の ZIP を戻します。'],
      ]],
      ['並べる・見比べる', [
        ['動かす・大きさ', 'つかんでドラッグ。右下の角で大きさ。矢印キーで少しずつ動かせます（⇧ で大きく）。'],
        ['盤面を動かす・拡大', '2本指でスクロール、ピンチか ⌘＋スクロールで拡大。F で全体を表示。'],
        ['えらぶ', '何もない所をドラッグすると、枠で囲んで選べます。「えらぶ」を押すと、押すたびに選べるモードに。⌘A で全部。'],
        ['ならべる', '石積み（すきまなく）・色の順・区分けごと。左・上・等間隔などの「そろえる」は、何枚か選ぶと右のパネルに出ます。'],
        ['くらべる', '写真を2〜6枚選んで「くらべる」。横・縦・格子・かさねる（2枚をスライダーで重ねて比べる）。'],
        ['大きく見る', '写真をダブルクリック（または ⏎）。切り抜く・まわす・色をとる・スポイト・構図ガイド・撮影データ。'],
        ['グリッド表示', '右上のボタンか G。Pinterest のように並べて眺めます。'],
        ['しるし ◎○△✕', '写真に「◎ 本命・○ 候補・△ 保留・✕ 見送り」を付けて、選ぶのに使います。写真を選んで 1〜4 キー（0 で外す）か、右のパネルで。同じしるしをもう一度で外れます。ボード・くらべる・ストックのどこでも同じしるしが見えます。'],
        ['1枚ずつ見て選ぶ', '大きく見ているとき、←→（携帯は左右に払う）で前後の写真へ。見ながら 1〜4 でしるしを付けられます。何枚か選んでから開くと、選んだものだけを順に見ます。'],
        ['いつも手前に表示', 'メニューの「表示」→「いつも手前に表示」（⌥⌘T）で、ほかのアプリの上に MOOD BOARD を出しておけます。「透け具合」で窓を半分透かすこともできます。', true],
      ]],
      ['書き込む・整理する', [
        ['ひとこと・説明', '写真を押して右のパネルで。ひとことは写真の下に出ます。説明は長いメモ用。'],
        ['タグ', '押すだけで付け外し。「さがす」やストックで探せます。'],
        ['区分け', 'ボードの中のグループ（例：素材・照明）。「ならべる → 区分けごとにまとめる」で段に分かれます。'],
        ['参考にするところ', 'その写真の「何を」使うか（光・ポーズ・構図・ヘアメイクなど）。写真の左上に印が出ます。'],
        ['文字・吹き出し・チェックリスト', '「道具」から。チェックリストは撮影のショットリストに便利です（頭に ★ で「必須」）。'],
        ['付箋の色・線の色', '付箋や吹き出しを押すと、右のパネルで色を選べます（8色）。描いた線も、あとから色と太さを変えられます。'],
        ['ペン・線・矢印・四角・丸', '「道具」→「かく」。shift でまっすぐ・正円。並べ直しても、描いた線は動きません。'],
      ]],
      ['道具', [
        ['補正', '明るさ・コントラスト・彩度・色温度。元の写真は変わらないので、何度でもやり直せます。'],
        ['反転・かたむける・うすくする', '左右／上下の反転、角度、不透明度。'],
        ['固定', '触っても動かなくなります（「ならべる」では動きます）。'],
        ['スポイト・配色をつくる・色を置く', '写真の1点の色を取る／合う色の組み合わせを作る（補色・類似色など）／色見本を盤面に置く。'],
        ['白黒で見る・反転して見る', '明暗の配分や、構図のかたよりを確かめるための見方。写真は変わりません。'],
        ['構図ガイド・撮影データ', '三分割・黄金比・SNS の比率を重ねる／カメラ・レンズ・絞りなどとヒストグラム。'],
        ['プレゼン', 'ボードの写真を1枚ずつ全画面で。←→ でめくり、Esc で終わる。'],
        ['ランダムに散らす・面積をそろえる', 'コラージュ風に散らす／見た目の大きさをそろえる。'],
      ]],
      ['ストック', [
        ['ストックとは', '取り込んだ写真の全部。ボードに載せずに貯めておけます。左下に白い点がある写真は、どのボードにも載っていません。'],
        ['さがす・しぼりこむ', 'タグ・メモ・ボード名・サイト名・カメラで探せます。上のボタンで「ボードに無い」や、よく使うタグにしぼれます。'],
        ['選んでできること', 'ボードへ入れる・くらべる・送る・タグを付ける・ストックから消す。ダブルクリックで大きく見る。'],
        ['並べ替え・形・色・大きさ', '「並び」で新しい順・古い順・しるし順・色の順・ランダム（昔の写真をふと見返す）。縦長・横長・正方形や、色の丸でしぼれます。小・中・大で写真の大きさ。'],
        ['色味が近い写真', '1枚選んで「そのほか」→「色味が近い順に並べる」。その写真に色が近いものから並びます。'],
        ['スペースで見る', '選んでスペースを押すと大きく見られます（もう一度スペースで閉じる）。←→ で次々に、1〜4 でしるし。'],
      ]],
      ['インスタで試す', [
        ['なにができる', 'ホームの「インスタ」で、インスタのプロフィールそっくりの画面に写真を3列で並べ、上げたらどう見えるかを試せます。インスタには何も送りません。グリッドは今のインスタと同じ 3:4（1:1 にも切り替えられる）。左上がいちばん新しい投稿です。'],
        ['写真を入れる', '「写真を足す」でストックから（◎本命・○候補でしぼれる）。ストックで選んで「そのほか」→「インスタのグリッドで試す」、ボードの「道具」→「インスタで試す」からも。'],
        ['並べ替え', 'ドラッグで動かします（携帯は少し長押ししてから）。「まぜる」で「これから投稿」の写真だけをランダムに。⌘Z（または「元にもどす」）で戻せます。⇧⌘Z でやり直し。'],
        ['パソコンでの見え方', '左に操作、右に携帯の画面がまるごと出ます。携帯の画面の中だけがスクロールします。窓を大きくすると、携帯の画面も大きくなります。'],
        ['全体の雰囲気を見る', '「ぼかして見る」で色のまとまり、「白黒で見る」で明るさのつながりを確かめられます。白い画面・黒い画面も切り替えられます。'],
        ['1つずつ', '写真を押すと：位置を直す（ずらす・大きく）・これから投稿／投稿済み・キャプションの下書き・先頭へ・アイコンにする・分けて並べる（3・6・9枚のパズル）・はずす。'],
        ['プロフィール', 'ユーザーネーム・名前・プロフィール文・フォロワーの数・アイコンは、押すと変えられます。'],
        ['案', '並べ方は「案」として保存されます。複製して、並べ方を変えて見比べられます。'],
        ['書き出す', '「見え方を1枚の画像に」で人に見せる画像を、「投稿用の写真を書き出す」で「これから投稿」の写真を投稿する順に 1080×1440 で（キャプションの一覧も）。01 から順に投稿すると、案のとおりに並びます。'],
      ]],
      ['送る・書き出す', [
        ['送る（⌘P）', '選んで「送る」。くらべるシート（番号付きPDF）・1枚の画像・1枚ずつのPDF・写真そのまま・盤面のまま。Mac版は AirDrop・メール・メッセージなどへ。'],
        ['写真をコピー（⌘C）', '選んだ写真を、ほかのアプリに貼り付けられる形でコピーします。'],
        ['印刷', 'メニュー →「印刷する」。ボードのまま・格子・1枚ずつ。A4／A3。'],
        ['まるごと書き出し', 'メニュー →「まるごと書き出し」。画像ごと1つの ZIP に。いちばん確かなバックアップです。'],
        ['USB に書き出す', '挿したパソコンで、そのまま開いて見られる形にします。'],
      ]],
      ['Mac とスマホで写真をやりとり', [
        ['考え方', 'MOOD BOARD どうしを直接つなぐ同期はしません。iCloud 写真・Google フォト・Amazon Photos に写真を入れて、それぞれの仕組みで Mac とスマホに届けます。'],
        ['iCloud 写真（iPhone）', '「送る」→「写真アプリに入れる」で、写真アプリのアルバム「MOOD BOARD」へ。Mac の写真アプリ › 設定 › iCloud で「iCloud 写真」がオンなら、iPhone の写真アプリにも届きます。最初に一度、写真アプリへのアクセスを許可します。', true],
        ['Google フォト', '「送る」→「クラウド用フォルダに置く」で「ピクチャ › MOOD BOARD 書き出し」へ。Google ドライブ（パソコン版）の設定 › マイ Mac › フォルダを追加 でこのフォルダを選び、「Google フォトにバックアップ」にします（最初の1回だけ）。', true],
        ['Amazon Photos', '同じく「MOOD BOARD 書き出し」フォルダを、Amazon Photos（Mac 版）の「バックアップ」に加えます（最初の1回だけ）。', true],
        ['自動で入れる', '設定（歯車）› クラウド で「自動で」にすると、MOOD BOARD に入れた写真が毎回、写真アプリや書き出しフォルダにも入ります。写真アプリから取り込んだ写真は、二重にならないよう写真アプリへは戻しません。', true],
        ['スマホで MOOD BOARD に入れる', 'スマホ版の「いれる」→「スマホの写真から」で、アルバム「MOOD BOARD」などから選べます。Google フォトの写真は、いったんスマホに保存してから選びます。'],
        ['Android でアプリにする', 'Chrome で携帯版を開いて、右上のメニュー（︙）→「アプリをインストール」（または「ホーム画面に追加」）。ホーム画面とアプリ一覧に MOOD BOARD が入り、全画面で開きます。アイコンを長押しすると「ストック」「新しいボード」へすぐ行けます。'],
        ['Android の「共有」から入れる', 'アプリにしたあとは、Google フォト・Instagram・Chrome などの「共有」→「MOOD BOARD」で写真や動画を送れます。ストックに入ります。URL を送ると、その画像を取り込みます。'],
        ['Android の「戻る」', '戻るボタン（戻るジェスチャー）で、開いているシートや1枚表示を1つずつ閉じます。ボード一覧で戻ると、アプリを閉じます。'],
        ['iPhone でアプリにする', 'Safari で携帯版を開いて、共有ボタン →「ホーム画面に追加」。'],
      ]],
      ['写真の置き場所', [
        ['ライブラリ', '写真とボードは「ピクチャ › MOOD BOARD」に普通のファイルで保存されます。Finder でも見られます。', true],
        ['場所を変える・USB', '設定（歯車）→ ライブラリ →「場所を変える…」。USB メモリに置けば、別の Mac でも開けます。', true],
        ['消してしまったら', 'はずした写真は、メニューの「ゴミ箱」から戻せます。ゴミ箱を空にしても、Mac版では写真のファイルは Mac のゴミ箱に移るだけです。'],
        ['自動の控え', 'ボードの中身は毎日、ライブラリの data › backup に控えが残ります。', true],
      ]],
      ['キーボード', [
        ['一覧', '⌘/ で全部見られます。Mac版はメニューバーにも同じものが並んでいます。'],
        ['よく使うもの', '⌘Z 元にもどす／⌘F さがす／⌘K 道具／⌘P 送る／⏎ 大きく見る／F 全体を見る／A ならべる／E 選ぶ／C くらべる／⌃⌥S 連続スクショ／？ この使い方'],
      ]],
      ['困ったとき', [
        ['間違えた', '⌘Z で元にもどせます（40回まで）。⇧⌘Z でやり直し。'],
        ['写真が見つからない', 'メニューの「ゴミ箱」を見てください。ストックの「さがす」でも探せます。'],
        ['共有に MOOD BOARD が出ない', 'システム設定 › 一般 › ログイン項目と機能拡張 › 共有 で MOOD BOARD をオンにします。', true],
        ['スクショが撮れない', 'システム設定 › プライバシーとセキュリティ › 画面収録とシステムオーディオ録音 で MOOD BOARD をオンにして、開き直してください。', true],
        ['⌃⌥S がほかのアプリとぶつかる', '連続スクショのパネルで「いつでも ⌃⌥S で撮る」を外してください。', true],
        ['iPhone の写真（HEIC）が入らない', 'Mac版なら読めます。ブラウザ版（Chrome）は HEIC が読めません。'],
        ['英語にしたい', '設定（歯車）→ 言語 / Language。'],
      ]],
    ],
  },
  en: {
    title: 'How to use', search: 'Search (e.g. screenshot, send, tags)', macOnly: 'Mac', empty: 'Nothing found',
    intro: 'MOOD BOARD is for laying out the photos you collect and comparing them. In the Mac app, photos are saved in “Pictures › MOOD BOARD” and never leave your Mac unless you send them.',
    sections: [
      ['Getting started', [
        ['① Make a board', '“New board” on the home screen. Make one per theme (e.g. SS27 shoot, locations, hair).'],
        ['② Add photos', 'Use “Add” at the bottom. Drag and drop or paste with ⌘V works too.'],
        ['③ Arrange and compare', 'Drag photos to move them and use the bottom-right corner to resize. Two-finger scroll pans; pinch zooms.'],
        ['④ Send to someone', 'Select a few photos and press “Send” to make a numbered comparison sheet (PDF) and share it by AirDrop or email.'],
      ]],
      ['The screen', [
        ['Home: Boards | Stock | Instagram', '“Boards” lists your boards by theme. “Stock” shows every photo you’ve imported. “Instagram” lets you try how photos would line up on Instagram.'],
        ['Bottom bar', 'Add (photos and more) · Find (by note or tag) · Select (several at once) · Arrange (tidy up) · Tools (draw, adjust, view).'],
        ['Right panel', 'Click a photo and it opens on the right. Change the caption, tags, size, opacity, flip and more right there. Close with ✕ or Esc.'],
        ['Top-right buttons', 'Switch view (grid) · How to use (?) · Settings (gear) · Menu (≡). On the canvas: zoom level (click to fit all) and this board’s colors.'],
      ]],
      ['Adding photos', [
        ['From files', '“Add” → “From files”. Pick a folder to add every photo in it.'],
        ['Videos', 'Add them like photos (mp4, mov…). On the canvas they show a ▶ and their length; double-click to play. PDFs and prints use the cover frame, and “Original photos” sends the video file itself.'],
        ['From the Photos app', '“Add” → “From the Photos app”. iPhone photos work as they are. No permission needed.', true],
        ['Drag and drop', 'From Finder or a browser onto the canvas — or onto MOOD BOARD’s Dock icon.'],
        ['Paste (⌘V)', 'In a browser, right-click an image → “Copy Image”, then press ⌘V in MOOD BOARD.'],
        ['From image URLs', 'Paste any number of image addresses to import them.'],
        ['From Pinterest', '“Add” → “Import a Pinterest board”. Open your board in Chrome and paste the code shown. Sections come in as sections. While it gathers, a “✋ Please don’t touch” sign shows — keep Chrome in front (switching to another app pauses it; it carries on when you come back). If some are missing, paste it again to add to the last run.'],
        ['Screenshot series', 'Press ⌃⌥S (control + option + S) in any app. The first time, drag to choose an area or click a window to capture it whole. After that, every press goes straight into MOOD BOARD (the open board, or Stock if no board is open). ⌃⌥Z undoes the last one. Change the area, capture when scrolling stops, or finish from the ◉ in the menu bar.', true],
        ['Inbox folder', 'Photos put in “Pictures › MOOD BOARD › 取り込み” go into Stock automatically. Handy as your screenshot location (⌘⇧5 → Options → Save to).', true],
        ['Share button', '“Share” in Photos or Safari → MOOD BOARD. Turn it on first in System Settings › General › Login Items & Extensions › Sharing.', true],
        ['From a ZIP', 'Menu (≡) → “Import ZIP” to restore a backup or a Pinterest ZIP.'],
      ]],
      ['Arranging and comparing', [
        ['Move and resize', 'Drag to move, use the bottom-right corner to resize. Arrow keys nudge (⇧ for bigger steps).'],
        ['Pan and zoom', 'Two-finger scroll to pan; pinch or ⌘ + scroll to zoom. F fits everything.'],
        ['Select', 'Drag on empty space to select with a box. Press “Select” to pick by clicking. ⌘A selects all.'],
        ['Arrange', 'Masonry (packed), by color, or by section. Alignment (left, top, even spacing…) appears in the right panel when several are selected.'],
        ['Compare', 'Select 2–6 photos and press “Compare”: side by side, stacked, grid, or overlay (two photos with a slider).'],
        ['View large', 'Double-click a photo (or press ⏎): crop, rotate, pick colors, eyedropper, composition guides, photo info.'],
        ['Grid view', 'The top-right button or G shows everything in a Pinterest-style grid.'],
        ['Marks ◎○△✕', 'Mark photos “◎ Top pick, ○ Candidate, △ On hold, ✕ Pass” to help you choose. Select a photo and press 1–4 (0 clears), or use the right panel. Marking again with the same mark clears it. The same mark shows on boards, in Compare and in Stock.'],
        ['Go through one by one', 'While viewing large, ← → (swipe on a phone) moves to the previous or next photo, and 1–4 marks as you go. Select several first to go through only those.'],
        ['Keep on top', 'View → “Keep on Top” (⌥⌘T) keeps MOOD BOARD above other apps. “Window Transparency” can make the window see-through.', true],
      ]],
      ['Notes and organizing', [
        ['Caption and notes', 'Click a photo and use the right panel. The caption shows under the photo; notes are for longer text.'],
        ['Tags', 'Click to add or remove. Use them with Find and in Stock.'],
        ['Sections', 'Groups within a board (e.g. materials, lighting). “Arrange → Group by section” puts them in rows.'],
        ['What to reference', 'What you’ll take from a photo (light, pose, composition, hair & makeup…). A badge appears on the photo.'],
        ['Text, bubbles, checklists', 'From “Tools”. Checklists work well as shot lists (start a line with ★ for “must have”).'],
        ['Card and line colors', 'Click a note or bubble to pick its color in the right panel (8 colors). Drawings can change color and width afterwards too.'],
        ['Pen, lines, arrows, boxes, circles', '“Tools” → “Draw”. Hold shift for straight lines and circles. Drawings stay put when you rearrange.'],
      ]],
      ['Tools', [
        ['Adjust', 'Brightness, contrast, saturation and warmth. The original photo is untouched, so you can always undo.'],
        ['Flip, tilt, fade', 'Flip horizontally or vertically, rotate to any angle, change opacity.'],
        ['Lock', 'Locked items don’t move when touched (Arrange still moves them).'],
        ['Eyedropper, color harmony, swatches', 'Pick a color from a photo / build matching palettes (complementary, analogous…) / place swatches on the canvas.'],
        ['View in gray, view mirrored', 'Ways to check light-and-dark balance and composition. The photos don’t change.'],
        ['Composition guides, photo info', 'Overlay thirds, golden ratio and social media ratios / camera, lens, aperture and a histogram.'],
        ['Present', 'Show the board’s photos one by one, full screen. ← → to move, Esc to stop.'],
        ['Scatter, equal area', 'Scatter like a collage / even out how big things look.'],
      ]],
      ['Stock', [
        ['What it is', 'Every photo you’ve imported. Keep photos here without putting them on a board. A white dot means the photo isn’t on any board.'],
        ['Find and filter', 'Search by tag, note, board, site or camera. Buttons at the top filter to “Not on a board” or your common tags.'],
        ['With a selection', 'Add to a board, compare, send, tag, or delete from Stock. Double-click to view large.'],
        ['Order, shape, color, size', '“Order”: newest, oldest, by mark, by color, or random (rediscover old photos). Filter by portrait, landscape or square, or by a color dot. S, M, L change the thumbnail size.'],
        ['Similar colors', 'Select one photo, then “More” → “Sort by similar colors”. Photos closest in color come first.'],
        ['Space to look', 'Select and press Space to view large (Space again closes). ← → to move on, 1–4 to mark.'],
      ]],
      ['Try on Instagram', [
        ['What it does', '“Instagram” on the home screen lays your photos out in three columns on a look-alike Instagram profile, so you can see how they’d look before posting. Nothing is posted. The grid is 3:4 like Instagram now (1:1 is available too). The top-left is the newest post.'],
        ['Adding photos', '“Add photos” picks from Stock (filter to ◎ Top pick or ○ Candidate). You can also select in Stock and choose “More” → “Try on an Instagram grid”, or use “Tools” → “Try on Instagram” on a board.'],
        ['Reordering', 'Drag to move (on a phone, press and hold first). “Shuffle” mixes only the planned photos. ⌘Z (or “Undo”) takes it back; ⇧⌘Z redoes.'],
        ['On a computer', 'Controls sit on the left and the whole phone screen shows on the right. Only the phone screen scrolls. Make the window bigger for a bigger phone.'],
        ['Checking the mood', '“Blur” shows how the colors sit together and “View in gray” shows the light-and-dark flow. Switch between a light and dark screen too.'],
        ['One post at a time', 'Tap a photo to reposition or zoom it, mark it planned or posted, draft a caption, move it to the front, use it as the profile photo, split it into a 3/6/9-piece puzzle, or remove it.'],
        ['Profile', 'Tap the username, name, bio, follower counts or profile photo to change them.'],
        ['Plans', 'Each arrangement is saved as a plan. Duplicate a plan to try another arrangement side by side.'],
        ['Export', '“Save the look as one image” makes a picture to show others. “Export photos for posting” saves the planned photos at 1080×1440 in posting order, with captions. Post them from 01 onward and they’ll line up as planned.'],
      ]],
      ['Sending and exporting', [
        ['Send (⌘P)', 'Select and press “Send”: comparison sheet (numbered PDF), one image, one per page (PDF), original photos, or as the canvas. The Mac app can send by AirDrop, Mail, Messages and more.'],
        ['Copy photo (⌘C)', 'Copies the selected photo so you can paste it into other apps.'],
        ['Print', 'Menu → “Print”: as the board, grid or one per page. A4 / A3.'],
        ['Export everything', 'Menu → “Export everything”: one ZIP with all images. Your most reliable backup.'],
        ['Export to USB', 'Makes a copy you can open on any computer you plug it into.'],
      ]],
      ['Moving photos between Mac and phone', [
        ['The idea', 'MOOD BOARD doesn’t sync with itself. Put photos into iCloud Photos, Google Photos or Amazon Photos and let them carry the photos between your Mac and phone.'],
        ['iCloud Photos (iPhone)', '“Send” → “Add to Photos” puts them in the “MOOD BOARD” album of the Photos app. With iCloud Photos on (Photos › Settings › iCloud on the Mac), they reach your iPhone’s Photos app. Allow access to Photos the first time.', true],
        ['Google Photos', '“Send” → “Put in cloud folder” saves to “Pictures › MOOD BOARD 書き出し”. In Google Drive for desktop, go to Settings › My Mac › Add folder, choose this folder and pick “Back up to Google Photos” (once).', true],
        ['Amazon Photos', 'Add the same “MOOD BOARD 書き出し” folder to Backup in Amazon Photos for Mac (once).', true],
        ['Do it automatically', 'Settings (gear) › Cloud › “Auto” adds every photo you put into MOOD BOARD to Photos and/or the cloud folder. Photos that came from the Photos app aren’t sent back, so nothing doubles up.', true],
        ['Adding on your phone', 'In the phone version, “Add” → “From photos” lets you pick from albums such as “MOOD BOARD”. For Google Photos, save the photo to your phone first.'],
        ['Make it an app on Android', 'Open the phone version in Chrome, then menu (⋮) → “Install app” (or “Add to Home screen”). MOOD BOARD appears on your home screen and app list and opens full screen. Long-press the icon to jump to Stock or a new board.'],
        ['Add from Android’s Share menu', 'Once installed, use “Share” → “MOOD BOARD” in Google Photos, Instagram, Chrome and others to send photos and videos. They go to Stock. Sharing a URL imports that image.'],
        ['Android’s back button', 'The back button (or gesture) closes what’s open — a sheet, a photo — one at a time. On the board list, it closes the app.'],
        ['Make it an app on iPhone', 'Open the phone version in Safari, then Share → “Add to Home Screen”.'],
      ]],
      ['Where photos live', [
        ['Library', 'Photos and boards are saved as normal files in “Pictures › MOOD BOARD”. You can see them in Finder.', true],
        ['Change location / USB', 'Settings (gear) → Library → “Change location…”. Keep it on a USB drive to open it on another Mac.', true],
        ['If you delete something', 'Removed photos can be restored from Trash in the menu. Even after emptying it, the Mac app only moves the files to the Mac’s Trash.'],
        ['Automatic backups', 'A copy of your boards is kept every day in the library’s data › backup.', true],
      ]],
      ['Keyboard', [
        ['Full list', 'Press ⌘/ to see everything. In the Mac app the same commands are in the menu bar.'],
        ['Most used', '⌘Z undo / ⌘F find / ⌘K tools / ⌘P send / ⏎ view large / F fit all / A arrange / E select / C compare / ⌃⌥S screenshot series / ? this help'],
      ]],
      ['Troubleshooting', [
        ['Made a mistake', '⌘Z undoes (up to 40 steps). ⇧⌘Z redoes.'],
        ['Can’t find a photo', 'Check Trash in the menu, or use Find in Stock.'],
        ['MOOD BOARD isn’t in the Share menu', 'Turn it on in System Settings › General › Login Items & Extensions › Sharing.', true],
        ['Screenshots don’t work', 'Turn on MOOD BOARD in System Settings › Privacy & Security › Screen & System Audio Recording, then reopen it.', true],
        ['⌃⌥S clashes with another app', 'Untick “⌃⌥S works anytime” in the screenshot series panel.', true],
        ['iPhone photos (HEIC) won’t import', 'The Mac app reads them. The browser version (Chrome) can’t read HEIC.'],
        ['Switch to Japanese / English', 'Settings (gear) → 言語 / Language.'],
      ]],
    ],
  },
};

function helpLang() { return (window.MB_I18N && MB_I18N.lang === 'en') ? 'en' : 'ja'; }

/* 使い方を描く。q があれば、その言葉を含む行だけ出す */
function renderHelp(q) {
  const H = HELP[helpLang()];
  const box = document.getElementById('help-body');
  const toc = document.getElementById('help-toc');
  const words = (q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  box.innerHTML = '';
  toc.innerHTML = '';
  let shown = 0;
  H.sections.forEach(([title, rows], si) => {
    const hits = rows.filter(([t, d]) => words.every(w => (t + ' ' + d + ' ' + title).toLowerCase().includes(w)));
    if (!hits.length) return;
    shown += hits.length;
    const sec = document.createElement('section');
    sec.className = 'help-sec';
    sec.id = 'help-s' + si;
    const h = document.createElement('h3');
    h.textContent = title;
    sec.appendChild(h);
    const list = document.createElement('div');
    list.className = 'help-list';
    hits.forEach(([t, d, mac]) => {
      const r = document.createElement('div');
      r.className = 'help-row';
      const b = document.createElement('b');
      b.textContent = t;
      if (mac) { const tag = document.createElement('span'); tag.className = 'help-mac'; tag.textContent = H.macOnly; b.appendChild(tag); }
      const p = document.createElement('p');
      p.textContent = d;
      r.append(b, p);
      list.appendChild(r);
    });
    sec.appendChild(list);
    box.appendChild(sec);
    // 目次（押すとその章へ）
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = title;
    c.onclick = () => sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toc.appendChild(c);
  });
  if (!shown) {
    const e = document.createElement('p');
    e.className = 'sheet-note';
    e.textContent = H.empty;
    box.appendChild(e);
  }
}
function openHelp() {
  const H = HELP[helpLang()];
  document.getElementById('help-title').textContent = H.title;
  document.getElementById('help-intro').textContent = H.intro;
  const q = document.getElementById('help-q');
  q.placeholder = H.search;
  q.value = '';
  renderHelp('');
  openSheet('#sheet-help');
}
document.getElementById('help-q').addEventListener('input', (e) => renderHelp(e.target.value));
document.getElementById('help-close').onclick = closeSheets;
document.getElementById('btn-help').onclick = () => openHelp();
