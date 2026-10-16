// 作品一覧
import { h } from './vdom.js';
import { db, mode } from './db.js';
import { S, rerender, toast, fmtTime, go } from './state.js';
import { createWork, deleteWork } from './model.js';
import { myRole, ROLE_LABEL } from './access.js';
import { buildSample } from './sample.js';
import { ask, confirmBox } from './dialog.js';

export async function createSampleWork() {
  try {
    const id = await buildSample(S.user);
    toast('見本の作品を作りました');
    go(`#/w/${id}`);
  } catch (e) { toast('見本を作れませんでした: ' + e.message, 'error'); }
}

async function newWork() {
  const title = (S.ui.newWork || '').trim();
  if (!title) { S.ui.newWorkErr = '作品名を入力してください'; rerender(); return; }
  const id = await createWork(title, S.user);
  S.ui.newWork = '';
  go(`#/w/${id}`);
}

export function HomeView() {
  const works = (S.d.works || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return h('main', { class: 'page' },
    h('section', { class: 'hero' },
      h('h1', null, '新しい作品を作る'),
      h('form', { class: 'hero-form', onsubmit: (e) => { e.preventDefault(); newWork(); } },
        h('input', {
          value: S.ui.newWork || '', placeholder: '作品名（例：ナルニア国物語）', 'aria-label': '作品名',
          oninput: (e) => { S.ui.newWork = e.target.value; if (S.ui.newWorkErr) { S.ui.newWorkErr = ''; rerender(); } },
        }),
        h('button', { class: 'btn primary big-inline', type: 'submit' }, '＋ 新しい作品')),
      S.ui.newWorkErr ? h('div', { class: 'dlg-err' }, S.ui.newWorkErr) : null,
      h('div', { class: 'hero-sub' },
        h('span', { class: 'muted small' }, '使い方を試したいときは'),
        h('button', { class: 'linkbtn', onclick: createSampleWork }, '見本の作品を作る'))),
    mode === 'local' ? h('div', { class: 'note' },
      h('b', null, 'デモモードで動いています。'),
      ' データはこのブラウザの中だけに保存され、他の人とは共有されません。Firebase を設定すると、作品を共有してみんなで同時に編集できるようになります。') : null,
    h('h2', { class: 'section-h' }, '作品一覧'),
    S.d.works == null ? h('p', { class: 'muted' }, '読み込み中…')
      : works.length === 0 ? h('div', { class: 'empty' }, h('p', null, 'まだ作品がありません。'), h('p', { class: 'muted' }, '上の欄に作品名を入れて「新しい作品」を押してください。ほかの人から共有された作品も、ここに表示されます。'))
        : h('div', { class: 'card-grid' }, works.map((w) => h('a', { key: w.id, class: 'work-card', href: `#/w/${w.id}` },
          h('div', { class: 'work-title' }, w.title || '無題の作品'),
          h('div', { class: 'work-meta' },
            h('span', { class: 'badge role-' + myRole(w) }, ROLE_LABEL[myRole(w)] || ''),
            (w.participants || []).length > 1 ? h('span', { class: 'muted small' }, `${w.participants.length}人で共有`) : null,
            w.linkRole && w.linkRole !== 'off' ? h('span', { class: 'muted small' }, 'リンク共有') : null),
          h('div', { class: 'muted small' }, `更新 ${fmtTime(w.updatedAt)}`)))),
  );
}

export async function confirmDeleteWork(w, work) {
  const r = await ask({
    title: '作品を削除', danger: true, ok: 'すべて削除',
    message: `作品「${work.title}」の話・トラック・稿・舞台図をすべて削除します。元に戻せません。`,
    fields: [{ key: 'title', label: '確認のため作品名を入力', placeholder: work.title }],
    validate: (v) => (v.title.trim() === (work.title || '').trim() ? null : '作品名が一致しません'),
  });
  if (!r) return;
  await deleteWork(w);
  toast('削除しました');
  go('#/');
}
