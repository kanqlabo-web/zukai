// 作品ページ（話・トラック・稿の一覧）とキャスト一覧
import { h } from './vdom.js';
import { db } from './db.js';
import { S, rerender, toast, fmtTime, saveLater, go } from './state.js';
import { P, createEpisode, createTrack, copyDraft, deleteDraft, deleteTrack, deleteEpisode, parseCast } from './model.js';
import { confirmDeleteWork } from './views-home.js';
import { ask, confirmBox } from './dialog.js';
import { ensureCastIds, numberCast } from './cast.js';

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
          {
            label: 'タイトルの頭につける文字を変える', fn: async () => {
              const r = await ask({ title: 'タイトルの頭につける文字', ok: '保存', fields: [{ key: 'v', label: '例：【表現活動】（空欄にもできます）', value: work.prefix ?? '【表現活動】' }] });
              if (r) db.update(workPath, { prefix: r.v });
            },
          },
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
                const t = await askName('トラックを追加', 'トラックの名前', `トラック${ts.length + 1}`, '追加');
                if (t) await createTrack(w, ep.id, t, ts.length + 1, S.user);
              },
            }, '＋ トラックを追加'),
            Menu([
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
                { label: '名前を変える', fn: async () => { const n = await askName('トラックの名前を変える', 'トラックの名前', t.title); if (n) db.update(P.doc(w, 'tracks', t.id), { title: n }); } },
                k > 0 ? { label: '上へ移動', fn: () => swapOrder(w, 'tracks', ts, k, -1) } : null,
                k < ts.length - 1 ? { label: '下へ移動', fn: () => swapOrder(w, 'tracks', ts, k, 1) } : null,
                ds.length > 1 ? { label: `最新の稿（第${latest.no}稿）だけ削除`, danger: true, fn: async () => { if (await confirmBox(`第${latest.no}稿を削除しますか？`, { ok: '削除', danger: true })) await deleteDraft(w, latest.id); } } : null,
                { label: 'このトラックを削除', danger: true, fn: async () => { if (await confirmBox(`「${t.title}」をすべての稿ごと削除しますか？`, { ok: '削除', danger: true })) await deleteTrack(w, t.id); } },
              ])));
        })));
    }),
    h('div', { class: 'actions pad-top' },
      h('button', {
        class: 'btn primary', onclick: async () => {
          const t = await askName('話を追加', '話の名前', `${eps.length + 1}話`, '追加');
          if (t) await createEpisode(w, t, eps.length + 1);
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
  let cast = S.ui.cast || work.cast || [];
  const fixed = ensureCastIds(cast);
  if (fixed.changed) { cast = fixed.cast; queueMicrotask(() => editCast(w, cast)); }
  const numbered = numberCast(cast);
  const upd = (i, k, v) => editCast(w, cast.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const dragging = S.ui.castDrag;
  return h('main', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'キャスト一覧'),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/w/${w}` }, '作品に戻る'))),
    h('p', { class: 'muted small' },
      '番号は上から順に自動で付きます。左のつまみ（⠿）をドラッグすると順番を入れ替えられ、すべてのトラックの舞台図の番号も一緒に変わります。'),
    h('div', { class: 'cast-scroll' }, h('table', { class: 'cast-edit' + (dragging ? ' dragging' : '') },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, '番号'), h('th', null, '名前'), h('th', null, '役'), h('th', null, '図解での表記'), h('th', null, ''))),
      h('tbody', null, cast.map((c, i) => h('tr', { key: c.id || 'c' + i, style: rowStyle(i), class: dragging && dragging.from === i ? 'drag-row' : null },
        h('td', { class: 'grip-cell' }, h('span', { class: 'grip', title: 'ドラッグで並べ替え', onpointerdown: (e) => startDrag(e, w, cast, i) }, '⠿')),
        h('td', { class: 'no' },
          c.tag != null && c.tag !== ''
            ? h('input', { value: c.tag, class: 'tag-in', 'aria-label': '記号', oninput: (e) => upd(i, 'tag', e.target.value), onblur: (e) => { if (!e.target.value.trim()) upd(i, 'tag', ''); } })
            : h('span', { class: 'auto-no' }, numbered[i].no)),
        h('td', null, h('input', { value: c.name, oninput: (e) => upd(i, 'name', e.target.value), 'aria-label': '名前' })),
        h('td', null, h('input', { value: c.role, oninput: (e) => upd(i, 'role', e.target.value), 'aria-label': '役', placeholder: '（なし）' })),
        h('td', { class: 'lbl' }, h('input', { value: c.label || '', oninput: (e) => upd(i, 'label', e.target.value), 'aria-label': '図解での表記', placeholder: c.role ? '例：ルー' : '' })),
        h('td', { class: 'row-btns' },
          h('details', { class: 'kebab' },
            h('summary', { title: 'その他' }, '⋯'),
            h('div', { class: 'menu' },
              c.tag ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; upd(i, 'tag', ''); } }, '番号に戻す')
                : h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; upd(i, 'tag', 'CD'); } }, '番号の代わりに記号を使う（CDなど）'),
              h('button', { class: 'linklike danger', onclick: async (e) => { e.target.closest('details').open = false; if (await confirmBox(`「${c.name || '名前なし'}」を一覧から削除しますか？\n舞台図に置いた丸は番号なしになります。`, { ok: '削除', danger: true })) editCast(w, cast.filter((_, j) => j !== i)); } }, '削除'))))))))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { const a = ensureCastIds([...cast, { name: '', role: '', label: '', tag: '' }]).cast; editCast(w, a); } }, '＋ 1人追加')),
    h('section', { class: 'panel' },
      h('h2', null, '図解での表記のルール'),
      h('p', { class: 'muted small' }, '役名を舞台図に書くときの決まりをメモしておけます（舞台図の編集画面からも見られます）。上の表の「図解での表記」に入れた文字が、舞台図の丸の横に表示されます。'),
      h('textarea', {
        rows: 4, value: work.labelRules || '', placeholder: '例：役名は〇の中ではなく横に書く。フォントはArial 9。ルーシィ→ルー、エドマンド→エド…',
        oninput: (e) => saveLater(P.work(w), { labelRules: e.target.value, updatedAt: Date.now() }),
      })),
    h('section', { class: 'panel' },
      h('h2', null, 'まとめて貼り付け'),
      h('p', { class: 'muted small' }, '1行に1人ずつ。「ぐっち（ビーヴァー奥さん）」や、表計算ソフトからコピーした「名前・役・図解での表記」の列に対応しています。行頭の番号は無視され、上から順に番号が付きます。'),
      h('textarea', { rows: 8, value: S.ui.castPaste || '', oninput: (e) => { S.ui.castPaste = e.target.value; }, placeholder: 'ぐっち（ビーヴァー奥さん）\nまお（ルーシィ）\nもえ' }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn primary', onclick: async () => {
            const add = parseCast(S.ui.castPaste); if (!add.length) return;
            if (cast.length && !(await confirmBox('今の一覧を貼り付けた内容で置き換えますか？\n舞台図に置いた丸は番号なしになります。', { ok: '置き換える', danger: true }))) return;
            editCast(w, add); S.ui.castPaste = ''; toast(`${add.length}人を読み込みました`);
          },
        }, '一覧を置き換える'),
        h('button', { class: 'btn', onclick: () => { const add = parseCast(S.ui.castPaste); if (!add.length) return; editCast(w, [...cast, ...add]); S.ui.castPaste = ''; toast(`${add.length}人を追加しました`); } }, '後ろに追加'))),
  );
}
