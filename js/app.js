// 起動・ログイン・画面の切り替え
import { h, render } from './vdom.js';
import { db, auth, initDB, mode, onDBError, history } from './db.js';
import { UndoButtons, undoAll, redoAll } from './undo.js';
import { S, rerender, setRenderers, toast, go } from './state.js';
import { HomeView, createSampleWork } from './views-home.js';
import { WorkView, CastView, ShareView } from './views-work.js';
import { DraftView, SelectionBar } from './views-draft.js';
import { EditorView } from './editor.js';
import { PrintView, loadPrint, layoutPages, clearPages } from './print.js';
import { P } from './model.js';
import { DialogView, isDialogOpen } from './dialog.js';
import { saveMyProfile, handleGroupResult } from './access.js';
import { setPresence, PresenceBar, presenceCol, paintCarets } from './presence.js';
import { ShowView, afterShow } from './show.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toasts = document.getElementById('toasts');
const $dialog = document.getElementById('dialog');

let subs = [];
function unsubAll() { for (const u of subs) { try { u(); } catch (e) { /* noop */ } } subs = []; }

// ---------- ルーティング ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'join' && parts[1] && parts[2]) return { name: 'join', params: { w: parts[1], key: parts[2] } };
  if (parts[0] === 'w' && parts[1]) {
    const w = parts[1];
    if (parts[2] === 'cast') return { name: 'cast', params: { w } };
    if (parts[2] === 'people') return { name: 'people', params: { w } };
    if (parts[2] === 'd' && parts[3]) return { name: 'draft', params: { w, d: parts[3] } };
    if (parts[2] === 'print' && parts[3] && parts[4]) return { name: 'print', params: { w, kind: parts[3], id: parts[4] } };
    if (parts[2] === 'show' && parts[3] && parts[4]) return { name: 'show', params: { w, kind: parts[3], id: parts[4] } };
    return { name: 'work', params: { w } };
  }
  return { name: 'home', params: {} };
}

function watch(key, fn) {
  subs.push(fn((v) => { S.d[key] = v; rerender(); }));
}

function onRoute() {
  const r = parseRoute();
  const same = JSON.stringify(r) === JSON.stringify(S.route);
  if (same && subs.length) return;
  S.route = r;
  unsubAll();
  S.d = {};
  S.ui = { ...(S.ui.keep || {}) };
  if (S.phase !== 'ready') { rerender(); return; }
  const { w, d } = r.params;
  if (r.name === 'home') {
    watch('works', (cb) => db.watchList('works', ['participants', 'array-contains', S.user.email], cb, (e) => {
      // 一覧が読めないときは、Firestore のルールが古いままのことが多い
      S.d.works = [];
      S.d.worksError = (e && e.code) || 'error';
      rerender();
    }));
  }
  // 同時に開いている人の表示：自分の場所を知らせ、ほかの人の場所を読む
  const pw = r.name === 'join' ? null : (w || null);
  setPresence(pw, { view: r.name, d: d || ((r.name === 'print' || r.name === 'show') && r.params.kind === 'd' ? r.params.id : null), block: null, row: null, g: null, sel: null });
  if (w && r.name !== 'print' && r.name !== 'show' && mode !== 'local') watch('presence', (cb) => db.watchList(presenceCol(w), null, cb, () => {}));
  if (r.name === 'join') { joinByLink(r.params); return; }
  if (w && r.name !== 'print' && r.name !== 'show') {
    // 参加していないライブラリーは読めない（その場合は「見つかりません」と表示）
    const denied = () => { S.d.work = null; rerender(); };
    watch('work', (cb) => db.watchDoc(P.work(w), cb, denied));
    watch('episodes', (cb) => db.watchList(P.col(w, 'episodes'), null, cb, denied));
    watch('tracks', (cb) => db.watchList(P.col(w, 'tracks'), null, cb, denied));
    watch('drafts', (cb) => db.watchList(P.col(w, 'drafts'), null, cb, denied));
  }
  if (r.name === 'draft') {
    watch('blocks', (cb) => db.watchList(P.col(w, 'blocks'), ['draftId', d], cb, () => { S.d.work = null; rerender(); }));
    watch('diagrams', (cb) => db.watchList(P.col(w, 'diagrams'), ['draftId', d], cb, () => { S.d.work = null; rerender(); }));
    watch('images', (cb) => db.watchList(P.col(w, 'images'), ['draftId', d], cb, () => { S.d.work = null; rerender(); }));
  }
  if (r.name === 'print' || r.name === 'show') {
    S.d.print = null; S.d.printError = null;
    loadPrint(r.params).then((data) => { S.d.print = data; rerender(); })
      .catch((e) => { S.d.printError = e.message || String(e); rerender(); });
  }
  window.scrollTo(0, 0);
  rerender();
}
window.addEventListener('hashchange', onRoute);

// ---------- リンクから参加 ----------
async function joinByLink({ w, key }) {
  S.ui.joining = true;
  rerender();
  const already = await db.getQuiet(P.work(w));
  if (already) { location.replace(`#/w/${w}`); return; }
  try {
    await db.joinWork(w, key, S.user.email);
    toast('ライブラリーに参加しました');
    location.replace(`#/w/${w}`);
  } catch (e) {
    S.ui.joining = false;
    S.ui.joinError = 'このリンクでは参加できませんでした。リンクが無効になっているか、共有が「制限付き」に変わった可能性があります。共有した人に確認してください。';
    rerender();
  }
}

// ---------- ログイン ----------
async function afterLogin(user) {
  if (!user) setPresence(null);
  S.user = user;
  if (!user) { S.phase = 'login'; unsubAll(); rerender(); return; }
  S.phase = 'ready';
  saveMyProfile(user);
  S.route = {};
  onRoute();
}

// LINE などのアプリの中のブラウザでは、Googleのログインができないことがある
const UA = navigator.userAgent;
const IOS = /iPhone|iPad|iPod/.test(UA);
const IN_APP = /Line\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK|YJApp|; wv\)/i.test(UA) || (IOS && !/Safari\//.test(UA));
function InAppNote() {
  return h('div', { class: 'inapp-note' },
    h('p', null, 'アプリの中のブラウザ（LINEなど）では、ログインできないことがあります。', IOS ? 'Safari' : 'Chrome', 'で開いてからログインしてください。'),
    h('button', { class: 'btn', onclick: async () => {
      try { await navigator.clipboard.writeText(location.href); toast(`リンクをコピーしました。${IOS ? 'Safari' : 'Chrome'}に貼り付けて開いてください。`); } catch (e) { toast('コピーできませんでした。右上や下のメニューの「ブラウザで開く」を使ってください。', 'error', 8000); }
    } }, 'リンクをコピー'));
}

async function doSignIn() {
  try { await auth.signIn(); } catch (e) {
    const code = e && e.code ? e.code : '';
    if (code.includes('popup-blocked')) toast('ポップアップがブロックされました。ブラウザの設定で許可してください。', 'error', 8000);
    else if (code.includes('unauthorized-domain')) toast('このURLがFirebaseで許可されていません（README 手順4）。', 'error', 8000);
    else if (!code.includes('popup-closed') && !code.includes('cancelled')) toast('ログインできませんでした: ' + (e.message || e) + (IN_APP ? '（Safari や Chrome で開くとログインできます）' : ''), 'error', 10000);
  }
}

// ---------- 画面の外枠 ----------
function Header() {
  const r = S.route;
  const work = S.d.work;
  const crumbs = [h('a', { href: '#/', class: 'brand' }, h('span', { class: 'brand-mark' }, '図'), h('span', { class: 'brand-name' }, '図解メーカー'))];
  if (work && r.params.w) {
    crumbs.push(h('span', { class: 'crumb-sep' }, '/'));
    crumbs.push(h('a', { href: `#/w/${r.params.w}`, class: 'crumb' }, work.title || '無題のライブラリー'));
  }
  if (r.name === 'cast') { crumbs.push(h('span', { class: 'crumb-sep' }, '/')); crumbs.push(h('span', { class: 'crumb' }, 'メンバー一覧')); }
  if (r.name === 'people') { crumbs.push(h('span', { class: 'crumb-sep' }, '/')); crumbs.push(h('span', { class: 'crumb' }, '共有')); }
  history.setScope(r.params.w || null);
  const canWrite = r.params.w && work && r.name !== 'print';
  return h('header', { class: 'topbar' },
    h('nav', { class: 'crumbs' }, crumbs),
    h('div', { class: 'top-right' },
      r.params.w && work ? PresenceBar() : null,
      canWrite ? h('div', { class: 'undo-btns' }, UndoButtons('icon-btn')) : null,
      mode === 'local' ? h('span', { class: 'badge demo', title: 'データはこのブラウザだけに保存されます' }, 'デモモード') : null,
      S.saving ? h('span', { class: 'saving' }, '保存中…') : null,
      S.user ? h('details', { class: 'usermenu' },
        h('summary', null, S.user.photo ? h('img', { src: S.user.photo, alt: '', class: 'avatar' }) : h('span', { class: 'avatar ph' }, (S.user.name || '?').slice(0, 1))),
        h('div', { class: 'menu' },
          h('div', { class: 'menu-who' }, S.user.name, h('small', null, S.user.email)),
          mode !== 'local' ? h('button', { class: 'linklike', onclick: () => auth.signOut() }, 'ログアウト') : null,
        )) : null,
    ));
}

function Gate(title, body) {
  return h('main', { class: 'gate' }, h('div', { class: 'gate-card' },
    h('div', { class: 'gate-mark' }, '図'),
    h('h1', null, title), body));
}

function PageView() {
  if (S.phase === 'loading') return h('div', { class: 'loading' }, '読み込み中…');
  if (S.phase === 'error') return Gate('うまく起動できませんでした', [
    h('p', null, S.ui.error),
    h('p', { class: 'muted' }, 'Firebase の設定（firebase-config.js）と Firestore のルールを確認してください。'),
    h('button', { class: 'btn', onclick: () => auth.signOut() }, 'ログアウト'),
  ]);
  if (S.phase === 'login') return Gate('図解メーカー', [
    h('p', null, 'テーマ活動の友・タイミング・図をみんなで作って、PDFに書き出すツールです。'),
    location.hash.startsWith('#/join/') ? h('p', { class: 'ok-note' }, '共有されたライブラリーに参加するには、Googleでログインしてください。') : null,
    h('button', { class: 'btn primary big', onclick: doSignIn }, 'Googleでログイン'),
    IN_APP ? InAppNote() : null,
  ]);
  if (S.route.name === 'join') return Gate(S.ui.joinError ? '参加できませんでした' : 'ライブラリーに参加しています…', [
    S.ui.joinError ? h('p', null, S.ui.joinError) : h('p', { class: 'muted' }, 'しばらくお待ちください。'),
    S.ui.joinError ? h('a', { class: 'btn primary big', href: '#/' }, 'ホームへ') : null,
  ]);
  const r = S.route;
  if (r.name === 'print') return PrintView();
  if (r.name === 'show') return ShowView();
  let page;
  if (r.name === 'home') page = HomeView();
  else if (r.name === 'work') page = WorkView();
  else if (r.name === 'cast') page = CastView();
  else if (r.name === 'people') page = ShareView();
  else if (r.name === 'draft') page = DraftView();
  return [Header(), page, r.name === 'draft' ? SelectionBar() : null];
}

function renderPage() {
  document.body.classList.toggle('is-print', S.route.name === 'print' && S.phase === 'ready');
  document.body.classList.toggle('is-show', S.route.name === 'show' && S.phase === 'ready');
  render($app, PageView());
  if (S.route.name === 'print' && S.phase === 'ready') { if (S.d.print) requestAnimationFrame(() => layoutPages()); } else clearPages();
  requestAnimationFrame(paintCarets);
  afterShow(); // 描いた直後に（次のフレームまで待つと、図が一瞬新しい位置に出てしまう）
}
export function renderModal() { render($modal, S.ui.editDiagram ? EditorView() : []); }
function renderToasts() {
  render($toasts, S.toasts.map((t) => h('div', { key: 't' + t.id, class: 'toast ' + t.kind }, t.msg)));
}

function renderDialog() { render($dialog, DialogView()); }
setRenderers([renderPage, renderModal, renderDialog, renderToasts]);
window.addEventListener('zukai-error', (e) => toast(e.detail, 'error', 8000));

// 「⋯」やアカウントのメニューは、ほかの所を押したらすぐ閉じる
const POPS = 'details.kebab[open], details.usermenu[open]';
document.addEventListener('pointerdown', (e) => {
  for (const d of document.querySelectorAll(POPS)) if (!d.contains(e.target)) d.open = false;
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const d of document.querySelectorAll(POPS)) d.open = false;
});
// 全体の「元に戻す・やり直す」（文字の入力中は、入力欄の元に戻すを使う。図の編集中は図の編集画面が受け持つ）
history.onChange(() => rerender());
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || S.ui.editDiagram || isDialogOpen()) return;
  const t = e.target || {};
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
  const k = (e.key || '').toLowerCase();
  if (k === 'z') { e.preventDefault(); e.shiftKey ? redoAll() : undoAll(); }
  else if (k === 'y') { e.preventDefault(); redoAll(); }
});

onDBError((e) => {
  const msg = e && e.code === 'permission-denied' ? '権限がありません（このライブラリーが共有されているか、編集者になっているか確認してください）' : (e.message || String(e));
  toast(msg, 'error', 6000);
});

(async function start() {
  // グループ確認のウィンドウから戻ってきたときは、結果を渡して閉じるだけ
  if (handleGroupResult(location.hash)) return;
  rerender();
  try {
    await initDB();
  } catch (e) {
    S.phase = 'error';
    S.ui.error = 'Firebase を読み込めませんでした: ' + (e.message || e);
    rerender();
    return;
  }
  auth.onChange((u) => afterLogin(u));
})();

export { createSampleWork, go };
