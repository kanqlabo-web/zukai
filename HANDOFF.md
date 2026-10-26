# 図解メーカー 引き継ぎ書

最終更新：2026-10-24

演劇の「図解」（テーマ活動の友＝台本、《タイミング》、説明、舞台の立ち位置の図）をみんなで作って書き出す Web ツール。
このファイルは、別の会話（プロジェクト）で作業を続けるための引き継ぎです。

---

## 1. 基本情報

| 項目 | 内容 |
|---|---|
| コード | GitHub `kanqlabo-web/zukai`（main ブランチ）。**公開リポジトリ** |
| サイト配信 | **GitHub Pages**（2026-10-24 から。Firebase Hosting はもう使わない） |
| データ・ログイン | Firebase プロジェクト `zukai-8a392`（Firestore ＋ Authentication の Google ログイン ＋ 同時編集の表示用の Realtime Database（シンガポール）） |
| 管理者アカウント | kanq.labo@gmail.com（`js/settings.js` の `ADMIN_EMAILS`） |
| 作業フォルダ（PC） | `C:\Users\kanql\Downloads\zukai_firebase\zukai`（中身はリポジトリと同じ。`公開する.bat` は Firebase 用で、もう使わない） |
| 料金 | Firebase 無料枠（Spark）。Firestore 1日 読み 5万・書き 2万。Drive / Picker API も無料 |

### 更新のしかた（これから）
- 直したら **GitHub の main に push するだけ**。Firebase への deploy はしない。
- **push のたびにバージョンを上げる**：`js/version.js` の `VERSION`・`DATE` を上げ、`CHANGELOG.md` の先頭に追記する（付け方は CHANGELOG の冒頭）。
- アプリを開いている人には、画面の下に「新しいバージョンが公開されました」と出る（`version.js` がサーバーの `version.js` と比べる。起動時・画面に戻ったとき・30分ごと）。「読み込み直す」で古い js / css を取り直してから再読み込みするので、Ctrl+Shift+R は要らない。
- 今のバージョンは、ホームのいちばん下・アカウントのメニュー・ログイン画面に出る（1.7.0 で左下の固定表示はやめた）。ページを開いた直後に古い版だと分かったら、お知らせを出さずに自動で読み込み直す（同じ版へは1回だけ。sessionStorage の `zukai-auto-reload`）。

### 報告のしかた（ユーザーの希望）
- です／ます調の丁寧な日本語。最初に一文で結論、そのあと「ラベル：具体的な事実」の箇条書き。
- ユーザーのくだけた話し方はまねしない。
- 絵文字は使わない。アプリの中のアイコンも絵文字ではなく SVG で描く。

---

## 2. つくり

- ビルドなしの静的サイト。`index.html` ＋ ES モジュール（`js/*.js`）。
- 自作の仮想 DOM（`js/vdom.js` の `h()` / `render()`）。状態は `js/state.js` の `S`（`S.d` データ、`S.ui` 画面の状態、`S.route`）。`rerender()` で描き直し（rAF でまとめる）。
- `js/firebase-config.js` の `apiKey` を空にすると「デモモード」（データはブラウザの localStorage）。手元の動作確認はこれで行う。**コミット前に apiKey を必ず戻す**（`AIzaSyDFBoS_DMNN9EB7ohza1ijwHpDzFD93WBA`）。
- Firestore の構造：`works/{w}`（ライブラリー。cast＝メンバー一覧、participants / owners / viewers、linkRole / linkKey）と、その下の `episodes`（話）・`tracks`（トラック）・`drafts`（稿。script＝テマ友）・`blocks`（タイミングの段。anchor＝{offset, text}、items＝説明・図・写真）・`diagrams`（図。shapes）・`images`（写真）・`presence`（同時編集の表示。Realtime Database が使えないときだけ）。ルールは `firestore.rules`。
- 同時編集の表示（1.6.0〜）：Realtime Database の `presence/{w}_{presenceKey}/{uid}`。`presenceKey` は作品（`works/{w}`）にあり、編集できる人が最初に作る（履歴には残さない）。接続が切れたら onDisconnect で消える。書けない・10秒つながらないときは、その回は Firestore の `works/{w}/presence` に切り替える。ルールは `database.rules.json`（コンソールの Realtime Database → ルールに貼る）。図の編集画面のマウスの位置（1.9.0〜）は `ptr: {g, x, y}`（舞台の座標）を 0.07 秒ごとに `update` で送り、受け取った側は画面全体を描き直さず `paintPointers` で矢印だけ動かす。ほかのページには出さない（1.10.0 で試したが、スマホとパソコンで見た目が違いすぎるため 1.10.1 でやめた）。

### 主なファイル
| ファイル | 役割 |
|---|---|
| `app.js` | ルーティング（`#/w/{w}`、`#/w/{w}/d/{d}`、`#/w/{w}/print/{d|e}/{id}`、`#/w/{w}/show/{d|e}/{id}`、`#/join/...`）、ヘッダー、ログイン画面 |
| `views-home.js` / `views-work.js` / `views-draft.js` | ホーム／ライブラリー（話・トラック一覧、読み込み）／稿の画面 |
| `editor.js` | 図の編集（図形・人・矢印・文字・画像、元に戻す、あとの図への反映、貼り付け） |
| `stage.js` | 図の描画（`shapeNode`、`StageSVG`、名前の配置 `layoutLabels`）。舞台は 1000×470 |
| `script.js` | テマ友の行の解析、タイミングの位置（`resolveAnchor`・`sortBlocks`・`buildRows`）、取り込み用の `findCue` |
| `print.js` | 書き出しページ。「書き出す」→ PDF（端末／ドライブ）・Googleドキュメント・Word |
| `pdfvec.js` / `pdf.js` | PDF の作成（文字・図はベクター、だめなら画像の PDF） |
| `docx.js` | Word（.docx）の作成。Googleドキュメントへの書き出しにも使う |
| `show.js` | 閲覧モード（図を大きく1枚ずつ。人がすべって動く） |
| `presence.js` | 同時に開いている人の表示（ヘッダーのアイコン、カーソル、選んでいる図形） |
| `docimport.js` / `pdfimport.js` / `pdfread.js` | Googleドキュメント（貼り付け）・図解 PDF の取り込み |
| `drawconv.js` / `drawimport.js` | Googleの図形描画（SVG）や PDF の図を、編集できる図形に直す（丸数字・文字の読み取り） |
| `clippaste.js` | 図の編集画面への貼り付け（画像・Googleドキュメントの図形描画・文字） |
| `gdrive.js` | Googleドライブ（フォルダ選択、PDF / ドキュメントの保存） |
| `version.js` ＋ `CHANGELOG.md` | バージョン表示と新しい版のお知らせ、更新履歴 |
| `sample.js` ＋ `sample/library.json` | 「サンプルを作る」の中身（管理者のライブラリーを書き出したもの） |
| `fonts/g/` | PDF 用の字形データ（Noto Sans CJK JP / Liberation Sans から作成） |

---

## 3. できていること（主な機能）

- **共有・同時編集**：Googleドキュメント風の共有（オーナー／編集者／閲覧者、リンク参加）。同時に開いている人の表示。
- **あとの図にも反映**：図形を動かすと、あとの図でも同じ図形（id、または形・名前・位置が近いもの）を同じだけ動かす。
- **タイミング**：テマ友に完全準拠。タイミング欄を押すと付け替え、付け替え後はテマ友の文字に置き換わる。
- **取り込み**（ライブラリーのページの「読み込む」）：
  - クリップボード：Googleドキュメントで Ctrl+A → Ctrl+C、このページで Ctrl+V。図形描画は Google から SVG で取り出して図形に直す（drive.readonly の許可が必要）。
  - 図解 PDF。
  - 既存の話に新しいトラックとして追加できる。
  - トラック（稿）のページで Ctrl+V しても取り込める（`views-work.js` の `importDocIntoTrack`）。白紙の稿なら確認なしでその稿に。中身があれば「新しい稿に取り込む」か「この稿を置き換える」（既定。`importZukai` の `replace`。前の行・図をすべて消してから入れ、`db.batchUndoable` で元に戻すの履歴に必ず残す）を選ぶ。`appendTo`（後ろに足す）は画面からは使っていない。図形描画は常に動かせる図に直す（`importZukai` の `toTrack`・`toDraftId`）。タイミングの順番が入れ替わらないよう、前のタイミングより前に戻らない探し方にしてある。
- **図の編集**：人を「図形にする」（石・草など）、図形の中の文字を図形の名前にする、画像・文字の貼り付け、画像は縦横比を保って拡大縮小（Shift で自由）。
- **書き出し**：「書き出す」から PDF（端末／Googleドライブに上書き保存でリンクそのまま）、Googleドキュメント（ドライブに作成）、Word。ドライブは drive.file 権限で、作ったファイルに目印（appProperties.zukai）を付けて次回上書き。
- **閲覧モード**：図を大きく表示、説明とテマ友を横（縦長画面では下）に。←→・図の左右クリック・テマ友の行クリックで移動。人が前の位置からすべる。写真は説明欄に小さく、押すと拡大。
- **ログイン**：アプリ内ブラウザ（LINE など）では「Safari / Chrome で開いて」の案内とリンクのコピー。
- **使い方マニュアル**：PDF（13ページ）を作成済み。

---

## 4. やりかけ・残っていること

1. **Googleスライドからの図形の貼り付け**（完了。2026-10-24）
   - `js/slidesclip.js` で、クリップボードの `application/x-vnd.google-docs-drawings-object+wrapped` を読む。記録 3＝図形（[3, id, 形, 行列, 属性, ページ]）、2＝グループ、15＝図形の中の文字、17＝文字の書式（6＝pt）。属性 14＝塗りのあり、15＝塗り、19＝線の色、22＝線の太さ、12＝フリーハンドの点、28／29＝線の始点／終点の矢印。座標は 25 EMU 単位で、図形のもとの大きさは 120000 四方。
   - 形の番号：8 楕円、6 四角、7 角丸四角、98 三角、108 テキストボックス、153 線、4 フリーハンド、72 右矢印、45 左矢印吹き出し、102 U ターン矢印、24 曲線矢印。名前の入った丸→人。知らない番号は同じ大きさの四角。
   - ほかの形を足すとき：調査用の自動保存（`saveClipForStudy`）は外したので、必要ならコミット d33eed8 以前の `editor.js` から戻して番号を調べ、`KIND` に足す。
2. **GitHub Pages に移ったことによる設定**（未確認）
   - Firebase Authentication の「承認済みドメイン」に `kanqlabo-web.github.io` を追加する。
   - Google Cloud の API キー（Browser key）の HTTP リファラー制限を使っているなら、`https://kanqlabo-web.github.io/*` を追加する。
   - `firebase-config.js` の authDomain は、web.app / firebaseapp.com 以外では `zukai-8a392.firebaseapp.com` を使う（GitHub Pages ではこれ）。iPhone のアプリ内ブラウザでのログインは引き続き不安定なことがある。
   - リポジトリが公開なので、サンプル（メンバーの呼び名・テマ友）も見える。気になるなら Private に（その場合 GitHub Pages は有料プランが必要）。
3. **drive.readonly 権限**：図形描画の取り出しに使っている。利用者が100人を超えるあたりで Google の審査が必要になり、ログイン時に「確認されていないアプリ」と出る。広く公開するなら見直す。
4. **取り込みのメモ（1.4.0）**：文字とみなすのは濃い塗り（灰色 0.6 未満）で、同じ枠の線がない形だけ（白抜き矢印の誤読対策）。人の塗りは `PERSON_WHITE`（0.88）より明るければ白。人を四角・三角で囲んだ図は、人の `outline: 'square'|'tri'` になる（`stage.js` の `personOutline`）。進み具合は `S.ui.importing`・`S.ui.importProg` を `app.js` の `ImportProgress` が表示。
5. **文字の読み取りの誤り**：図形描画を図形に直すときの読み取りで、アニ→アユ、玉→王、台→合 などの誤りが残る（`drawconv.js`）。2.5.0 から、図形描画は PDF でも書き出して本当の文字を使う（`pdfimport.js` の `drawingPdf` → `svgToPage` の `page.texts`）。PDF に文字がなければ形の読み取りに戻り、読んだ語はメンバー名・役名に寄せる（`drawconv.js` の `snapWord`、語は `drawimport.js` の `vocabOf`）。Google の PDF に本当に文字が入っているかは実物で未確認。2.22.0：写真の横並びは、写真の項目の `beside: true`（前の項目も写真のときだけ効く）。画面は `views-draft.js` で `.item-row` にまとめ、印刷は `.p-photo-row`、Word は同じ段落に続けて置く。取り込みは同じ段落の2枚目以降に付ける。2.15.0：斜めの文字は `drawconv.js` の `slantOf`（字の中心の並びの向き）で見つけ、`rotatePath` でまっすぐにして読む（文字の `rot`）。楕円は点が本当に楕円に乗るか確かめ、乗らなければ blob。図形の中の名前は `nameOff` で元の位置。写真の幅は表の `<colgroup>` の右の列の幅に対する割合（slice のときは HTML の colgroup を順に使う）を `it.w` に。2.10.0：スマートチップは slice の `dsl_entitypositionmap["first-party-link"]`（文字 \ue909 の位置）と `dsl_entitymap` の `fple-t`（題名）・`fple-u`（URL）。HTML では `data-rich-links`。説明の URL は `richtext.js` の `linkify` で <a class="tlink">。円の隣の名前は `drawconv.js` で番号も中の名前もない円に結びつけ、`labelOff` で元の側に置く。2.8.0：《A》～《B》の範囲のタイミングは、図解（block）の `cueEnd`（表示用の文字）と `anchorEnd`（{offset, text}）に入る。読むのは `script.js` の `cueRangeEnd`、目立たせるのは `highlightRanges`、見出しは `sheet.js` の `CueTitle(cue, upd, end)`。並び順や段は《A》だけで決まる。2.12.0：画面からの作成・編集は `views-draft.js`。新規は `startRange`（`S.ui.rangeStart`）→ `makeRangeBlock`、終わりの付け替えは `startReanchor(id, true)`（`S.ui.reanchorEnd`）→ `reanchorEndTo`。2.7.0：円の中の文字はまず役の一覧（表記→役名の順）と比べて `rid` にする（`drawimport.js` の `toDiagram`）。人の大きさと円の中の名前の位置は、ユーザーの希望で 2.8.1 で取り消した（人はふつうの大きさ、名前は円の外）。2.11.0：白抜きの太い矢印の外形（角7つ・角10）は `blockArrowOf` で矢印（片方向は `arrow`、両方向は `line` の block・head both）にする。2.16.0：曲がった太い矢印は `bentArrowFor` / `bentArrowOf`。囲み・線になった形に矢の先（首・返し・先・返し・首）があれば、首の真ん中から矢印の中の幅の真ん中をたどって中心線を作り、`line` の block（mode smooth）にする。曲がり矢印の裏側などの塗りだけの形（すぐ前後に描かれ、線の枠の中にあるもの）は矢印の中として使い、捨てる。先が2つある形などは、中心線のまわりに収まらないので囲みのまま。線は `shapesOf` で部分ごとに分け、`clipPoly` で舞台の外を切る（舞台からはみ出した線だけの形も `vis` に入れる）。
6. **調査用ボタン**：ライブラリーのページの「（調査）クリップボードを保存」（管理者だけ）。不要になったら外す。

---

## 5. 確認のしかた（作業する側のメモ）

- 手元で `python3 -m http.server` で配信し、apiKey を空にしてデモモードで Playwright から確認する。「サンプルを作る」で中身のあるライブラリーができる。
- `node --check` は `.js` だと構文の誤りを見逃すことがあるので、`.mjs` にコピーしてから確認する。
- vdom は子の並びが変わると作り直すので、表示しないときも空の枠を置く（例：`NameTags`）。

---

## 6. エラー番号（1.7.0〜）

利用者には「管理者（ADMIN_EMAILS の先頭）に知らせてください（エラー番号 E…）」と出す（`state.js` の `adminMsg`）。

| 番号 | 場所 | 意味 |
|---|---|---|
| E101 | `app.js` ログイン | このURLが Firebase Authentication の承認済みドメインにない（unauthorized-domain） |
| E102 | `app.js` ログイン | そのほかのログインの失敗（後ろに Firebase のエラーコードが付く。詳しくはコンソール） |
| E201 | `app.js` 起動 | Firebase を読み込めなかった（firebase-config.js・通信） |
| E301 | `views-home.js` | ライブラリー一覧を読む権限がない（firestore.rules が古い可能性） |
| E302 | `views-home.js` | ライブラリー一覧を読めなかった（通信など） |
| E401 | `views-work.js` 共有 | Googleグループで追加しようとしたが、`settings.js` の GROUP_LOOKUP_URL が空 |
| E501 | `moves.js` 動きの変更 | 送る権限がない（閲覧者が送ったが、firestore.rules の moves の部分がコンソールに貼られていない） |

## 7. 1.7.0 からの画面まわりのメモ

- LINE のアプリの中のブラウザ（UA に ` Line/`）では Google のログインができない（ポップアップが同じ画面で firebaseapp.com に移り、sessionStorage が分かれて「missing initial state」になる）。2.24.1 から `index.html` の先頭のスクリプトで URL に `openExternalBrowser=1` を付けて開き直し、LINE に Safari / Chrome で開かせる。開いた先では印を URL から消す。`app.js` の `LINE_APP` のときはログインのボタンも同じ動き。ほかのアプリ（Instagram など）は `InAppNote` の案内だけ。

- 稿の `figs: true`：テマ友なしでも図解がある稿の目印（`createBlock` が付ける）。`isEmptyDraft`（`views-draft.js`）で、空の稿のボタンを押せなくする。
- 図解の段のボタンは `S.ui.activeBlock` の段だけ表示（CSS で隠す。作り直すと入力中の欄が外れるため）。
- 図の編集を開くと `history.pushState({ zukaiEditor })` で履歴を1つ足し、popstate で閉じる（`editor.js`）。
- 書き出しへのリンクは `#/w/…/print/…?export`。開いたらすぐ `autoExport`（`print.js`）。キャンセルで `history.back()`。
- 「使い方」の開閉は localStorage の `zukai.howtoViews`（3回まで開いておく。閉じたら 99）。
- アイコンは `js/icons.js` の `icon(name)`。
- スマホ（1.7.1〜）：`pointer: coarse` だけの端末では、テマ友の欄は `contenteditable=false`。`S.ui.scriptTyping`（段の先頭位置）の段だけ書き換えられる（`views-draft.js` の `touchOnly`・`startScriptTyping`）。図の編集の2本指の拡大・スクロールは `editor.js` の `fingers`・`pinchStart`・`pinchMove`。
- 図解のページ（2.0.0〜）：図解（`blocks`）の中身は今までどおり `items`（order の順）で、データの形は変えていない。画面では1枚のページとして並べ、項目のあいだに「＋」（`InsertSlot`）。2.1.0 から「行頭」「足す」は上のツールバー（`FormatBar`）にあり、新しいタイミングは文章だけで作る（`model.js` の `createBlock`）。写真の幅は items の `w`（%、`photoWidth` で古い `size` s/m/l を 40/68/100 に読み替え）。カーソル位置への差し込みは `insertTarget` → `insertItems`（文章を `splitText` で行の区切りで2つに分ける。まだ保存していない打ち込みは `state.js` の `takePending` で一緒に保存）。文章の先頭の Backspace でつなげる（`noteKeyDown`）。写真の貼り付けは `richtext.js` の `onPasteFiles`、カーソル位置は `selectionchange` で `el._lastSel` に覚える。青字の判定（`update.js` の `blockUpdates`）は、図解の中のどの文章の欄にあった行でも「元からある行」とみなす。
- 下絵（1.8.0〜）：図（`diagrams`）の `trace: { img: 画像のid, op: 濃さ }`。画像は `images` に舞台の形（1000×470）に直した JPEG で保存。四隅を合わせる画面と射影変換は `js/trace.js`、図の編集への組み込みは `editor.js` の `pickTrace`・`finishTrace`・`TraceSection`。書き出し・閲覧モードには出さない。図を複製しても下絵は付いていかない。

- 役の一覧（2.3.0〜）：作品（`works/{w}`）の `roleList: [{ id, name, label }]`。図の人は `cid`（メンバー）の代わりに `rid`（役）を持てる。どのメンバーかは `cast.js` の `castIndex(cast, roleList)` が、メンバーの役（`roles[].rid`、なければ役名が同じもの）から `byRid` を作って決める（`personCast` が `rid` も見る）。役者未定なら番号なし・黒い円・役名。役名の表示は `personRole` / `roleShort`、役で置いた人の役名は図で隠していなければいつも出す（`roleVisible` の `explicit`）。画面はメンバー一覧の `RoleListSection`（`views-work.js`）と図の編集の `RoleChips`・`placeRole`・`setPersonRole`（`editor.js`）。castIndex を直接呼ばず `workIndex(work)` を使う。
- 前後のトラックの図（2.19.0〜）：`js/neighbors.js`。同じ話の前後のトラックの最新の稿の図を、図の編集を開いたときに `loadNeighbor` で読む（`db.list`、見るだけ）。左の一覧の上下に薄く出し、押すと `openOther`（`location.replace` で稿を移り、`openPendingEditor` がデータが届いてから開く。`app.js` の `watch` から呼ぶ）。`assign.js` の `previousShapes` は、トラックの最初の図なら前のトラックの最後の図を返す（最小ストレッチ・前の図の重ね表示が使う）。重ね表示は `editor.js` の `GhostLayer`（`E.ghost`、localStorage `zukai.ghost`）。
- コメント（2.20.0〜）：`js/comments.js`。`works/{w}/comments/{id}`（draftId・at・text・by・ts・replies（map）・done）。at は `script`（テマ友の s〜e と q）／`note`（図解 b の文章 it の s〜e と q）／`block`（図解 b）。文字がずれたら q を元の位置の近くで探し直す（`locate`）。黄色の目印は CSS Custom Highlight API（`paintCommentMarks`、`app.js` の renderPage のあと）。保存は `setQuiet`/`updateQuiet`/`removeQuiet` で、元に戻すの履歴に入れない。Firestore のルールは今のまま（作品の中身として編集者が書ける）。閲覧者は稿のページを開けないので、コメントも見られない。
- 動きの変更（2.30.0〜、2.31.0 からベータ版）：`js/moves.js`。`js/beta.js` の `betaOn()`（localStorage `zukai.beta`、アカウントのメニューの「ベータ版の機能を使う」）がオフの端末では、ボタン・知らせ・図の編集の欄・購読をすべて出さない。`works/{w}/moves/{id}`（draftId・trackId・blockId・cue・gid または base・moves{図形id:{x,y,fx,fy}}・note・me・by・ts・state open/done/skip）。演者は閲覧モードの「動きが変わった」（`ShowFigure`・`MoveSheet`）で送る。図のないタイミング（前の図のまま）では base に前の図を入れ、図解部が「このタイミングに図を作る」（`views-draft.js` の `figFromMove`）で写して足す。図解部の画面はトラックのページの `DraftMovesBar`、ライブラリーの `TrackMoveChip`、図の編集の `EditorMovesSection`・`EditorMovesLayer`（反映は `editor.js` の `applyMoves` → `commit`）。購読は `app.js` で state=='open' だけ。閲覧者も送れるよう `firestore.rules` に `match /moves/{id}` を足した（コンソールへの貼り直しが要る）。「あなた」は localStorage の `zukai.me.{w}`。
- 音声（2.32.0〜、ベータ版）：`js/audio.js`。トラック（`tracks/{t}`）の `audio: { id, name, type, size, dur, parts, by, ts }`。中身は `works/{w}/audio/{id}_{n}`（`data` に 700KB ずつの base64。Firebase Storage は使っていない）で、20MB まで。デモモードでは parts 0 で、この端末の IndexedDB だけ。読んだ音声は IndexedDB `zukai-audio` に控え、次からはサーバーから読まない。音声の読み込み・外すは元に戻すの履歴に入れない。タイミングの時刻は図解（`blocks`）の `sec`（秒）。閲覧モード（`show.js`）の上に `ShowAudioBar`。流している間は rAF で `targetAt`（sec がいまの時刻以下のいちばん後ろのタイミング）を見て `goTo(i, true)`（auto は音声の位置を動かさない）。手で移ったら `audioOnNav` がそのタイミングの sec に合わせる。「時刻を合わせる」（`A.sync`）では自動で送らず、「ここ」（Enter）で表示中のタイミングに今の時刻を付けて次へ。K で流す・止める。Firestore のルールは今のまま（作品の中身として、閲覧者は読める・編集者は書ける）。
- ベータ版（2.33.0〜）：写真から人を置く（`editor.js` の `startPick`・`pickAt`・`PickBar`、`E.pick`。`down` の最初で受ける）、自分目線（`moves.js` の `ShowMeSelect`・`MeNote`、`ShowFigure` の `focus`。SVG の中の `<style>` で自分以外を薄くする。「自分」は動きの変更と同じ `zukai.me.{w}`）、ぶつかりチェック（`js/clash.js` の `clashesOf`。重なり・大きな移動・場面の変わり目だけ。途中のぶつかり（同時にまっすぐ動いたときのすれ違い）は、演者が自分で避けるのでユーザーの希望で 2.41.2 で外した。しきい値は先頭の定数）。
- 時刻を自動で合わせる（2.37.0〜、ベータ版）：`audio.js` の `autoSync`。音声を `autosync.js` の `toMono16k` で 16kHz にし、`js/asr-worker.js`（module Worker）で transformers.js 3.7.1（jsdelivr）＋ `Xenova/whisper-base`（q8・wasm、約75MB、Hugging Face から。ブラウザに控えが残る）で30秒ずつ聞き取る。言語はテマ友の文字から決め（`langsOf`。英日なら両方で2回）、`matchTimes` で照らし合わせる：その言語の文字だけを取り出し、同じ並び（英語6文字・日本語4文字）が両方にあるところを候補にし（`gramPoints`）、時刻が後戻りしない最長の並び（`monotone`）だけを残し、タイミングの位置の時刻を前後から補う。全体を並べ合わせる方式は、もう一方の言語を訳した文などの混ざりものに引っぱられて崩れたのでやめた。手元での確認は `window.ZUKAI_ASR = { model, tjs, local: { models, wasm } }` で同じサイトのモデルを使える（npm の `sts-whisper-base` に同じモデルがある）。espeak の合成音声（英日）で確かめ、英語の段は1〜2秒以内、日本語は合成音声が聞き取れないため前後からの見積もりだった。実物の CD の音声では未確認。最後に聞き取った文字は `window.__zukaiHeard` で見られる。
- 1話まるごとの音源（2.40.0〜）：話のトラックすべてに同じ `audio`（同じ id、`shared: true`）を付ける（`importAudio` で選ぶ）。時刻（sec）は話の音声の中の位置。閲覧モードは `aidOf(ti)` が同じトラックを1つの音声として扱う（`timedSteps`・自動で送る・`markNow`・`onEnded`）。外すときや差し替えたときは、どのトラックも使わなくなった音声だけ中身を消す（`dropIfUnused`）。聞き取った文字は `works/{w}/audio/{id}_heard`（{ langs, out }、900KB 未満のとき）と IndexedDB の `{id}_heard` に保存し、使い回す。長い MP3 は `toMono16k` で 4MB ずつ読む（20分で 0.1秒ほどずれるだけ）。上限は 80MB。
- 歌詞のように流れるテマ友（2.41.0〜）：`audio.js` の `paintLyric`（再生中の rAF で、`.show-script` に `is-lyric`、いまの行の `.sline` に `sing`、前の行に `sung`。描き直しを待たず DOM に直接付ける）。行の時刻は `lineTimes`：聞き取った文字（`heardMem`、`loadHeard` で IndexedDB か Firestore から）があれば `matchTimes`、なければタイミングの sec のあいだを文字数で割り振る。流している間は `show.js` の `afterShow` が段の先頭へスクロールしない（`audioLyricOn`）。行を押すと `audioSeekLine`。聞き取りの途中の分は IndexedDB の `{id}_partial`（30秒ごと、Worker の `win`）で、次は `from` から続ける。
- 時刻の精度（2.42.0〜）：`asr-worker.js` の `hear` は `return_timestamps: 'word'`（Xenova/whisper-base で使える）。単語の時刻がそろって崩れた窓（英日が混ざる窓の日本語で起きる）は文ごとに聞き直す。前に長い間がある単語は始まりを終わりから見積もる。聞き取りの記録は `v: 2`（`HEARD_V`）で、古いものは自動合わせのときに聞き取り直す。`matchTimes` は行の頭の話し手の名前を `spokenFrom` で飛ばす。テマ友の行の時刻（`lineTimes`）は、タイミングの sec を決まった点にし、そのあいだを聞き取りの時刻（なければ文字数）で割り振る。CD_004（ライオンと魔女4話、33分）の英語の行で、単語の時刻が声の始まりに合うことを確かめた。日本語は単語の時刻が崩れることが多く、文ごと（または前後からの見積もり）になる。
- 閲覧モードのトラックまたぎ（2.43.0〜）：`#/w/{w}/show/d/{稿}` でも `loadPrint(params, true)`（wide）で同じ話のトラックをすべて並べる（開いた稿以外は各トラックの最新の稿）。`data.focus`（開いた稿）のトラックの最初の図から始める。書き出し（print）はこれまでどおり1トラックだけ。
