// 作品ページ（話・トラック・稿の一覧）とメンバー一覧
import { h } from './vdom.js';
import { db } from './db.js';
import { S, rerender, toast, fmtTime, saveLater, go } from './state.js';
import { P, createEpisode, createTrack, copyDraft, deleteDraft, deleteTrack, deleteEpisode, parseCast } from './model.js';
import { confirmDeleteWork } from './views-home.js';
import { ask, confirmBox } from './dialog.js';
import { ensureCastIds, numberCast, rolesOf } from './cast.js';
import { myRole, canEdit, isOwner, ROLE_LABEL, rolesOfWork, saveRoles, joinUrl, profileName, groupMembers } from './access.js';
import { CastTable } from './sheet.js';
import { newId } from './db.js';

const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0);

export function latestDraft(drafts, trackId) {
  return (drafts || []).filter((d) => d.trackId === trackId).sort((a, b) => (b.no || 0) - (a.no || 0))[0];
}

async function swapOrder(w, col, list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const a = list.slice();
  [a[i], a[j]] = [a[j], a[i]];
  await db.batch(a.map((x, k) => ({ op: 'update', path: P.doc(w, col, x.id), data: { order: k + 1 } })));
}

function Menu(items) {
  return h('details', { class: 'kebab' },
    h('summary', { title: 'その他の操作', 'aria-label': 'その他の操作' }, '⋯'),
    h('div', { class: 'menu' }, items.filter(Boolean).map((it) => h('button', {
      class: 'linklike' + (it.danger ? ' danger' : ''),
      onclick: (e) => { e.target.closest('details').open = false; it.fn(); },
    }, it.label))));
}

async function askName(title, label, value, ok = '保存') {
  const r = await ask({ title, ok, fields: [{ key: 'v', label, value, required: true }] });
  return r ? r.v : null;
}

export function WorkView() {
  const w = S.route.params.w;
  const work = S.d.work;
  if (work === undefined) return h('main', { class: 'page' }, h('p', { class: 'muted' }, '読み込み中…'));
  if (work === null) return h('main', { class: 'page' }, h('p', null, 'この作品は見つからないか、あなたに共有されていません。'), h('a', { href: '#/' }, '作品一覧へ'));
  const eps = (S.d.episodes || []).slice().sort(byOrder);
  const edit = canEdit(work);
  const owner = isOwner(work);
  const tracks = S.d.tracks || [];
  const drafts = S.d.drafts || [];
  const workPath = P.work(w);

  return h('main', { class: 'page' },
    h('div', { class: 'page-head' },
      h('input', {
        class: 'title-input', value: work.title, 'aria-label': '作品名', readonly: !edit,
        oninput: (e) => saveLater(workPath, { title: e.target.value, updatedAt: Date.now() }),
      }),
      h('div', { class: 'actions' },
        h('span', { class: 'badge role-' + myRole(work) }, ROLE_LABEL[myRole(work)]),
        h('a', { class: 'btn primary share-btn', href: `#/w/${w}/people` }, '共有'),
        h('a', { class: 'btn', href: `#/w/${w}/cast` }, `メンバー一覧（${(work.cast || []).length}人）`),
        edit ? Menu([
          {
            label: 'タイトルの頭につける文字を変える', fn: async () => {
              const r = await ask({ title: 'タイトルの頭につける文字', ok: '保存', fields: [{ key: 'v', label: '例：【表現活動】（空欄にもできます）', value: work.prefix ?? '【表現活動】' }] });
              if (r) db.update(workPath, { prefix: r.v });
            },
          },
          owner ? { label: 'この作品を削除', danger: true, fn: () => confirmDeleteWork(w, work) } : null,
        ]) : null)),
    !edit ? h('div', { class: 'note' }, 'この作品は閲覧のみで共有されています。見ることとPDFの書き出しができます。') : null,
    h('p', { class: 'muted small' }, `PDFのタイトル例：${work.prefix ?? '【表現活動】'}2話図解_トラ1_第1稿`),
    eps.length === 0 ? h('div', { class: 'empty' }, h('p', null, 'まだ話がありません。'), edit ? h('p', { class: 'muted' }, '「＋ 話を追加」から始めましょう（例：1話、2話）。') : null) : null,
    eps.map((ep, i) => {
      const ts = tracks.filter((t) => t.episodeId === ep.id).sort(byOrder);
      return h('section', { key: ep.id, class: 'episode' },
        h('div', { class: 'ep-head' },
          h('h2', null, ep.title),
          h('div', { class: 'actions' },
            ts.length ? h('a', { class: 'btn small', href: `#/w/${w}/print/e/${ep.id}` }, 'この話をPDFに') : null,
            edit ? h('button', {
              class: 'btn small primary', onclick: async () => {
                const t = await askName('トラックを追加', 'トラックの名前', `トラック${ts.length + 1}`, '追加');
                if (t) await createTrack(w, ep.id, t, ts.length + 1, S.user);
              },
            }, '＋ トラックを追加') : null,
            !edit ? null : Menu([
              { label: '名前を変える', fn: async () => { const t = await askName('話の名前を変える', '話の名前', ep.title); if (t) db.update(P.doc(w, 'episodes', ep.id), { title: t }); } },
              i > 0 ? { label: '上へ移動', fn: () => swapOrder(w, 'episodes', eps, i, -1) } : null,
              i < eps.length - 1 ? { label: '下へ移動', fn: () => swapOrder(w, 'episodes', eps, i, 1) } : null,
              { label: 'この話を削除', danger: true, fn: async () => { if (await confirmBox(`「${ep.title}」と、その中のトラックをすべて削除しますか？`, { ok: '削除', danger: true })) await deleteEpisode(w, ep.id); } },
            ]))),
        ts.length === 0 ? h('p', { class: 'muted small pad' }, 'トラックがまだありません。') : null,
        h('ul', { class: 'tracks' }, ts.map((t, k) => {
          const ds = drafts.filter((d) => d.trackId === t.id).sort((a, b) => (b.no || 0) - (a.no || 0));
          const latest = ds[0];
          return h('li', { key: t.id, class: 'track' },
            h('a', { class: 'track-main', href: latest ? (edit ? `#/w/${w}/d/${latest.id}` : `#/w/${w}/print/d/${latest.id}`) : '#' },
              h('div', { class: 'track-title' }, t.title, latest ? h('span', { class: 'badge' }, `第${latest.no}稿`) : null),
              h('div', { class: 'muted small' },
                latest && latest.zukaikko ? `図解っ子：${latest.zukaikko} ・ ` : '',
                latest ? `更新 ${fmtTime(latest.updatedAt)}${latest.updatedBy ? '（' + latest.updatedBy + '）' : ''}` : '')),
            h('div', { class: 'track-actions' },
              ds.length > 1 ? h('select', {
                class: 'small', 'aria-label': '稿を選ぶ', value: '',
                onchange: (e) => { if (e.target.value) go(edit ? `#/w/${w}/d/${e.target.value}` : `#/w/${w}/print/d/${e.target.value}`); },
              }, h('option', { value: '' }, '稿を選ぶ'), ds.map((d) => h('option', { value: d.id }, `第${d.no}稿`))) : null,
              latest ? h('a', { class: 'btn small', href: `#/w/${w}/print/d/${latest.id}` }, 'PDF') : null,
              !edit ? null : Menu([
                latest ? { label: '新しい稿を作る（最新の稿を複製）', fn: async () => { const nd = await copyDraft(w, latest.id, S.user); toast('新しい稿を作りました'); go(`#/w/${w}/d/${nd}`); } } : null,
                { label: '名前を変える', fn: async () => { const n = await askName('トラックの名前を変える', 'トラックの名前', t.title); if (n) db.update(P.doc(w, 'tracks', t.id), { title: n }); } },
                k > 0 ? { label: '上へ移動', fn: () => swapOrder(w, 'tracks', ts, k, -1) } : null,
                k < ts.length - 1 ? { label: '下へ移動', fn: () => swapOrder(w, 'tracks', ts, k, 1) } : null,
                ds.length > 1 ? { label: `最新の稿（第${latest.no}稿）だけ削除`, danger: true, fn: async () => { if (await confirmBox(`第${latest.no}稿を削除しますか？`, { ok: '削除', danger: true })) await deleteDraft(w, latest.id); } } : null,
                { label: 'このトラックを削除', danger: true, fn: async () => { if (await confirmBox(`「${t.title}」をすべての稿ごと削除しますか？`, { ok: '削除', danger: true })) await deleteTrack(w, t.id); } },
              ])));
        })));
    }),
    edit ? h('div', { class: 'actions pad-top' },
      h('button', {
        class: 'btn primary', onclick: async () => {
          const t = await askName('話を追加', '話の名前', `${eps.length + 1}話`, '追加');
          if (t) await createEpisode(w, t, eps.length + 1);
        },
      }, '＋ 話を追加')) : null,
  );
}

// ---------- メンバー一覧 ----------
let castTimer = null;
function editCast(w, cast) {
  S.ui.cast = cast;
  saveLater(P.work(w), { cast, updatedAt: Date.now() }, 500);
  clearTimeout(castTimer);
  castTimer = setTimeout(() => { if (!S.ui.castDrag) { S.ui.cast = null; rerender(); } }, 2500);
  rerender();
}

// 行の左のつまみをドラッグして並べ替える（マウス・指どちらでも）
function startDrag(e, w, cast, i) {
  e.preventDefault();
  const row = e.target.closest('tr');
  const rowH = row.getBoundingClientRect().height;
  const startY = e.clientY;
  S.ui.castDrag = { from: i, to: i, dy: 0, rowH };
  rerender();
  const move = (ev) => {
    const d = S.ui.castDrag;
    if (!d) return;
    d.dy = ev.clientY - startY;
    d.to = Math.max(0, Math.min(cast.length - 1, d.from + Math.round(d.dy / rowH)));
    rerender();
    // 画面端で自動スクロール
    if (ev.clientY < 70) window.scrollBy(0, -12);
    else if (ev.clientY > window.innerHeight - 50) window.scrollBy(0, 12);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    const d = S.ui.castDrag;
    S.ui.castDrag = null;
    if (d && d.to !== d.from) {
      const a = cast.slice();
      const [m] = a.splice(d.from, 1);
      a.splice(d.to, 0, m);
      editCast(w, a);
    } else rerender();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function rowStyle(i) {
  const d = S.ui.castDrag;
  if (!d) return null;
  if (i === d.from) return { transform: `translateY(${d.dy}px)`, position: 'relative', zIndex: 2 };
  if (d.from < d.to && i > d.from && i <= d.to) return { transform: `translateY(${-d.rowH}px)` };
  if (d.from > d.to && i < d.from && i >= d.to) return { transform: `translateY(${d.rowH}px)` };
  return null;
}

export function CastView() {
  const w = S.route.params.w;
  const work = S.d.work;
  if (!work) return h('main', { class: 'page' }, h('p', { class: 'muted' }, '読み込み中…'));
  if (!canEdit(work)) {
    return h('main', { class: 'page narrow' },
      h('div', { class: 'page-head' }, h('h1', null, 'メンバー一覧'), h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/w/${w}` }, '作品に戻る'))),
      h('p', { class: 'muted small' }, '閲覧のみで共有されているため、変更はできません。'),
      CastTable(work.cast),
      work.labelRules ? h('section', { class: 'panel' }, h('h2', null, '図解での表記のルール'), h('div', { class: 'rules-body' }, work.labelRules)) : null);
  }
  let cast = S.ui.cast || work.cast || [];
  const fixed = ensureCastIds(cast);
  if (fixed.changed) { cast = fixed.cast; queueMicrotask(() => editCast(w, cast)); }
  const numbered = numberCast(cast);
  const upd = (i, k, v) => editCast(w, cast.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  // 役（兼役は複数）を書き換える。古い role / label の形は roles に置き換える
  const setRoles = (i, fn) => editCast(w, cast.map((c, j) => {
    if (j !== i) return c;
    const roles = fn(rolesOf(c).length ? rolesOf(c).map((r) => ({ ...r })) : [{ name: '', label: '' }]);
    const n = { ...c, roles };
    delete n.role; delete n.label;
    return n;
  }));
  const dragging = S.ui.castDrag;
  return h('main', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'メンバー一覧'),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/w/${w}` }, '作品に戻る'))),
    h('p', { class: 'muted small' },
      '番号は上から順に自動で付きます。左のつまみ（⠿）をドラッグすると順番を入れ替えられ、すべてのトラックの舞台図の番号も一緒に変わります。1人が複数の役をするときは「＋ 兼役」で役を追加してください。CD係のように記号（CDなど）の人は、この一覧とPDFの表にだけ載り、舞台図には出ません。'),
    h('div', { class: 'cast-scroll' }, h('table', { class: 'cast-edit' + (dragging ? ' dragging' : '') },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, '番号'), h('th', null, '名前'), h('th', null, '役 ／ 図解での表記'), h('th', null, ''))),
      h('tbody', null, cast.map((c, i) => h('tr', { key: c.id || 'c' + i, style: rowStyle(i), class: dragging && dragging.from === i ? 'drag-row' : null },
        h('td', { class: 'grip-cell' }, h('span', { class: 'grip', title: 'ドラッグで並べ替え', onpointerdown: (e) => startDrag(e, w, cast, i) }, '⠿')),
        h('td', { class: 'no' },
          c.tag != null && c.tag !== ''
            ? h('input', { value: c.tag, class: 'tag-in', 'aria-label': '記号', oninput: (e) => upd(i, 'tag', e.target.value), onblur: (e) => { if (!e.target.value.trim()) upd(i, 'tag', ''); } })
            : h('span', { class: 'auto-no' }, numbered[i].no)),
        h('td', null, h('input', { value: c.name, oninput: (e) => upd(i, 'name', e.target.value), 'aria-label': '名前' })),
        h('td', { class: 'roles-cell' },
          (rolesOf(c).length ? rolesOf(c) : [{ name: '', label: '' }]).map((r, k) => h('div', { key: 'r' + k, class: 'role-line' },
            h('input', { value: r.name, placeholder: k ? '兼役' : '（なし）', 'aria-label': k ? '兼役' : '役', oninput: (e) => setRoles(i, (rs) => { rs[k].name = e.target.value; return rs; }) }),
            h('input', { class: 'lbl-in', value: r.label, placeholder: '表記 例：ルー', 'aria-label': '図解での表記', oninput: (e) => setRoles(i, (rs) => { rs[k].label = e.target.value; return rs; }) }),
            k > 0 ? h('button', { class: 'icon-btn', title: 'この兼役を削除', onclick: () => setRoles(i, (rs) => rs.filter((_, x) => x !== k)) }, '×') : h('span', { class: 'icon-sp' }))),
          h('button', { class: 'add-role', onclick: () => setRoles(i, (rs) => [...rs, { name: '', label: '' }]) }, '＋ 兼役')),
        h('td', { class: 'row-btns' },
          h('details', { class: 'kebab' },
            h('summary', { title: 'その他' }, '⋯'),
            h('div', { class: 'menu' },
              c.tag ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; upd(i, 'tag', ''); } }, '番号に戻す')
                : h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; upd(i, 'tag', 'CD'); } }, '番号の代わりに記号を使う（CD係など。舞台図には出ません）'),
              h('button', { class: 'linklike danger', onclick: async (e) => { e.target.closest('details').open = false; if (await confirmBox(`「${c.name || '名前なし'}」を一覧から削除しますか？\n舞台図に置いた丸は番号なしになります。`, { ok: '削除', danger: true })) editCast(w, cast.filter((_, j) => j !== i)); } }, '削除'))))))))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => {
        // 記号の人（CD係など）より前に追加する
        let at = cast.length;
        while (at > 0 && cast[at - 1].tag) at--;
        const a = cast.slice();
        a.splice(at, 0, { name: '', roles: [{ name: '', label: '' }], tag: '' });
        editCast(w, ensureCastIds(a).cast);
      } }, '＋ 1人追加')),
    h('section', { class: 'panel' },
      h('h2', null, '図解での表記のルール'),
      h('p', { class: 'muted small' }, '役名を舞台図に書くときの決まりをメモしておけます（舞台図の編集画面からも見られます）。上の表の「図解での表記」に入れた文字が、舞台図の丸の横に表示されます。'),
      h('textarea', {
        rows: 4, value: work.labelRules || '', placeholder: '例：役名は〇の中ではなく横に書く。フォントはArial 9。ルーシィ→ルー、エドマンド→エド…',
        oninput: (e) => saveLater(P.work(w), { labelRules: e.target.value, updatedAt: Date.now() }),
      })),
    h('section', { class: 'panel' },
      h('h2', null, 'まとめて貼り付け'),
      h('p', { class: 'muted small' }, '1行に1人ずつ。「ぐっち（ビーヴァー奥さん）」や、表計算ソフトからコピーした「名前・役・図解での表記」の列に対応しています。兼役は「役A/役B」のように「/」で区切ります。行頭の番号は無視され、上から順に番号が付きます。'),
      h('textarea', { rows: 8, value: S.ui.castPaste || '', oninput: (e) => { S.ui.castPaste = e.target.value; }, placeholder: 'ぐっち（ビーヴァー奥さん）\nまお（ルーシィ）\nもえ' }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn primary', onclick: async () => {
            const add = parseCast(S.ui.castPaste); if (!add.length) return;
            if (cast.length && !(await confirmBox('今の一覧を貼り付けた内容で置き換えますか？\n舞台図に置いた丸は番号なしになります。', { ok: '置き換える', danger: true }))) return;
            const staff = add.some((c) => c.tag) ? [] : cast.filter((c) => c.tag);
            editCast(w, [...add, ...staff]); S.ui.castPaste = ''; toast(`${add.length}人を読み込みました`);
          },
        }, '一覧を置き換える'),
        h('button', { class: 'btn', onclick: () => { const add = parseCast(S.ui.castPaste); if (!add.length) return; editCast(w, [...cast, ...add]); S.ui.castPaste = ''; toast(`${add.length}人を追加しました`); } }, '後ろに追加'))),
  );
}

// ---------- 共有（Googleドライブと同じ形） ----------
function splitAddrs(text) {
  return [...new Set(String(text || '').split(/[\s,、，;；]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

async function addPeople(w, work) {
  const addrs = splitAddrs(S.ui.shareInput);
  if (!addrs.length) return;
  const role = S.ui.shareRole || 'editor';
  const roles = rolesOfWork(work);
  const added = [];
  const errors = [];
  for (const a of addrs) {
    if (!EMAIL_RE.test(a)) { errors.push(`「${a}」はメールアドレスの形ではありません`); continue; }
    if (a.endsWith('@googlegroups.com')) {
      const members = await groupMembers(a);
      if (!members) { errors.push(`${a} のメンバー一覧を読み込めませんでした（グループが同期されていないか、あなたがそのグループのメンバーではありません）`); continue; }
      let n = 0;
      for (const m of members) if (!roles[m]) { roles[m] = role; n++; }
      added.push(`${a}（${n}人）`);
      continue;
    }
    if (!roles[a]) { roles[a] = role; added.push(a); }
  }
  if (added.length) {
    try {
      await saveRoles(w, roles);
      toast(`${added.join('、')} を${ROLE_LABEL[role]}として追加しました`, 'info', 5000);
      S.ui.shareInput = '';
    } catch (e) { errors.push(e.message || String(e)); }
  }
  S.ui.shareError = errors.join('\n');
  rerender();
}

async function changeRole(w, work, email, role) {
  const roles = rolesOfWork(work);
  if (role === 'remove') delete roles[email]; else roles[email] = role;
  try { await saveRoles(w, roles); } catch (e) { toast(e.message, 'error'); rerender(); }
}

async function leaveWork(w, work) {
  if (!(await confirmBox('この作品の共有から抜けますか？\n抜けると、この作品を見られなくなります。', { ok: '抜ける', danger: true }))) return;
  const me = S.user.email;
  await db.update(P.work(w), {
    participants: (work.participants || []).filter((e) => e !== me),
    viewers: (work.viewers || []).filter((e) => e !== me),
  });
  go('#/');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('リンクをコピーしました'); } catch (e) {
    await ask({ title: 'リンク', message: 'コピーできなかったので、下の文字を選んでコピーしてください。', fields: [{ key: 'v', label: 'リンク', value: text }], cancel: false, ok: '閉じる' });
  }
}

export function ShareView() {
  const w = S.route.params.w;
  const work = S.d.work;
  if (work === undefined) return h('main', { class: 'page' }, h('p', { class: 'muted' }, '読み込み中…'));
  if (work === null) return h('main', { class: 'page' }, h('p', null, 'この作品は見つからないか、あなたに共有されていません。'), h('a', { href: '#/' }, '作品一覧へ'));
  const me = S.user.email;
  const owner = isOwner(work);
  const roles = rolesOfWork(work);
  const order = { owner: 0, editor: 1, viewer: 2 };
  const people = Object.keys(roles).sort((a, b) => (order[roles[a]] - order[roles[b]]) || a.localeCompare(b));
  const link = work.linkRole || 'off';
  const nameOf = (e) => (e === me ? S.user.name : profileName(e, rerender));

  return h('main', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', null, `「${work.title || '無題の作品'}」を共有`),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/w/${w}` }, '作品に戻る'))),

    owner ? h('section', { class: 'panel' },
      h('h2', null, 'ユーザーやグループを追加'),
      h('div', { class: 'share-add' },
        h('textarea', {
          rows: 2, value: S.ui.shareInput || '', placeholder: 'メールアドレス、または 〇〇@googlegroups.com（複数は改行や「,」で区切る）',
          oninput: (e) => { S.ui.shareInput = e.target.value; if (S.ui.shareError) { S.ui.shareError = ''; rerender(); } },
        }),
        h('div', { class: 'share-add-row' },
          h('select', { value: S.ui.shareRole || 'editor', onchange: (e) => { S.ui.shareRole = e.target.value; } },
            h('option', { value: 'editor' }, '編集者'), h('option', { value: 'viewer' }, '閲覧者'), h('option', { value: 'owner' }, 'オーナー')),
          h('button', { class: 'btn primary', onclick: () => addPeople(w, work) }, '追加'))),
      S.ui.shareError ? h('div', { class: 'dlg-err pre' }, S.ui.shareError) : null,
      h('p', { class: 'muted small' }, 'Googleグループのアドレスを入れると、そのグループのメンバー全員をまとめて追加します（あとからグループに入った人は自動では追加されません）。追加した人には自動で通知が届かないので、下の「リンクをコピー」で知らせてください。')) : null,

    h('section', { class: 'panel' },
      h('h2', null, `アクセスできるユーザー（${people.length}人）`),
      h('ul', { class: 'mlist' }, people.map((e) => h('li', { key: e },
        h('div', { class: 'grow' },
          h('div', null, nameOf(e) || e, e === me ? h('span', { class: 'muted small' }, '（あなた）') : null),
          nameOf(e) ? h('div', { class: 'muted small' }, e) : null),
        owner ? h('select', {
          value: roles[e], 'aria-label': '権限',
          onchange: async (ev) => {
            const v = ev.target.value;
            if (e === me && v !== 'owner' && !(await confirmBox(v === 'remove' ? '自分をこの作品から外しますか？\n外すと、この作品を見られなくなります。' : '自分をオーナーから外しますか？\nあとで戻すには、ほかのオーナーに頼む必要があります。', { ok: 'はい', danger: true }))) { rerender(); return; }
            await changeRole(w, work, e, v);
            if (e === me && v === 'remove') go('#/');
          },
        }, h('option', { value: 'owner' }, 'オーナー'), h('option', { value: 'editor' }, '編集者'), h('option', { value: 'viewer' }, '閲覧者'), h('option', { value: 'remove' }, 'アクセス権を削除'))
          : h('span', { class: 'badge role-' + roles[e] }, ROLE_LABEL[roles[e]])))),
      !owner ? h('div', { class: 'actions' },
        h('span', { class: 'muted small grow' }, '共有の設定を変えられるのはオーナーだけです。'),
        h('button', { class: 'btn small danger', onclick: () => leaveWork(w, work) }, '共有から抜ける')) : null),

    h('section', { class: 'panel' },
      h('h2', null, '一般的なアクセス'),
      h('div', { class: 'link-row' },
        h('span', { class: 'link-ico' + (link === 'off' ? '' : ' on') }, link === 'off' ? '🔒' : '🔗'),
        h('div', { class: 'grow' },
          owner ? h('select', {
            value: link === 'off' ? 'off' : 'link',
            onchange: (e) => db.update(P.work(w), { linkRole: e.target.value === 'off' ? 'off' : 'viewer', updatedAt: Date.now() }),
          }, h('option', { value: 'off' }, '制限付き'), h('option', { value: 'link' }, 'リンクを知っている全員')) : h('b', null, link === 'off' ? '制限付き' : 'リンクを知っている全員'),
          h('div', { class: 'muted small' }, link === 'off'
            ? '追加されたユーザーだけが開けます。'
            : 'このリンクを開いてGoogleでログインした人は、だれでもこの作品に参加できます。')),
        link !== 'off' ? (owner ? h('select', {
          value: link, 'aria-label': 'リンクの権限',
          onchange: (e) => db.update(P.work(w), { linkRole: e.target.value, updatedAt: Date.now() }),
        }, h('option', { value: 'viewer' }, '閲覧者'), h('option', { value: 'editor' }, '編集者')) : h('span', { class: 'badge' }, ROLE_LABEL[link])) : null),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => copyText(joinUrl(w, work)) }, '🔗 リンクをコピー'),
        owner && link !== 'off' ? h('button', {
          class: 'btn small ghost', onclick: async () => {
            if (!(await confirmBox('今のリンクを無効にして、新しいリンクを作りますか？\nすでに参加している人はそのまま使えます。', { ok: '作り直す' }))) return;
            await db.update(P.work(w), { linkKey: newId(20), updatedAt: Date.now() });
            toast('新しいリンクを作りました');
          },
        }, 'リンクを作り直す') : null),
      h('p', { class: 'muted small' }, link === 'off'
        ? 'リンクをコピーして送っても、上の一覧にいない人は開けません。'
        : 'リンクから参加した人は、上の「アクセスできるユーザー」に追加されます。')),
  );
}
