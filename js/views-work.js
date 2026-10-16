// 作品ページ（話・トラ・稿の一覧）とキャスト一覧
import { h } from './vdom.js';
import { db } from './db.js';
import { S, rerender, toast, fmtTime, saveLater, go } from './state.js';
import { P, createEpisode, createTrack, copyDraft, deleteDraft, deleteTrack, deleteEpisode, parseCast } from './model.js';
import { confirmDeleteWork } from './views-home.js';

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

export function WorkView() {
  const w = S.route.params.w;
  const work = S.d.work;
  if (work === undefined) return h('main', { class: 'page' }, h('p', { class: 'muted' }, '読み込み中…'));
  if (work === null) return h('main', { class: 'page' }, h('p', null, 'この作品は見つかりませんでした。'), h('a', { href: '#/' }, '作品一覧へ'));
  const eps = (S.d.episodes || []).slice().sort(byOrder);
  const tracks = S.d.tracks || [];
  const drafts = S.d.drafts || [];
  const workPath = P.work(w);

  return h('main', { class: 'page' },
    h('div', { class: 'page-head' },
      h('input', {
        class: 'title-input', value: work.title, 'aria-label': '作品名',
        oninput: (e) => saveLater(workPath, { title: e.target.value, updatedAt: Date.now() }),
      }),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: `#/w/${w}/cast` }, `キャスト一覧（${(work.cast || []).length}人）`),
        Menu([
          { label: 'タイトルの頭につける文字を変える', fn: () => { const t = prompt('PDFのタイトルの頭につける文字（例：【表現活動】）', work.prefix ?? '【表現活動】'); if (t != null) db.update(workPath, { prefix: t }); } },
          S.role === 'admin' ? { label: 'この作品を削除', danger: true, fn: () => confirmDeleteWork(w, work) } : null,
        ]))),
    h('p', { class: 'muted small' }, `PDFのタイトル例：${work.prefix ?? '【表現活動】'}2話図解_トラ1_第1稿`),
    eps.length === 0 ? h('div', { class: 'empty' }, h('p', null, 'まだ話がありません。'), h('p', { class: 'muted' }, '「＋ 話を追加」から始めましょう（例：1話、2話）。')) : null,
    eps.map((ep, i) => {
      const ts = tracks.filter((t) => t.episodeId === ep.id).sort(byOrder);
      return h('section', { key: ep.id, class: 'episode' },
        h('div', { class: 'ep-head' },
          h('h2', null, ep.title),
          h('div', { class: 'actions' },
            ts.length ? h('a', { class: 'btn small', href: `#/w/${w}/print/e/${ep.id}` }, 'この話をPDFに') : null,
            h('button', {
              class: 'btn small primary', onclick: async () => {
                const t = prompt('トラの名前', `トラ${ts.length + 1}`);
                if (!t) return;
                await createTrack(w, ep.id, t.trim(), ts.length + 1, S.user);
              },
            }, '＋ トラを追加'),
            Menu([
              { label: '名前を変える', fn: () => { const t = prompt('話の名前', ep.title); if (t) db.update(P.doc(w, 'episodes', ep.id), { title: t.trim() }); } },
              i > 0 ? { label: '上へ移動', fn: () => swapOrder(w, 'episodes', eps, i, -1) } : null,
              i < eps.length - 1 ? { label: '下へ移動', fn: () => swapOrder(w, 'episodes', eps, i, 1) } : null,
              { label: 'この話を削除', danger: true, fn: async () => { if (confirm(`「${ep.title}」とその中のトラをすべて削除しますか？`)) await deleteEpisode(w, ep.id); } },
            ]))),
        ts.length === 0 ? h('p', { class: 'muted small pad' }, 'トラがまだありません。') : null,
        h('ul', { class: 'tracks' }, ts.map((t, k) => {
          const ds = drafts.filter((d) => d.trackId === t.id).sort((a, b) => (b.no || 0) - (a.no || 0));
          const latest = ds[0];
          return h('li', { key: t.id, class: 'track' },
            h('a', { class: 'track-main', href: latest ? `#/w/${w}/d/${latest.id}` : '#' },
              h('div', { class: 'track-title' }, t.title, latest ? h('span', { class: 'badge' }, `第${latest.no}稿`) : null),
              h('div', { class: 'muted small' },
                latest && latest.zukaikko ? `図解っ子：${latest.zukaikko} ・ ` : '',
                latest ? `更新 ${fmtTime(latest.updatedAt)}${latest.updatedBy ? '（' + latest.updatedBy + '）' : ''}` : '')),
            h('div', { class: 'track-actions' },
              ds.length > 1 ? h('select', {
                class: 'small', 'aria-label': '稿を選ぶ', value: '',
                onchange: (e) => { if (e.target.value) go(`#/w/${w}/d/${e.target.value}`); },
              }, h('option', { value: '' }, '稿を選ぶ'), ds.map((d) => h('option', { value: d.id }, `第${d.no}稿`))) : null,
              latest ? h('a', { class: 'btn small', href: `#/w/${w}/print/d/${latest.id}` }, 'PDF') : null,
              Menu([
                latest ? { label: '新しい稿を作る（最新の稿を複製）', fn: async () => { const nd = await copyDraft(w, latest.id, S.user); toast('新しい稿を作りました'); go(`#/w/${w}/d/${nd}`); } } : null,
                { label: '名前を変える', fn: () => { const n = prompt('トラの名前', t.title); if (n) db.update(P.doc(w, 'tracks', t.id), { title: n.trim() }); } },
                k > 0 ? { label: '上へ移動', fn: () => swapOrder(w, 'tracks', ts, k, -1) } : null,
                k < ts.length - 1 ? { label: '下へ移動', fn: () => swapOrder(w, 'tracks', ts, k, 1) } : null,
                ds.length > 1 ? { label: `最新の稿（第${latest.no}稿）だけ削除`, danger: true, fn: async () => { if (confirm(`第${latest.no}稿を削除しますか？`)) await deleteDraft(w, latest.id); } } : null,
                { label: 'このトラを削除', danger: true, fn: async () => { if (confirm(`「${t.title}」をすべての稿ごと削除しますか？`)) await deleteTrack(w, t.id); } },
              ])));
        })));
    }),
    h('div', { class: 'actions pad-top' },
      h('button', {
        class: 'btn primary', onclick: async () => {
          const t = prompt('話の名前', `${eps.length + 1}話`);
          if (!t) return;
          await createEpisode(w, t.trim(), eps.length + 1);
        },
      }, '＋ 話を追加')),
  );
}

// ---------- キャスト一覧 ----------
let castTimer = null;
function editCast(w, cast) {
  S.ui.cast = cast;
  saveLater(P.work(w), { cast, updatedAt: Date.now() }, 500);
  clearTimeout(castTimer);
  castTimer = setTimeout(() => { S.ui.cast = null; rerender(); }, 2500);
  rerender();
}

export function CastView() {
  const w = S.route.params.w;
  const work = S.d.work;
  if (!work) return h('main', { class: 'page' }, h('p', { class: 'muted' }, '読み込み中…'));
  const cast = S.ui.cast || work.cast || [];
  const upd = (i, k, v) => editCast(w, cast.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  return h('main', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'キャスト一覧'),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/w/${w}` }, '作品に戻る'))),
    h('p', { class: 'muted small' }, 'ここで決めた番号が、すべてのトラの一覧表と舞台図の丸の番号に使われます。役は空欄でも大丈夫です。'),
    h('table', { class: 'cast-edit' },
      h('thead', null, h('tr', null, h('th', null, '番号'), h('th', null, '名前'), h('th', null, '役'), h('th', null, ''))),
      h('tbody', null, cast.map((c, i) => h('tr', { key: 'c' + i },
        h('td', { class: 'no' }, h('input', { value: c.no, oninput: (e) => upd(i, 'no', e.target.value), 'aria-label': '番号' })),
        h('td', null, h('input', { value: c.name, oninput: (e) => upd(i, 'name', e.target.value), 'aria-label': '名前' })),
        h('td', null, h('input', { value: c.role, oninput: (e) => upd(i, 'role', e.target.value), 'aria-label': '役' })),
        h('td', { class: 'row-btns' },
          h('button', { class: 'icon-btn', title: '上へ', disabled: i === 0, onclick: () => { const a = cast.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; editCast(w, a); } }, '↑'),
          h('button', { class: 'icon-btn', title: '削除', onclick: () => editCast(w, cast.filter((_, j) => j !== i)) }, '×')))))),
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn', onclick: () => {
          const nums = cast.map((c) => parseInt(c.no, 10)).filter((n) => !isNaN(n));
          editCast(w, [...cast, { no: String(nums.length ? Math.max(...nums) + 1 : 1), name: '', role: '' }]);
        },
      }, '＋ 1人追加')),
    h('section', { class: 'panel' },
      h('h2', null, 'まとめて貼り付け'),
      h('p', { class: 'muted small' }, '1行に1人ずつ。「1 ぐっち（ビーヴァー奥さん）」や、表計算ソフトからコピーした「番号・名前・役」の3列に対応しています。'),
      h('textarea', { rows: 8, value: S.ui.castPaste || '', oninput: (e) => { S.ui.castPaste = e.target.value; }, placeholder: '1 ぐっち（ビーヴァー奥さん）\n2 まお（ルーシィ）\n3 もえ' }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { const add = parseCast(S.ui.castPaste); if (!add.length) return; if (cast.length && !confirm('今の一覧を貼り付けた内容で置き換えますか？')) return; editCast(w, add); S.ui.castPaste = ''; toast(`${add.length}人を読み込みました`); } }, '一覧を置き換える'),
        h('button', { class: 'btn', onclick: () => { const add = parseCast(S.ui.castPaste); if (!add.length) return; editCast(w, [...cast, ...add]); S.ui.castPaste = ''; toast(`${add.length}人を追加しました`); } }, '後ろに追加'))),
  );
}
