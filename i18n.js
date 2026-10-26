/* ==========================================================================
   MOOD BOARD — 言語の切り替え（日本語 / English）
   画面に日本語の文字が出た瞬間に、この辞書で英語に置き換える（戻すと元の日本語に戻る）。
   ・文言は index.html と app.js に散らばっているので、1つずつ書き換えずに「出たものを置き換える」方式にした
   ・数字の入る文は数字を {n}、「」の中身（ボード名など）を {q} にしたひな形で引く
     例：「3 枚いれました」→「{n} 枚いれました」→「{n} added」
   ・辞書に無いものは日本語のまま残る（新しく文言を足したら、ここにも足すこと）
   ・英語も「いれる・さがす・ならべる」の平たさに合わせ、短い普通の語にする（Add / Find / Arrange / Tools）
   ========================================================================== */
(function () {
  'use strict';
  const EN = {
    /* ---- 下のドック・よく出る言葉 ---- */
    'いれる': 'Add', 'さがす': 'Find', 'えらぶ': 'Select', 'ならべる': 'Arrange', '道具': 'Tools',
    'くらべる': 'Compare', '送る': 'Send', '送る…': 'Send…', 'うつす': 'Move', 'はずす': 'Remove', 'やめる': 'Cancel',
    'とじる': 'Close', 'もどる': 'Back', '保存': 'Save', '保存…': 'Save…', '追加': 'Add', '置く': 'Place', 'できた': 'Done',
    'おわる': 'Done', '取り込む': 'Import', '中止': 'Stop', '次へ': 'Next', '前へ': 'Previous', 'メニュー': 'Menu', '設定': 'Settings',
    'ボード': 'Boards', 'ストック': 'Stock', 'ボードとストック': 'Boards and stock', 'あたらしいボード': 'New board',
    '大きく': 'Bigger', '小さく': 'Smaller', 'メモ': 'Note', 'タグ': 'Tags', '印刷': 'Print', 'そのほか': 'More', 'ボードへ': 'To board',
    '{n} まい': '{n} selected', '0 まい': '0 selected', '{n} 個': '{n} items', 'そろえる': 'Align', 'なし': 'None', 'あり': 'On', 'ぜんぶ': 'All',
    'からっぽ': 'Empty', 'からっぽです': 'Empty', '読み込み中…': 'Loading…', 'まとめて': 'Together',
    /* ---- ホーム ---- */
    'ボードがありません': 'No boards yet', 'テーマごとに1枚つくって、': 'Make one per theme,', '写真を放り込んでいきます。': 'and toss photos in.',
    '{n} 枚の写真をこの端末に保存中': '{n} photos stored on this device', '{n} 枚の写真をライブラリ「{q}」に保存中': '{n} photos in the library “{q}”',
    '{n} 使用': '{n} used', '{n} 使用（空き {n}）': '{n} used ({n} free)', '（この端末の上限 {n}）': '(limit on this device {n})',
    'まだ写真がありません': 'No photos yet', '下の「いれる」から、どのボードにも載せずに取り込めます。': 'Use “Add” below to import without putting them on a board.',
    'ボードに入れた写真も、ここに全部並びます。': 'Photos on your boards show up here too.',
    'タグ・メモ・ボード名・サイト名・カメラでさがす': 'Find by tag, note, board, site or camera',
    'すべて {n}': 'All {n}', 'ボードに無い {n}': 'Not on a board {n}', 'ボードに無い': 'Not on a board',
    '{n} 枚　押して選ぶ・ダブルクリックで大きく見る': '{n} photos · click to select, double-click to view',
    '{n} / {n} 枚　押して選ぶ・ダブルクリックで大きく見る': '{n} / {n} photos · click to select, double-click to view',
    'どのボードにも載っていません': 'Not on any board', 'ボード：{q}': 'Board: {q}',
    'どのボードに入れますか': 'Which board?', 'えらんだ写真': 'Selected photos', '{n} 枚えらんでいます': '{n} selected',
    '大きく見る': 'View large', '1枚えらんでいるとき': 'When one is selected', 'タグを付ける': 'Add tags', 'ストックの「さがす」で使えます': 'Used by Find in Stock',
    'いま見えている写真を全部えらぶ': 'Select all shown', '⌘A でも': 'Or ⌘A', 'ストックから消す': 'Delete from stock',
    'どのボードにも載っていない写真だけ': 'Only photos that aren’t on a board',
    /* ---- ボードの上 ---- */
    '下の ＋ から写真を入れます': 'Add photos with + below', '押すと全体を表示（F）': 'Click to fit all (F)',
    '白黒で表示中': 'Showing in gray', '反転して表示中': 'Showing mirrored', '表示を切り替える': 'Switch view',
    /* ---- 設定パネル（選んだもの） ---- */
    'この写真': 'Photo', '文字': 'Text', '吹き出し': 'Speech bubble', 'チェックリスト': 'Checklist', '色見本': 'Swatch', '描いた線': 'Drawing',
    'えらんだもの': 'Selection', '選ぶのをやめる': 'Deselect', '選ぶのをやめる（Esc）': 'Deselect (Esc)',
    '切り抜く': 'Crop', '複製': 'Duplicate', '文字を直す': 'Edit text', '中身を直す': 'Edit items',
    'ひとこと': 'Caption', '写真の下に出る': 'Shown under the photo', '説明': 'Notes', '長く書きたいとき': 'For longer notes',
    '金具の感じ': 'e.g. the hardware', 'どこが良いのか、どう使うつもりか': 'What you like about it and how you’ll use it',
    'どこが良いのか、どう使うつもりか。あとで自分が読んで分かるように。': 'What you like about it and how you’ll use it — for future you.',
    '参考にするところ': 'What to reference', 'この写真の「何を」使うか': 'What you’ll take from this photo',
    '光': 'Light', 'ポーズ': 'Pose', '構図': 'Composition', '色': 'Color', 'スタイリング': 'Styling', 'ヘアメイク': 'Hair & makeup',
    '質感': 'Texture', '場所': 'Location', '雰囲気': 'Mood',
    '押すだけで付け外し': 'Click to add or remove', '押すだけで付け外しできる': 'Click to add or remove',
    '押すと {n} 枚すべてに付く／外れる': 'Click to add to or remove from all {n}',
    '新しいタグを打って Enter': 'Type a new tag and press Enter', 'まだタグなし': 'No tags yet',
    '区分け': 'Sections', 'ボードの中のグループ': 'Groups within the board', 'ボードの中をグループに分ける': 'Split the board into groups',
    '＋ 新しい区分け': '+ New section', '区分けの名前': 'Section name',
    '大きさ': 'Size', 'よこ': 'Width', 'たて': 'Height', '元の縦横比': 'Original ratio',
    '見た目': 'Look', '不透明度': 'Opacity', 'かたむき': 'Tilt', '左右反転': 'Flip horizontal', '上下反転': 'Flip vertical',
    '明るさ・色を整える…': 'Adjust light and color…', '重なりと固定': 'Order and lock', 'いちばん前': 'Bring to front', 'いちばん後ろ': 'Send to back',
    '固定する': 'Lock', '固定中（押すと外す）': 'Locked (click to unlock)',
    '横に等間隔': 'Space horizontally', '縦に等間隔': 'Space vertically', '真ん中': 'Middle', '幅': 'Width', '高さ': 'Height', '面積': 'Area',
    '横一列': 'One row', '縦一列': 'One column', '重ねる': 'Stack', '上': 'Top', '下': 'Bottom', '左': 'Left', '右': 'Right', '中央': 'Center',
    /* ---- いれる ---- */
    'スマホの写真から': 'From photos', '写真のファイルから': 'From files', 'まとめて選べます': 'Pick several at once',
    '写真アプリから': 'From the Photos app', 'iPhoneで撮った写真もそのまま（許可は要りません）': 'iPhone photos too (no permission needed)',
    '連続スクショ': 'Screenshot series', 'インスタやサイトを見ながら、⌃⌥S を押すたびに撮って貯める': 'Browse Instagram or any site and press ⌃⌥S to capture each screen',
    'どのアプリを見ていても ⌃⌥S で撮れる。止めたところを自動で撮る、も': 'Press ⌃⌥S in any app to capture — or let it capture wherever you stop scrolling',
    'スクショ': 'screenshot',
    '取り込みフォルダを開く': 'Open the inbox folder', 'ここに入れた写真は、自動でストックに入ります': 'Photos put here go into Stock automatically',
    '画像のURLから': 'From image URLs', '何行でも貼り付けOK': 'Paste as many lines as you like',
    'Pinterestからまとめて': 'Import a Pinterest board', '保存済みのピンを一気に。パソコンのChromeで': 'All your saved pins at once, in Chrome on a computer',
    '色を置く': 'Place a color', 'このボードの色や、好きな色を見本として並べます': 'Place this board’s colors or any color as swatches',
    '文字を置く': 'Add text', '気づいたことを、ノートのように書き込めます': 'Write notes right on the board',
    '画像のURL': 'Image URLs', '1行に': 'One per line',
    '1行に1つ。何百行でも大丈夫です。取り込むと画像の実体がこの端末に保存されるので、元が消えても残ります。': 'One per line, any number. The image itself is saved here, so it stays even if the original disappears.',
    'Pinterestの画像はここでは取り込めません': 'Pinterest images can’t be imported here',
    '（あちら側の制限）。ひとつ前の画面の「Pinterestからまとめて」を使ってください。': '(their restriction). Use “Import a Pinterest board” on the previous screen.',
    'Pinterestの画像は、': 'Pinterest images', 'Pinterestのページの中からしか取り出せません': 'can only be taken out from inside Pinterest’s own pages',
    '（そういう制限がかかっています）。なので、あちら側で一気にまとめてから持ち帰ります。': '(that’s their restriction), so we gather them there and bring them back.',
    'パソコンのChrome': 'Chrome on a computer', 'で行ってください。': '.', 'Chromeで自分のボードを開く': 'Open your board in Chrome',
    '下のコードをコピーして、': 'Copy the code below and paste it into', '右クリック → 検証 → Console': 'right-click → Inspect → Console', 'に貼って Enter': ', then press Enter',
    'あとは放っておく': 'Then leave it', '勝手に最後までスクロールして集め、縮小して1つのZIPにまとめます。': 'It scrolls to the end by itself, shrinks the images and packs them into one ZIP.',
    'セクションも1つずつ開いて集めます': 'It opens each section too',
    '（途中で画面がセクションに切り替わって見えますが、そのままで大丈夫です）。右下に進み具合が出ます。枚数が多いと数分かかります': '(you’ll see it switch to the sections — that’s fine). Progress shows at the bottom right. Large boards take a few minutes.',
    'ZIPが保存されたら、このアプリの': 'When the ZIP is saved, use', 'メニュー → ZIPから読み込む': 'Menu → Import ZIP', 'に入れる': 'in this app',
    'ボードの名前ごと、並んだ状態で復元されます。セクションは「区分け」になります。': 'The board comes back with its name and layout. Sections become sections.',
    '最後に「ボードのピン◯件・見つけた◯枚」と内訳が出るので、足りないときはその数を教えてください': 'At the end it shows “pins on board / found”. If some are missing, tell us those numbers.',
    'コードをコピー': 'Copy code', 'pinterest.com/(自分のID)/(ボード名)/': 'pinterest.com/(your ID)/(board)/',
    'コピーしました<br>Chromeの Console に貼り付けてください': 'Copied — paste it into Chrome’s Console', 'コピーしました': 'Copied', 'Chromeの Console に貼り付けてください': 'Paste it into Chrome’s Console',
    '（コードを読み込めませんでした）': '(couldn’t load the code)',
    /* ---- メニュー ---- */
    '元にもどす': 'Undo', 'やり直す': 'Redo', 'まるごと書き出し': 'Export everything', '画像ごと1つのZIPに。これが本当のバックアップ': 'One ZIP with all images — your real backup',
    'USBに書き出す': 'Export to USB', '挿したパソコンで、そのまま広げて見られる形にする': 'Make it viewable on any computer you plug it into',
    'USBとつなぐ': 'Sync with USB', 'USBと突き合わせて、まだ無い写真だけやりとりする': 'Compare with the USB and copy only what’s missing',
    '1枚の画像にして送る': 'Send as one image', 'LINEやメールでそのまま人に渡せます': 'Ready to share by message or email',
    'PDFにして送る': 'Send as PDF', '人に渡す用。1枚にまとめる / 1枚ずつ': 'To hand to someone. One page / one per page',
    '印刷する': 'Print', 'ボードのまま / 格子 / 1枚ずつ': 'As the board / grid / one per page',
    'ZIPから読み込む': 'Import ZIP', '別の端末や、書き出したファイルから復元': 'Restore from another device or an export',
    'Macの「ショートカット」と使う': 'Use with Mac Shortcuts', 'スクショを自動でストックへ・右クリックから入れる': 'Screenshots straight to Stock, add from right-click',
    'キーボードのショートカット': 'Keyboard shortcuts', '⌘/ でも開けます': 'Or press ⌘/',
    '重複をさがす': 'Find duplicates', '似た写真をまとめて、ゴミ箱へ整理できます': 'Group similar photos and clear them out',
    'ゴミ箱': 'Trash', '外した写真を戻せます': 'Bring removed photos back', 'ボードの名前を変える': 'Rename board',
    'このボードを削除': 'Delete this board', '写真そのものは他のボードに残ります': 'The photos stay on other boards',
    /* ---- 設定 ---- */
    'ライブラリ（写真の置き場所）': 'Library (where photos live)', '中身': 'Contents', 'Finderで見る': 'Show in Finder', '場所を変える…': 'Change location…',
    'テーマ': 'Theme', '自動': 'Auto', 'ライト': 'Light', 'ダーク': 'Dark', '差し色': 'Accent', 'ブルー': 'Blue', 'コーラル': 'Coral', 'グリーン': 'Green', 'モノ': 'Mono',
    '文字の大きさ': 'Text size', 'ふつう': 'Normal', '大きい': 'Large', 'もっと大きい': 'Larger', '盤面': 'Canvas', '背景': 'Background',
    'くろ': 'Black', 'グレー': 'Gray', 'しろ': 'White', '紙': 'Paper', 'ドット': 'Dots', '影': 'Shadow', 'すきま': 'Gap', 'せまい': 'Narrow', 'ひろい': 'Wide',
    'スナップ': 'Snap', '操作': 'Controls', '何もない所をドラッグ': 'Drag on empty space', '囲んで選ぶ': 'Select by box', '動かす': 'Pan',
    '2本指': 'Two fingers', '2本指のスクロールで動かす': 'Two-finger scroll pans', '拡大する': 'Zoom', '動き': 'Motion', 'なめらか': 'Smooth', '控えめ': 'Reduced',
    'パソコンでは': 'On a computer', 'ピンチ（または ⌘＋スクロール）で拡大': 'Pinch (or ⌘ + scroll) to zoom',
    '背景と影は「1枚の画像にして送る」にも反映されます。': 'Background and shadow also apply to “Send as one image”.',
    '言語': 'Language', 'クラウド（iCloud・Google フォト・Amazon Photos）': 'Cloud (iCloud, Google Photos, Amazon Photos)', '写真アプリにも入れる': 'Also add to Photos', 'クラウド用フォルダにも置く': 'Also put in cloud folder', 'しない': 'Off', '自動で': 'Auto', 'フォルダを開く': 'Open folder',
    '「自動で」にすると、MOOD BOARD に入れた写真が、写真アプリのアルバム「MOOD BOARD」（iCloud 写真で iPhone へ）や、ピクチャの「MOOD BOARD 書き出し」フォルダにも入ります。Google フォト・Amazon Photos は、それぞれのパソコン用アプリでこのフォルダをバックアップに加えてください（右上の ？ の「Mac とスマホで写真をやりとり」）。': 'With “Auto”, photos you add to MOOD BOARD also go to the “MOOD BOARD” album in Photos (and on to your iPhone via iCloud Photos) and to the “MOOD BOARD 書き出し” folder in Pictures. For Google Photos and Amazon Photos, add that folder to backup in their desktop apps (see “?” › Moving photos between Mac and phone).',
    'クラウドへ（写真をそのまま）': 'To the cloud (original photos)', '写真アプリに入れる（iCloud 写真）': 'Add to Photos (iCloud Photos)', 'アルバム「MOOD BOARD」へ。iCloud 写真がオンなら iPhone にも届く': 'Into the “MOOD BOARD” album — reaches your iPhone with iCloud Photos on',
    'クラウド用フォルダに置く': 'Put in cloud folder', 'Google フォト・Amazon Photos のアプリが上げてくれる': 'The Google Photos / Amazon Photos apps upload it',
    '{n} 枚を写真アプリのアルバム「{q}」に入れました': 'Added {n} to the Photos album “{q}”', 'iCloud 写真がオンなら、iPhone にも届きます': 'With iCloud Photos on, they’ll reach your iPhone too',
    '{n} 枚をクラウド用フォルダに置きました': 'Put {n} in the cloud folder', 'Google フォト・Amazon Photos のアプリが上げてくれます': 'The Google Photos / Amazon Photos apps will upload them',
    '送れる写真がありません': 'No photos to send', 'Mac版で使えます': 'Available in the Mac app', '直前のスクショを取り消しました': 'Removed the last screenshot', '動画': 'Video', '再生': 'Play', '動画 {n}': 'Videos {n}', '動画は切り抜けません': 'Videos can’t be cropped', 'この動画は読めません': 'This video can’t be read', '付箋の色': 'Card color', '線の色と太さ': 'Line color and width', 'クリーム': 'Cream', 'ピンク': 'Pink', '水色': 'Light blue', 'ミント': 'Mint', 'レモン': 'Lemon', '緑': 'Green', '使い方': 'Help', '使い方（？）': 'Help (?)', '使い方（説明書）': 'How to use', '？ ／ ⌘?': '? / ⌘?', '自由': 'Free', '＝ぜんたい・': '= fit all ·', '＝ならべる・': '= arrange ·', '＝はずす・': '= remove ·', '＝貼り付けて入れる。': '= paste to add.',
    '{n} 個のボード ・ {n} 枚': '{n} boards · {n} photos', '{n} 使用（この端末の上限 {n}）': '{n} used (limit on this device {n})',
    '{n} 使用（空き {n}）': '{n} used ({n} free)', '{n} 枚・{n}（空き {n}）': '{n} photos · {n} ({n} free)', '{n} 枚・{n}（空き {n}）・USBメモリなど': '{n} photos · {n} ({n} free) · removable drive',
    /* ---- 写真を整える・色 ---- */
    '写真を整える': 'Adjust photo', '明るさ': 'Brightness', 'コントラスト': 'Contrast', '彩度': 'Saturation', '色温度': 'Warmth', '補正': 'Adjust',
    'うすくする': 'Fade', 'かたむける': 'Tilt', '動かすと、その場で写真に反映されます。': 'Changes apply as you move them.',
    'クリア': 'Reset', '配色をつくる': 'Color harmony', 'もとの色（押すと変えられます）': 'Base color (click to change)',
    'もとの色から、合う色の組み合わせを出します。「置く」で色見本として盤面に並べます。': 'Suggests colors that go with the base. “Place” puts them on the canvas as swatches.',
    'このボードの色': 'This board’s colors', '好きな色': 'Any color', '色をタップするとコードをコピーします': 'Click a color to copy its code',
    '色見本として盤面に置きます。写真と一緒に並べると、配色の方向性が決めやすくなります。': 'Placed on the canvas as swatches — next to photos, it’s easier to decide on colors.',
    '補色': 'Complementary', '反対側の色。強い対比': 'The opposite color. Strong contrast', '類似色': 'Analogous', '隣どうしの色。まとまりが出る': 'Neighboring colors. Cohesive',
    'トライアド': 'Triad', '3等分の色。にぎやか': 'Three evenly spaced colors. Lively', '分裂補色': 'Split complementary', '補色の両隣。対比をやわらげる': 'Either side of the complement. Softer contrast',
    'トーン': 'Tones', '同じ色の明るさ違い': 'Same color, different lightness', 'くすませる': 'Muted', '彩度を落として落ち着かせる': 'Lower saturation to calm it down',
    /* ---- 道具 ---- */
    'かく': 'Draw', 'ペン': 'Pen', '線・矢印': 'Line & arrow', '四角・丸': 'Box & circle', '線': 'Line', '矢印': 'Arrow', '四角': 'Box', '丸': 'Circle',
    '細い': 'Thin', '太い': 'Thick', '黒': 'Black', '白': 'White', '赤': 'Red', '青': 'Blue', '黄': 'Yellow',
    '選んだものに': 'On selection', 'しっぽの向き': 'Tail direction', '固定': 'Lock', 'スポイト': 'Eyedropper',
    '白黒で見る': 'View in gray', '反転して見る': 'View mirrored', '構図ガイド': 'Composition guide', '撮影データ': 'Photo info', 'プレゼン': 'Present',
    'ランダムに散らす': 'Scatter', '面積をそろえる': 'Equal area', '見る': 'View', '道具を開く': 'Open tools',
    '写真などを選んでから開くと、「選んだものに」の道具が使えます。': 'Select something first to use the “On selection” tools.',
    '写真などを選んでから使います': 'Select something first', '写真を選んでから使います': 'Select a photo first', '吹き出しを選んでから使います': 'Select a speech bubble first',
    '「選んだものに」は、いま選んでいる1つにかかります。': '“On selection” applies to the one you selected.',
    'なぞると描けます。shift を押すとまっすぐ／正円に。終わったら「おわる」': 'Drag to draw. Hold shift for straight lines / circles. Press “Done” when finished',
    '左右を反転して表示しています。構図のかたよりを見るときに（この間は動かせません）': 'Showing mirrored — good for checking balance (can’t move things meanwhile)',
    '白黒で表示しています。明暗の配分を見るときに': 'Showing in gray — good for checking light and dark',
    'ランダムに散らしました。もう一度押すと別の散らし方になります': 'Scattered. Press again for a different scatter',
    '面積をそろえました。「ならべる」で詰め直すときれいに並びます': 'Equalized area. Use “Arrange” to tidy up',
    '2つ以上あるときに使えます': 'Needs two or more', '2枚以上えらんでください': 'Select two or more', '等間隔にするには3枚以上えらんでください': 'Select three or more to space evenly',
    /* ---- 1枚表示 ---- */
    'まわす': 'Rotate', '元の形に': 'Uncrop', '色をとる': 'Pick colors', 'ガイド': 'Guide', '情報': 'Info', '盤面に置く': 'Place on canvas', 'コピー': 'Copy',
    'カメラ': 'Camera', 'レンズ': 'Lens', '撮影日': 'Taken', '出どころ': 'Source', '明暗のかたより': 'Light/dark balance',
    '明部が飛び気味': 'Highlights clipping', '暗部がつぶれ気味': 'Shadows crushed',
    'この写真には残っていません（ネットの画像やスクショには無いことが多い）': 'Not recorded in this photo (web images and screenshots usually don’t have it)',
    '写真の、色をとりたいところを押してください': 'Click the spot you want the color from',
    '三分割': 'Rule of thirds', '黄金比': 'Golden ratio', '対角線': 'Diagonals', '4:5 縦投稿': '4:5 portrait post', '9:16 ストーリー': '9:16 story',
    '16:9 横': '16:9 landscape', 'A判 誌面': 'A-size page', 'ガイド：{q}': 'Guide: {q}',
    /* ---- くらべる ---- */
    'レイアウト': 'Layout', 'おまかせ': 'Auto', '格子': 'Grid', 'かさねる': 'Overlay', '「かさねる」は2枚を選んでください': 'Select two for “Overlay”',
    /* ---- ならべる ---- */
    'ならべかた': 'Arrange', 'すきまなく積む': 'Pack tightly', '大きさを揃えて、隙間なく詰める': 'Even sizes, packed tight',
    '色の順にならべる': 'Arrange by color', '似た色味が隣り合うので、方向性が一目で分かる': 'Similar colors sit together, so the direction is clear at a glance',
    '区分けごとにまとめる': 'Group by section', '「素材」「照明」などの区分けごとに、見出しを付けて段に分ける': 'Rows with headings for each section, like “materials” or “lighting”',
    'ならべました': 'Arranged', '色の順にならべました': 'Arranged by color', '{n} つの区分けにまとめました': 'Grouped into {n} sections',
    '区分けがまだありません<br>写真を選んで「タグ」から付けられます': 'No sections yet — select photos and add them from “Tags”',
    '区分けがまだありません': 'No sections yet', '写真を選んで「タグ」から付けられます': 'Select photos and add them from “Tags”',
    '「ならべる」でこのすきまになります': 'Applied the next time you arrange',
    'つめる': 'Tight', 'ひろく': 'Wide', '余白': 'Margin', '幅をそろえる': 'Same width', '高さをそろえる': 'Same height', '等間隔': 'Even spacing',
    '{n} 枚をきれいに並べ直します。': 'Tidy up {n} items.', '枚をきれいに並べ直します。': 'items will be tidied up.',
    /* ---- 送る ---- */
    '形': 'Format', 'くらべるシート（PDF）': 'Comparison sheet (PDF)', '1枚の画像': 'One image', '1枚ずつ（PDF）': 'One per page (PDF)',
    '写真そのまま': 'Original photos', '盤面のまま（PDF）': 'As the canvas (PDF)', '向き': 'Orientation', '番号とひとこと': 'Numbers and captions',
    '入れる': 'Include', '入れない': 'Leave out', 'タイトル': 'Title', 'ファイル名と、シートの上に出る': 'Used for the file name and the sheet heading',
    'この形で印刷する（印刷のシートへ）': 'Print this way (go to Print)', 'このボードを送る': 'Send this board', '{n} 枚を送る': 'Send {n}',
    'ボードの全部（{n} 個）': 'The whole board ({n} items)', 'えらんだ {n} 個': '{n} selected', 'えらんだ {n} 個（うち写真 {n} 枚）': '{n} selected ({n} photos)',
    '送る…（AirDrop・メールなど）': 'Send… (AirDrop, Mail and more)',
    '番号付きで並べたPDF（1ページに12枚まで。多いときは続きのページへ）。「3番の光がいい」のように話せます': 'A numbered PDF (up to 12 per page). Easy to say “I like the light in #3”.',
    'LINE やインスタのDMにそのまま貼れる、1枚の画像（JPEG）': 'One image (JPEG) you can drop into any chat',
    '1ページに1枚ずつ、大きく入ったPDF（{n}ページ）': 'A PDF with one large photo per page ({n} pages)',
    '写真を1枚ずつのファイルで。名前は「タイトル_番号_ひとこと」': 'Each photo as its own file, named “title_number_caption”',
    'いまの盤面の並びのまま、1ページのPDF': 'A one-page PDF laid out like the canvas',
    '送るものがありません': 'Nothing to send', '作れるものがありませんでした': 'Nothing could be made', '作っています': 'Making…', '写真を用意しています': 'Preparing photos…',
    '保存しました（{n}）': 'Saved ({n})', '{n} 個のファイルを保存しました（{n}）': 'Saved {n} files ({n})',
    /* ---- 印刷・PDF ---- */
    '用紙': 'Paper', 'A4 たて': 'A4 portrait', 'A4 よこ': 'A4 landscape', 'A3 たて': 'A3 portrait', 'A3 よこ': 'A3 landscape', '対象': 'Scope',
    'ボード全部': 'Whole board', '選んだものだけ': 'Selection only', 'ボードのまま': 'As the board', '1枚ずつ': 'One per page', '白黒': 'Grayscale',
    'PDFにする': 'Make PDF', 'PDFを作っています': 'Making PDF…', 'PDFにするものがありません': 'Nothing to put in a PDF', '印刷するものがありません': 'Nothing to print',
    '印刷 / PDF': 'Print / PDF', '{n} 枚': '{n} photos', '組んでいます': 'Laying out…',
    /* ---- ショートカット一覧 ---- */
    '文字を打っている間は、文字の入力が優先されます。Mac版ではメニューバーにも同じものが並んでいます。': 'While typing, keys go to the text field. In the Mac app the same commands are in the menu bar.',
    '新しいボード': 'New board', '次のボード': 'Next board', '前のボード': 'Previous board', 'ボード一覧へ戻る（何も選んでいないとき）': 'Back to boards (when nothing is selected)',
    '写真をいれる': 'Add photos', 'コピーした画像を貼り付ける': 'Paste a copied image', 'ぜんぶ選ぶ': 'Select all', '選ぶモードに入る／出る': 'Enter / leave select mode',
    '元にもどす ／ やり直す': 'Undo / redo', '写真をコピー（ほかのアプリに貼れる）': 'Copy photo (paste into other apps)', 'はずす（ゴミ箱へ）': 'Remove (to Trash)',
    '少し動かす ／ 大きく動かす': 'Nudge / nudge more', '矢印 ／ ⇧＋矢印': 'Arrows / ⇧ + arrows', 'いちばん前へ': 'Bring to front', 'いちばん後ろへ': 'Send to back',
    '固定する／外す': 'Lock / unlock', '大きく見る（写真を1枚選んで）': 'View large (one photo selected)', '全体を見る': 'Fit all', '等倍（100%）': 'Actual size (100%)',
    '拡大 ／ 縮小': 'Zoom in / out', 'グリッド表示との切り替え': 'Toggle grid view', 'くらべる（写真を2〜6枚選んで）': 'Compare (select 2–6 photos)',
    'スペース＋ドラッグ': 'Space + drag', '盤面を動かす': 'Pan the canvas', '石積みにならべる': 'Arrange as masonry', '送る・印刷・PDF': 'Send / print / PDF',
    '1枚の画像に書き出す': 'Export as one image', 'まるごと書き出し（ZIP）': 'Export everything (ZIP)', 'このショートカット一覧': 'This list',
    'ストックを開く': 'Open stock', '直す': 'Edit', '{n}': '{n}',
    /* ---- Macの「ショートカット」と使う ---- */
    'ここに書いてあることは、Mac版の MOOD BOARD で使えます。': 'Everything here works in the Mac app.', '取り込みフォルダ': 'Inbox folder', 'Finderで開く': 'Open in Finder', '場所をコピー': 'Copy path',
    'このフォルダに入った写真は、': 'Photos that land in this folder', '自動でストックに入ります': 'go into Stock automatically',
    '（入れたものは「取り込んだもの」へ移ります）。ショートカットやスクリーンショットの保存先にすると、撮ったものがそのまま貯まります。': '(they’re then moved to “取り込んだもの”). Make it the destination of a shortcut or of screenshots and everything collects here.',
    'スクショを全部ストックへ（いちばん手軽・設定1回）': 'All screenshots to Stock (easiest — set once)',
    '⌘⇧5 →「オプション」→「保存先」→「その他の場所…」で、上の取り込みフォルダを選ぶ。以後 ⌘⇧4 などで撮ったスクショが、そのままストックに入ります。許可は要りません。': '⌘⇧5 → Options → Save to → Other Location… and choose the inbox folder above. Screenshots (⌘⇧4 etc.) then go straight into Stock. No permission needed.',
    '撮ってすぐ入れるショートカット': 'A shortcut that captures and adds',
    'ショートカットで新規 →「スクリーンショットを撮る」→「ファイルを保存」（保存先：取り込みフォルダ／「保存先を尋ねる」はオフ）。右の「i」→「キーボードショートカットを追加」で、好きなキーに割り当てられます。': 'New shortcut → “Take Screenshot” → “Save File” (to the inbox folder, “Ask Where to Save” off). Use “i” → “Add Keyboard Shortcut” to put it on any key.',
    'Finderの右クリックから入れる': 'Add from Finder’s right-click',
    'ショートカットで新規 → 右の「i」→「クイックアクションとして使用」と「Finder」にチェック →「ファイルを保存」（保存先：取り込みフォルダ）。写真を右クリック →「クイックアクション」に出ます。': 'New shortcut → “i” → check “Use as Quick Action” and “Finder” → “Save File” (to the inbox folder). It appears under right-click → Quick Actions.',
    '連続スクショをキー1つで始める': 'Start a screenshot series with one key', 'ショートカットで新規 →「URLを開く」に': 'New shortcut → “Open URLs” with',
    'を入れて、キーボードショートカットを割り当てる。': ', then assign a keyboard shortcut.', 'ほかの呼び出し方：': 'Other ways in:',
    '（ストックを開く）／': '(open stock) /', '（入れる）': '(add)', 'moodboard://add?path=写真やフォルダの場所&to=stock': 'moodboard://add?path=photo-or-folder&to=stock',
    '場所をコピーしました。ショートカットの保存先に貼り付けられます': 'Path copied — paste it as the shortcut’s destination', '（Mac版のライブラリの中）': '(inside the Mac app’s library)',
    /* ---- USB ---- */
    'USBを選ぶ': 'Choose USB', 'USBに保存する': 'Save to USB', 'この端末に取り込む': 'Import to this device', 'まだ無い写真だけ': 'Only what’s missing',
    'USBにまだ無い写真': 'Photos not yet on the USB', 'この端末にまだ無い写真': 'Photos not yet on this device', '両方にある（保存済み）': 'On both (saved)',
    '前回のUSBにつなぐ': 'Connect to last USB', '調べ直す': 'Check again', 'やり方': 'How', 'USBの中の': 'The USB’s', 'フォルダと突き合わせて、': 'folder is compared, and',
    'をやりとりします。写真そのものはUSBに残るので、別の端末でも同じものを取り込めます。': 'gets copied. The photos stay on the USB, so other devices can import them too.',
    'USBに MOOD BOARD フォルダがありません。': 'There’s no MOOD BOARD folder on the USB.', '「USBに保存する」で作られます。': 'It’s created by “Save to USB”.',
    'このブラウザではフォルダに直接つなげません。': 'This browser can’t connect to folders directly.',
    'パソコンのChromeかEdgeでお使いください。iPhoneの場合は「まるごと書き出し」のZIPでやりとりしてください。': 'Use Chrome or Edge on a computer. On iPhone, move things with the “Export everything” ZIP.',
    'Mac版では、ライブラリそのものをUSBメモリに置けます。': 'In the Mac app you can keep the library itself on a USB drive.',
    '設定（歯車）→ ライブラリ →「場所を変える…」でUSBメモリを選ぶと、写真とボードがそのままUSBに入ります。': 'Settings (gear) → Library → “Change location…” and pick the USB drive — photos and boards go there as they are.',
    'USBに入れて持ち歩き、別のMacの MOOD BOARD で開くこともできます。': 'Carry it around and open it in MOOD BOARD on another Mac.',
    /* ---- ゴミ箱・重複 ---- */
    'ボードから外した写真です。いつでも戻せます。': 'Photos removed from the board. You can bring them back anytime.', 'ぜんぶ戻す': 'Restore all',
    'ゴミ箱を空にする': 'Empty Trash', '写真の実体ごと完全に消して、容量を空けます。': 'Delete the photos for good and free up space.', '戻せません': 'Can’t be undone',
    '重複さがし': 'Duplicates', '見た目が近い写真をグループにしました。': 'Grouped photos that look alike.', '残す候補': 'Keep', '重複は見つかりませんでした': 'No duplicates found',
    '。ゴミ箱に入れるだけなので、いつでも戻せます。': '. They only go to Trash, so you can bring them back.',
    '写真そのものは消えません': 'The photos themselves stay', '写真そのものは消えていません': 'The photos themselves are still there',
    /* ---- うつす ---- */
    '移す': 'Move', 'このボードの中で複製': 'Duplicate on this board', '写真そのものは1つのまま、置き場所だけが増えます。容量は変わりません。': 'Still one photo, just placed twice. No extra space used.',
    '移しました': 'Moved', '複製しました': 'Duplicated', '{n} 枚複製しました': 'Duplicated {n}',
    /* ---- トースト（よく出るもの） ---- */
    '{n} 枚いれました': '{n} added', '{n} 枚をストックに入れました': '{n} added to Stock', '{n} 枚をボードに入れました': '{n} added to the board',
    '{n} 枚えらびました': '{n} selected', '{n} 枚に付けました': 'Added to {n}', '{n} 枚にタグを付けました': 'Tagged {n}',
    '{n} 枚は読めない形式でした': '{n} were in an unreadable format', '{n} 枚はHEIC形式で、この環境では開けませんでした': '{n} were HEIC and can’t be opened here',
    '{n} 枚はHEIC形式で、このブラウザでは開けませんでした。': '{n} were HEIC and this browser can’t open them.',
    'iPhoneの 設定 → カメラ → フォーマット を「互換性優先」にすると、': 'Set iPhone Settings → Camera → Formats to “Most Compatible” and',
    'これから撮る写真はJPEGになります': 'new photos will be JPEG',
    'ゴミ箱に入れました': 'Moved to Trash', 'メニューからいつでも戻せます': 'Bring it back anytime from the menu', 'もどしました': 'Undone', 'やり直しました': 'Redone',
    'これ以上もどせません': 'Nothing more to undo', 'やり直せるものがありません': 'Nothing to redo', '保存しました': 'Saved',
    '左右を反転しました': 'Flipped horizontally', '上下を反転しました': 'Flipped vertically', 'いちばん前にしました': 'Brought to front', 'いちばん後ろにしました': 'Sent to back',
    '固定しました。触っても動きません（ならべるでは動きます）': 'Locked. It won’t move when touched (Arrange still moves it)', '固定をはずしました': 'Unlocked',
    '先にボードを開いてください': 'Open a board first', 'ほかのボードがありません': 'No other boards', '画像が見つかりませんでした': 'No images found', '画像が見つかりません': 'Image not found',
    'タップで選ぶ／何もない所をドラッグすると枠で囲んで選べます': 'Click to select / drag on empty space to select by box',
    '写真を1枚えらぶと、コピーできます': 'Select one photo to copy it', '写真をコピーしました。ほかのアプリに貼り付けられます': 'Photo copied — paste it into other apps',
    'コピーできませんでした': 'Couldn’t copy', 'この環境ではコピーできません': 'Copying isn’t available here',
    '写真を2〜6枚えらぶと、くらべられます': 'Select 2–6 photos to compare', '写真を2〜6枚えらぶと使えます': 'Needs 2–6 photos',
    'ストックに取り込んでいます': 'Importing to Stock…', '写真を取り込んでいます': 'Importing photos…', '取り込んでいます': 'Importing…', '{n} / {n} 枚目': '{n} / {n}',
    '{n} 枚をストックから消しました': 'Deleted {n} from Stock',
    'えらんだ写真は、どれもボードに載っています。<br>ボードから外すと、ここからも消せるようになります': 'All selected photos are on boards — remove them from the boards first',
    'えらんだ写真は、どれもボードに載っています。': 'All selected photos are on boards.', 'ボードから外すと、ここからも消せるようになります': 'Remove them from the boards to delete them here.',
    '保存できませんでした。ライブラリのフォルダ（USBメモリなど）が外れていないか確かめてください': 'Couldn’t save. Check that the library folder (USB drive, etc.) is still connected',
    '保存できるようになりました': 'Saving works again', '名前を変えました': 'Renamed', '削除しました': 'Deleted', 'ボードの名前': 'Board name', '無題のボード': 'Untitled board',
    'ボードが見つかりません': 'Board not found', '見せるものがありません': 'Nothing to show', '中止しました': 'Stopped',
    '{n} 枚を完全に消しました': 'Deleted {n} for good', 'ゴミ箱へ': 'To Trash', '書き出しています': 'Exporting…', '読み込んでいます': 'Loading…',
    'PDFにしました（{n}ページ・{n}）': 'Made a PDF ({n} pages, {n})', 'そのまま送れます': 'Ready to send',
    '似た写真をさがしています': 'Looking for similar photos…', '色を調べています': 'Checking colors…', '切り抜いています': 'Cropping…', 'まわしています': 'Rotating…',
    '元の形に戻しました': 'Uncropped', '元の向きに戻りました': 'Back to the original orientation',
    '切り抜きました<br>元の写真も残っています（1枚表示から「元の形に」）': 'Cropped — the original is kept (“Uncrop” in the photo view)',
    '切り抜きました': 'Cropped', '元の写真も残っています（1枚表示から「元の形に」）': 'The original is kept (“Uncrop” in the photo view)',
    'この端末では保存領域が使えませんでした。': 'Storage isn’t available on this device.', 'プライベートブラウズをオフにしてお試しください。': 'Try turning off private browsing.',
    'ショットリスト': 'Shot list', '★全身・正面\n★バストアップ\n手元のアップ\n後ろ姿': '★Full body, front\n★Bust\nHands close-up\nFrom behind',
    '1行に1項目。頭に ★ を付けると「必須」': 'One per line. Start with ★ for “must have”',
    'チェックリストの見出し（例：撮るカット・持ち物）': 'Checklist title (e.g. shots, things to bring)', '吹き出しのことば': 'Bubble text',
    '文字を書く': 'Write text', '文字を編集（空にするとゴミ箱へ）': 'Edit text (empty moves it to Trash)',
  };

  /* 数字・「」の中身をひな形にする */
  const NUM = /\d+(?:[.,]\d+)*(?:\s?(?:KB|MB|GB|B)\b)?/g, QUOTE = /「[^」]*」/g;
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  // 辞書の側も同じ形にそろえる（全角の空白や改行の違いで引けなくならないように）
  for (const k of Object.keys(EN)) { const nk = norm(k); if (nk !== k && !(nk in EN)) EN[nk] = EN[k]; }
  function tr(text) {
    if (!text) return text;
    const raw = String(text), t = norm(raw);
    if (!t || !/[぀-ヿ㐀-鿿]/.test(t)) return raw;
    let out = EN[t];
    if (out == null) {
      const nums = t.match(NUM) || [];
      const key = t.replace(NUM, '{n}');
      out = EN[key];
      if (out == null) {
        const qs = [];
        const key2 = key.replace(QUOTE, (m) => { qs.push(m.slice(1, -1)); return '「{q}」'; });
        out = EN[key2];
        if (out != null) { let i = 0; out = out.replace(/\{q\}/g, () => qs[i++] || ''); }
      }
      if (out != null) { let i = 0; out = out.replace(/\{n\}/g, () => nums[i++] || ''); }
    }
    if (out == null) return raw;
    // 前後の空白は元のまま残す
    const lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
    return lead + out + tail;
  }

  /* ---- 画面に当てる ---- */
  const ORIG = new WeakMap();          // テキスト → 元の日本語
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  let lang = 'ja', mo = null;
  function applyText(node) {
    const cur = node.nodeValue;
    if (lang === 'en') {
      const o = ORIG.has(node) && tr(ORIG.get(node)) === cur ? ORIG.get(node) : cur;
      const t = tr(o);
      if (t !== o) { ORIG.set(node, o); if (cur !== t) node.nodeValue = t; }
    } else if (ORIG.has(node)) {
      const o = ORIG.get(node);
      if (tr(o) === cur) node.nodeValue = o;      // 英語のままなら元に戻す（画面側が書き換えていたら触らない）
      ORIG.delete(node);
    }
  }
  function applyAttrs(el) {
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const key = 'data-ja-' + a, cur = el.getAttribute(a);
      if (lang === 'en') {
        const o = el.hasAttribute(key) && tr(el.getAttribute(key)) === cur ? el.getAttribute(key) : cur;
        const t = tr(o);
        if (t !== o) { el.setAttribute(key, o); if (cur !== t) el.setAttribute(a, t); }
      } else if (el.hasAttribute(key)) {
        const o = el.getAttribute(key);
        if (tr(o) === cur) el.setAttribute(a, o);
        el.removeAttribute(key);
      }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return applyText(root);
    if (root.nodeType !== 1) return;
    if (root.tagName === 'SCRIPT' || root.tagName === 'STYLE' || root.isContentEditable) return;
    applyAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'TEXTAREA' || n.isContentEditable))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) applyText(n); else applyAttrs(n); }
  }
  function observe() {
    if (mo) return;
    mo = new MutationObserver((list) => {
      mo.disconnect();
      for (const m of list) {
        if (m.type === 'characterData') applyText(m.target);
        else if (m.type === 'attributes') applyAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
      mo.observe(document.body, OPTS);
    });
    mo.observe(document.body, OPTS);
  }
  const OPTS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS };

  function set(next) {
    lang = next === 'en' ? 'en' : 'ja';
    document.documentElement.lang = lang;
    document.documentElement.classList.toggle('lang-en', lang === 'en');
    if (mo) mo.disconnect();
    walk(document.body);
    if (mo) mo.observe(document.body, OPTS); else observe();
  }
  window.MB_I18N = { set, tr: (t) => (lang === 'en' ? tr(t) : t), get lang() { return lang; } };
})();
