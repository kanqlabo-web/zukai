// ライブラリー一覧
import { h } from './vdom.js';
import { icon } from './icons.js';
import { versionLabel, CHANGELOG_URL } from './version.js';
import { db, mode } from './db.js';
import { S, rerender, toast, fmtTime, go, adminMsg } from './state.js';
import { P, createWork, deleteWork, exportWork } from './model.js';
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

export function HomeView() {
  const works = (S.d.works || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const hasWorks = works.length > 0;
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
    S.d.worksError ? h('div', { class: 'warn' },
      h('b', null, 'ライブラリー一覧を読み込めませんでした。'),
      S.d.worksError === 'permission-denied'
        ? ' ' + adminMsg('読み込む権限がありませんでした', 'E301')
        : ' 通信状態を確かめて、ページを読み込み直してください（エラー番号 E302）。') : null,
    S.d.works == null ? h('p', { class: 'muted' }, '読み込み中…')
      : works.length === 0 ? h('div', { class: 'empty' }, h('p', null, 'まだライブラリーがありません。'), h('p', { class: 'muted' }, '上の欄にライブラリー名を入れて「作成」を押してください。ほかの人から共有されたライブラリーも、ここに表示されます。'))
        : h('div', { class: 'card-grid' }, works.map((w) => h('div', {
          key: w.id, class: 'work-card', role: 'link', tabindex: 0,
          onclick: (e) => { if (!e.target.closest('.kebab')) go(`#/w/${w.id}`); },
          onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) go(`#/w/${w.id}`); },
        },
          h('div', { class: 'work-card-head' },
            h('div', { class: 'work-title' }, w.title || '無題のライブラリー'),
            h('details', { class: 'kebab' },
              h('summary', { title: 'その他の操作', 'aria-label': 'その他の操作' }, icon('more')),
              h('div', { class: 'menu' },
                myRole(w) === 'owner' && ADMIN_EMAILS.includes(String((S.user && S.user.email) || '').toLowerCase()) ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; exportSample(w.id, w); } }, 'サンプル用に書き出す') : null,
                myRole(w) === 'owner'
                  ? h('button', { class: 'linklike danger', onclick: (e) => { e.target.closest('details').open = false; confirmDeleteWork(w.id, w); } }, 'ライブラリーを削除')
                  : h('button', { class: 'linklike danger', onclick: (e) => { e.target.closest('details').open = false; confirmLeaveWork(w.id, w); } }, '共有を解除')))),
          h('div', { class: 'work-meta' },
            h('span', { class: 'badge role-' + myRole(w) }, ROLE_LABEL[myRole(w)] || ''),
            (w.participants || []).length > 1 ? h('span', { class: 'muted small' }, `${w.participants.length}人で共有`) : null,
            w.linkRole && w.linkRole !== 'off' ? h('span', { class: 'muted small' }, 'リンク共有') : null),
          h('div', { class: 'muted small' }, `更新 ${fmtTime(w.updatedAt)}`)))),
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
