// 稿の編集画面：台本＋《タイミング》＋動き・舞台図・写真
import { h } from './vdom.js';
import { db, DEL, newId } from './db.js';
import { S, rerender, toast, fmtTime, saveLater, compressImage, pickFile, go } from './state.js';
import { P, draftTitle, saveScript, createBlock, createDiagram, createImage, copyDraft } from './model.js';
import { buildRows, highlightRanges } from './script.js';
import { StageSVG } from './stage.js';
import { CastTable, Legend, ScriptLines, DotText } from './sheet.js';
import { openEditor } from './editor.js';
import { confirmBox } from './dialog.js';
import { castIndex } from './cast.js';
import { resolveAnchor } from './script.js';

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

function autosize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

// ---------- 台本上の選択 ----------
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
  const text = draft.script || '';
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
  const text = draft.script || '';
  S.ui.lineSel = line.start;
  S.ui.lineText = text.slice(line.start, line.end);
  S.ui.lineAuto = autoTiming(text, line);
  S.ui.lineInfo = line;
  S.ui.sel = null;
  rerender();
}

// 行の最初の数語をタイミングにする（話者名は除く）
export function autoTiming(text, line) {
  let start = line.label ? line.label.e : line.start;
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

async function reanchorTo(blockId) {
  const { w, d } = ctx();
  if (!S.ui.sel) return;
  await db.update(P.doc(w, 'blocks', blockId), { anchor: { offset: S.ui.sel.a, text: S.ui.sel.text } });
  touch(w, d);
  clearSel();
  toast('位置を付け替えました');
}

// 話者名（薄い文字）の自動判定を、行ごとに手で直す
async function setSpeakerFix(lineText, n) {
  const { w, d, draft } = ctx();
  const list = (draft.spkFix || []).filter((f) => f.t !== lineText);
  if (n != null) list.push({ t: lineText, n });
  await db.update(P.doc(w, 'drafts', d), { spkFix: list });
  clearSel();
}
function SpeakerFix() {
  const line = S.ui.lineInfo;
  const t = S.ui.lineText || '';
  if (!t.trim()) return null;
  const keep = (e) => e.preventDefault();
  const btns = [];
  if (line.label) btns.push(h('button', { class: 'btn', onpointerdown: keep, onclick: () => setSpeakerFix(t, 0) }, '話者名ではない'));
  else {
    const c = t.search(/[:：]/);
    if (c > 0) btns.push(h('button', { class: 'btn', onpointerdown: keep, onclick: () => setSpeakerFix(t, c + 1) }, `「${t.slice(0, Math.min(c, 12))}${c > 12 ? '…' : ''}」は話者名`));
  }
  if (line.fixed) btns.push(h('button', { class: 'btn', onpointerdown: keep, onclick: () => setSpeakerFix(t, null) }, '自動判定に戻す'));
  return btns;
}

export function SelectionBar() {
  if (S.route.name !== 'draft') return null;
  const { sel, lineSel, reanchor } = S.ui;
  if (!sel && lineSel == null && !reanchor) return null;
  const preview = (t) => { t = (t || '').replace(/\s+/g, ' '); return t.length > 28 ? t.slice(0, 28) + '…' : t; };
  const keep = (e) => e.preventDefault();
  if (reanchor) {
    return h('div', { class: 'selbar' },
      h('div', { class: 'selbar-text' }, sel ? `「${preview(sel.text)}」に付け替えます` : '台本の中で、新しい位置の語句を選んでください'),
      h('div', { class: 'selbar-btns' },
        sel ? h('button', { class: 'btn primary', onpointerdown: keep, onclick: () => reanchorTo(reanchor) }, 'ここに付け替える') : null,
        h('button', { class: 'btn ghost', onpointerdown: keep, onclick: clearSel }, 'やめる')));
  }
  return h('div', { class: 'selbar' },
    h('div', { class: 'selbar-text' }, sel ? `タイミング：《${preview(sel.text)}》` : S.ui.lineAuto ? `タイミング：《${preview(S.ui.lineAuto.text)}》` : 'この行（空行）'),
    h('div', { class: 'selbar-btns' },
      h('button', { class: 'btn primary', onpointerdown: keep, onclick: () => makeBlock(true) }, sel ? '選んだ語句で図解を追加' : 'この行に図解を追加'),
      !sel && S.ui.lineInfo ? SpeakerFix() : null,
      h('button', { class: 'btn ghost', onpointerdown: keep, onclick: clearSel, 'aria-label': '閉じる' }, '×')));
}

// 新しい図解の位置より前にある、最後の舞台図（人の位置を引き継ぐため）
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
  if (it.kind !== 'text' && !(await confirmBox(it.kind === 'diagram' ? 'この舞台図を削除しますか？' : 'この写真を削除しますか？', { ok: '削除', danger: true }))) return;
  const ops = [{ op: 'update', path: blockPath(w, b), data: { [`items.${it.id}`]: DEL } }];
  if (it.refId) ops.push({ op: 'remove', path: P.doc(w, it.kind === 'diagram' ? 'diagrams' : 'images', it.refId) });
  await db.batch(ops);
  touch(w, d);
}

async function removeBlock(w, d, b) {
  if (!(await confirmBox(`《${b.cue || 'タイミングなし'}》の図解を削除しますか？\n中の舞台図・写真も消えます。`, { ok: '削除', danger: true }))) return;
  const ops = [{ op: 'remove', path: blockPath(w, b) }];
  for (const it of itemsOf(b)) if (it.refId) ops.push({ op: 'remove', path: P.doc(w, it.kind === 'diagram' ? 'diagrams' : 'images', it.refId) });
  await db.batch(ops);
  touch(w, d);
}

// 表示順で直前にある舞台図を探す
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

function insertMarker(e, w, d, b, it, mark) {
  e.preventDefault();
  const ta = e.target.closest('.item').querySelector('textarea');
  if (!ta) return;
  const v = ta.value;
  const pos = document.activeElement === ta ? ta.selectionStart : v.length;
  const ls = v.lastIndexOf('\n', pos - 1) + 1;
  const rest = v.slice(ls).replace(/^(●|☆|＊|→|・)\s?/, '');
  const line = v.slice(ls, pos);
  let nv, caret;
  if (line.trim() === '' || /^(●|☆|＊|→|・)\s?$/.test(line)) {
    nv = v.slice(0, ls) + mark + ' ' + rest;
    caret = ls + mark.length + 1;
  } else {
    // 行の途中なら次の行に追加
    const le = v.indexOf('\n', pos) === -1 ? v.length : v.indexOf('\n', pos);
    nv = v.slice(0, le) + '\n' + mark + ' ' + v.slice(le);
    caret = le + 1 + mark.length + 1;
  }
  ta.value = nv;
  ta._typed = true;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  autosize(ta);
  saveLater(blockPath(w, b), { [`items.${it.id}.text`]: nv });
  touch(w, d);
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
      h('textarea', {
        rows: 1, value: it.text || '', placeholder: '● 動き　☆ 意味　＊ ポイント　→ 補足',
        ref: (el) => { autosize(el); if (S.ui.focusItem === it.id) { S.ui.focusItem = null; el.focus(); el.setSelectionRange(el.value.length, el.value.length); } },
        update: autosize,
        oninput: (e) => { autosize(e.target); saveLater(blockPath(w, b), { [`items.${it.id}.text`]: e.target.value }); touch(w, d); },
      }),
      bar(['●', '☆', '＊', '→'].map((m) => h('button', { class: 'mark-btn', title: `行頭に「${m}」`, onpointerdown: (e) => e.preventDefault(), onclick: (e) => insertMarker(e, w, d, b, it, m) }, m))));
  }
  if (it.kind === 'diagram') {
    const g = (S.d.diagrams || []).find((x) => x.id === it.refId);
    return h('div', { key: it.id, class: 'item diagram' },
      h('input', {
        class: 'caption', value: it.caption || '', placeholder: '見出し（任意）',
        oninput: (e) => { saveLater(blockPath(w, b), { [`items.${it.id}.caption`]: e.target.value }); touch(w, d); },
      }),
      h('button', { class: 'thumb', onclick: () => openEditor(w, it.refId), title: 'クリックで舞台図を編集' },
        g ? StageSVG(g.shapes, { idx: castIndex(S.d.work && S.d.work.cast), roleVis: g.roleVis || {} }) : h('div', { class: 'muted small pad' }, '読み込み中…'),
        h('span', { class: 'thumb-hint' }, '編集')),
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
        class: 'caption', value: it.caption || '', placeholder: '見出し（任意）例：＜木のイメージ＞',
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
  return h('div', { key: b.id, class: 'block' + (b.cue ? '' : ' nocue') },
    h('div', { class: 'block-head' },
      h('label', { class: 'cue-field' },
        h('span', { class: 'cue-br' }, '《'),
        h('input', {
          value: b.cue || '', placeholder: 'タイミングなし', 'aria-label': 'タイミング',
          oninput: (e) => { saveLater(blockPath(w, b), { cue: e.target.value }); touch(w, d); },
        }),
        h('span', { class: 'cue-br' }, '》')),
      h('details', { class: 'kebab' },
        h('summary', { title: 'その他の操作' }, '⋯'),
        h('div', { class: 'menu' },
          canMerge ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; db.update(blockPath(w, b), { newRow: false }); } }, '上の段とまとめる') : null,
          b.newRow === false ? h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; db.update(blockPath(w, b), { newRow: true }); } }, 'この位置で段を分ける') : null,
          h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; S.ui.reanchor = b.id; S.ui.sel = null; S.ui.lineSel = null; rerender(); } }, '台本上の位置を付け替える'),
          h('button', { class: 'linklike danger', onclick: (e) => { e.target.closest('details').open = false; removeBlock(w, d, b); } }, 'この図解を削除')))),
    !r.ok ? h('div', { class: 'warn small' }, '台本の中にこの語句が見つかりません。「⋯」→「位置を付け替える」で直してください。') : null,
    b.newRow === false && indexInRow === 0 ? null : null,
    items.map((it, i) => ItemView(w, d, b, it, i, items, rows)),
    h('div', { class: 'add-bar' },
      h('button', { class: 'btn tiny', onclick: async () => { const id = await addItem(w, d, b, { kind: 'text', text: '● ' }); S.ui.focusItem = id; } }, '＋文章'),
      h('button', { class: 'btn tiny', onclick: () => addDiagram(w, d, b, null) }, '＋舞台図'),
      prevDia ? h('button', { class: 'btn tiny', onclick: () => addDiagram(w, d, b, prevDia.refId) }, '＋直前の図を複製') : null,
      h('button', { class: 'btn tiny', onclick: () => addImage(w, d, b) }, '＋写真')));
}

// ---------- 台本の貼り付け ----------
function ScriptModal(w, d, draft, blocks) {
  const m = S.ui.scriptEdit;
  const changed = draft.script !== m.base;
  const close = () => { S.ui.scriptEdit = null; rerender(); };
  return h('div', { class: 'overlay', onclick: (e) => { if (e.target.classList.contains('overlay')) close(); } },
    h('div', { class: 'dialog wide' },
      h('h2', null, '台本を貼り付け・編集'),
      h('p', { class: 'muted small' }, 'このトラックの台本をそのまま貼り付けてください。「PETER:」「ピーター:」のような行頭の話者名は自動で薄い文字になり、セリフは字下げされます（語り・NARRATOR は字下げしません）。'),
      changed ? h('div', { class: 'warn' }, '開いている間に、ほかの人が台本を更新しました。',
        h('button', { class: 'btn tiny', onclick: () => { S.ui.scriptEdit = { value: draft.script || '', base: draft.script || '' }; rerender(); } }, '最新の台本を読み込む')) : null,
      h('textarea', { class: 'script-ta', value: m.value, oninput: (e) => { m.value = e.target.value; }, spellcheck: false, ref: (el) => el.focus() }),
      h('div', { class: 'actions end' },
        h('button', { class: 'btn ghost', onclick: close }, 'キャンセル'),
        h('button', {
          class: 'btn primary', onclick: async () => {
            await saveScript(w, d, m.value, blocks, S.user);
            S.ui.scriptEdit = null;
            toast('台本を保存しました');
            rerender();
          },
        }, '保存'))));
}

// ---------- 画面 ----------
export function DraftView() {
  const { w, d, draft, track, ep, work, drafts } = ctx();
  if (!S.d.drafts || work === undefined) return h('main', { class: 'page' }, h('p', { class: 'muted' }, '読み込み中…'));
  if (!draft) return h('main', { class: 'page' }, h('p', null, 'この稿は見つかりませんでした（削除された可能性があります）。'), h('a', { href: `#/w/${w}` }, '作品ページへ'));
  const blocks = S.d.blocks || [];
  const text = draft.script || '';
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
          siblings.map((x) => h('option', { value: x.id }, `第${x.no}稿${x.id === siblings[0].id ? '（最新）' : ''}`))) : null,
        h('button', { class: 'btn', onclick: () => { S.ui.scriptEdit = { value: text, base: text }; rerender(); } }, text ? '台本を編集' : '台本を貼り付け'),
        h('a', { class: 'btn primary', href: `#/w/${w}/print/d/${d}` }, 'PDFに書き出す'),
        h('button', {
          class: 'btn', title: 'この稿を複製して次の稿を作ります', onclick: async () => {
            if (!(await confirmBox(`第${draft.no}稿を複製して、新しい稿を作りますか？`, { ok: '作る' }))) return;
            const nd = await copyDraft(w, d, S.user);
            toast('新しい稿を作りました');
            go(`#/w/${w}/d/${nd}`);
          },
        }, '新しい稿を作る'))),
    !isLatest ? h('div', { class: 'note' }, `これは古い稿（第${draft.no}稿）です。編集すると、この稿が書き換わります。`) : null,
    h('section', { class: 'info-panel' },
      h('label', { class: 'field' }, h('span', null, '図解っ子'),
        h('input', { value: draft.zukaikko || '', placeholder: '例：C、B', oninput: (e) => { saveLater(draftPath, { zukaikko: e.target.value }); touch(w, d); } })),
      h('label', { class: 'field' }, h('span', null, '表現したいこと（場面', h('i', { class: 'dot' }), '）'),
        h('input', { value: draft.theme || '', oninput: (e) => { saveLater(draftPath, { theme: e.target.value }); touch(w, d); } })),
      h('details', { class: 'cast-peek' },
        h('summary', null, `メンバー一覧（${(work.cast || []).length}人）`),
        CastTable(work.cast),
        h('a', { class: 'small', href: `#/w/${w}/cast` }, 'メンバー一覧を編集')),
      h('div', { class: 'muted small' }, `最終更新 ${fmtTime(draft.updatedAt)} ${draft.updatedBy || ''}`)),
    h('div', { class: 'howto small' }, '台本の行をタップすると、その行の最初の数語をタイミングにして図解を追加できます。語句をなぞって選ぶと、選んだ語句をタイミングにできます。'),
    Legend(),
    !text ? h('div', { class: 'empty' },
      h('p', null, 'まだ台本がありません。'),
      h('button', { class: 'btn primary', onclick: () => { S.ui.scriptEdit = { value: '', base: '' }; rerender(); } }, '台本を貼り付ける')) : null,
    text ? h('div', { class: 'sheet-edit' }, rows.map((row, ri) => h('div', { key: 'row' + row.start, class: 'srow' },
      h('div', { class: 'scol' }, ScriptLines(text, row.lines, hls, { lineSel: S.ui.lineSel, onLine })),
      h('div', { class: 'ncol' },
        row.blocks.map(({ b, r }, k) => BlockCard(w, d, b, r, ri, k, rows)),
        row.blocks.length === 0 ? h('div', { class: 'ncol-empty muted small' }, ri === 0 ? '左の台本の行をタップすると、ここに図解ができます。' : '') : null)))) : null,
    S.ui.scriptEdit ? ScriptModal(w, d, draft, blocks) : null,
  );
}

export { DotText };
