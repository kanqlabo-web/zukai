// 作品一覧とアカウント管理
import { h } from './vdom.js';
import { db, mode } from './db.js';
import { S, rerender, toast, fmtTime, go } from './state.js';
import { createWork, deleteWork, extractEmails } from './model.js';
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
      ' データはこのブラウザの中だけに保存され、他の人とは共有されません。Firebase を設定すると、みんなで同時に編集できるようになります。') : null,
    h('h2', { class: 'section-h' }, '作品一覧'),
    S.d.works == null ? h('p', { class: 'muted' }, '読み込み中…')
      : works.length === 0 ? h('div', { class: 'empty' }, h('p', null, 'まだ作品がありません。'), h('p', { class: 'muted' }, '上の欄に作品名を入れて「新しい作品」を押してください。'))
        : h('div', { class: 'card-grid' }, works.map((w) => h('a', { key: w.id, class: 'work-card', href: `#/w/${w.id}` },
          h('div', { class: 'work-title' }, w.title || '無題の作品'),
          h('div', { class: 'muted small' }, `メンバー ${(w.cast || []).length}人 ・ 更新 ${fmtTime(w.updatedAt)}`)))),
  );
}

// ---------- アカウント管理（ログインできる人） ----------
async function addEmails(text, role, prune) {
  const emails = extractEmails(text);
  if (!emails.length) { toast('メールアドレスが見つかりませんでした', 'error'); return; }
  const members = S.d.members || [];
  const existing = new Set(members.map((m) => m.id));
  const ops = [];
  for (const e of emails) {
    if (!existing.has(e)) ops.push({ op: 'set', path: 'members/' + e, data: { role, name: '', addedAt: Date.now(), addedBy: S.user.email } });
  }
  let removed = 0;
  if (prune) {
    const keep = new Set(emails);
    for (const m of members) {
      if (m.role !== 'admin' && !keep.has(m.id)) { ops.push({ op: 'remove', path: 'members/' + m.id }); removed++; }
    }
  }
  for (const r of S.d.requests || []) if (emails.includes(r.id)) ops.push({ op: 'remove', path: 'requests/' + r.id });
  if (!ops.length) { toast('新しく追加する人はいませんでした'); return; }
  await db.batch(ops);
  toast(`${ops.length - removed}人を追加${removed ? `、${removed}人を削除` : ''}しました`);
  S.ui.bulk = '';
  rerender();
}

export function AdminView() {
  if (S.role !== 'admin') return h('main', { class: 'page' }, h('p', null, 'この画面は管理者だけが使えます。'));
  const members = (S.d.members || []).slice().sort((a, b) => (a.role === b.role ? a.id.localeCompare(b.id) : a.role === 'admin' ? -1 : 1));
  const reqs = S.d.requests || [];
  const admins = members.filter((m) => m.role === 'admin').length;
  const gs = S.d.groupSync;
  return h('main', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'アカウント管理')),
    h('section', { class: 'panel' },
      h('h2', null, 'Googleグループとの自動同期'),
      gs ? h('div', null,
        h('p', null, h('b', null, gs.group), ` のメンバー ${gs.count}人を、1時間ごとに自動で反映しています。`),
        h('p', { class: 'muted small' }, `最終同期 ${fmtTime(gs.at)}（追加 ${gs.added || 0}人・削除 ${gs.removed || 0}人）。グループから抜けた人は、次の同期でログインできなくなります。管理者と、下で手動追加した人は変わりません。`))
        : h('p', { class: 'muted small' }, 'まだ設定されていません。README.md の「手順6」で同期スクリプトを設定すると、Googleグループのメンバーが自動でログインできるようになります。設定するまでは、下の欄に手動で貼り付けて追加してください。')),
    reqs.length ? h('section', { class: 'panel' },
      h('h2', null, `参加リクエスト（${reqs.length}）`),
      h('ul', { class: 'mlist' }, reqs.map((r) => h('li', { key: r.id },
        h('div', { class: 'grow' }, h('b', null, r.name || ''), ' ', h('span', { class: 'muted' }, r.id), h('div', { class: 'muted small' }, fmtTime(r.at))),
        h('button', {
          class: 'btn primary small', onclick: () => db.batch([
            { op: 'set', path: 'members/' + r.id, data: { role: 'member', name: r.name || '', addedAt: Date.now(), addedBy: S.user.email } },
            { op: 'remove', path: 'requests/' + r.id },
          ]),
        }, '許可'),
        h('button', { class: 'btn small', onclick: () => db.remove('requests/' + r.id) }, '却下'))))) : null,
    h('section', { class: 'panel' },
      h('h2', null, gs ? '手動でまとめて追加（グループ外の人など）' : 'メールアドレスをまとめて追加'),
      h('p', { class: 'muted small' },
        'groups.google.com でグループを開き、「メンバー」画面からメンバー一覧をエクスポート（CSV）するか、メールアドレスをコピーして下に貼り付けてください。メールアドレス以外の文字が混ざっていても大丈夫です。'),
      h('textarea', { rows: 6, placeholder: 'taro@gmail.com\nhanako@gmail.com …', value: S.ui.bulk || '', oninput: (e) => { S.ui.bulk = e.target.value; } }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!S.ui.prune, onchange: (e) => { S.ui.prune = e.target.checked; rerender(); } }),
        ' 貼り付けた一覧にいない人を削除する（グループと同じ状態にそろえる。管理者は削除されません）'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => addEmails(S.ui.bulk, 'member', S.ui.prune) }, '編集できる人として追加'),
        h('button', { class: 'btn', onclick: () => addEmails(S.ui.bulk, 'admin', false) }, '管理者として追加')),
    ),
    h('section', { class: 'panel' },
      h('h2', null, `ログインできる人（${members.length}人）`),
      h('ul', { class: 'mlist' }, members.map((m) => h('li', { key: m.id },
        h('div', { class: 'grow' }, h('span', null, m.id), m.source === 'group' ? h('span', { class: 'badge', title: 'Googleグループから自動で追加' }, 'グループ') : null, m.name ? h('span', { class: 'muted small' }, '　' + m.name) : null),
        h('select', {
          value: m.role || 'member', disabled: m.id === S.user.email && admins <= 1,
          onchange: (e) => db.update('members/' + m.id, { role: e.target.value }),
        }, h('option', { value: 'member' }, '編集者'), h('option', { value: 'admin' }, '管理者')),
        h('button', {
          class: 'btn small danger', disabled: m.id === S.user.email,
          onclick: async () => { if (await confirmBox(`${m.id} がログインできないようにしますか？`, { ok: '削除', danger: true })) db.remove('members/' + m.id); },
        }, '削除'))))),
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
