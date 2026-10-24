// 稿の編集画面：テーマ活動の友＋《タイミング》＋動き・図・写真
import { h } from './vdom.js';
import { db, DEL, newId } from './db.js';
import { S, rerender, toast, fmtTime, saveLater, flushAll, compressImage, pickFile, go } from './state.js';
import { P, draftTitle, draftName, normalizeDraftName, saveScript, createBlock, createDiagram, createImage, copyDraft, deleteDraft, deleteTrack } from './model.js';
import { buildRows, highlightRanges, parseLines } from './script.js';
import { StageSVG, W, H } from './stage.js';
import { CastTable, Legend, ScriptLines, DotText } from './sheet.js';
import { openEditor, PresenceMarks } from './editor.js';
import { confirmBox, ask } from './dialog.js';
import { canEdit } from './access.js';
import { castIndex } from './cast.js';
import { resolveAnchor } from './script.js';
import { others, NameTags, ringStyle } from './presence.js';
import { RichEdit, runSpan, shiftMarks, lastRichEditor, applyToSelection, TEXT_COLORS, BG_COLORS, readEditor, selectionIn, setSelectionIn, attrsOf, marksOf, runsOf, markStyle } from './richtext.js';
import { blockUpdates, showUpdates, DIAGRAM_FIXED } from './update.js';

const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
export const itemsOf = (b) => Object.entries(b.items || {}).map(([id, it]) => ({ id, ...it })).sort(byOrder);

function ctx() {
  const { w, d } = S.route.params;
  const drafts = S.d.drafts || [];
  const draft = drafts.find((x) => x.id === d);
  const track = draft && (S.d.tracks || []).find((t) => t.id === draft.trackId);
  const ep = track && (S.d.episodes || []).find((e) => e.id === track.episodeId);
  return { w, d, draft, track, ep, work: S.d.work, drafts };
}

function touch(w, d) {
  saveLater(P.doc(w, 'drafts', d), { updatedAt: Date.now(), updatedBy: S.user.name }, 2500);
}

// テマ友を画面で直接書き換えているあいだは、保存が終わるまで手元の内容を使う
function scriptOf(draft) {
  const loc = S.ui.scriptLocal;
  if (loc && draft && loc.d === draft.id) {
    if (loc.saved && draft.script === loc.text && JSON.stringify(draft.scriptMarks || []) === JSON.stringify(loc.marks)) S.ui.scriptLocal = null;
    else return { text: loc.text, marks: loc.marks };
  }
  return { text: (draft && draft.script) || '', marks: (draft && draft.scriptMarks) || [] };
}
let scriptTimer = null;
function saveScriptLocal(w, d, text, marks) {
  S.ui.scriptLocal = { d, text, marks, saved: false };
  saveLater(P.doc(w, 'drafts', d), { script: text, scriptMarks: marks, updatedAt: Date.now(), updatedBy: S.user.name }, 700);
  clearTimeout(scriptTimer);
  // タイミングの位置（語句の場所）も、少し落ち着いてから合わせ直す
  scriptTimer = setTimeout(async () => {
    flushAll();
    const blocks = S.d.blocks || [];
    const ops = [];
    for (const b of blocks) {
      const r = resolveAnchor(text, b.anchor);
      if (r.ok && r.offset !== b.anchor.offset) ops.push({ op: 'update', path: P.doc(w, 'blocks', b.id), data: { 'anchor.offset': r.offset } });
    }
    if (ops.length) await db.batch(ops);
    if (S.ui.scriptLocal && S.ui.scriptLocal.text === text) S.ui.scriptLocal.saved = true;
  }, 1500);
}

// 文字の色・塗りのツールバー（Word・Googleドキュメントのように、選んだ文字に付ける）
function FormatBar() {
  const keep = (e) => e.preventDefault();
  const apply = (k, v) => {
    const sel = window.getSelection();
    const node = sel && sel.anchorNode;
    const el = (node && (node.nodeType === 1 ? node : node.parentElement).closest('.rich')) || lastRichEditor();
    if (!el || !applyToSelection(el, k, v)) toast('色を付ける文字を、なぞって選んでください', 'info', 2500);
  };
  const sw = (k, v, label, color, title) => h('button', { class: 'fmt-btn', title, onpointerdown: keep, onclick: () => apply(k, v) },
    h('span', { class: 'fmt-sw', style: k === 'bg' ? { background: color } : { color } }, label));
  return h('div', { class: 'format-bar' },
    h('button', { class: 'fmt-btn fmt-bold', title: '太字（もう一度押すと元に戻す）', onpointerdown: keep, onclick: () => apply('b', 1) }, 'B'),
    h('span', { class: 'fmt-sep' }),
    h('span', { class: 'fmt-label' }, '文字の色'),
    sw('c', 'black', 'A', TEXT_COLORS.black, '黒（自動の青字も黒にする）'),
    sw('c', 'blue', 'A', TEXT_COLORS.blue, '青（更新）'),
    sw('c', 'pink', 'A', TEXT_COLORS.pink, 'ピンク（再更新）'),
    sw('c', 'red', 'A', TEXT_COLORS.red, '赤（重要）'),
    sw('c', 'gray', 'A', 'var(--label-gray)', '灰色（キャラ名と同じ色）'),
    h('button', { class: 'fmt-btn', title: '付けた色を消す（更新した行は自動で青になります）', onpointerdown: keep, onclick: () => apply('c', null) }, '色を消す'),
    h('span', { class: 'fmt-sep' }),
    h('span', { class: 'fmt-label' }, '塗り'),
    sw('bg', 'gray', 'あ', BG_COLORS.gray, '灰色で塗る'),
    h('button', { class: 'fmt-btn', title: '塗りを消す', onpointerdown: keep, onclick: () => apply('bg', null) }, '塗りを消す'),
    h('span', { class: 'fmt-hint muted small' }, 'テマ友と説明は、その場で書き換えられます。文字をなぞって選んでから色を押してください。'));
}

// テマ友の段（行のまとまり）を、その場で書き換えられる欄にする
function ScriptEditor(w, d, draft, row, hls, allText, allMarks) {
  const lines = row.lines;
  const start = lines[0].start, end = lines[lines.length - 1].end;
  const at = attrsOf(allText, allMarks);
  const lineSel = S.ui.lineSel;
  return RichEdit({
    key: 'se-' + row.start, cls: 'script-ed', pkey: 'script@' + start,
    sig: allText.slice(start, end) + '|' + JSON.stringify(allMarks.filter((m) => m.e > start && m.s < end)) + '|' + JSON.stringify(hls) + '|' + lineSel + '|' + lines.map((l) => (l.indent ? 1 : 0) + (l.label ? 'L' + l.label.s + '-' + l.label.e : '')).join(','),
    lines: () => lines.map((l) => {
      const cls = 'rl sline' + (l.indent ? ' indent' : '') + (l.blank ? ' blank' : '') + (lineSel === l.start ? ' picked' : '');
      if (l.blank || l.end === l.start) return h('div', { class: cls, 'data-ls': l.start, onclick: (e) => onLine(e, l) }, h('span', { 'data-s': l.start, 'data-blank': '1' }), h('br'));
      // 1文字ずつの見た目（キャラ名・タイミングの語句・印・色・塗り）でまとめる
      const look = (i) => {
        const lab = l.label && i >= l.label.s && i < l.label.e;
        const hl = hls.some(([a, b]) => i >= a && i < b);
        const mk = (l.hide || []).some(([a, b]) => i >= a && i < b);
        const gray = (l.gray || []).some(([a, b]) => i >= a && i < b);
        return [lab || gray ? 1 : 0, hl ? 1 : 0, mk ? 1 : 0, at.c[i] || '', at.bg[i] || '', at.b[i] || ''].join('/');
      };
      const segs = [];
      let i = l.start;
      while (i < l.end) {
        const k = look(i);
        let j = i + 1;
        while (j < l.end && look(j) === k) j++;
        segs.push([i, j, k]);
        i = j;
      }
      return h('div', { class: cls, 'data-ls': l.start, onclick: (e) => onLine(e, l) }, segs.map(([a, b, k]) => {
        const [lab, hl, mk, c, bg, bo] = k.split('/');
        return h('span', {
          'data-s': a, 'data-c': c, 'data-bg': bg, 'data-b': bo,
          class: [lab === '1' ? 'spk' : '', hl === '1' ? 'hl' : '', mk === '1' ? 'mk' : ''].filter(Boolean).join(' ') || null,
          style: markStyle(c, bg, bo),
        }, allText.slice(a, b));
      }));
    }),
    onChange: (slice, c, bg, bo) => {
      const text = allText.slice(0, start) + slice + allText.slice(end);
      const nc = [...at.c.slice(0, start), ...c, ...at.c.slice(end)];
      const nbg = [...at.bg.slice(0, start), ...bg, ...at.bg.slice(end)];
      const nb = [...at.b.slice(0, start), ...bo, ...at.b.slice(end)];
      saveScriptLocal(w, d, text, marksOf(nc, nbg, nb));
      rerender();
    },
  });
}

function autosize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

// ---------- テーマ活動の友上の選択 ----------
function pointOffset(node, off) {
  let el = node.nodeType === 3 ? node.parentElement : node;
  if (node.nodeType !== 3) {
    const child = node.childNodes[off];
    const probe = child && child.nodeType === 1 ? (child.matches('[data-s]') ? child : child.querySelector('[data-s]')) : null;
    if (probe) return +probe.dataset.s;
    const all = node.querySelectorAll ? node.querySelectorAll('[data-s]') : [];
    if (all.length) { const last = all[all.length - 1]; return +last.dataset.s + (last.dataset.blank ? 0 : last.textContent.length); }
    el = node.closest && node.closest('[data-s]');
    if (!el) return null;
    return +el.dataset.s;
  }
  el = el && el.closest('[data-s]');
  if (!el) return null;
  return +el.dataset.s + (el.dataset.blank ? 0 : off);
}

document.addEventListener('selectionchange', () => {
  if (S.route.name !== 'draft') return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (r.collapsed) return;
  const root = document.querySelector('.sheet-edit');
  if (!root || !root.contains(r.commonAncestorContainer)) return;
  const { draft } = ctx();
  if (!draft) return;
  const text = scriptOf(draft).text;
  let a = pointOffset(r.startContainer, r.startOffset);
  let b = pointOffset(r.endContainer, r.endOffset);
  if (a == null || b == null) return;
  if (b < a) [a, b] = [b, a];
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  if (b <= a) return;
  const cur = S.ui.sel;
  if (cur && cur.a === a && cur.b === b) return;
  S.ui.sel = { a, b, text: text.slice(a, b) };
  S.ui.lineSel = null;
  rerender();
});

function onLine(e, line) {
  const s = window.getSelection();
  if (s && !s.isCollapsed) return;
  const { draft } = ctx();
  const text = scriptOf(draft).text;
  S.ui.lineSel = line.start;
  S.ui.lineText = text.slice(line.start, line.end);
  S.ui.lineAuto = autoTiming(text, line);
  S.ui.lineInfo = line;
  S.ui.sel = null;
  rerender();
}

// 行の最初の数語をタイミングにする（キャラクター名は除く）
export function autoTiming(text, line) {
  let start = line.label ? line.label.e : line.body != null ? line.body : line.start;
  const body = text.slice(start, line.end);
  const lead = body.match(/^\s*/)[0].length;
  start += lead;
  const rest = text.slice(start, line.end);
  if (!rest.trim()) return null;
  let t;
  if (/^[\x00-\x7f]/.test(rest)) {
    const m = rest.match(/^\S+(?:\s+\S+){0,2}/);
    t = m ? m[0] : rest;
    const cut = t.search(/[.!?;:](\s|$)/);
    if (cut > 0) t = t.slice(0, cut + 1);
  } else {
    const m = rest.match(/^[^、。！？!?,，\s]{1,10}[、。！？!?,，]?/);
    t = m ? m[0] : rest.slice(0, 10);
  }
  return { offset: start, text: t };
}

function clearSel() {
  S.ui.sel = null; S.ui.lineSel = null; S.ui.reanchor = null;
  const s = window.getSelection();
  if (s) s.removeAllRanges();
  rerender();
}

async function makeBlock(withCue) {
  const { w, d } = ctx();
  let offset, anchorText, cue = '';
  if (S.ui.sel) {
    offset = S.ui.sel.a; anchorText = S.ui.sel.text;
    if (withCue) cue = S.ui.sel.text.replace(/\s*\n\s*/g, ' ').slice(0, 80);
  } else if (S.ui.lineSel != null) {
    const a = S.ui.lineAuto;
    if (a) { offset = a.offset; anchorText = a.text; cue = a.text; }
    else { offset = S.ui.lineSel; anchorText = ''; }
  } else return;
  const prev = lastDiagramBefore(offset);
  const { itemId } = await createBlock(w, d, { cue, offset, anchorText, shapes: prev ? prev.shapes : {} });
  S.ui.focusItem = itemId;
  touch(w, d);
  clearSel();
}

// タイミングの文字：テマ友の中の、付けた位置の文章
const cueOf = (t) => String(t || '').replace(/\s*\n\s*/g, ' ').trim().slice(0, 80);
function cueText(b, r) {
  if (!b.cue) return '';
  const { draft } = ctx();
  const text = scriptOf(draft).text;
  const t = b.anchor && b.anchor.text;
  if (t && r && r.ok && text.substr(r.offset, t.length) === t) return cueOf(t);
  return b.cue;
}

// 付け替え先：なぞって選んだ語句。行をタップしたときは、その行の最初の数語
const reanchorPick = () => (S.ui.sel ? { a: S.ui.sel.a, text: S.ui.sel.text }
  : S.ui.lineSel != null && S.ui.lineAuto ? { a: S.ui.lineAuto.offset, text: S.ui.lineAuto.text } : null);
async function reanchorTo(blockId) {
  const { w, d } = ctx();
  const pick = reanchorPick();
  if (!pick) return;
  // 位置を付け替えたら、タイミングの文字も選んだテマ友の文章にする
  await db.update(P.doc(w, 'blocks', blockId), { anchor: { offset: pick.a, text: pick.text }, cue: cueOf(pick.text) });
  touch(w, d);
  clearSel();
  toast('タイミングを付け替えました');
}
async function clearCue(blockId) {
  const { w, d } = ctx();
  await db.update(P.doc(w, 'blocks', blockId), { cue: '' });
  touch(w, d);
  clearSel();
}

// キャラクター名（薄い文字）と字下げの自動判定を、行ごとに手で直す
// patch：{ n: キャラクター名の文字数 | null（自動）, ind: true/false | null（自動） }。all=true ならすべて自動に戻す
async function setLineFix(lineText, patch, all) {
  const { w, d, draft } = ctx();
  const list = (draft.spkFix || []).filter((f) => f.t !== lineText);
  const cur = (draft.spkFix || []).find((f) => f.t === lineText) || {};
  if (!all) {
    const f = { t: lineText };
    for (const k of ['n', 'ind']) {
      const v = k in patch ? patch[k] : cur[k];
      if (v != null) f[k] = v;
    }
    if (f.n != null || f.ind != null) list.push(f);
  }
  await db.update(P.doc(w, 'drafts', d), { spkFix: list });
  clearSel();
}
// 文字の位置から、その行を探す
function lineAt(offset) {
  const { draft } = ctx();
  const text = (draft && draft.script) || '';
  return parseLines(text, draft && draft.spkFix).find((l) => offset >= l.start && offset <= l.end) || null;
}
function LineFixButtons() {
  const { draft } = ctx();
  const text = (draft && draft.script) || '';
  const keep = (e) => e.preventDefault();
  const sel = S.ui.sel;
  const line = sel ? lineAt(sel.a) : S.ui.lineInfo;
  if (!line || line.blank) return [];
  const t = text.slice(line.start, line.end);
  const btns = [];
  if (sel) {
    // 行の頭からなぞった部分を、キャラクター名（薄い文字）にする
    if (sel.b <= line.end && !text.slice(line.start, sel.a).trim()) {
      btns.push(h('button', { class: 'btn', onpointerdown: keep, onclick: () => setLineFix(t, { n: sel.b - line.start }) }, '選んだ部分をキャラ名にする'));
    }
    return btns;
  }
  if (line.label) btns.push(h('button', { class: 'btn', onpointerdown: keep, onclick: () => setLineFix(t, { n: 0 }) }, 'キャラ名ではない'));
  else {
    const c = t.search(/[:：]/);
    if (c > 0) btns.push(h('button', { class: 'btn', onpointerdown: keep, onclick: () => setLineFix(t, { n: c + 1 }) }, `「${t.slice(0, Math.min(c, 12)).trim()}${c > 12 ? '…' : ''}」はキャラ名`));
  }
  btns.push(h('button', { class: 'btn', onpointerdown: keep, onclick: () => setLineFix(t, { ind: !line.indent }) }, line.indent ? '字下げしない' : '字下げする'));
  if (line.fixed) btns.push(h('button', { class: 'btn', onpointerdown: keep, onclick: () => setLineFix(t, {}, true) }, '自動判定に戻す'));
  return btns;
}

export function SelectionBar() {
  if (S.route.name !== 'draft') return null;
  const { sel, lineSel, reanchor } = S.ui;
  if (!sel && lineSel == null && !reanchor) return null;
  const preview = (t) => { t = (t || '').replace(/\s+/g, ' '); return t.length > 28 ? t.slice(0, 28) + '…' : t; };
  const keep = (e) => e.preventDefault();
  if (reanchor) {
    const pick = reanchorPick();
    return h('div', { class: 'selbar' },
      h('div', { class: 'selbar-text' }, pick ? `タイミングを《${preview(pick.text)}》に付け替えます` : '左のテーマ活動の友で、行をタップするか、語句をなぞって選んでください'),
      h('div', { class: 'selbar-btns' },
        pick ? h('button', { class: 'btn primary', onpointerdown: keep, onclick: () => reanchorTo(reanchor) }, 'ここに付け替える') : null,
        !pick ? h('button', { class: 'btn', onpointerdown: keep, onclick: () => clearCue(reanchor) }, 'タイミングなしにする') : null,
        h('button', { class: 'btn ghost', onpointerdown: keep, onclick: clearSel }, 'やめる')));
  }
  return h('div', { class: 'selbar' },
    h('div', { class: 'selbar-text' }, sel ? `タイミング：《${preview(sel.text)}》` : S.ui.lineAuto ? `タイミング：《${preview(S.ui.lineAuto.text)}》` : 'この行（空行）'),
    h('div', { class: 'selbar-btns' },
      h('button', { class: 'btn primary', onpointerdown: keep, onclick: () => makeBlock(true) }, sel ? '選んだ語句で図解を追加' : 'この行に図解を追加'),
      LineFixButtons(),
      h('button', { class: 'btn ghost', onpointerdown: keep, onclick: clearSel, 'aria-label': '閉じる' }, '×')));
}

// 新しい図解の位置より前にある、最後の図（人の位置を引き継ぐため）
function lastDiagramBefore(offset) {
  const { draft } = ctx();
  const text = (draft && draft.script) || '';
  let best = null, bestOff = -1;
  for (const b of S.d.blocks || []) {
    const r = resolveAnchor(text, b.anchor);
    if (r.offset > offset) continue;
    const dias = itemsOf(b).filter((it) => it.kind === 'diagram');
    if (!dias.length) continue;
    if (r.offset >= bestOff) { bestOff = r.offset; best = dias[dias.length - 1]; }
  }
  return best ? (S.d.diagrams || []).find((g) => g.id === best.refId) : null;
}

// ---------- 図解の項目操作 ----------
function blockPath(w, b) { return P.doc(w, 'blocks', b.id); }

async function addItem(w, d, b, item) {
  const items = itemsOf(b);
  const id = newId(8);
  const order = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
  await db.update(blockPath(w, b), { [`items.${id}`]: { order, ...item } });
  touch(w, d);
  return id;
}

async function moveItem(w, b, items, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= items.length) return;
  const a = items.slice();
  [a[i], a[j]] = [a[j], a[i]];
  const patch = {};
  a.forEach((it, k) => { patch[`items.${it.id}.order`] = k + 1; });
  await db.update(blockPath(w, b), patch);
}

async function removeItem(w, d, b, it) {
  if (it.kind !== 'text' && !(await confirmBox(it.kind === 'diagram' ? 'この図を削除しますか？' : 'この写真を削除しますか？', { ok: '削除', danger: true }))) return;
  const ops = [{ op: 'update', path: blockPath(w, b), data: { [`items.${it.id}`]: DEL } }];
  if (it.refId) ops.push({ op: 'remove', path: P.doc(w, it.kind === 'diagram' ? 'diagrams' : 'images', it.refId) });
  await db.batch(ops);
  touch(w, d);
}

async function removeBlock(w, d, b) {
  if (!(await confirmBox(`《${b.cue || 'タイミングなし'}》の図解を削除しますか？\n中の図・写真も消えます。`, { ok: '削除', danger: true }))) return;
  const ops = [{ op: 'remove', path: blockPath(w, b) }];
  for (const it of itemsOf(b)) if (it.refId) ops.push({ op: 'remove', path: P.doc(w, it.kind === 'diagram' ? 'diagrams' : 'images', it.refId) });
  await db.batch(ops);
  touch(w, d);
}

// 表示順で直前にある図を探す
function previousDiagram(rows, block, beforeOrder = Infinity) {
  let last = null;
  for (const row of rows) {
    for (const { b } of row.blocks) {
      for (const it of itemsOf(b)) {
        if (b.id === block.id && (it.order || 0) >= beforeOrder) return last;
        if (it.kind === 'diagram') last = it;
      }
      if (b.id === block.id) return last;
    }
  }
  return last;
}

async function addDiagram(w, d, b, copyFromId) {
  let shapes = {};
  if (copyFromId) {
    const src = (S.d.diagrams || []).find((g) => g.id === copyFromId) || await db.get(P.doc(w, 'diagrams', copyFromId));
    shapes = (src && src.shapes) || {};
  }
  const gid = await createDiagram(w, d, shapes);
  await addItem(w, d, b, { kind: 'diagram', refId: gid, caption: '' });
  openEditor(w, gid);
}

async function addImage(w, d, b) {
  const f = await pickFile('image/*');
  if (!f) return;
  try {
    toast('写真を縮小して保存しています…');
    const img = await compressImage(f);
    const iid = await createImage(w, d, img);
    await addItem(w, d, b, { kind: 'image', refId: iid, caption: '', size: 'm' });
  } catch (e) { toast(e.message || String(e), 'error', 6000); }
}

// 説明の行頭に「●」などを入れる（カーソルのある行。行の途中なら次の行を作る）
function insertMarker(e, w, d, b, it, mark) {
  e.preventDefault();
  const el = e.target.closest('.item').querySelector('.rich');
  if (!el) return;
  const m = readEditor(el);
  const v = m.text;
  const sel = document.activeElement === el ? selectionIn(el) : null;
  const pos = sel ? sel[0] : v.length;
  const ls = v.lastIndexOf('\n', pos - 1) + 1;
  const le = v.indexOf('\n', pos) === -1 ? v.length : v.indexOf('\n', pos);
  const line = v.slice(ls, le);
  let at, del, ins;
  const head = line.match(/^(●|☆|＊|→|・)\s?/);
  if (!line.trim() || (head && head[0].length === line.length)) { at = ls; del = line.length; ins = mark + ' '; }
  else if (pos === ls && head) { at = ls; del = head[0].length; ins = mark + ' '; }
  else { at = le; del = 0; ins = '\n' + mark + ' '; }
  const text = v.slice(0, at) + ins + v.slice(at + del);
  const fill = (arr) => [...arr.slice(0, at), ...Array.from(ins, () => null), ...arr.slice(at + del)];
  el._rt.onChange(text, fill(m.c), fill(m.bg), fill(m.b));
  rerender();
  setTimeout(() => { el.focus(); setSelectionIn(el, at + ins.length); }, 0);
}

// 説明文の欄（直接編集。更新した行は青、ツールバーで色を付けられる）
function NoteEditor(w, d, b, it) {
  const u = b._u;
  const raw = (b.items && b.items[it.id]) || it;
  const text = raw.text || '';
  const marks = raw.marks || [];
  const at = attrsOf(text, marks);
  const lines = text.split('\n');
  const autoNew = lines.map((ln) => !!(u && u.line(it.id, ln)));
  const autofocus = S.ui.focusItem === it.id;
  if (autofocus) queueMicrotask(() => { S.ui.focusItem = null; });
  return RichEdit({
    key: 'ne-' + it.id, cls: 'note-ed', autofocus, pkey: 'note:' + it.id, placeholder: '● 動き　☆ 意味　＊ ポイント　→ 補足',
    sig: text + '|' + JSON.stringify(marks) + '|' + autoNew.join(''),
    lines: () => {
      let pos = 0;
      return lines.map((ln, li) => {
        const st = pos; pos += ln.length + 1;
        const runs = runsOf(st, st + ln.length, at);
        return h('div', { class: 'rl' + (autoNew[li] ? ' auto-upd' : '') },
          runs.length ? runs.map((r) => runSpan(text, r)) : h('br'));
      });
    },
    onChange: (nt, c, bg, bo) => {
      const nm = marksOf(c, bg, bo);
      if (b.items && b.items[it.id]) { b.items[it.id].text = nt; b.items[it.id].marks = nm; }
      saveLater(blockPath(w, b), { [`items.${it.id}.text`]: nt, [`items.${it.id}.marks`]: nm });
      touch(w, d);
      rerender();
    },
  });
}

function ItemView(w, d, b, it, i, items, rows) {
  const bar = (extra) => h('div', { class: 'item-tools' },
    extra,
    h('span', { class: 'grow' }),
    h('button', { class: 'icon-btn', title: '上へ', disabled: i === 0, onclick: () => moveItem(w, b, items, i, -1) }, '↑'),
    h('button', { class: 'icon-btn', title: '下へ', disabled: i === items.length - 1, onclick: () => moveItem(w, b, items, i, 1) }, '↓'),
    h('button', { class: 'icon-btn', title: '削除', onclick: () => removeItem(w, d, b, it) }, '×'));

  if (it.kind === 'text') {
    return h('div', { key: it.id, class: 'item text' },
      NoteEditor(w, d, b, it),
      bar(['●', '☆', '＊', '→'].map((m) => h('button', { class: 'mark-btn', title: `行頭に「${m}」`, onpointerdown: (e) => e.preventDefault(), onclick: (e) => insertMarker(e, w, d, b, it, m) }, m))));
  }
  if (it.kind === 'diagram') {
    const g = (S.d.diagrams || []).find((x) => x.id === it.refId);
    return h('div', { key: it.id, class: 'item diagram' },
      h('input', {
        class: 'caption', value: it.caption || '', placeholder: '見出し（任意）', 'data-pkey': 'cap:' + it.id,
        oninput: (e) => { saveLater(blockPath(w, b), { [`items.${it.id}.caption`]: e.target.value }); touch(w, d); },
      }),
      b._u && b._u.diagram(it.id, it.refId) ? h('div', { class: 'upd small' }, DIAGRAM_FIXED) : null,
      (() => { const ed = others().filter((p) => p.g === it.refId); return h('div', { class: 'pres-edit' + (ed.length ? '' : ' empty') }, NameTags(ed, 'on-thumb'), ed.length ? h('span', { class: 'muted small' }, 'が図を編集中') : null); })(),
      h('button', { class: 'thumb', onclick: () => openEditor(w, it.refId), title: 'クリックで図を編集' },
        g ? StageSVG(g.shapes, { idx: castIndex(S.d.work && S.d.work.cast), roleVis: g.roleVis || {} }) : h('div', { class: 'muted small pad' }, '読み込み中…'),
        (() => {
          const ed = g ? others().filter((p) => p.g === it.refId) : [];
          return h('svg', { class: 'pres-overlay', viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true' }, ed.length ? PresenceMarks(g.shapes, ed, 0.8) : []);
        })(),
        h('span', { class: 'thumb-hint' }, '編集')),
      g ? OverCount(g.shapes) : null,
      bar([
        h('button', { class: 'btn tiny', onclick: () => openEditor(w, it.refId) }, '編集'),
        h('button', { class: 'btn tiny', onclick: () => addDiagramAfter(w, d, b, it) }, '複製して下に追加'),
      ]));
  }
  if (it.kind === 'image') {
    const im = (S.d.images || []).find((x) => x.id === it.refId);
    const size = it.size || 'm';
    return h('div', { key: it.id, class: 'item image' },
      h('input', {
        class: 'caption', value: it.caption || '', placeholder: '見出し（任意）例：＜木のイメージ＞', 'data-pkey': 'cap:' + it.id,
        oninput: (e) => { saveLater(blockPath(w, b), { [`items.${it.id}.caption`]: e.target.value }); touch(w, d); },
      }),
      im ? h('img', { class: 'photo size-' + size, src: im.data, alt: it.caption || '参考写真' }) : h('div', { class: 'muted small pad' }, '読み込み中…'),
      bar(h('div', { class: 'seg' }, [['s', '小'], ['m', '中'], ['l', '大']].map(([k, label]) =>
        h('button', { class: 'seg-btn' + (size === k ? ' on' : ''), onclick: () => db.update(blockPath(w, b), { [`items.${it.id}.size`]: k }) }, label)))));
  }
  return null;
}

async function addDiagramAfter(w, d, b, it) {
  const items = itemsOf(b);
  const src = (S.d.diagrams || []).find((g) => g.id === it.refId);
  const gid = await createDiagram(w, d, (src && src.shapes) || {});
  const id = newId(8);
  const idx = items.findIndex((x) => x.id === it.id);
  const patch = { [`items.${id}`]: { kind: 'diagram', refId: gid, caption: '', order: idx + 2 } };
  items.forEach((x, k) => { patch[`items.${x.id}.order`] = k <= idx ? k + 1 : k + 2; });
  await db.update(blockPath(w, b), patch);
  touch(w, d);
  openEditor(w, gid);
}

function BlockCard(w, d, b, r, rowIndex, indexInRow, rows) {
  const items = itemsOf(b);
  const prevDia = previousDiagram(rows, b);
  const canMerge = rowIndex > 0 && indexInRow === 0;
  const { draft } = ctx();
  b._u = blockUpdates(draft, b, Object.fromEntries((S.d.diagrams || []).map((g) => [g.id, g])));
  const here = others().filter((p) => p.d === d && p.block === b.id && !p.g && !p.caret);
  return h('div', { key: b.id, class: 'block' + (b.cue ? '' : ' nocue') + (here.length ? ' has-pres' : ''), 'data-pblock': b.id, style: ringStyle(here) },
    NameTags(here, 'on-block'),
    h('div', { class: 'block-head' },
      // タイミングはテマ友の文章そのもの。押すと、テマ友での位置を選び直せる
      h('div', { class: 'cue-field' },
        h('span', { class: 'cue-br' }, '《'),
        h('button', {
          type: 'button', 'aria-label': 'タイミング（押すとテマ友での位置を付け替えます）', title: '押すと、テマ友での位置を付け替えます',
          class: 'cue-btn' + (b._u && b._u.cue && b.cue ? ' upd' : '') + (S.ui.reanchor === b.id ? ' picking' : '') + (b.cue ? '' : ' empty'),
          onclick: () => { S.ui.reanchor = S.ui.reanchor === b.id ? null : b.id; S.ui.sel = null; S.ui.lineSel = null; rerender(); },
        }, cueText(b, r) || 'タイミングなし（押して付ける）'),
        h('span', { class: 'cue-br' }, '》')),
      h('details', { class: 'kebab' },
        h('summary', { title: 'その他の操作' }, '⋯'),
        h('div', { class: 'menu' },
          canMerge ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; db.update(blockPath(w, b), { newRow: false }); } }, '上の段とまとめる') : null,
          b.newRow === false ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; db.update(blockPath(w, b), { newRow: true }); } }, 'この位置で段を分ける') : null,
          h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; S.ui.reanchor = b.id; S.ui.sel = null; S.ui.lineSel = null; rerender(); } }, 'タイミング（テマ友での位置）を付け替える'),
          h('button', { class: 'linklike danger', onclick: (e) => { e.target.closest('details').open = false; removeBlock(w, d, b); } }, 'この図解を削除')))),
    !r.ok ? h('div', { class: 'warn small' }, 'テーマ活動の友の中にこの語句が見つかりません。「⋯」→「位置を付け替える」で直してください。') : null,
    b.newRow === false && indexInRow === 0 ? null : null,
    items.map((it, i) => ItemView(w, d, b, it, i, items, rows)),
    h('div', { class: 'add-bar' },
      h('button', { class: 'btn tiny', onclick: async () => { const id = await addItem(w, d, b, { kind: 'text', text: '● ' }); S.ui.focusItem = id; } }, '＋説明'),
      h('button', { class: 'btn tiny', onclick: () => addDiagram(w, d, b, null) }, '＋図'),
      prevDia ? h('button', { class: 'btn tiny', onclick: () => addDiagram(w, d, b, prevDia.refId) }, '＋直前の図を複製') : null,
      h('button', { class: 'btn tiny', onclick: () => addImage(w, d, b) }, '＋写真')));
}

// ---------- テーマ活動の友の貼り付け ----------
function ScriptModal(w, d, draft, blocks) {
  const m = S.ui.scriptEdit;
  const changed = draft.script !== m.base;
  const close = () => { S.ui.scriptEdit = null; rerender(); };
  return h('div', { class: 'overlay', onclick: (e) => { if (e.target.classList.contains('overlay')) close(); } },
    h('div', { class: 'dialog wide' },
      h('h2', null, 'テマ友を貼り付け・編集'),
      h('p', { class: 'muted small' }, 'このトラックのテーマ活動の友をそのまま貼り付けてください。「PETER:」「ピーター:」のような行頭のキャラクター名は自動で薄い文字になります。キャラクター名で始まる行から次の空行まではセリフとして字下げし、空行のあとでキャラクター名のない行はナレーションとして字下げしません（NARRATOR・ナレーションの行も字下げしません）。うまく判定されない行は、保存したあとに行をタップすると直せます。'),
      h('details', { class: 'mark-help small' },
        h('summary', null, '字下げやキャラ名を、文章に印を書いて直す'),
        h('p', { class: 'muted' }, '印は画面・PDF・Wordには表示されません。'),
        h('table', { class: 'mark-table' },
          h('tr', null, h('td', null, h('code', null, '[字下げ]')), h('td', null, '行頭に書くと、その行から次の空行まで字下げします')),
          h('tr', null, h('td', null, h('code', null, '[字下げなし]')), h('td', null, '行頭に書くと、その行から次の空行まで字下げしません')),
          h('tr', null, h('td', null, h('code', null, '{ピーター:}')), h('td', null, '{ } で囲んだ部分を薄い文字（キャラ名）にします。行頭に書くと、その行のキャラ名になります')),
          h('tr', null, h('td', null, h('code', null, '{}')), h('td', null, '行頭に書くと、その行はキャラ名なしになります'))),
        h('p', { class: 'muted' }, '例：', h('code', null, '{Dursoi A:}The clouds open their portals.'), '　／　', h('code', null, '[字下げなし]He pretends to be a full-fledged warrior,'), '　［ ］｛ ｝は全角でもかまいません。')),
      changed ? h('div', { class: 'warn' }, '開いている間に、ほかの人がテーマ活動の友を更新しました。',
        h('button', { class: 'btn tiny', onclick: () => { S.ui.scriptEdit = { value: draft.script || '', base: draft.script || '' }; rerender(); } }, '最新のテマ友を読み込む')) : null,
      h('textarea', { class: 'script-ta', value: m.value, oninput: (e) => { m.value = e.target.value; }, spellcheck: false, ref: (el) => el.focus() }),
      h('div', { class: 'actions end' },
        h('button', { class: 'btn ghost', onclick: close }, 'キャンセル'),
        h('button', {
          class: 'btn primary', onclick: async () => {
            const cur = scriptOf(draft);
            const marks = shiftMarks(cur.text, m.value, cur.marks);
            S.ui.scriptLocal = null;
            await saveScript(w, d, m.value, blocks, S.user);
            await db.update(P.doc(w, 'drafts', d), { scriptMarks: marks });
            S.ui.scriptEdit = null;
            toast('テマ友を保存しました');
            rerender();
          },
        }, '保存'))));
}

// ---------- 画面 ----------
// 舞台の人がメンバーより多いときの、控えめなお知らせ
function OverCount(shapes) {
  const ix = castIndex(S.d.work && S.d.work.cast);
  const members = ix.list.filter((c) => c.id && !c.tag).length;
  const n = Object.values(shapes || {}).filter((s) => s && s.t === 'person').length;
  if (!members || n <= members) return null;
  return h('div', { class: 'over-note' }, `舞台の人がメンバーより${n - members}人多くなっています（${n}／${members}）`);
}

// 稿を削除する（その稿しかないときは、トラックごと削除）
async function removeDraft(w, draft, track, siblings) {
  const only = siblings.length <= 1;
  const ok = await confirmBox(only
    ? `「${track ? track.title : 'このトラック'}」の稿はこの${draftName(draft)}だけです。削除すると、トラックごと削除されます。`
    : `${draftName(draft)}を削除しますか？`, {
    title: only ? 'トラックを削除' : '稿を削除', ok: '削除', danger: true,
    detail: 'この稿のテーマ活動の友・タイミング・図・写真もすべて削除されます（削除したあと、このライブラリーの中にいるあいだは、右上の「↶」で元に戻せます）。ほかの稿はそのまま残ります。',
  });
  if (!ok) return;
  if (only) {
    await deleteTrack(w, draft.trackId);
    toast('トラックを削除しました');
    go(`#/w/${w}`);
  } else {
    const next = siblings.find((x) => x.id !== draft.id);
    await deleteDraft(w, draft.id);
    toast(`${draftName(draft)}を削除しました`);
    go(`#/w/${w}/d/${next.id}`);
  }
}

// 新しい稿を作る（稿の名前と「すべて黒字にする」を確かめてから）
export async function newDraftFlow(w, draft, siblings) {
  const nextNo = Math.max(0, ...siblings.map((x) => x.no || 0)) + 1;
  const r = await ask({
    title: '新しい稿を作る', message: `${draftName(draft)}を複製して、新しい稿を作ります。`, ok: '作る',
    fields: [
      { key: 'name', label: '新しい稿の名前', value: `第${nextNo}稿`, required: true, hint: '「最終稿」「2.5稿」などに書き換えられます。数字だけなら「第〇稿」になります。' },
      { key: 'keepBlue', type: 'checkbox', label: '青字をそのままにする', value: false, hint: 'チェックしないと、前の稿で青字だったところは黒になり、新しい稿で変えたところだけが青になります。ピンク・赤・灰色の文字はそのまま残ります。' },
    ],
  });
  if (!r) return;
  const nd = await copyDraft(w, draft.id, S.user, { label: normalizeDraftName(r.name), keepBlue: !!r.keepBlue });
  toast('新しい稿を作りました');
  go(`#/w/${w}/d/${nd}`);
}

export function DraftView() {
  const { w, d, draft, track, ep, work, drafts } = ctx();
  if (!S.d.drafts || work === undefined) return h('main', { class: 'page' }, h('p', { class: 'muted' }, '読み込み中…'));
  if (!draft) return h('main', { class: 'page' }, h('p', null, 'この稿は見つかりませんでした（削除された可能性があります）。'), h('a', { href: `#/w/${w}` }, 'ライブラリーページへ'));
  // 閲覧者は、PDF用の表示で見る
  if (work && !canEdit(work)) { queueMicrotask(() => location.replace(`#/w/${w}/print/d/${d}`)); return h('main', { class: 'page' }, h('p', { class: 'muted' }, '閲覧用の表示に切り替えています…')); }
  const blocks = S.d.blocks || [];
  const text = scriptOf(draft).text;
  const rows = buildRows(text, blocks, draft.spkFix);
  const hls = highlightRanges(text, blocks);
  const siblings = drafts.filter((x) => x.trackId === draft.trackId).sort((a, b) => (b.no || 0) - (a.no || 0));
  const draftPath = P.doc(w, 'drafts', d);
  const isLatest = siblings[0] && siblings[0].id === d;

  return h('main', { class: 'page draft-page' },
    h('div', { class: 'draft-head' },
      h('div', { class: 'grow' },
        h('div', { class: 'muted small' }, ep ? ep.title : '', ' ・ ', track ? track.title : ''),
        h('h1', { class: 'sheet-name' }, draftTitle(work, ep, track, draft))),
      h('div', { class: 'actions' },
        siblings.length > 1 ? h('select', { value: d, onchange: (e) => go(`#/w/${w}/d/${e.target.value}`), 'aria-label': '稿を切り替える' },
          siblings.map((x) => h('option', { value: x.id }, `${draftName(x)}${x.id === siblings[0].id ? '（最新）' : ''}`))) : null,
        h('button', { class: 'btn', onclick: () => { S.ui.scriptEdit = { value: text, base: text }; rerender(); } }, text ? 'テマ友を編集' : 'テマ友を貼り付け'),
        h('a', { class: 'btn', href: `#/w/${w}/show/d/${d}`, title: '図を大きく、1枚ずつ見ます（プレゼンテーションのように）' }, '閲覧モード'),
        h('a', { class: 'btn primary', href: `#/w/${w}/print/d/${d}`, title: 'PDF・Googleドキュメント・Wordで書き出します' }, '書き出す'),
        h('button', {
          class: 'btn', title: 'この稿を複製して次の稿を作ります', onclick: async () => {
            await newDraftFlow(w, draft, siblings);
          },
        }, '新しい稿を作る'),
        h('details', { class: 'kebab' },
          h('summary', { title: 'その他の操作', 'aria-label': 'その他の操作' }, '⋯'),
          h('div', { class: 'menu' },
            draft.updMark ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; db.update(draftPath, { updShow: draft.updShow === false }); } }, draft.updShow === false ? '更新箇所を青字にする' : '更新箇所を青字にしない') : null,
            h('button', { class: 'linklike danger', onclick: (e) => { e.target.closest('details').open = false; removeDraft(w, draft, track, siblings); } }, 'この稿を削除'))))),
    !isLatest ? h('div', { class: 'note' }, `これは古い稿（${draftName(draft)}）です。編集すると、この稿が書き換わります。`) : null,
    showUpdates(draft) ? h('div', { class: 'howto small upd-note' }, `前の稿から変えたところ（新しいタイミング・書き足した説明の行・変えた図）は、書き出したPDFなどで青字になります。「⋯」から青字をやめられます。`) : null,
    h('section', { class: 'info-panel' },
      h('label', { class: 'field' }, h('span', null, '図解っ子'),
        h('input', { value: draft.zukaikko || '', placeholder: '例：C、B', 'data-pkey': 'zk', oninput: (e) => { saveLater(draftPath, { zukaikko: e.target.value }); touch(w, d); } })),
      h('label', { class: 'field' }, h('span', null, '表現したいこと（場面', h('i', { class: 'dot' }), '）'),
        h('input', { value: draft.theme || '', 'data-pkey': 'theme', oninput: (e) => { saveLater(draftPath, { theme: e.target.value }); touch(w, d); } })),
      h('details', { class: 'cast-peek' },
        h('summary', null, `メンバー一覧（${(work.cast || []).length}人）`),
        CastTable(work.cast),
        h('a', { class: 'small', href: `#/w/${w}/cast` }, 'メンバー一覧を編集')),
      draft.updatedAt ? h('div', { class: 'muted small' }, `最終更新 ${fmtTime(draft.updatedAt)} ${draft.updatedBy || ''}`) : null),
    h('div', { class: 'howto small' }, 'テーマ活動の友の行をタップすると、その行の最初の数語をタイミングにして図解を追加できます。語句をなぞって選ぶと、選んだ語句をタイミングにできます。行をタップすると、キャラ名（薄い文字）や字下げも直せます。Googleドキュメントの図解をコピーしてこのページで Ctrl+V を押すと、このトラックに取り込めます。'),
    text ? FormatBar() : null,
    Legend(),
    !text ? h('div', { class: 'empty' },
      h('p', null, 'まだテーマ活動の友がありません。'),
      h('button', { class: 'btn primary', onclick: () => { S.ui.scriptEdit = { value: '', base: '' }; rerender(); } }, 'テマ友を貼り付ける'),
      h('p', { class: 'muted small' }, 'Googleドキュメントの図解を Ctrl+A → Ctrl+C でコピーして、このページで Ctrl+V を押すと、テマ友・タイミング・図をまとめて取り込めます。')) : null,
    text ? h('div', { class: 'sheet-edit' }, rows.map((row, ri) => h('div', { key: 'row' + row.start, class: 'srow', 'data-prow': row.start },
      (() => {
        const here = others().filter((p) => p.d === d && p.row === row.start && !p.block && !p.g && !p.caret);
        return h('div', { class: 'scol' + (here.length ? ' has-pres' : ''), style: ringStyle(here) }, NameTags(here, 'on-row'), ScriptEditor(w, d, draft, row, hls, text, scriptOf(draft).marks));
      })(),
      h('div', { class: 'ncol' },
        row.blocks.map(({ b, r }, k) => BlockCard(w, d, b, r, ri, k, rows)),
        row.blocks.length === 0 ? h('div', { class: 'ncol-empty muted small' }, ri === 0 ? '左のテーマ活動の友の行をタップすると、ここに図解ができます。' : '') : null)))) : null,
    S.ui.scriptEdit ? ScriptModal(w, d, draft, blocks) : null,
  );
}

export { DotText };
