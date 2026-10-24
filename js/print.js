// PDF書き出し用の表示（A4縦・左にテーマ活動の友、右にタイミングと図）
import { h } from './vdom.js';
import { db, mode, auth } from './db.js';
import { findSavedPdf, pickFolder, uploadPdf } from './gdrive.js';
import { S, toast, rerender } from './state.js';
import { ask } from './dialog.js';
import { buildPdf, deliverPdf } from './pdf.js';
import { buildVectorPdf } from './pdfvec.js';
import { buildDocx, deliverFile } from './docx.js';
import { P, draftTitle, draftName, shortTrack } from './model.js';
import { castIndex } from './cast.js';
import { buildRows, highlightRanges } from './script.js';
import { blockUpdates, showUpdates, DIAGRAM_FIXED } from './update.js';
import { StageSVG } from './stage.js';
import { CastTable, Legend, ScriptLines, DotText, CueTitle } from './sheet.js';

const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0);

export async function loadPrint({ w, kind, id }) {
  const [work, episodes, tracks, drafts] = await Promise.all([
    db.get(P.work(w)), db.list(P.col(w, 'episodes')), db.list(P.col(w, 'tracks')), db.list(P.col(w, 'drafts')),
  ]);
  if (!work) throw new Error('ライブラリーが見つかりません');
  let targets = [];
  let fileName = '';
  if (kind === 'd') {
    const d = drafts.find((x) => x.id === id);
    if (!d) throw new Error('稿が見つかりません');
    const t = tracks.find((x) => x.id === d.trackId);
    const e = t && episodes.find((x) => x.id === t.episodeId);
    targets = [{ draft: d, track: t, ep: e }];
    fileName = draftTitle(work, e, t, d);
  } else {
    const e = episodes.find((x) => x.id === id);
    if (!e) throw new Error('話が見つかりません');
    const ts = tracks.filter((t) => t.episodeId === e.id).sort(byOrder);
    for (const t of ts) {
      const d = drafts.filter((x) => x.trackId === t.id).sort((a, b) => (b.no || 0) - (a.no || 0))[0];
      if (d) targets.push({ draft: d, track: t, ep: e });
    }
    const nos = [...new Set(targets.map((x) => draftName(x.draft)))];
    const tnum = (t) => shortTrack(t.title).replace(/^トラ/, '');
    const range = ts.length ? `${shortTrack(ts[0].title)}${ts.length > 1 ? '-' + tnum(ts[ts.length - 1]) : ''}` : '';
    fileName = `${e.title}${range}図解結合版${nos.length === 1 ? `_${nos[0]}` : ''}`;
  }
  for (const t of targets) {
    const [blocks, diagrams, images] = await Promise.all([
      db.list(P.col(w, 'blocks'), ['draftId', t.draft.id]),
      db.list(P.col(w, 'diagrams'), ['draftId', t.draft.id]),
      db.list(P.col(w, 'images'), ['draftId', t.draft.id]),
    ]);
    t.blocks = blocks;
    t.diagrams = Object.fromEntries(diagrams.map((g) => [g.id, g]));
    t.images = Object.fromEntries(images.map((im) => [im.id, im]));
  }
  return { work, targets, fileName, w, kind, id };
}

function NoteBlock(t, b, idx) {
  const items = Object.entries(b.items || {}).map(([id, it]) => ({ id, ...it })).sort(byOrder);
  const u = blockUpdates(t.draft, b, t.diagrams);
  return h('div', { key: b.id, class: 'p-block' },
    b.cue ? CueTitle(b.cue, u && u.cue) : null,
    items.map((it) => {
      if (it.kind === 'text') return h('div', { key: it.id, class: 'p-text' }, DotText(it.text, u ? (ln) => u.line(it.id, ln) : null, it.marks));
      if (it.kind === 'diagram') {
        const g = t.diagrams[it.refId];
        return h('figure', { key: it.id, class: 'p-fig' },
          it.caption ? h('figcaption', null, it.caption) : null,
          u && u.diagram(it.id, it.refId) ? h('div', { class: 'nline upd fixed-mark' }, DIAGRAM_FIXED) : null,
          g ? StageSVG(g.shapes, { cls: 'stage p-stage', idx, roleVis: g.roleVis || {} }) : null);
      }
      if (it.kind === 'image') {
        const im = t.images[it.refId];
        return h('figure', { key: it.id, class: 'p-fig p-photo size-' + (it.size || 'm') },
          it.caption ? h('figcaption', null, it.caption) : null,
          im ? h('img', { src: im.data, alt: it.caption || '参考写真' }) : null);
      }
      return null;
    }));
}

function Sheet(data, t, i) {
  const { work } = data;
  const text = t.draft.script || '';
  const rows = buildRows(text, t.blocks, t.draft.spkFix);
  const hls = highlightRanges(text, t.blocks);
  const title = draftTitle(work, t.ep, t.track, t.draft);
  const idx = castIndex(work.cast);
  return h('section', { key: t.draft.id, class: 'sheet src', 'data-title': title },
    h('div', { class: 'sheet-title' }, title),
    h('div', { class: 'info' },
      h('div', { class: 'info-line' }, '図解っ子：', t.draft.zukaikko || ''),
      h('div', { class: 'info-line' }, '表現したいこと（場面', h('i', { class: 'dot' }), '）：', t.draft.theme || ''),
      showUpdates(t.draft) ? h('div', { class: 'info-line upd' }, '更新：青') : null,
      CastTable(work.cast),
      Legend()),
    // テーマ活動の友と図解の表。ページをまたぐときは、各ページで枠が閉じる
    h('div', { class: 'p-box' },
      h('table', { class: 'p-table' },
        h('colgroup', null, h('col', { class: 'c-script' }), h('col', { class: 'c-notes' })),
        h('tbody', null, text || t.blocks.length ? rows.map((row) => h('tr', { key: 'r' + row.start, class: 'p-row' },
          h('td', { class: 'p-script' }, text ? ScriptLines(text, row.lines, hls, { marks: t.draft.scriptMarks || [] }) : '（テマ友なし）'),
          h('td', { class: 'p-notes', 'data-off': row.blocks.length ? row.blocks[0].r.offset : null }, row.blocks.map(({ b }) => NoteBlock(t, b, idx)))))
          : h('tr', { class: 'p-row' }, h('td', { class: 'p-script' }, '（テマ友なし）'), h('td', { class: 'p-notes' }, ''))))));
}

export function PrintView() {
  if (S.d.printError) return h('main', { class: 'page' }, h('p', null, S.d.printError), h('a', { href: '#/' }, '戻る'));
  const data = S.d.print;
  if (!data) return h('div', { class: 'loading' }, '書き出し用のページを準備しています…');
  document.title = data.fileName;
  const back = data.kind === 'd' ? `#/w/${data.w}/d/${data.id}` : `#/w/${data.w}`;
  return [
    h('div', { class: 'print-bar no-print' },
      h('a', { class: 'btn', href: back, onclick: () => { document.title = '図解メーカー'; } }, '← 戻る'),
      h('div', { class: 'grow' },
        h('b', null, data.fileName),
        h('div', { class: 'muted small' }, pdfMsg())),
      PdfButton()),
    // ページ分けの元になる、1枚につながった表（画面には出さない）
    h('div', { class: 'print-src', 'aria-hidden': 'true' }, data.targets.length
      ? data.targets.map((t, i) => Sheet(data, t, i))
      : h('p', { class: 'pad' }, 'この話にはまだトラックがありません。')),
  ];
}

// 右側の《タイミング》を、テーマ活動の友の中でその語句がある高さにそろえる
// （1行が折り返して長いとき、語句が2行目・3行目にあっても横に並ぶように）
export function alignPrint() {
  for (const td of document.querySelectorAll('.print-src td.p-notes[data-off]')) {
    const first = td.firstElementChild;
    if (!first) continue;
    first.style.marginTop = '';
    const script = td.parentElement.querySelector('.p-script');
    const off = +td.getAttribute('data-off');
    let target = null;
    for (const sp of script.querySelectorAll('span[data-s]')) {
      if (+sp.getAttribute('data-s') <= off) target = sp; else break;
    }
    const top = script.querySelector('.sline');
    if (!target || !top) continue;
    const dy = target.getBoundingClientRect().top - top.getBoundingClientRect().top;
    if (dy > 2) first.style.marginTop = dy.toFixed(1) + 'px';
  }
}

// ---------- ページ分け ----------
// ブラウザに任せず、ここでA4のページに分ける（どの端末でも同じ区切り・同じ見た目にするため）。
// 文字の行・タイミング・図の途中では区切らない。各ページで表の枠を閉じ、上にタイトルを出す。
const MM = 96 / 25.4;
const PAGE_H = 297, PAD_T = 10, PAD_B = 9, TITLE_H = 8, BOX_V = 4; // mm
let laidFor = null;
let laying = false;

export function layoutPages(force) {
  const data = S.d.print;
  if (!data || (!force && laidFor === data)) return;
  if (laying) return;
  laying = true;
  laidFor = data;
  const done = () => { laying = false; };
  Promise.all([
    document.fonts ? document.fonts.ready : null,
    ...[...document.querySelectorAll('.print-src img')].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))),
  ]).then(() => { if (S.d.print === data) buildPages(); done(); }, done);
}

function pagesRoot() {
  let el = document.getElementById('print-pages');
  if (!el) { el = document.createElement('div'); el.id = 'print-pages'; document.body.appendChild(el); }
  return el;
}
export function clearPages() {
  laidFor = null;
  const el = document.getElementById('print-pages');
  if (el) el.remove();
}

// テーマ活動の友の列と図解の列は、それぞれ行（図）の切れ目でページを分ける。
// 2つの列の高さの位置関係はそのまま（タイミングの横並びがずれない）。
function pageCuts(table, cap1, cap) {
  const top = table.getBoundingClientRect().top;
  const H = table.getBoundingClientRect().height;
  const atoms = (sel) => [...table.querySelectorAll(sel)].map((e) => {
    const r = e.getBoundingClientRect();
    return [r.top - top, r.bottom - top];
  }).filter(([a, b]) => b > a);
  const cols = [atoms('.p-script .sline'), atoms('.p-notes .cue, .p-notes .nline, .p-notes figure')];
  const cutIn = (iv, from, limit) => {
    const inside = (y) => iv.some(([a, b]) => a < y - 0.5 && y + 0.5 < b);
    if (!inside(limit)) return limit;
    let best = from;
    for (const [a] of iv) if (a > from + 1 && a <= limit && a > best && !inside(a)) best = a;
    return best > from + 1 ? best : limit; // 1ページに入らない大きさのときだけ途中で切る
  };
  const pages = [];
  let start = [0, 0];
  let cap0 = cap1;
  for (let guard = 0; guard < 500; guard++) {
    const base = Math.min(start[0], start[1]);
    const limit = base + cap0;
    if (limit >= H - 0.5) { pages.push({ base, start, end: [H, H] }); break; }
    const end = [cutIn(cols[0], start[0], limit), cutIn(cols[1], start[1], limit)];
    pages.push({ base, start, end });
    start = end;
    cap0 = cap;
  }
  return { pages, H };
}

function el(tag, cls, kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids || []) if (k) e.appendChild(k);
  return e;
}

function buildPages() {
  alignPrint();
  const root = pagesRoot();
  root.textContent = '';
  const inner = (PAGE_H - PAD_T - PAD_B - TITLE_H - BOX_V) * MM - 4;
  let n = 0;
  for (const sheet of document.querySelectorAll('.print-src .sheet')) {
    const title = sheet.getAttribute('data-title') || '';
    const info = sheet.querySelector('.info');
    const table = sheet.querySelector('.p-table');
    const infoH = info.getBoundingClientRect().height;
    const { pages, H } = pageCuts(table, inner - infoH, inner);
    pages.forEach((pgc, k) => {
      const hgt = Math.max(pgc.end[0], pgc.end[1]) - pgc.base;
      // 列ごとに、このページに入る範囲だけを見せる枠（はみ出しは隠す）
      const W = table.getBoundingClientRect().width;
      const split = W * 0.365;
      const part = (col) => {
        const c = table.cloneNode(true);
        c.style.width = W + 'px';
        c.style.top = -pgc.start[col] + 'px';
        c.style.left = (col ? -split : 0) + 'px';
        const box = el('div', 'p-col', [c]);
        box.style.left = (col ? split : 0) + 'px';
        box.style.width = (col ? W - split : split) + 'px';
        box.style.top = (pgc.start[col] - pgc.base) + 'px';
        box.style.height = Math.max(0, pgc.end[col] - pgc.start[col]) + 'px';
        return box;
      };
      const clip = el('div', 'p-clip', [part(0), part(1)]);
      clip.style.height = hgt + 'px';
      const page = el('div', 'pg', [
        el('div', 'pg-title', [document.createTextNode(title)]),
        k === 0 ? info.cloneNode(true) : null,
        el('div', 'p-box', [clip, el('div', 'p-div'), el('div', 'p-thick')]),
      ]);
      root.appendChild(el('div', 'pg-wrap', [page]));
      n++;
    });
  }
  fitPages();
  return n;
}

// 画面の幅に合わせてページを縮小表示（印刷には影響しない）
function fitPages() {
  const root = document.getElementById('print-pages');
  if (!root) return;
  const w = 210 * MM;
  const k = Math.min(1, (document.documentElement.clientWidth - 16) / w);
  root.style.setProperty('--fit', k.toFixed(4));
}
window.addEventListener('resize', () => { if (document.body.classList.contains('is-print')) fitPages(); });
if (document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', () => { if (document.body.classList.contains('is-print')) layoutPages(true); });
}

// ---------- PDFを保存（スマホ対応） ----------
// LINEなどのアプリの中のブラウザは印刷（PDF保存）に対応していないことが多い。
// その場合は、SafariやChromeで開き直す案内を出す。
const UA = navigator.userAgent;
const IN_APP = /Line\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK|; wv\)/i.test(UA);

// PDFはサイトの中で作ってダウンロードする（印刷画面は使わない）
const pdf = { state: 'idle', done: 0, total: 0, blob: null, name: '' };
const IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function pdfMsg() {
  if (pdf.state === 'making') return `PDFを作っています…（${pdf.done}／${pdf.total}ページ）`;
  if (pdf.state === 'ready') return 'PDFができました。「保存する」を押して、「ファイルに保存」などを選んでください。';
  if (pdf.state === 'busy') return pdf.msg || '書き出しています…';
  return '書き出す前の確認です。「書き出す」を押すと、PDF・Googleドキュメント・Wordから選んで書き出せます。';
}
function PdfButton() {
  if (pdf.state === 'making' || pdf.state === 'busy') return h('button', { class: 'btn primary', disabled: true }, '作成中…');
  if (pdf.state === 'ready') return h('button', { class: 'btn primary', onclick: deliverReady }, '保存する');
  return h('button', { class: 'btn primary', onclick: exportFlow }, '書き出す');
}
async function deliverReady() {
  if (!pdf.blob) return;
  const r = await deliverPdf(pdf.blob, pdf.name);
  if (r !== 'cancel') { pdf.state = 'idle'; pdf.blob = null; rerender(); }
}

const FORMATS = [
  ['pdf', 'PDF（この端末に保存）'],
  ['pdf-drive', 'PDF（Googleドライブに保存）'],
  ['gdoc', 'Googleドキュメント（ドライブに作る）'],
  ['docx', 'Word（.docx）'],
];
// 一覧やトラックのページの「書き出す」から来たときは、すぐに形式を選ぶ画面を出す。やめたら元のページに戻る
export async function autoExport() {
  const r = await exportFlow();
  if (r === 'cancel' && S.route.name === 'print') window.history.back();
}

async function exportFlow() {
  if (pdf.state === 'making' || pdf.state === 'busy') return;
  const def = (S.d.print && S.d.print.fileName) || '図解';
  const formats = mode === 'local' ? FORMATS.filter(([k]) => !/drive|gdoc/.test(k)) : FORMATS;
  let last = 'pdf';
  try { last = localStorage.getItem('zukai.exportAs') || 'pdf'; } catch (e) { /* 使えない環境 */ }
  if (!formats.some(([k]) => k === last)) last = 'pdf';
  const r = await ask({
    title: '書き出す', ok: '書き出す',
    fields: [
      { key: 'as', label: '形式', type: 'select', value: last, options: formats, hint: mode === 'local' ? '' : 'ドライブに保存すると、次からは同じファイルを新しくできます（共有したリンクのまま、最新になります）。' },
      { key: 'name', label: 'ファイル名', value: def, required: true },
    ],
  });
  if (!r) return 'cancel';
  try { localStorage.setItem('zukai.exportAs', r.as); } catch (e) { /* 使えない環境 */ }
  const fileName = String(r.name).replace(/\.(pdf|docx)$/i, '').trim() || def;
  if (r.as === 'pdf' || r.as === 'pdf-drive') return savePdf(fileName, r.as === 'pdf-drive');
  return saveDoc(fileName, r.as === 'gdoc');
}

// Word のファイル／Googleドキュメント
async function saveDoc(fileName, toDrive) {
  let dest = null;
  if (toDrive) {
    dest = await driveDest('gdoc');
    if (!dest) return;
  }
  pdf.state = 'busy'; pdf.msg = toDrive ? 'Googleドキュメントを作っています…' : 'Wordのファイルを作っています…';
  rerender();
  try {
    const blob = await buildDocx(S.d.print);
    pdf.state = 'idle'; rerender();
    if (dest) await saveToDrive(dest, blob, fileName, 'gdoc');
    else await deliverFile(blob, fileName.replace(/[\\/:*?"<>|]/g, '_') + '.docx');
  } catch (e) {
    pdf.state = 'idle'; rerender();
    toast('書き出せませんでした: ' + (e.message || e), 'error', 8000);
  }
}

async function savePdf(fileName, toDrive) {
  if (IN_APP && !toDrive) { cannotPrint(); return; }
  // ページ分けが終わるまで待つ（ページを開いてすぐ書き出すとき）
  for (let i = 0; i < 150 && !document.querySelector('#print-pages .pg'); i++) await new Promise((res) => setTimeout(res, 100));
  const pages = [...document.querySelectorAll('#print-pages .pg')];
  if (!pages.length || pdf.state === 'making') return;
  // ドライブ：先に許可と保存先を決めておく（PDFを作ってからだと、許可の画面がブロックされることがある）
  let dest = null;
  if (toDrive) {
    dest = await driveDest('pdf');
    if (!dest) return;
  }
  pdf.state = 'making'; pdf.done = 0; pdf.total = pages.length;
  rerender();
  try {
    const prog = (d, t) => { pdf.done = d; pdf.total = t; rerender(); };
    let blob;
    // 文字と図はベクター（拡大してもくっきり）。うまくいかないときは、これまでの画像のPDFにする
    try { blob = await buildVectorPdf(pages, prog); } catch (e) {
      console.error(e);
      blob = await buildPdf(pages, prog);
    }
    pdf.blob = blob;
    pdf.name = fileName;
    if (dest) {
      pdf.state = 'idle';
      rerender();
      await saveToDrive(dest, blob, fileName, 'pdf');
      return;
    }
    if (IOS) { pdf.state = 'ready'; rerender(); return; } // iPhoneは、もう一度押したときに保存画面を出す
    pdf.state = 'idle';
    rerender();
    await deliverPdf(blob, pdf.name);
  } catch (e) {
    pdf.state = 'idle';
    rerender();
    toast('PDFを作れませんでした: ' + (e.message || e), 'error', 8000);
  }
}

const pdfKey = () => { const p = S.d.print || {}; return `${p.w}_${p.kind}_${p.id}`; };

// ドライブのどこに保存するか（前のファイルを新しくする／フォルダを選んで新しく作る）
async function driveDest(as) {
  const what = as === 'gdoc' ? 'Googleドキュメント' : 'PDF';
  let token;
  try { token = await auth.driveToken(false); } catch (e) {
    toast('Googleドライブの許可をもらえませんでした: ' + (e.message || e), 'error', 8000);
    return null;
  }
  const key = pdfKey() + (as === 'gdoc' ? '_gdoc' : '');
  let prev = null;
  try { prev = await findSavedPdf(token, key); } catch (e) { console.warn(e); }
  if (prev) {
    const r = await ask({
      title: 'Googleドライブに保存',
      message: `前にこの${what}を「${prev.folderName || 'ドライブ'}」に保存しています（${prev.name}）。`,
      fields: [{
        key: 'how', label: '保存のしかた', type: 'select', value: 'update',
        options: [['update', `前の${as === 'gdoc' ? 'ドキュメント' : 'ファイル'}を新しくする（リンクはそのまま）`], ['new', 'フォルダを選んで、別のファイルとして保存する']],
        hint: as === 'gdoc' ? '新しくすると、前のドキュメントに付いていたコメントは、場所がわからなくなることがあります。' : '',
      }],
      ok: '次へ',
    });
    if (!r) return null;
    if (r.how === 'update') return { token, key, fileId: prev.id };
  }
  let folder;
  try { folder = await pickFolder(token, as === 'gdoc' ? 'ドキュメントを作るフォルダを選んでください' : undefined); } catch (e) {
    toast(e.message || String(e), 'error', 8000);
    return null;
  }
  if (!folder) return null;
  return { token, key, folderId: folder.id, folderName: folder.name };
}

async function saveToDrive(dest, blob, fileName, as) {
  const name = as === 'gdoc' ? fileName : fileName + '.pdf';
  const target = as === 'gdoc' ? 'application/vnd.google-apps.document' : 'application/pdf';
  let f;
  try {
    f = await uploadPdf(dest.token, { blob, name, key: dest.key, fileId: dest.fileId, folderId: dest.folderId, target });
  } catch (e) {
    // 前のファイルが消されていたら、フォルダを選び直してもらう
    if (dest.fileId && (e.status === 404 || e.status === 403)) {
      const folder = await pickFolder(dest.token, as === 'gdoc' ? 'ドキュメントを作るフォルダを選んでください' : undefined).catch(() => null);
      if (!folder) return;
      try { f = await uploadPdf(dest.token, { blob, name, key: dest.key, folderId: folder.id, target }); } catch (e2) { toast('Googleドライブに保存できませんでした: ' + (e2.message || e2), 'error', 9000); return; }
    } else {
      toast('Googleドライブに保存できませんでした: ' + (e.message || e), 'error', 9000);
      return;
    }
  }
  let copied = false;
  try { await navigator.clipboard.writeText(f.webViewLink); copied = true; } catch (e) { /* コピーできない環境 */ }
  const r = await ask({
    title: as === 'gdoc' ? 'Googleドキュメントを作りました' : 'Googleドライブに保存しました',
    message: `${dest.fileId ? '前のファイルを新しくしました' : `「${dest.folderName || 'ドライブ'}」に保存しました`}：${f.name}`,
    detail: (copied ? 'リンクをコピーしました。' : '') + 'だれが見られるかは、ドライブのフォルダの共有設定のとおりです。',
    ok: as === 'gdoc' ? 'ドキュメントを開く' : 'ドライブで開く', cancel: '閉じる', fields: [],
  });
  if (r) window.open(f.webViewLink, '_blank', 'noopener');
}

async function cannotPrint() {
  const url = location.href;
  let copied = false;
  try { await navigator.clipboard.writeText(url); copied = true; } catch (e) { /* コピーできない環境 */ }
  const android = /Android/i.test(UA);
  const line = /Line\//i.test(UA);
  const r = await ask({
    title: 'このブラウザではPDFを保存できません',
    message: 'LINEなどのアプリの中で開いたページでは、PDFに保存できないことがあります。Safari（iPhone）やChrome（Android）で開き直してから、もう一度「PDFを保存」を押してください。',
    detail: copied ? 'このページのリンクをコピーしました。うまく開かないときは、Safari や Chrome のアドレス欄に貼り付けてください。'
      : 'うまく開かないときは、画面右上などのメニューから「ブラウザで開く」を選んでください。',
    ok: line || android ? (android ? 'Chromeで開く' : 'Safariで開く') : 'OK',
    cancel: '閉じる',
    fields: [],
  });
  if (!r) return;
  if (line) {
    // LINEは、このしるしを付けたリンクを外のブラウザで開く
    const u = new URL(url);
    u.searchParams.set('openExternalBrowser', '1');
    location.href = u.toString();
  } else if (android) {
    location.href = `intent://${location.host}${location.pathname}${location.search}${location.hash}#Intent;scheme=https;package=com.android.chrome;end`;
  } else if (copied) {
    toast('リンクをコピーしました。Safari で開いてください。');
  }
}
