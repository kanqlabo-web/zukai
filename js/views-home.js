// 作品一覧とメンバー管理
import { h } from './vdom.js';
import { db, mode } from './db.js';
import { S, rerender, toast, fmtTime, go } from './state.js';
import { createWork, deleteWork, extractEmails } from './model.js';
import { buildSample } from './sample.js';

export async function createSampleWork() {
  try {
    const id = await buildSample(S.user);
    toast('見本の作品を作りました');
    go(`#/w/${id}`);
  } catch (e) { toast('見本を作れませんでした: ' + e.message, 'error'); }
}

export function HomeView() {
  const works = (S.d.works || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return h('main', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', null, '作品'),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn primary', onclick: async () => {
            const t = prompt('作品名を入力してください', '');
            if (!t) return;
            const id = await createWork(t.trim(), S.user);
            go(`#/w/${id}`);
          },
        }, '＋ 新しい作品'),
        h('button', { class: 'btn', onclick: createSampleWork }, '見本の作品を作る'),
      )),
    mode === 'local' ? h('div', { class: 'note' },
      h('b', null, 'デモモードで動いています。'),
      ' データはこのブラウザの中だけに保存され、他の人とは共有されません。Firebase を設定すると、みんなで同時に編集できるようになります。') : null,
    S.d.works == null ? h('p', { class: 'muted' }, '読み込み中…')
      : works.length === 0 ? h('div', { class: 'empty' }, h('p', null, 'まだ作品がありません。'), h('p', { class: 'muted' }, '「新しい作品」から始めるか、「見本の作品を作る」で使い方を試せます。'))
        : h('div', { class: 'card-grid' }, works.map((w) => h('a', { key: w.id, class: 'work-card', href: `#/w/${w.id}` },
          h('div', { class: 'work-title' }, w.title || '無題の作品'),
          h('div', { class: 'muted small' }, `キャスト ${(w.cast || []).length}人 ・ 更新 ${fmtTime(w.updatedAt)}`)))),
  );
}

// ---------- メンバー管理 ----------
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
  return h('main', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'メンバー管理')),
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
      h('h2', null, 'Googleグループのメンバーをまとめて追加'),
      h('p', { class: 'muted small' },
        'groups.google.com でグループを開き、「メンバー」画面からメンバー一覧をエクスポート（CSV）するか、メールアドレスをコピーして下に貼り付けてください。メールアドレス以外の文字が混ざっていても大丈夫です。'),
      h('textarea', { rows: 6, placeholder: 'taro@gmail.com\nhanako@gmail.com …', value: S.ui.bulk || '', oninput: (e) => { S.ui.bulk = e.target.value; } }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!S.ui.prune, onchange: (e) => { S.ui.prune = e.target.checked; rerender(); } }),
        ' 貼り付けた一覧にいないメンバーを削除する（グループと同じ状態にそろえる。管理者は削除されません）'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => addEmails(S.ui.bulk, 'member', S.ui.prune) }, 'メンバーとして追加'),
        h('button', { class: 'btn', onclick: () => addEmails(S.ui.bulk, 'admin', false) }, '管理者として追加')),
    ),
    h('section', { class: 'panel' },
      h('h2', null, `メンバー（${members.length}人）`),
      h('ul', { class: 'mlist' }, members.map((m) => h('li', { key: m.id },
        h('div', { class: 'grow' }, h('span', null, m.id), m.name ? h('span', { class: 'muted small' }, '　' + m.name) : null),
        h('select', {
          value: m.role || 'member', disabled: m.id === S.user.email && admins <= 1,
          onchange: (e) => db.update('members/' + m.id, { role: e.target.value }),
        }, h('option', { value: 'member' }, 'メンバー'), h('option', { value: 'admin' }, '管理者')),
        h('button', {
          class: 'btn small danger', disabled: m.id === S.user.email,
          onclick: () => { if (confirm(`${m.id} を削除しますか？`)) db.remove('members/' + m.id); },
        }, '削除'))))),
  );
}

export async function confirmDeleteWork(w, work) {
  const t = prompt(`作品「${work.title}」をすべて削除します。元に戻せません。\n確認のため作品名を入力してください。`);
  if (t == null) return;
  if (t.trim() !== (work.title || '').trim()) { toast('作品名が一致しませんでした', 'error'); return; }
  await deleteWork(w);
  toast('削除しました');
  go('#/');
}
