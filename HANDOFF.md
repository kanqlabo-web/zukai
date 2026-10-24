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
| データ・ログイン | Firebase プロジェクト `zukai-8a392`（Firestore ＋ Authentication の Google ログイン） |
| 管理者アカウント | kanq.labo@gmail.com（`js/settings.js` の `ADMIN_EMAILS`） |
| 作業フォルダ（PC） | `C:\Users\kanql\Downloads\zukai_firebase\zukai`（中身はリポジトリと同じ。`公開する.bat` は Firebase 用で、もう使わない） |
| 料金 | Firebase 無料枠（Spark）。Firestore 1日 読み 5万・書き 2万。Drive / Picker API も無料 |

### 更新のしかた（これから）
- 直したら **GitHub の main に push するだけ**。Firebase への deploy はしない。
- **push のたびにバージョンを上げる**：`js/version.js` の `VERSION`・`DATE` を上げ、`CHANGELOG.md` の先頭に追記する（付け方は CHANGELOG の冒頭）。
- アプリを開いている人には、画面の下に「新しいバージョンが公開されました」と出る（`version.js` がサーバーの `version.js` と比べる。起動時・画面に戻ったとき・30分ごと）。「読み込み直す」で古い js / css を取り直してから再読み込みするので、Ctrl+Shift+R は要らない。
- 今のバージョンは、右上のアカウントのメニューの一番下とログイン画面に出る。

### 報告のしかた（ユーザーの希望）
- です／ます調の丁寧な日本語。最初に一文で結論、そのあと「ラベル：具体的な事実」の箇条書き。
- ユーザーのくだけた話し方はまねしない。
- 絵文字は使わない。アプリの中のアイコンも絵文字ではなく SVG で描く。

---

## 2. つくり

- ビルドなしの静的サイト。`index.html` ＋ ES モジュール（`js/*.js`）。
- 自作の仮想 DOM（`js/vdom.js` の `h()` / `render()`）。状態は `js/state.js` の `S`（`S.d` データ、`S.ui` 画面の状態、`S.route`）。`rerender()` で描き直し（rAF でまとめる）。
- `js/firebase-config.js` の `apiKey` を空にすると「デモモード」（データはブラウザの localStorage）。手元の動作確認はこれで行う。**コミット前に apiKey を必ず戻す**（`AIzaSyDFBoS_DMNN9EB7ohza1ijwHpDzFD93WBA`）。
- Firestore の構造：`works/{w}`（ライブラリー。cast＝メンバー一覧、participants / owners / viewers、linkRole / linkKey）と、その下の `episodes`（話）・`tracks`（トラック）・`drafts`（稿。script＝テマ友）・`blocks`（タイミングの段。anchor＝{offset, text}、items＝説明・図・写真）・`diagrams`（図。shapes）・`images`（写真）・`presence`（同時編集の表示）。ルールは `firestore.rules`。

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
  - 既存の話に新しいトラックとして追加できる。タイミングの順番が入れ替わらないよう、前のタイミングより前に戻らない探し方にしてある。
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
4. **文字の読み取りの誤り**：図形描画を図形に直すときの読み取りで、アニ→アユ、玉→王、台→合 などの誤りが残る（`drawconv.js`）。
5. **調査用ボタン**：ライブラリーのページの「（調査）クリップボードを保存」（管理者だけ）。不要になったら外す。

---

## 5. 確認のしかた（作業する側のメモ）

- 手元で `python3 -m http.server` で配信し、apiKey を空にしてデモモードで Playwright から確認する。「サンプルを作る」で中身のあるライブラリーができる。
- `node --check` は `.js` だと構文の誤りを見逃すことがあるので、`.mjs` にコピーしてから確認する。
- vdom は子の並びが変わると作り直すので、表示しないときも空の枠を置く（例：`NameTags`）。
