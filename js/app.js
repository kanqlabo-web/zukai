// 起動・ログイン・画面の切り替え
import { h, render } from './vdom.js';
import { db, auth, initDB, mode, onDBError } from './db.js';
import { S, rerender, setRenderers, toast, go } from './state.js';
import { HomeView, createSampleWork } from './views-home.js';
import { WorkView, CastView, ShareView } from './views-work.js';
import { DraftView, SelectionBar } from './views-draft.js';
import { EditorView } from './editor.js';
import { PrintView, loadPrint } from './print.js';
import { P } from './model.js';
import { DialogView } from './dialog.js';
import { saveMyProfile, handleGroupResult } from './access.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toasts = document.getElementById('toasts');
const $dialog = document.getElementById('dialog');

let subs = [];
function unsubAll() { for (const u of subs) { try { u(); } catch (e) { /* noop */ } } subs = []; }

// ---------- ルーティング ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'join' && parts[1] && parts[2]) return { name: 'join', params: { w: parts[1], key: parts[2] } };
  if (parts[0] === 'w' && parts[1]) {
    const w = parts[1];
    if (parts[2] === 'cast') return { name: 'cast', params: { w } };
    if (parts[2] === 'people') return { name: 'people', params: { w } };
    if (parts[2] === 'd' && parts[3]) return { name: 'draft', params: { w, d: parts[3] } };
    if (parts[2] === 'print' && parts[3] && parts[4]) return { name: 'print', params: { w, kind: parts[3], id: parts[4] } };
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
  if (r.name === 'home') watch('works', (cb) => db.watchList('works', ['participants', 'array-contains', S.user.email], cb));
  if (r.name === 'join') { joinByLink(r.params); return; }
  if (w && r.name !== 'print') {
    // 参加していない作品は読めない（その場合は「見つかりません」と表示）
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
  if (r.name === 'print') {
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
    toast('作品に参加しました');
    location.replace(`#/w/${w}`);
  } catch (e) {
    S.ui.joining = false;
    S.ui.joinError = 'このリンクでは参加できませんでした。リンクが無効になっているか、共有が「制限付き」に変わった可能性があります。共有した人に確認してください。';
    rerender();
  }
}

// ---------- ログイン ----------
async function afterLogin(user) {
  S.user = user;
  if (!user) { S.phase = 'login'; unsubAll(); rerender(); return; }
  S.phase = 'ready';
  saveMyProfile(user);
  S.route = {};
  onRoute();
}

async function doSignIn() {
  try { await auth.signIn(); } catch (e) {
    const code = e && e.code ? e.code : '';
    if (code.includes('popup-blocked')) toast('ポップアップがブロックされました。ブラウザの設定で許可してください。', 'error', 8000);
    else if (code.includes('unauthorized-domain')) toast('このURLがFirebaseで許可されていません（README 手順4）。', 'error', 8000);
    else if (!code.includes('popup-closed') && !code.includes('cancelled')) toast('ログインできませんでした: ' + (e.message || e), 'error', 8000);
  }
}

// ---------- 画面の外枠 ----------
function Header() {
  const r = S.route;
  const work = S.d.work;
  const crumbs = [h('a', { href: '#/', class: 'brand' }, h('span', { class: 'brand-mark' }, '図'), h('span', { class: 'brand-name' }, '舞台図解メーカー'))];
  if (work && r.params.w) {
    crumbs.push(h('span', { class: 'crumb-sep' }, '/'));
    crumbs.push(h('a', { href: `#/w/${r.params.w}`, class: 'crumb' }, work.title || '無題の作品'));
  }
  if (r.name === 'cast') { crumbs.push(h('span', { class: 'crumb-sep' }, '/')); crumbs.push(h('span', { class: 'crumb' }, 'メンバー一覧')); }
  if (r.name === 'people') { crumbs.push(h('span', { class: 'crumb-sep' }, '/')); crumbs.push(h('span', { class: 'crumb' }, '共有')); }
  return h('header', { class: 'topbar' },
    h('nav', { class: 'crumbs' }, crumbs),
    h('div', { class: 'top-right' },
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
  if (S.phase === 'login') return Gate('舞台図解メーカー', [
    h('p', null, '台本・タイミング・舞台図をみんなで作って、PDFに書き出すツールです。'),
    location.hash.startsWith('#/join/') ? h('p', { class: 'ok-note' }, '共有された作品に参加するには、Googleでログインしてください。') : null,
    h('button', { class: 'btn primary big', onclick: doSignIn }, 'Googleでログイン'),
  ]);
  if (S.route.name === 'join') return Gate(S.ui.joinError ? '参加できませんでした' : '作品に参加しています…', [
    S.ui.joinError ? h('p', null, S.ui.joinError) : h('p', { class: 'muted' }, 'しばらくお待ちください。'),
    S.ui.joinError ? h('a', { class: 'btn primary big', href: '#/' }, 'ホームへ') : null,
  ]);
  const r = S.route;
  if (r.name === 'print') return PrintView();
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
  render($app, PageView());
}
export function renderModal() { render($modal, S.ui.editDiagram ? EditorView() : []); }
function renderToasts() {
  render($toasts, S.toasts.map((t) => h('div', { key: 't' + t.id, class: 'toast ' + t.kind }, t.msg)));
}

function renderDialog() { render($dialog, DialogView()); }
setRenderers([renderPage, renderModal, renderDialog, renderToasts]);
window.addEventListener('zukai-error', (e) => toast(e.detail, 'error', 8000));

onDBError((e) => {
  const msg = e && e.code === 'permission-denied' ? '権限がありません（この作品が共有されているか、編集者になっているか確認してください）' : (e.message || String(e));
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
