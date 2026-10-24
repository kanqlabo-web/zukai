// ライブラリーページ（話・トラック・稿の一覧）とメンバー一覧
import { h } from './vdom.js';
import { db, auth } from './db.js';
import { S, rerender, toast, fmtTime, saveLater, go, pickFile } from './state.js';
import { readZukaiPdf, importZukai } from './pdfimport.js';
import { analyzeDocHtml, sliceToHtml, SLICE_TYPE } from './docimport.js';
import { pickDocHtml, pairFigures } from './gdrive.js';
import { mode } from './db.js';
import { newDraftFlow } from './views-draft.js';
import { P, draftName, createEpisode, createTrack, copyDraft, deleteDraft, deleteTrack, deleteEpisode, parseCast } from './model.js';
import { confirmDeleteWork, confirmLeaveWork } from './views-home.js';
import { ask, confirmBox } from './dialog.js';
import { ensureCastIds, numberCast, rolesOf } from './cast.js';
import { myRole, canEdit, isOwner, ROLE_LABEL, rolesOfWork, saveRoles, joinUrl, profileName, openGroupWindow, waitGroups, cancelGroupWait } from './access.js';
import { GROUP_LOOKUP_URL, ADMIN_EMAILS } from './settings.js';
import { CastTable } from './sheet.js';
import { others, NameTags } from './presence.js';
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
  if (work === null) return h('main', { class: 'page' }, h('p', null, 'このライブラリーは見つからないか、あなたに共有されていません。'), h('a', { href: '#/' }, 'ライブラリー一覧へ'));
  const eps = (S.d.episodes || []).slice().sort(byOrder);
  const edit = canEdit(work);
  const owner = isOwner(work);
  const tracks = S.d.tracks || [];
  const drafts = S.d.drafts || [];
  const workPath = P.work(w);

  return h('main', { class: 'page' },
    h('div', { class: 'page-head' },
      h('input', {
        class: 'title-input', value: work.title, 'aria-label': 'ライブラリー名', readonly: !edit,
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
          owner ? { label: 'このライブラリーを削除', danger: true, fn: () => confirmDeleteWork(w, work) } : null,
        ]) : null)),
    !edit ? h('div', { class: 'note' }, 'このライブラリーは閲覧のみで共有されています。見ることとPDFの書き出しができます。') : null,
    h('p', { class: 'muted small' }, `PDFのタイトル例：${work.prefix ?? '【表現活動】'}2話図解_トラ1_第1稿`),
    eps.length === 0 ? h('div', { class: 'empty' }, h('p', null, 'まだ話がありません。'), edit ? h('p', { class: 'muted' }, '「＋ 話を追加」から始めましょう（例：1話、2話）。') : null) : null,
    eps.map((ep, i) => {
      const ts = tracks.filter((t) => t.episodeId === ep.id).sort(byOrder);
      return h('section', { key: ep.id, class: 'episode' },
        h('div', { class: 'ep-head' },
          h('h2', null, ep.title),
          h('div', { class: 'actions' },
            ts.length ? h('a', { class: 'btn small', href: `#/w/${w}/show/e/${ep.id}` }, 'この話を見る') : null,
            ts.length ? h('a', { class: 'btn small', href: `#/w/${w}/print/e/${ep.id}` }, 'この話を書き出す') : null,
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
          const here = others().filter((p) => p.d && ds.some((x) => x.id === p.d));
          return h('li', { key: t.id, class: 'track' + (here.length ? ' has-pres' : '') },
            h('a', { class: 'track-main', href: latest ? (edit ? `#/w/${w}/d/${latest.id}` : `#/w/${w}/print/d/${latest.id}`) : '#' },
              h('div', { class: 'track-title' }, t.title, latest ? h('span', { class: 'badge' }, draftName(latest)) : null),
              h('div', { class: 'muted small' },
                latest && latest.zukaikko ? `図解っ子：${latest.zukaikko}${latest.updatedAt ? ' ・ ' : ''}` : '',
                latest && latest.updatedAt ? `更新 ${fmtTime(latest.updatedAt)}${latest.updatedBy ? '（' + latest.updatedBy + '）' : ''}` : ''),
              NameTags(here, 'in-track')),
            h('div', { class: 'track-actions' },
              ds.length > 1 ? h('select', {
                class: 'small', 'aria-label': '稿を選ぶ', value: '',
                onchange: (e) => { if (e.target.value) go(edit ? `#/w/${w}/d/${e.target.value}` : `#/w/${w}/print/d/${e.target.value}`); },
              }, h('option', { value: '' }, '稿を選ぶ'), ds.map((d) => h('option', { value: d.id }, draftName(d)))) : null,
              latest ? h('a', { class: 'btn small', href: `#/w/${w}/show/d/${latest.id}` }, '見る') : null,
              latest ? h('a', { class: 'btn small', href: `#/w/${w}/print/d/${latest.id}` }, '書き出す') : null,
              !edit ? null : Menu([
                latest ? { label: '新しい稿を作る（最新稿を複製）', fn: () => newDraftFlow(w, latest, ds) } : null,
                { label: '名前を変える', fn: async () => { const n = await askName('トラックの名前を変える', 'トラックの名前', t.title); if (n) db.update(P.doc(w, 'tracks', t.id), { title: n }); } },
                k > 0 ? { label: '上へ移動', fn: () => swapOrder(w, 'tracks', ts, k, -1) } : null,
                k < ts.length - 1 ? { label: '下へ移動', fn: () => swapOrder(w, 'tracks', ts, k, 1) } : null,
                ds.length > 1 ? { label: `最新稿（${draftName(latest)}）だけ削除`, danger: true, fn: async () => { if (await confirmBox(`${draftName(latest)}を削除しますか？`, { ok: '削除', danger: true })) await deleteDraft(w, latest.id); } } : null,
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
      }, '＋ 話を追加'),
      h('button', { class: 'btn', disabled: !!S.ui.importing, onclick: () => importFlow(w, work, eps) }, S.ui.importing ? '読み込み中…' : '読み込む'),
      isAdmin() ? h('button', { class: 'btn ghost', onclick: startCapture }, '（調査）クリップボードを保存') : null) : null,
    edit ? h('p', { class: 'muted small' }, '「読み込む」で、コピーしたGoogleドキュメントか、図解のPDFを取り込めます。Googleドキュメントで Ctrl+A → Ctrl+C してから、このページで Ctrl+V しても取り込めます。') : null,
  );
}

// ---------- 図解PDFの取り込み ----------
async function importFlow(w, work, eps) {
  const r = await ask({
    title: '読み込む', ok: '次へ',
    fields: [{
      key: 'from', label: '読み込むもの', type: 'select', value: 'clip',
      options: [['clip', 'クリップボード（コピーしたGoogleドキュメント）'], ['pdf', '図解のPDF']],
      hint: 'Googleドキュメントからは、図形描画の図も編集できる図として取り込めます。',
    }],
  });
  if (!r) return;
  if (r.from === 'pdf') return importPdfFlow(w, work, eps);
  return pasteDocFlow(w, work, eps);
}

async function importPdfFlow(w, work, eps) {
  const f = await pickFile('application/pdf,.pdf');
  if (!f) return;
  const setMsg = (m) => { S.ui.importing = m; rerender(); };
  let result;
  try {
    setMsg('PDFを読み込んでいます…');
    result = await readZukaiPdf(f, (d, t) => setMsg(`PDFを読み込んでいます…（${d}／${t}ページ）`));
  } catch (e) {
    setMsg('');
    toast('PDFを読み込めませんでした: ' + (e.message || e), 'error', 8000);
    return;
  } finally { if (S.ui.importing && !result) setMsg(''); }
  setMsg('');
  if (!result.tracks.length) {
    toast('図解として読み取れる文字が見つかりませんでした。文字の入っていないPDF（写真や、このツールで書き出したPDFなど）は取り込めません。', 'error', 9000);
    return;
  }
  await finishImport(w, work, eps, result, 'PDF');
}

// ---------- Googleドキュメントから（コピー＆貼り付け） ----------
// ボタン：クリップボードを読む（許可が出ないときは、Ctrl+V で貼り付けてもらう）
async function pasteDocFlow(w, work, eps) {
  // 図形描画の場所は、Ctrl+V で貼り付けたときにしかわからないので、Ctrl+V を使ってもらう
  void w; void work; void eps;
  await ask({
    title: 'コピーしたドキュメントを取り込む', ok: 'わかりました',
    message: '1. Googleドキュメントで図解を開き、Ctrl+A（すべて選択）→ Ctrl+C（コピー）します。\n2. このページに戻って、Ctrl+V（貼り付け）を押します。',
    detail: '図形描画の図も、動かせる図として取り込めます（はじめに Googleドライブの許可を求められます）。',
    fields: [],
  });
}

export async function importDocHtml(w, work, eps, html) {
  if (S.ui.importing) return;
  let result;
  try { result = analyzeDocHtml(html); } catch (e) { toast('読み取れませんでした: ' + (e.message || e), 'error', 8000); return; }
  if (!result.tracks.length) {
    toast('コピーした内容に図解の表が見つかりませんでした。Googleドキュメントで Ctrl+A → Ctrl+C してから貼り付けてください。', 'error', 9000);
    return;
  }
  const remoteImgs = (html.match(/<img\b[^>]*src="https?:/gi) || []).length;
  await finishImport(w, work, eps, result, 'ドキュメント', remoteImgs && mode !== 'local'
    ? `コピーした内容に図が${remoteImgs}個あります。図形描画はコピーでは取り込めないことがあります。Googleドキュメントの画面で Ctrl+A → Ctrl+C してから貼り付けると、図形描画も取り込めます。` : '');
}

// ライブラリーのページで Ctrl+V したら、Googleドキュメントの図解として取り込む
// 調査用：クリップボードに入っている全部の形式を、ファイルに保存する（管理者だけ）
let capturing = false;
function startCapture() { capturing = true; toast('Googleドキュメントやスライドでコピーしてから、このページで Ctrl+V を押してください', 'info', 15000); }
document.addEventListener('paste', (e) => {
  if (!capturing) return;
  capturing = false;
  e.preventDefault();
  e.stopImmediatePropagation();
  const dt = e.clipboardData;
  const out = { at: new Date().toISOString(), types: [...(dt ? dt.types : [])], data: {} };
  for (const t of out.types) { try { out.data[t] = dt.getData(t); } catch (er) { out.data[t] = '(読めませんでした) ' + er; } }
  // 図形描画の中身を、Googleから取ってこられるか試す
  probeDrawings(out).catch((er) => toast('調べられませんでした: ' + (er.message || er), 'error', 8000));
}, true);
function saveJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
async function probeDrawings(out) {
  let slice = null;
  try { slice = JSON.parse(JSON.parse(out.data['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved; } catch (e) { /* なし */ }
  const docId = (/documents\/([\w-]{20,})\//.exec(out.data['application/x-vnd.google-docs-image-clip+wrapped'] || '') || [])[1] || '';
  const res = { docId, drawings: [], tries: [] };
  if (slice) {
    const toks = slice.dsl_drawingrevisionaccesstokenmap || {};
    for (const [k, v] of Object.entries(slice.dsl_entitymap || {})) {
      const e = v && v.ee_eo;
      if (e && e.d_id) res.drawings.push({ key: k, id: e.d_id, rev: e.d_revision, tok: toks[k] || '', w: e.i_wth, h: e.i_ht });
    }
  }
  if (!res.drawings.length) { saveJson({ ...res, raw: out }, 'clipboard.json'); toast('コピーした内容を clipboard.json に保存しました', 'info', 8000); return; }
  toast('Googleドライブの許可を求めます（調査用）', 'info', 5000);
  let token = '';
  try { token = await auth.driveToken(true); } catch (e) { res.tokenError = String(e.message || e); }
  // 図形描画を SVG で取り出して、全部保存する
  res.svgs = [];
  for (const d of res.drawings) {
    try {
      const r = await fetch(`https://docs.google.com/drawings/d/${d.id}/export/svg`, { headers: { Authorization: 'Bearer ' + token } });
      res.svgs.push({ key: d.key, w: d.w, h: d.h, status: r.status, svg: await r.text() });
    } catch (er) { res.svgs.push({ key: d.key, error: String(er.message || er) }); }
  }
  res.drawings = res.drawings.map((x) => ({ ...x, tok: x.tok ? '（あり）' : '' }));
  saveJson(res, 'drawings.json');
  toast(`図形描画 ${res.svgs.length} 個を drawings.json に保存しました`, 'info', 8000);
}
const isAdmin = () => ADMIN_EMAILS.includes(String((S.user && S.user.email) || '').toLowerCase());

document.addEventListener('paste', (e) => {
  if (!S.route || S.route.name !== 'work' || !S.d.work || !canEdit(S.d.work)) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  let html = e.clipboardData && e.clipboardData.getData('text/html');
  // Googleドキュメントからのコピーなら、図形描画の場所もわかる形式を使う
  const slice = e.clipboardData && e.clipboardData.getData(SLICE_TYPE);
  if (slice) { const h2 = sliceToHtml(slice, html); if (h2 && /<table/i.test(h2)) html = h2; }
  if (!html || !/<table/i.test(html)) return;
  e.preventDefault();
  const eps = (S.d.episodes || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  importDocHtml(S.route.params.w, S.d.work, eps, html);
});

// トラック（稿）のページで Ctrl+V したら、Googleドキュメントの図解を、このトラックに取り込む
document.addEventListener('paste', (e) => {
  if (!S.route || S.route.name !== 'draft' || !S.d.work || !canEdit(S.d.work) || S.ui.importing) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  let html = e.clipboardData && e.clipboardData.getData('text/html');
  const slice = e.clipboardData && e.clipboardData.getData(SLICE_TYPE);
  if (slice) { const h2 = sliceToHtml(slice, html); if (h2 && /<table/i.test(h2)) html = h2; }
  if (!html || !/<table/i.test(html)) return;
  e.preventDefault();
  importDocIntoTrack(S.route.params.w, S.route.params.d, html);
});
async function importDocIntoTrack(w, d, html) {
  let result;
  try { result = analyzeDocHtml(html); } catch (e) { toast('読み取れませんでした: ' + (e.message || e), 'error', 8000); return; }
  if (!result.tracks.length) {
    toast('コピーした内容に図解の表が見つかりませんでした。Googleドキュメントで Ctrl+A → Ctrl+C してから貼り付けてください。', 'error', 9000);
    return;
  }
  const work = S.d.work;
  const drafts = S.d.drafts || [];
  const draft = drafts.find((x) => x.id === d);
  const track = draft && (S.d.tracks || []).find((x) => x.id === draft.trackId);
  if (!draft || !track) return;
  const empty = !String(draft.script || '').trim() && !(S.d.blocks || []).some((b) => b.draftId === d);
  const nextNo = Math.max(0, ...drafts.filter((x) => x.trackId === track.id).map((x) => x.no || 0)) + 1;
  const list = result.tracks.map((T, i) => { const figs = T.blocks.reduce((a, b) => a + b.items.filter((it) => it.kind === 'figure').length, 0); return [String(i), `${T.track || 'トラック'}（第${T.draftNo}稿・タイミング${T.blocks.filter((b) => b.cue).length}個${figs ? `・図${figs}枚` : ''}）`]; });
  // 白紙の稿で、トラックが1つだけなら、聞かずにこの稿に取り込む
  let r = { into: empty ? 'this' : 'next' };
  if (!empty || result.tracks.length > 1) {
    r = await ask({
      title: `「${track.title}」に取り込む`, ok: '取り込む',
      message: result.tracks.length === 1 ? `見つかったトラック：${list[0][1]}` : `トラックが${result.tracks.length}個見つかりました。このトラックに入れるものを選んでください。`,
      detail: (empty ? `この稿（${draftName(draft)}）に取り込みます。` : 'この稿にはもう中身があります。新しい稿を作るか、この稿の後ろに足すかを選んでください。') + '取り込んだあとで、タイミングの位置や改行を確かめてください。',
      fields: [
        result.tracks.length > 1 ? { key: 'ti', label: '取り込むトラック', type: 'select', value: '0', options: list } : null,
        empty ? null : { key: 'into', label: '入れる先', type: 'select', value: 'next', options: [['next', `新しい稿（第${nextNo}稿）を作る`], ['this', `この稿（${draftName(draft)}）の後ろに足す`]] },
      ].filter(Boolean),
    });
    if (r && empty) r.into = 'this';
  }
  if (!r) return;
  const T = result.tracks[+(r.ti || 0)] || result.tracks[0];
  const driveToken = await driveTokenFor([T]);
  try {
    setProgress('取り込んでいます…');
    const out = await importZukai(w, { ...result, tracks: [T] }, {
      epId: track.episodeId, toTrack: track, toDraftId: r.into === 'this' ? d : null, appendTo: empty ? null : { script: draft.script || '', zukaikko: draft.zukaikko || '', theme: draft.theme || '' },
      existingEpisodes: S.d.episodes || [], tracks: S.d.tracks || [], drafts, user: S.user, cast: work.cast || [], vectorize: true, driveToken, onProgress: setProgress,
    });
    setProgress('');
    reportImport(out, `「${track.title}」に取り込みました`);
    const made = out.made[0];
    if (made && made.draftId !== d) go(`#/w/${w}/d/${made.draftId}`);
  } catch (e) {
    setProgress('');
    toast('取り込めませんでした: ' + (e.message || e), 'error', 15000);
  }
}

// 取り込みの進み具合（画面の下に出す）。m が空なら消す
function setProgress(m, done = 0, total = 0) {
  S.ui.importing = m;
  S.ui.importProg = m && total ? { done, total } : null;
  rerender();
}
// 図形描画があれば、取り出すために Googleドライブの許可をもらう
async function driveTokenFor(tracks) {
  if (!tracks.some((T) => T.blocks.some((b) => b.items.some((i) => i.fig && i.fig.drawing)))) return null;
  setProgress('Googleドライブの許可を待っています…');
  try { return await auth.driveToken(true); } catch (e) {
    toast('Googleドライブの許可がないので、図形描画は取り込めません', 'error', 10000);
    return null;
  } finally { setProgress(''); }
}
// 終わったことと、読めなかった図があればそれを知らせる
function reportImport(out, okMsg) {
  const f = out.failed || [];
  if (!f.length) { toast(okMsg, 'info', 6000); return; }
  const cues = [...new Set(f.filter(Boolean))].slice(0, 3).map((c) => `《${c}》`).join('、');
  toast(`${okMsg}。ただし図${f.length}枚は読み込めませんでした${cues ? `（${cues}${f.length > 3 ? 'など' : ''}）` : ''}。その段には図が入っていないので、描き直すか、もう一度取り込んでください。`, 'error', 20000);
}

const trackTitleOf = (t) => String(t || '').replace(/^トラ(?!ック)/, 'トラック');
async function finishImport(w, work, eps, result, src, note = '') {
  const epGuess = result.tracks[0].ep || '';
  const same = eps.find((e) => e.title === epGuess);
  const castN = result.cast ? result.cast.split('\n').filter(Boolean).length : 0;
  const named = (work.cast || []).filter((c) => c.name).length;
  const list = result.tracks.map((t) => { const figs = t.blocks.reduce((a, b) => a + b.items.filter((i) => i.kind === 'figure').length, 0); return `${t.track || 'トラック'}（第${t.draftNo}稿・タイミング${t.blocks.filter((b) => b.cue).length}個${figs ? `・図${figs}枚` : ''}）`; }).join('、');
  const r = await ask({
    title: src === 'PDF' ? '図解PDFを取り込む' : 'Googleドキュメントから取り込む', ok: '取り込む',
    message: `見つかったトラック：${list}`,
    detail: (note ? note + '\n' : '') + 'テーマ活動の友・タイミング・メモを、トラックごとに取り込みます。既にある話を選ぶと、その話にトラックが追加されます。図形描画の図は、動かせる図に直して取り込みます。取り込んだあとで、タイミングの位置や改行を確かめてください。',
    fields: [
      { key: 'ep', label: '取り込む先の話', type: 'select', value: same ? same.id : 'new', options: [...eps.map((e) => [e.id, e.title]), ['new', `新しい話「${epGuess || '取り込んだ話'}」を作る`]] },
      result.tracks.length === 1 ? { key: 'tname', label: 'トラックの名前', value: trackTitleOf(result.tracks[0].track) || 'トラック1', hint: '取り込む先の話に同じ名前のトラックがあるときは、下の「同じ名前のトラックがあるとき」に従います。' } : null,
      { key: 'mode', label: '同じ名前のトラックがあるとき', type: 'select', value: 'new', options: [['new', '新しいトラックとして追加する'], ['next', 'そのトラックの次の稿にする']] },
      castN ? { key: 'cast', label: `メンバー一覧（${src}には${castN}人）`, type: 'select', value: named ? 'keep' : 'replace', options: [['keep', '今の一覧のままにする'], ['replace', `${src}の一覧で置き換える`]] } : null,
    ].filter(Boolean),
  });
  if (!r) return;
  const driveToken = await driveTokenFor(result.tracks);
  try {
    setProgress('取り込んでいます…');
    const out = await importZukai(w, result, {
      epId: r.ep === 'new' ? null : r.ep, epTitle: epGuess, replaceCast: r.cast === 'replace',
      asNewTrack: r.mode !== 'next', trackName: result.tracks.length === 1 ? r.tname : null,
      existingEpisodes: eps, tracks: S.d.tracks || [], drafts: S.d.drafts || [], user: S.user, cast: work.cast || [], vectorize: true, driveToken, onProgress: setProgress,
    });
    setProgress('');
    reportImport(out, `${out.made.length}トラックを取り込みました`);
    if (out.made[0]) go(`#/w/${w}/d/${out.made[0].draftId}`);
  } catch (e) {
    setProgress('');
    toast('取り込めませんでした: ' + (e.message || e), 'error', 15000);
  }
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
      h('div', { class: 'page-head' }, h('h1', null, 'メンバー一覧'), h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/w/${w}` }, 'ライブラリーに戻る'))),
      h('p', { class: 'muted small' }, '閲覧のみで共有されているため、変更はできません。'),
      CastTable(work.cast),
      work.labelRules ? h('section', { class: 'panel' }, h('h2', null, 'キャラクターの表記のルール'), h('div', { class: 'rules-body' }, work.labelRules)) : null);
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
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/w/${w}` }, 'ライブラリーに戻る'))),
    h('p', { class: 'muted small' },
      '番号は上から順に自動で付きます。左のつまみ（⠿）をドラッグすると順番を入れ替えられ、すべてのトラックの図の番号も一緒に変わります。1人が複数の役をするときは、役の欄の右の「＋」で兼役を追加できます。CD係は、この一覧とPDFの表にだけ載り、図には出ません。'),
    h('div', { class: 'cast-scroll' }, h('table', { class: 'cast-edit' + (dragging ? ' dragging' : '') },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, '番号'), h('th', null, '名前'), h('th', null, '役 ／ キャラクターの表記'), h('th', null, ''))),
      h('tbody', null, cast.map((c, i) => h('tr', { key: c.id || 'c' + i, style: rowStyle(i), class: dragging && dragging.from === i ? 'drag-row' : null },
        h('td', { class: 'grip-cell' }, h('span', { class: 'grip', title: 'ドラッグで並べ替え', onpointerdown: (e) => startDrag(e, w, cast, i) }, '⠿')),
        h('td', { class: 'no' },
          h('span', { class: 'auto-no' + (c.tag ? ' tag-no' : '') }, numbered[i].no)),
        h('td', null, h('input', { value: c.name, oninput: (e) => upd(i, 'name', e.target.value), 'aria-label': '名前' })),
        h('td', { class: 'roles-cell' },
          c.tag ? h('span', { class: 'muted staff-note' }, '図には出ません')
            : (rolesOf(c).length ? rolesOf(c) : [{ name: '', label: '' }]).map((r, k, all) => h('div', { key: 'r' + k, class: 'role-line' },
              h('input', { value: r.name, placeholder: k ? '兼役' : '（なし）', 'aria-label': k ? '兼役' : '役', oninput: (e) => setRoles(i, (rs) => { rs[k].name = e.target.value; return rs; }) }),
              h('input', { class: 'lbl-in', value: r.label, placeholder: '表記 例：ルー', 'aria-label': 'キャラクターの表記', oninput: (e) => setRoles(i, (rs) => { rs[k].label = e.target.value; return rs; }) }),
              k > 0 ? h('button', { class: 'icon-btn', title: 'この兼役を削除', onclick: () => setRoles(i, (rs) => rs.filter((_, x) => x !== k)) }, '×')
                : all.length === 1 ? h('button', { class: 'add-role', title: '兼役を追加', 'aria-label': '兼役を追加', onclick: () => setRoles(i, (rs) => [...rs, { name: '', label: '' }]) }, '＋')
                  : h('span', { class: 'icon-sp' })))),
        h('td', { class: 'row-btns' },
          h('button', { class: 'icon-btn trash', title: 'この人を削除', 'aria-label': 'この人を削除', onclick: async () => { if (await confirmBox(`「${c.name || '名前なし'}」を一覧から削除しますか？\n図に置いた人は番号なしになります。`, { ok: '削除', danger: true })) editCast(w, cast.filter((_, j) => j !== i)); } },
            h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' },
              h('path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))))))))),
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
      h('h2', null, 'キャラクターの表記のルール'),
      h('p', { class: 'muted small' }, '役名を図に書くときの決まりをメモしておけます（図の編集画面からも見られます）。上の表の「キャラクターの表記」に入れた文字が、図の人の横に表示されます。'),
      h('textarea', {
        rows: 4, value: work.labelRules || '', placeholder: '例：役名は〇の中ではなく横に書く。フォントはArial 9。ルーシィ→ルー、エドマンド→エド…',
        oninput: (e) => saveLater(P.work(w), { labelRules: e.target.value, updatedAt: Date.now() }),
      })),
    h('section', { class: 'panel' },
      h('h2', null, 'まとめて貼り付け'),
      h('p', { class: 'muted small' }, '1行に1人ずつ。「ぐっち（ビーヴァー奥さん）」や、表計算ソフトからコピーした「名前・役・キャラクターの表記」の列に対応しています。兼役は「役A/役B」のように「/」で区切ります。行頭の番号は無視され、上から順に番号が付きます。'),
      h('textarea', { rows: 8, value: S.ui.castPaste || '', oninput: (e) => { S.ui.castPaste = e.target.value; }, placeholder: 'ぐっち（ビーヴァー奥さん）\nまお（ルーシィ）\nもえ' }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn primary', onclick: async () => {
            const add = parseCast(S.ui.castPaste); if (!add.length) return;
            if (cast.length && !(await confirmBox('今の一覧を貼り付けた内容で置き換えますか？\n図に置いた人は番号なしになります。', { ok: '置き換える', danger: true }))) return;
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

// ボタンを押した直後にグループ確認のウィンドウを開く（ポップアップをブロックされないため）
function addPeople(w, work) {
  const addrs = splitAddrs(S.ui.shareInput);
  if (!addrs.length) return;
  const groups = addrs.filter((a) => a.endsWith('@googlegroups.com') && EMAIL_RE.test(a));
  const pop = groups.length ? openGroupWindow(groups) : null;
  addPeopleAsync(w, work, addrs, groups, pop);
}

async function addPeopleAsync(w, work, addrs, groups, pop) {
  const role = S.ui.shareRole || 'editor';
  const roles = rolesOfWork(work);
  const added = [];
  const errors = [];
  let found = {};
  if (groups.length) {
    if (!GROUP_LOOKUP_URL) errors.push('Googleグループで追加する機能が、まだ設定されていません（README 手順6）。');
    else if (!pop) errors.push('ポップアップがブロックされました。ブラウザでこのサイトのポップアップを許可して、もう一度「追加」を押してください。');
    else {
      S.ui.shareBusy = true;
      rerender();
      try { found = await waitGroups(pop); } catch (e) { errors.push(e.message || String(e)); }
      S.ui.shareBusy = false;
    }
  }
  for (const a of addrs) {
    if (!EMAIL_RE.test(a)) { errors.push(`「${a}」はメールアドレスの形ではありません`); continue; }
    if (groups.includes(a)) {
      const g = found[a];
      if (!g) continue;
      if (!g.ok) { errors.push(`${a} のメンバー一覧を読めませんでした。アドレスが正しいか、あなたがそのグループのメンバー一覧を見られるか確認してください。（${g.error}）`); continue; }
      let n = 0;
      for (const m of g.members) if (!roles[m]) { roles[m] = role; n++; }
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

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('リンクをコピーしました'); } catch (e) {
    await ask({ title: 'リンク', message: 'コピーできなかったので、下の文字を選んでコピーしてください。', fields: [{ key: 'v', label: 'リンク', value: text }], cancel: false, ok: '閉じる' });
  }
}

export function ShareView() {
  const w = S.route.params.w;
  const work = S.d.work;
  if (work === undefined) return h('main', { class: 'page' }, h('p', { class: 'muted' }, '読み込み中…'));
  if (work === null) return h('main', { class: 'page' }, h('p', null, 'このライブラリーは見つからないか、あなたに共有されていません。'), h('a', { href: '#/' }, 'ライブラリー一覧へ'));
  const me = S.user.email;
  const owner = isOwner(work);
  const roles = rolesOfWork(work);
  const order = { owner: 0, editor: 1, viewer: 2 };
  const people = Object.keys(roles).sort((a, b) => (order[roles[a]] - order[roles[b]]) || a.localeCompare(b));
  const link = work.linkRole || 'off';
  const nameOf = (e) => (e === me ? S.user.name : profileName(e, rerender));

  return h('main', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', null, `「${work.title || '無題のライブラリー'}」を共有`),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/w/${w}` }, 'ライブラリーに戻る'))),

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
          S.ui.shareBusy ? h('button', { class: 'btn ghost', onclick: cancelGroupWait }, 'やめる') : null,
          h('button', { class: 'btn primary', disabled: !!S.ui.shareBusy, onclick: () => addPeople(w, work) }, S.ui.shareBusy ? 'グループを確認中…' : '追加'))),
      S.ui.shareBusy ? h('p', { class: 'small' }, '開いたウィンドウでグループを確認しています。初めてのときはGoogleの許可画面が出るので、自分のアカウントを選んで許可してください（「Googleで確認されていません」と出たら「詳細」→「〜に移動」）。') : null,
      S.ui.shareError ? h('div', { class: 'dlg-err pre' }, S.ui.shareError) : null,
      h('p', { class: 'muted small' }, 'Googleグループのアドレスを入れると、小さなウィンドウでグループを確認し、メンバー全員をまとめて追加します（初回だけGoogleの許可画面が出ます。あとからグループに入った人は自動では追加されません）。追加した人には自動で通知が届かないので、下の「リンクをコピー」で知らせてください。')) : null,

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
            if (e === me && v !== 'owner' && !(await confirmBox(v === 'remove' ? '自分をこのライブラリーから外しますか？\n外すと、このライブラリーを見られなくなります。' : '自分をオーナーから外しますか？\nあとで戻すには、ほかのオーナーに頼む必要があります。', { ok: 'はい', danger: true }))) { rerender(); return; }
            await changeRole(w, work, e, v);
            if (e === me && v === 'remove') go('#/');
          },
        }, h('option', { value: 'owner' }, 'オーナー'), h('option', { value: 'editor' }, '編集者'), h('option', { value: 'viewer' }, '閲覧者'), h('option', { value: 'remove' }, 'アクセス権を削除'))
          : h('span', { class: 'badge role-' + roles[e] }, ROLE_LABEL[roles[e]])))),
      !owner ? h('div', { class: 'actions' },
        h('span', { class: 'muted small grow' }, '共有の設定を変えられるのはオーナーだけです。'),
        h('button', { class: 'btn small danger', onclick: () => confirmLeaveWork(w, work) }, '共有を解除')) : null),

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
            : 'このリンクを開いてGoogleでログインした人は、だれでもこのライブラリーに参加できます。')),
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
