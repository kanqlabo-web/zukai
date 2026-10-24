// ライブラリー一覧
import { h } from './vdom.js';
import { icon } from './icons.js';
import { versionLabel, CHANGELOG_URL } from './version.js';
import { db, mode } from './db.js';
import { S, rerender, toast, fmtTime, go, adminMsg } from './state.js';
import { P, createWork, deleteWork, exportWork, thumbOf } from './model.js';
import { StageSVG, stageCount } from './stage.js';
import { workIndex } from './cast.js';
import { myRole, ROLE_LABEL } from './access.js';
import { buildSample, buildSampleFrom } from './sample.js';
import { SAMPLE_LINK, ADMIN_EMAILS } from './settings.js';
import { ask, confirmBox } from './dialog.js';

// 全員に見せるサンプル（settings.js の SAMPLE_LINK）
function sampleTarget() {
  const m = /#\/(?:join\/([^/]+)\/([^/?#]+)|w\/([^/?#]+))/.exec(SAMPLE_LINK || '');
  if (!m) return null;
  return m[1] ? { w: m[1], key: m[2] } : { w: m[3], key: null };
}
export async function createSampleWork() {
  if (S.ui.makingSample) return;
  S.ui.makingSample = true; rerender();
  try {
    const t = mode !== 'local' ? sampleTarget() : null;
    const id = t ? await buildSampleFrom(t, S.user) : await buildSample(S.user);
    toast('サンプルを作りました');
    go(`#/w/${id}`);
  } catch (e) { toast('サンプルを作れませんでした: ' + e.message, 'error'); }
  S.ui.makingSample = false; rerender();
}

// 「サンプル用に書き出す」：sample フォルダに置く library.json を作る
async function exportSample(w, work) {
  try {
    toast('書き出しています…');
    const data = await exportWork(w);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'library.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`「${work.title || '無題'}」を library.json に書き出しました`);
  } catch (e) { toast('書き出せませんでした: ' + (e.message || e), 'error'); }
}

async function newWork() {
  const title = (S.ui.newWork || '').trim();
  if (!title) { S.ui.newWorkErr = 'ライブラリー名を入力してください'; rerender(); return; }
  const id = await createWork(title, S.user);
  S.ui.newWork = '';
  go(`#/w/${id}`);
}

// ライブラリーがあるときは、一覧の右上のボタンから作る
async function newWorkDialog() {
  const r = await ask({ title: '新しいライブラリー', ok: '作成', fields: [{ key: 'v', label: 'ライブラリー名', placeholder: '例：ライオンと魔女と大きなたんす', required: true }] });
  if (!r) return;
  const id = await createWork(r.v, S.user);
  go(`#/w/${id}`);
}

// カードの上の絵：舞台の上に人・図形がいちばん多い図（覚えていなければ、一度だけ探してライブラリーに覚えておく）
const thumbs = {};
async function findThumb(w) {
  thumbs[w.id] = 'loading';
  try {
    const list = await db.list(P.col(w.id, 'diagrams'));
    const score = (g) => [stageCount(g.shapes), g.updatedAt || g.createdAt || 0];
    const better = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
    const best = list.reduce((m, g) => (!m || better(g, m) ? g : m), null);
    thumbs[w.id] = best ? thumbOf(best) : 'none';
    // 編集できる人なら、次からは探さずに済むようライブラリーに覚えておく
    if (best && myRole(w) !== 'viewer') db.updateQuiet(P.work(w.id), { thumb: thumbs[w.id] }).catch(() => {});
  } catch (e) { thumbs[w.id] = 'none'; }
  rerender();
}
function CardArt(w) {
  // 古い決め方（最後に直した図）で覚えたもの・選び直しの印があるものは、探し直す
  const saved = w.thumb && w.thumb.n != null && !w.thumb.stale ? w.thumb : null;
  const t = thumbs[w.id] || saved || (w.thumb ? w.thumb : null);
  if (!thumbs[w.id] && !saved) findThumb(w);
  const shapes = t && typeof t === 'object' ? t.shapes : {};
  return StageSVG(shapes || {}, { cls: 'stage card-stage', idx: workIndex(w), roleVis: (t && t.roleVis) || {} });
}

// 一覧の見せ方（Googleドキュメントのホームと同じ：カード／リスト、並べ替え、検索）。この端末に覚えておく
const VIEW_KEY = 'zukai-home-view';
function homePref() { try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch (e) { return {}; } }
function setHomePref(patch) { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ ...homePref(), ...patch })); } catch (e) { /* 使えない環境 */ } rerender(); }

export function HomeView() {
  const pref = homePref();
  const sortBy = pref.sort === 'title' ? 'title' : 'updated';
  const all = (S.d.works || []).slice().sort(sortBy === 'title'
    ? (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ja')
    : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const hasWorks = all.length > 0;
  const q = (S.ui.homeQuery || '').trim().toLowerCase();
  const works = q ? all.filter((w) => String(w.title || '').toLowerCase().includes(q)) : all;
  const listView = pref.view === 'list';
  return h('main', { class: 'page' },
    hasWorks ? null : h('section', { class: 'hero' },
      h('h1', null, '新しいライブラリーを作る'),
      h('form', { class: 'hero-form', onsubmit: (e) => { e.preventDefault(); newWork(); } },
        h('input', {
          value: S.ui.newWork || '', placeholder: 'ライブラリー名（例：ライオンと魔女と大きなたんす）', 'aria-label': 'ライブラリー名',
          oninput: (e) => { S.ui.newWork = e.target.value; if (S.ui.newWorkErr) { S.ui.newWorkErr = ''; rerender(); } },
        }),
        h('button', { class: 'btn primary big-inline', type: 'submit' }, '作成')),
      S.ui.newWorkErr ? h('div', { class: 'dlg-err' }, S.ui.newWorkErr) : null,
      h('div', { class: 'hero-sub' },
        h('span', { class: 'muted small' }, '使い方を試したいときは'),
        h('button', { class: 'linkbtn', onclick: createSampleWork, disabled: !!S.ui.makingSample }, S.ui.makingSample ? 'サンプルを作っています…' : 'サンプルを作る'))),
    mode === 'local' ? h('div', { class: 'note' },
      h('b', null, 'デモモードで動いています。'),
      ' データはこのブラウザの中だけに保存され、他の人とは共有されません。Firebase を設定すると、ライブラリーを共有してみんなで同時に編集できるようになります。') : null,
    h('div', { class: 'section-head' },
      h('h2', { class: 'section-h' }, 'ライブラリー一覧'),
      hasWorks ? h('button', { class: 'btn primary', onclick: newWorkDialog }, icon('plus', 16), '新しいライブラリー') : null),
    hasWorks ? h('div', { class: 'home-tools' },
      h('label', { class: 'home-search' }, icon('search', 18),
        h('input', { type: 'search', value: S.ui.homeQuery || '', placeholder: 'ライブラリーを検索', 'aria-label': 'ライブラリーを検索', oninput: (e) => { S.ui.homeQuery = e.target.value; rerender(); } })),
      h('select', { class: 'home-sort', 'aria-label': '並べ替え', value: sortBy, onchange: (e) => setHomePref({ sort: e.target.value }) },
        h('option', { value: 'updated' }, '更新が新しい順'), h('option', { value: 'title' }, '名前順')),
      h('div', { class: 'seg view-seg', role: 'group', 'aria-label': '表示' },
        h('button', { class: 'seg-btn' + (listView ? '' : ' on'), title: 'カードで表示', 'aria-label': 'カードで表示', 'aria-pressed': listView ? 'false' : 'true', onclick: () => setHomePref({ view: 'grid' }) }, icon('grid', 16)),
        h('button', { class: 'seg-btn' + (listView ? ' on' : ''), title: 'リストで表示', 'aria-label': 'リストで表示', 'aria-pressed': listView ? 'true' : 'false', onclick: () => setHomePref({ view: 'list' }) }, icon('list', 16)))) : null,
    S.d.worksError ? h('div', { class: 'warn' },
      h('b', null, 'ライブラリー一覧を読み込めませんでした。'),
      S.d.worksError === 'permission-denied'
        ? ' ' + adminMsg('読み込む権限がありませんでした', 'E301')
        : ' 通信状態を確かめて、ページを読み込み直してください（エラー番号 E302）。') : null,
    S.d.works == null ? h('p', { class: 'muted' }, '読み込み中…')
      : q && !works.length ? h('p', { class: 'muted' }, `「${S.ui.homeQuery.trim()}」に合うライブラリーはありません。`)
      : works.length === 0 ? h('div', { class: 'empty' }, h('p', null, 'まだライブラリーがありません。'), h('p', { class: 'muted' }, '上の欄にライブラリー名を入れて「作成」を押してください。ほかの人から共有されたライブラリーも、ここに表示されます。'))
        : h('div', { class: 'card-grid' + (listView ? ' as-list' : '') }, works.map((w) => h('div', {
          key: w.id, class: 'work-card', role: 'link', tabindex: 0,
          onclick: (e) => { if (!e.target.closest('.kebab')) go(`#/w/${w.id}`); },
          onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) go(`#/w/${w.id}`); },
        },
          h('div', { class: 'work-thumb', 'aria-hidden': 'true' }, CardArt(w)),
          h('div', { class: 'work-body' },
            h('div', { class: 'work-card-head' },
              h('div', { class: 'work-title' }, w.title || '無題のライブラリー')),
            h('div', { class: 'work-sub' },
              h('span', { class: 'badge role-' + myRole(w) }, ROLE_LABEL[myRole(w)] || ''),
              h('span', { class: 'grow' }, `更新 ${fmtTime(w.updatedAt)}`),
              h('details', { class: 'kebab' },
                h('summary', { title: 'その他の操作', 'aria-label': 'その他の操作' }, icon('more')),
                h('div', { class: 'menu' },
                  myRole(w) === 'owner' && ADMIN_EMAILS.includes(String((S.user && S.user.email) || '').toLowerCase()) ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; exportSample(w.id, w); } }, 'サンプル用に書き出す') : null,
                  myRole(w) === 'owner'
                    ? h('button', { class: 'linklike danger', onclick: (e) => { e.target.closest('details').open = false; confirmDeleteWork(w.id, w); } }, 'ライブラリーを削除')
                    : h('button', { class: 'linklike danger', onclick: (e) => { e.target.closest('details').open = false; confirmLeaveWork(w.id, w); } }, '共有を解除')))),
            (w.participants || []).length > 1 || (w.linkRole && w.linkRole !== 'off') ? h('div', { class: 'work-share muted small' },
              [(w.participants || []).length > 1 ? `${w.participants.length}人で共有` : null, w.linkRole && w.linkRole !== 'off' ? 'リンク共有' : null].filter(Boolean).join('・')) : null)))),
    hasWorks ? h('p', { class: 'home-foot muted small' },
      h('button', { class: 'linklike inline', onclick: createSampleWork, disabled: !!S.ui.makingSample }, S.ui.makingSample ? 'サンプルを作っています…' : 'サンプルを作る'),
      ' ・ ',
      h('a', { href: CHANGELOG_URL, target: '_blank', rel: 'noopener', title: '更新履歴を見る' }, versionLabel())) : h('p', { class: 'home-foot muted small' },
      h('a', { href: CHANGELOG_URL, target: '_blank', rel: 'noopener', title: '更新履歴を見る' }, versionLabel())),
  );
}

export async function confirmDeleteWork(w, work) {
  const others = (work.participants || []).filter((e) => e !== (S.user && S.user.email)).length;
  const r = await ask({
    title: 'ライブラリーを削除', danger: true, ok: 'すべて削除',
    message: `ライブラリー「${work.title}」の話・トラック・稿・図をすべて削除します。元に戻せません。`,
    detail: others ? `共有しているほかのメンバー（${others}人）も、このライブラリーを開けなくなります。` : 'このライブラリーはほかの人と共有していません。',
    fields: [{ key: 'title', label: '確認のためライブラリー名を入力', placeholder: work.title }],
    validate: (v) => (v.title.trim() === (work.title || '').trim() ? null : 'ライブラリー名が一致しません'),
  });
  if (!r) return;
  await deleteWork(w);
  toast('削除しました');
  go('#/');
}

// オーナー以外：自分だけ共有から外れる（ライブラリーは消えない）
export async function confirmLeaveWork(w, work) {
  const ok = await confirmBox(`「${work.title || '無題のライブラリー'}」の共有を解除して、あなたのライブラリー一覧から外しますか？`, {
    title: '共有を解除', ok: '共有を解除', danger: true,
    detail: 'ライブラリーそのものは削除されません。ほかのメンバーは、これまでどおり開いて使えます。もう一度開くには、オーナーに共有してもらうか、共有リンクから参加してください。',
  });
  if (!ok) return;
  const me = S.user.email;
  await db.update(P.work(w), {
    participants: (work.participants || []).filter((e) => e !== me),
    viewers: (work.viewers || []).filter((e) => e !== me),
  });
  toast('共有を解除しました');
  go('#/');
}
