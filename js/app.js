// 起動・ログイン・画面の切り替え
import { h, render } from './vdom.js';
import { db, auth, initDB, mode, onDBError } from './db.js';
import { S, rerender, setRenderers, toast, go } from './state.js';
import { HomeView, AdminView, createSampleWork } from './views-home.js';
import { WorkView, CastView } from './views-work.js';
import { DraftView, SelectionBar } from './views-draft.js';
import { EditorView } from './editor.js';
import { PrintView, loadPrint } from './print.js';
import { P } from './model.js';
import { DialogView } from './dialog.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toasts = document.getElementById('toasts');
const $dialog = document.getElementById('dialog');

let subs = [];
function unsubAll() { for (const u of subs) { try { u(); } catch (e) { /* noop */ } } subs = []; }
let memberUnsub = null;

// ---------- ルーティング ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'admin') return { name: 'admin', params: {} };
  if (parts[0] === 'w' && parts[1]) {
    const w = parts[1];
    if (parts[2] === 'cast') return { name: 'cast', params: { w } };
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
  if (r.name === 'home') watch('works', (cb) => db.watchList('works', null, cb));
  if (r.name === 'admin') {
    watch('members', (cb) => db.watchList('members', null, cb));
    watch('requests', (cb) => db.watchList('requests', null, cb));
  }
  if (w && r.name !== 'print') {
    watch('work', (cb) => db.watchDoc(P.work(w), cb));
    watch('episodes', (cb) => db.watchList(P.col(w, 'episodes'), null, cb));
    watch('tracks', (cb) => db.watchList(P.col(w, 'tracks'), null, cb));
    watch('drafts', (cb) => db.watchList(P.col(w, 'drafts'), null, cb));
  }
  if (r.name === 'draft') {
    watch('blocks', (cb) => db.watchList(P.col(w, 'blocks'), ['draftId', d], cb));
    watch('diagrams', (cb) => db.watchList(P.col(w, 'diagrams'), ['draftId', d], cb));
    watch('images', (cb) => db.watchList(P.col(w, 'images'), ['draftId', d], cb));
  }
  if (r.name === 'print') {
    loadPrint(r.params).then((data) => { S.d.print = data; rerender(); })
      .catch((e) => { S.d.printError = e.message || String(e); rerender(); });
  }
  window.scrollTo(0, 0);
  rerender();
}
window.addEventListener('hashchange', onRoute);

// ---------- ログインとメンバー確認 ----------
async function afterLogin(user) {
  if (memberUnsub) { memberUnsub(); memberUnsub = null; }
  S.user = user;
  if (!user) { S.phase = 'login'; S.role = null; unsubAll(); rerender(); return; }
  try {
    if (mode === 'local') {
      const me = await db.get('members/' + user.email);
      if (!me) {
        await db.batch([
          { op: 'set', path: 'members/' + user.email, data: { role: 'admin', name: user.name, addedAt: Date.now(), addedBy: user.email } },
          { op: 'set', path: 'meta/setup', data: { at: Date.now(), by: user.email } },
        ]);
      }
    }
    const me = await db.get('members/' + user.email);
    if (me) {
      S.role = me.role || 'member';
      S.phase = 'ready';
      memberUnsub = db.watchDoc('members/' + user.email, (m) => {
        if (!m) { S.phase = 'pending'; S.role = null; unsubAll(); }
        else if (m.role !== S.role) S.role = m.role;
        rerender();
      });
      S.route = {};
      onRoute();
      return;
    }
    const setup = await db.get('meta/setup');
    S.phase = setup ? 'pending' : 'setup';
    if (S.phase === 'pending') {
      const req = await db.get('requests/' + user.email).catch(() => null);
      S.ui.requested = !!req;
    }
  } catch (e) {
    S.phase = 'error';
    S.ui.error = e.message || String(e);
  }
  rerender();
}

async function becomeFirstAdmin() {
  const u = S.user;
  try {
    await db.batch([
      { op: 'set', path: 'members/' + u.email, data: { role: 'admin', name: u.name, addedAt: Date.now(), addedBy: u.email } },
      { op: 'set', path: 'meta/setup', data: { at: Date.now(), by: u.email } },
    ]);
    await afterLogin(u);
  } catch (e) {
    toast('登録できませんでした。Firestore のルールが正しく設定されているか確認してください。', 'error', 8000);
  }
}

async function sendRequest() {
  const u = S.user;
  try {
    await db.set('requests/' + u.email, { email: u.email, name: u.name, at: Date.now() });
    S.ui.requested = true;
    rerender();
  } catch (e) {
    toast('リクエストを送れませんでした: ' + e.message, 'error');
  }
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
  if (r.name === 'admin') { crumbs.push(h('span', { class: 'crumb-sep' }, '/')); crumbs.push(h('span', { class: 'crumb' }, 'アカウント管理')); }
  return h('header', { class: 'topbar' },
    h('nav', { class: 'crumbs' }, crumbs),
    h('div', { class: 'top-right' },
      mode === 'local' ? h('span', { class: 'badge demo', title: 'データはこのブラウザだけに保存されます' }, 'デモモード') : null,
      S.saving ? h('span', { class: 'saving' }, '保存中…') : null,
      S.user ? h('details', { class: 'usermenu' },
        h('summary', null, S.user.photo ? h('img', { src: S.user.photo, alt: '', class: 'avatar' }) : h('span', { class: 'avatar ph' }, (S.user.name || '?').slice(0, 1))),
        h('div', { class: 'menu' },
          h('div', { class: 'menu-who' }, S.user.name, h('small', null, S.user.email)),
          S.role === 'admin' ? h('a', { href: '#/admin', onclick: (e) => e.target.closest('details').open = false }, 'アカウント管理') : null,
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
    h('button', { class: 'btn primary big', onclick: doSignIn }, 'Googleでログイン'),
  ]);
  if (S.phase === 'setup') return Gate('はじめの設定', [
    h('p', null, 'まだ管理者がいません。このアカウントを最初の管理者として登録します。'),
    h('p', { class: 'muted' }, S.user.email),
    h('button', { class: 'btn primary big', onclick: becomeFirstAdmin }, 'このアカウントを管理者にする'),
    h('button', { class: 'btn ghost', onclick: () => auth.signOut() }, '別のアカウントでログイン'),
  ]);
  if (S.phase === 'pending') return Gate('参加の許可が必要です', [
    h('p', null, 'このアカウントはまだ編集できる人として登録されていません。'),
    h('p', { class: 'muted' }, S.user.email),
    S.ui.requested
      ? h('p', { class: 'ok-note' }, '参加リクエストを送りました。管理者が許可すると使えるようになります。')
      : h('button', { class: 'btn primary big', onclick: sendRequest }, '管理者に参加をリクエスト'),
    h('button', { class: 'btn ghost', onclick: () => auth.signOut() }, '別のアカウントでログイン'),
  ]);
  const r = S.route;
  if (r.name === 'print') return PrintView();
  let page;
  if (r.name === 'home') page = HomeView();
  else if (r.name === 'admin') page = AdminView();
  else if (r.name === 'work') page = WorkView();
  else if (r.name === 'cast') page = CastView();
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
  const msg = e && e.code === 'permission-denied' ? '権限がありません（アカウント管理で許可されているか確認してください）' : (e.message || String(e));
  toast(msg, 'error', 6000);
});

(async function start() {
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
