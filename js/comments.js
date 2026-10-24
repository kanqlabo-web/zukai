// コメント（Googleドキュメントのように、文字を選んでコメントを付け、返信して、済んだら「解決」にする）
//
// データ：works/{w}/comments/{id} = { draftId, at, text, by: { name, email }, ts, replies: { [id]: { text, by, ts } }, done, doneBy, doneAt, edited }
//   at.k = 'script' … テマ友の s〜e 文字目（q はそのときの文字。文字がずれたら q を探し直す）
//   at.k = 'note'   … 図解（b）の中の文章（it）の s〜e 文字目
//   at.k = 'block'  … 図解（b）全体
// コメントは「元に戻す」の履歴には入れない（Googleドキュメントと同じ）。
import { h } from './vdom.js';
import { db, DEL, newId } from './db.js';
import { S, rerender, toast, fmtTime } from './state.js';
import { P } from './model.js';
import { icon } from './icons.js';
import { pointAt, selectionIn, lastRichEditor } from './richtext.js';
import { buildRows } from './script.js';
import { confirmBox } from './dialog.js';
import { openContextMenu, MOD } from './menubar.js';

// 画面の状態（ページを移ると閉じる）
const C = { d: null, open: false, hidden: false, active: null, filter: 'open', compose: null, reply: {}, editing: null };
function reset(d) { if (C.d !== d) Object.assign(C, { d, open: false, active: null, compose: null, reply: {}, editing: null }); }
// 広い画面では、コメントを本文の右に、付けた所の高さにそろえていつも出す（Googleドキュメントと同じ）。狭い画面では下に開く
// パソコン（マウスで使う端末）は幅に関係なく右に。指だけの端末は、広い画面（タブレットの横向きなど）のときだけ右に
const fine = () => !!(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches);
const wide = () => window.innerWidth > (fine() ? 700 : 1100);
function shown() {
  if (S.route.name !== 'draft' || C.d !== S.route.params.d) return false;
  if (!wide()) return C.open;
  return C.open || !!C.compose || commentsOf().length > 0; // 右に出すときは隠せない（コメントがあればいつも出す）
}

const path = (id) => P.doc(S.route.params.w, 'comments', id);
const me = () => ({ name: (S.user && S.user.name) || '', email: (S.user && S.user.email) || '' });
const mine = (by) => !!(by && S.user && by.email === S.user.email);
const fail = () => toast('コメントを保存できませんでした。通信を確かめてください', 'error', 6000);

function draftOf() { return (S.d.drafts || []).find((x) => x.id === S.route.params.d) || null; }
// 画面で打ち込み中のテマ友（保存前）があれば、そちらを使う
function scriptText() {
  const loc = S.ui.scriptLocal;
  if (loc && loc.d === S.route.params.d) return loc.text;
  const d = draftOf();
  return (d && d.script) || '';
}
function blockOf(id) { return (S.d.blocks || []).find((b) => b.id === id) || null; }
function noteText(at) { const b = blockOf(at.b); const it = b && b.items && b.items[at.it]; return it ? it.text || '' : null; }

// 文字 q が今どこにあるか（元の位置にあればそこ、なければ元の位置にいちばん近い所）
function findQuote(text, at) {
  if (text == null || !at.q) return null;
  if (text.slice(at.s, at.e) === at.q) return [at.s, at.e];
  let best = null;
  for (let i = text.indexOf(at.q); i >= 0; i = text.indexOf(at.q, i + 1)) {
    if (!best || Math.abs(i - at.s) < Math.abs(best[0] - at.s)) best = [i, i + at.q.length];
  }
  return best;
}
// コメントが付いている場所（見つからなければ null）
export function locate(c) {
  const at = c.at || {};
  if (at.k === 'script') return findQuote(scriptText(), at);
  if (at.k === 'note') return findQuote(noteText(at), at);
  if (at.k === 'block') return blockOf(at.b) ? [0, 0] : null;
  return null;
}

export function commentsOf() {
  return (S.d.comments || []).filter((c) => c.draftId === S.route.params.d);
}
// ページの上から順に並べる
function sorted(list) {
  const d = draftOf();
  const rows = d ? buildRows(scriptText(), S.d.blocks || [], d.spkFix) : [];
  const blockPos = {};
  rows.forEach((row, ri) => row.blocks.forEach(({ b }, k) => { blockPos[b.id] = [ri, k]; }));
  const rowOfOffset = (s) => { let r = 0; rows.forEach((row, i) => { if (row.start <= s) r = i; }); return r; };
  const key = (c) => {
    const at = c.at || {};
    const loc = locate(c);
    if (at.k === 'script') return [loc ? rowOfOffset(loc[0]) : 1e9, 0, loc ? loc[0] : 0, c.ts || 0];
    const bp = blockPos[at.b] || [1e9, 0];
    return [bp[0], 1 + bp[1], at.k === 'note' && loc ? loc[0] : -1, c.ts || 0];
  };
  const keys = new Map(list.map((c) => [c.id, key(c)]));
  return list.slice().sort((a, b) => {
    const x = keys.get(a.id), y = keys.get(b.id);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}
export const openCount = () => commentsOf().filter((c) => !c.done).length;

// ---------- コメントを始める ----------
// 選んでいる所（テマ友の語句・行、図解の文章、選んでいる図解）にコメントを付ける
export function startComment() {
  reset(S.route.params.d);
  let at = null;
  // いま文字を選んでいるのが図解の文章なら、そちらを優先する
  const ds = window.getSelection();
  const inNote = ds && ds.rangeCount && !ds.isCollapsed && ds.anchorNode && ds.anchorNode.parentElement && ds.anchorNode.parentElement.closest('.note-ed');
  const sel = inNote ? null : S.ui.sel;
  if (sel && sel.b > sel.a) at = { k: 'script', s: sel.a, e: sel.b, q: scriptText().slice(sel.a, sel.b) };
  if (!at && !inNote && S.ui.lineSel != null && S.ui.lineInfo && !S.ui.lineInfo.blank) {
    const l = S.ui.lineInfo;
    at = { k: 'script', s: l.start, e: l.end, q: scriptText().slice(l.start, l.end) };
  }
  if (!at) {
    const el = inNote || lastRichEditor();
    const key = el && el.getAttribute('data-pkey');
    const s = el && (selectionIn(el) || el._lastSel);
    if (key && key.startsWith('note:') && s && s[1] > s[0]) {
      const it = key.slice(5);
      const host = el.closest('[data-pblock]'); // 文章の id は図解ごとなので、図解は画面の場所から決める
      const b = host && blockOf(host.getAttribute('data-pblock'));
      const text = b && b.items && b.items[it] ? b.items[it].text || '' : '';
      if (b && b.items && b.items[it]) at = { k: 'note', b: b.id, it, s: s[0], e: s[1], q: text.slice(s[0], s[1]) };
    }
  }
  if (!at && S.ui.activeBlock && blockOf(S.ui.activeBlock)) at = { k: 'block', b: S.ui.activeBlock };
  if (!at) { toast('コメントを付ける語句をなぞって選ぶか、図解を押して選んでから、もう一度押してください', 'info', 5000); return; }
  if (at.q != null && !at.q.trim()) { toast('空白ではなく、文字を選んでください'); return; }
  C.open = true; C.hidden = false;
  C.compose = { at, text: '' };
  C.active = null;
  S.ui.sel = null; S.ui.lineSel = null; // 下の「タイミング」の帯は閉じる
  rerender();
  focusLater('.cmt-compose textarea');
}
export function commentOnBlock(blockId) {
  reset(S.route.params.d);
  C.open = true; C.hidden = false; C.active = null;
  C.compose = { at: { k: 'block', b: blockId }, text: '' };
  rerender();
  focusLater('.cmt-compose textarea');
}
// 欄に入るときにページが動かないように（カードの高さを付ける前に入ると、ページの上まで飛んでいた）
function focusLater(sel) { requestAnimationFrame(() => requestAnimationFrame(() => { layoutSide(); const el = document.querySelector(sel); if (el) el.focus({ preventScroll: true }); })); }

export function toggleComments(v) {
  reset(S.route.params.d);
  // 右に出しているときは隠さない。ボタンを押したら、最初の未解決のコメントへ移る
  if (wide() && commentsOf().length) {
    const first = sorted(commentsOf().filter((c) => !c.done))[0];
    if (v !== false && first) goTo(first);
    return;
  }
  const on = v == null ? !shown() : v;
  C.open = on; C.hidden = !on;
  if (!on) { C.compose = null; C.active = null; }
  rerender();
}
export const commentsOpen = () => shown();

// ---------- 保存 ----------
async function post() {
  const m = C.compose;
  const text = (m && m.text || '').trim();
  if (!text) return;
  const id = newId();
  C.compose = null;
  C.active = id;
  rerender();
  try {
    await db.setQuiet(path(id), { draftId: S.route.params.d, at: m.at, text, by: me(), ts: Date.now(), replies: {}, done: false });
  } catch (e) { fail(); C.compose = m; rerender(); }
}
async function reply(c) {
  const text = (C.reply[c.id] || '').trim();
  if (!text) return;
  C.reply[c.id] = '';
  rerender();
  try { await db.updateQuiet(path(c.id), { [`replies.${newId(10)}`]: { text, by: me(), ts: Date.now() }, ...(c.done ? { done: false } : {}) }); } catch (e) { fail(); }
}
async function setDone(c, done) {
  try { await db.updateQuiet(path(c.id), done ? { done: true, doneBy: me(), doneAt: Date.now() } : { done: false }); } catch (e) { fail(); }
  if (done && C.active === c.id) C.active = null;
  toast(done ? 'コメントを解決にしました（「すべて」で見られます）' : 'コメントを開き直しました');
}
async function saveEdit(c) {
  const e = C.editing;
  const text = (e && e.text || '').trim();
  if (!text) return;
  C.editing = null;
  rerender();
  try {
    if (e.reply) await db.updateQuiet(path(c.id), { [`replies.${e.reply}.text`]: text, [`replies.${e.reply}.edited`]: true });
    else await db.updateQuiet(path(c.id), { text, edited: true });
  } catch (err) { fail(); }
}
async function remove(c, replyId) {
  if (!(await confirmBox(replyId ? 'この返信を削除しますか？' : 'このコメントを削除しますか？返信もすべて消えます。', { ok: '削除', danger: true }))) return;
  try {
    if (replyId) await db.updateQuiet(path(c.id), { [`replies.${replyId}`]: DEL });
    else await db.removeQuiet(path(c.id));
  } catch (e) { fail(); }
}

// ---------- 場所へ移る・目立たせる ----------
function rangeOf(c) {
  const at = c.at || {};
  const loc = locate(c);
  if (!loc || at.k === 'block') return null;
  let pts = null;
  if (at.k === 'script') pts = [scriptPoint(loc[0], false), scriptPoint(loc[1], true)];
  else {
    const el = document.querySelector(`[data-pblock="${CSS.escape(at.b)}"] [data-pkey="note:${CSS.escape(at.it)}"]`);
    if (el) pts = [pointAt(el, loc[0]), pointAt(el, loc[1])];
  }
  if (!pts || !pts[0] || !pts[1]) return null;
  const r = document.createRange();
  try { r.setStart(pts[0][0], pts[0][1]); r.setEnd(pts[1][0], pts[1][1]); } catch (e) { return null; }
  return r;
}
// テマ友の何文字目か → 画面の文字の場所（行の span は data-s に先頭の位置を持つ）
function scriptPoint(off, isEnd) {
  const spans = document.querySelectorAll('.sheet-edit .script-ed span[data-s]');
  let hit = null;
  for (const sp of spans) {
    if (sp.dataset.blank) continue;
    const s = +sp.dataset.s;
    const t = sp.firstChild;
    if (!t || t.nodeType !== 3) continue;
    const len = t.data.length;
    if (isEnd ? (off > s && off <= s + len) : (off >= s && off < s + len)) { hit = [t, off - s]; break; }
  }
  return hit;
}
function targetEl(c) {
  const at = c.at || {};
  if (at.k === 'block' || at.k === 'note') return document.querySelector(`[data-pblock="${CSS.escape(at.b)}"]`);
  return null;
}
function goTo(c) {
  C.active = c.id;
  rerender();
  requestAnimationFrame(() => {
    const r = rangeOf(c);
    const rect = r ? r.getBoundingClientRect() : (targetEl(c) ? targetEl(c).getBoundingClientRect() : null);
    if (!rect) return;
    if (rect.top < 90 || rect.bottom > window.innerHeight - 40) window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: 'smooth' });
    const el = targetEl(c);
    if (el) { el.classList.remove('cmt-flash'); void el.offsetWidth; el.classList.add('cmt-flash'); }
  });
}

// 画面を描いたあとに、コメントの付いた文字を黄色く塗る（CSS Custom Highlight。使えないブラウザでは塗らない）
export function paintCommentMarks() {
  queueSide();
  if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
  if (S.route.name !== 'draft') { CSS.highlights.delete('zukai-cmt'); CSS.highlights.delete('zukai-cmt-on'); return; }
  const all = [], on = [];
  for (const c of commentsOf()) {
    if (c.done) continue;
    const r = rangeOf(c);
    if (!r) continue;
    (c.id === C.active && commentsOpen() ? on : all).push(r);
  }
  CSS.highlights.set('zukai-cmt', new Highlight(...all));
  CSS.highlights.set('zukai-cmt-on', new Highlight(...on));
}

// 塗られた文字を押したら、そのコメントを開く
document.addEventListener('click', (e) => {
  if (S.route.name !== 'draft') return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  const list = commentsOf().filter((c) => !c.done);
  if (!list.length) return;
  const hit = list.find((c) => { const cr = rangeOf(c); try { return cr && cr.comparePoint(r.startContainer, r.startOffset) === 0; } catch (err) { return false; } });
  if (!hit) {
    // 本文のほかの所を押したら、選んでいたコメントを外す（Googleドキュメントと同じ）
    if (C.active && !C.compose && e.target.closest && !e.target.closest('.cmt-side-col, .cmt-panel, .cmt-chip, .menu-pop')) { C.active = null; rerender(); }
    return;
  }
  reset(S.route.params.d);
  C.open = true; C.hidden = false; C.active = hit.id; C.compose = null;
  rerender();
  requestAnimationFrame(() => { const el = document.querySelector(`.cmt-card[data-cid="${CSS.escape(hit.id)}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); });
});

// 右クリック：選んだ語句・押した図解にコメント（Googleドキュメントのように、右クリックのメニューから）
document.addEventListener('contextmenu', (e) => {
  if (S.route.name !== 'draft' || S.ui.editDiagram) return;
  const t = e.target;
  if (!t.closest || !t.closest('.sheet-edit') || t.closest('input, textarea')) return;
  const ds = window.getSelection();
  const hasSel = !!(ds && ds.rangeCount && !ds.isCollapsed && t.closest('.script-ed, .note-ed'));
  const block = t.closest('[data-pblock]');
  if (!hasSel && !block) return;
  e.preventDefault();
  const copy = () => { try { document.execCommand('copy'); } catch (err) { /* noop */ } };
  openContextMenu(e.clientX, e.clientY, [
    hasSel ? { label: 'コピー', kbd: MOD + 'C', onclick: copy } : null,
    hasSel ? '-' : null,
    hasSel ? { label: 'コメント', kbd: MOD + 'Alt+M', onclick: startComment } : null,
    block ? { label: 'この図解にコメント', onclick: () => commentOnBlock(block.getAttribute('data-pblock')) } : null,
  ].filter(Boolean), rerender);
});

// 文字を選んだら、そのすぐ下にコメントのボタンを出す（Googleドキュメントと同じ）
// 画面全体を描き直さないよう、ボタンは1つだけ作って位置だけ動かす
let floatBtn = null;
function floatingButton() {
  if (floatBtn) return floatBtn;
  floatBtn = document.createElement('button');
  floatBtn.type = 'button';
  floatBtn.className = 'cmt-float';
  floatBtn.title = 'コメントを追加（' + MOD + 'Alt+M）';
  floatBtn.setAttribute('aria-label', 'コメントを追加');
  floatBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H10l-4 3.5V16H4z"/><path d="M12 8v5M9.5 10.5h5"/></svg>';
  floatBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // 選んだ文字が外れないように
  floatBtn.addEventListener('mousedown', (e) => e.preventDefault());
  floatBtn.addEventListener('click', () => { floatBtn.hidden = true; startComment(); });
  floatBtn.hidden = true;
  document.body.appendChild(floatBtn);
  return floatBtn;
}
function placeFloat() {
  const btn = floatingButton();
  const ds = window.getSelection();
  const ok = S.route.name === 'draft' && !S.ui.editDiagram && ds && ds.rangeCount && !ds.isCollapsed && ds.toString().trim();
  const r = ok ? ds.getRangeAt(0) : null;
  const host = r && (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement);
  if (!host || !host.closest || !host.closest('.script-ed, .note-ed')) { btn.hidden = true; return; }
  const rects = r.getClientRects();
  const last = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect();
  if (!last || (!last.width && !last.height)) { btn.hidden = true; return; }
  btn.hidden = false;
  const x = Math.min(window.innerWidth - 48, Math.max(8, last.right - 18));
  const y = Math.min(window.innerHeight - 48, last.bottom + 8);
  btn.style.left = x + 'px';
  btn.style.top = y + 'px';
}
let floatRaf = 0;
const queueFloat = () => { if (!floatRaf) floatRaf = requestAnimationFrame(() => { floatRaf = 0; placeFloat(); }); };
document.addEventListener('selectionchange', queueFloat);
window.addEventListener('scroll', queueFloat, true);
window.addEventListener('resize', queueFloat);
window.addEventListener('hashchange', queueFloat);

// Ctrl+Alt+M（Mac は ⌘+Option+M）でコメント（Googleドキュメントと同じ）
document.addEventListener('keydown', (e) => {
  if (S.route.name !== 'draft' || S.ui.editDiagram) return;
  if ((e.ctrlKey || e.metaKey) && e.altKey && (e.code === 'KeyM' || e.key === 'm' || e.key === 'M')) { e.preventDefault(); startComment(); }
});

// ---------- 画面 ----------
const keep = (e) => e.preventDefault();
const preview = (t, n = 60) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
function quoteOf(c) {
  const at = c.at || {};
  if (at.k === 'block') {
    const b = blockOf(at.b);
    return b ? `図解《${preview(b.cue || 'タイミングなし', 24)}》` : '（削除された図解）';
  }
  return at.q || '';
}
function Avatar(by) {
  const n = (by && by.name) || '?';
  return h('span', { class: 'cmt-av', 'aria-hidden': 'true' }, n.slice(0, 1));
}
function Who(by, ts, edited) {
  return h('div', { class: 'cmt-who' }, Avatar(by),
    h('div', { class: 'cmt-who-text' },
      h('span', { class: 'cmt-name' }, (by && by.name) || '名前なし'),
      h('span', { class: 'cmt-time' }, fmtTime(ts) + (edited ? '（編集済み）' : ''))));
}
function Box(value, onInput, onSubmit, onCancel, placeholder, ok) {
  return h('div', { class: 'cmt-box' },
    h('textarea', {
      rows: 2, value, placeholder,
      oninput: (e) => { onInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; },
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); onSubmit(); } else if (e.key === 'Escape') { e.preventDefault(); onCancel(); } },
    }),
    h('div', { class: 'cmt-box-btns' },
      h('button', { class: 'btn small ghost', onclick: onCancel }, 'キャンセル'),
      h('button', { class: 'btn small primary', onclick: onSubmit }, ok)));
}
function Menu(c, replyId, by, text) {
  if (!mine(by)) return null;
  return h('details', { class: 'kebab cmt-menu' },
    h('summary', { title: 'その他の操作', 'aria-label': 'その他の操作' }, icon('more', 16)),
    h('div', { class: 'menu' },
      h('button', { class: 'linklike', onclick: (e) => { e.target.closest('details').open = false; C.editing = { id: c.id, reply: replyId || null, text }; C.active = c.id; rerender(); focusLater('.cmt-card.on .cmt-edit textarea'); } }, '編集'),
      h('button', { class: 'linklike danger', onclick: (e) => { e.target.closest('details').open = false; remove(c, replyId); } }, '削除')));
}
function Card(c) {
  const on = C.active === c.id;
  const lost = !locate(c);
  const ed = C.editing && C.editing.id === c.id ? C.editing : null;
  const replies = Object.entries(c.replies || {}).map(([id, r]) => ({ id, ...r })).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const body = (by, ts, edited, text, replyId) => h('div', { class: 'cmt-msg' },
    h('div', { class: 'cmt-msg-head' }, Who(by, ts, edited),
      !replyId ? h('button', { class: 'icon-btn cmt-done', title: c.done ? '開き直す' : '解決にする（済んだらチェック）', 'aria-label': c.done ? '開き直す' : '解決にする', onclick: (e) => { e.stopPropagation(); setDone(c, !c.done); } },
        c.done ? icon('undo', 16) : h('svg', { class: 'ico', viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, h('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }))) : null,
      Menu(c, replyId, by, text)),
    ed && (ed.reply || null) === (replyId || null)
      ? h('div', { class: 'cmt-edit' }, Box(ed.text, (v) => { ed.text = v; }, () => saveEdit(c), () => { C.editing = null; rerender(); }, '', '保存'))
      : h('div', { class: 'cmt-text' }, text));
  return h('div', {
    key: c.id, 'data-cid': c.id, class: 'cmt-card' + (on ? ' on' : '') + (c.done ? ' done' : ''),
    onclick: (e) => { if (e.target.closest('button, textarea, details, a')) return; if (!on) goTo(c); },
  },
    h('span', { class: 'cmt-bubble', 'aria-hidden': 'true' }, icon('comment', 13), replies.length ? String(replies.length + 1) : ''),
    h('div', { class: 'cmt-quote' + (lost ? ' lost' : '') }, lost ? '元の文字は削除されたか、書き換えられました：' + preview(quoteOf(c), 40) : preview(quoteOf(c))),
    c.done ? h('div', { class: 'cmt-resolved' }, `${(c.doneBy && c.doneBy.name) || ''}さんが解決にしました`) : null,
    body(c.by, c.ts, c.edited, c.text, null),
    // 選んでいないカードは、返信をたたんで件数だけ出す（場所を取らないように）
    on || !replies.length ? replies.map((r) => h('div', { key: r.id, class: 'cmt-reply' }, body(r.by, r.ts, r.edited, r.text, r.id)))
      : h('div', { class: 'cmt-more' }, `返信 ${replies.length}件`),
    on && !c.done ? h('div', { class: 'cmt-reply-box' },
      Box(C.reply[c.id] || '', (v) => { C.reply[c.id] = v; }, () => reply(c), () => { C.reply[c.id] = ''; C.active = null; rerender(); }, '返信する（Ctrl+Enter で送信）', '返信')) : null);
}

export function CommentsPanel() {
  if (S.route.name !== 'draft') return null;
  reset(S.route.params.d);
  const on = shown();
  const side = on && wide();
  document.body.classList.toggle('cmt-open', on);
  document.body.classList.toggle('cmt-side', side);
  if (!on) return null;
  const all = sorted(commentsOf());
  const list = C.filter === 'open' ? all.filter((c) => !c.done) : all;
  const m = C.compose;
  const head = h('div', { class: 'cmt-head' },
    h('strong', null, 'コメント'),
    h('div', { class: 'seg cmt-seg' },
      h('button', { class: 'seg-btn' + (C.filter === 'open' ? ' on' : ''), onclick: () => { C.filter = 'open'; rerender(); } }, `未解決（${all.filter((c) => !c.done).length}）`),
      h('button', { class: 'seg-btn' + (C.filter === 'all' ? ' on' : ''), onclick: () => { C.filter = 'all'; rerender(); } }, `すべて（${all.length}）`)),
    side ? null : h('button', { class: 'icon-btn', title: '閉じる', 'aria-label': 'コメントを閉じる', onclick: () => toggleComments(false) }, icon('close', 18)));
  const compose = m ? h('div', { key: '__new', 'data-cid': '__new', class: 'cmt-card on cmt-compose' },
    h('div', { class: 'cmt-quote' }, preview(m.at.k === 'block' ? quoteOf({ at: m.at }) : m.at.q)),
    Who(me(), Date.now()),
    Box(m.text, (v) => { m.text = v; }, post, () => { C.compose = null; rerender(); }, 'コメントを書く（Ctrl+Enter で送信）', 'コメント')) : null;
  const empty = !m && !list.length ? h('div', { class: 'cmt-empty muted small' },
    h('p', null, C.filter === 'open' ? '未解決のコメントはありません。' : 'コメントはまだありません。'),
    h('p', null, 'テマ友や図解の文章をなぞって選ぶと出るボタンか、右クリック、', h('kbd', null, 'Ctrl+Alt+M'), ' でコメントできます。')) : null;
  // 広い画面：本文の右の余白。カードの高さは、描いたあとに layoutSide で付けた所にそろえる
  if (side) return h('aside', { class: 'cmt-side-col', 'aria-label': 'コメント' }, head, empty, compose, list.map(Card));
  return h('aside', { class: 'cmt-panel', 'aria-label': 'コメント' }, head,
    h('div', { class: 'cmt-list' }, compose, empty, list.map(Card)),
    h('div', { class: 'cmt-foot' },
      h('button', { class: 'btn small', onpointerdown: keep, onclick: startComment }, icon('comment', 16), '選んだ所にコメント')));
}

// 本文の右のカードを、付けた所の高さに並べる（重なるときは下へずらす。選んでいるカードはちょうどの高さに）
function anchorTop(c) {
  if (!c) return null;
  const r = rangeOf(c);
  const rect = r ? r.getBoundingClientRect() : (targetEl(c) ? targetEl(c).getBoundingClientRect() : null);
  return rect && (rect.width || rect.height) ? rect.top + window.scrollY : null;
}
export function layoutSide() {
  const box = document.querySelector('.cmt-side-col');
  if (!box) return;
  const page = document.querySelector('.draft-page');
  const sheet = document.querySelector('.sheet-edit');
  const top0 = (page ? page.getBoundingClientRect().top : 0) + window.scrollY;
  box.style.top = top0 + 'px';
  const content = sheet || page;
  const right = content ? content.getBoundingClientRect().right : 0;
  const vw = document.documentElement.clientWidth;
  // 本文の幅は変えず、コメントのカードを画面の右端に、付けた所の高さで重ねて出す（本文の右の余白が広ければ余白に）
  box.classList.remove('mini');
  const cw = 270;
  box.style.left = (Math.min(right + 12, vw - cw - 10) + window.scrollX) + 'px';
  box.style.width = cw + 'px';
  const head = box.querySelector('.cmt-head');
  const minY = head ? head.offsetHeight + 12 : 0;
  const fallback = sheet ? sheet.getBoundingClientRect().top + window.scrollY - top0 : minY;
  const byId = new Map(commentsOf().map((c) => [c.id, c]));
  const cards = [...box.querySelectorAll(':scope > .cmt-card, :scope > .cmt-empty')].map((el, i) => {
    const id = el.getAttribute('data-cid');
    const c = id === '__new' ? (C.compose ? { at: C.compose.at } : null) : byId.get(id);
    const y = anchorTop(c);
    return { el, id, i, want: y == null ? null : y - top0, h: el.offsetHeight };
  });
  // 付けた所が見つからないものは、前のカードのすぐあとに
  let last = fallback;
  for (const k of cards) { if (k.want == null) k.want = last; last = k.want; }
  cards.sort((a, b) => a.want - b.want || a.i - b.i);
  const gap = 10;
  let a = cards.findIndex((k) => k.id === (C.compose ? '__new' : C.active));
  if (a < 0) a = 0;
  if (!cards.length) { box.style.height = '0px'; return; }
  const pos = new Array(cards.length);
  pos[a] = Math.max(minY, cards[a].want);
  for (let i = a + 1; i < cards.length; i++) pos[i] = Math.max(cards[i].want, pos[i - 1] + cards[i - 1].h + gap);
  for (let i = a - 1; i >= 0; i--) pos[i] = Math.min(cards[i].want, pos[i + 1] - cards[i].h - gap);
  if (pos[0] < minY) { pos[0] = minY; for (let i = 1; i < cards.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + cards[i - 1].h + gap); }
  cards.forEach((k, i) => { k.el.style.top = pos[i] + 'px'; });
  box.style.height = (pos[cards.length - 1] + cards[cards.length - 1].h + 40) + 'px';
}
let sideRaf = 0;
const queueSide = () => { if (!sideRaf) sideRaf = requestAnimationFrame(() => { sideRaf = 0; layoutSide(); }); };
window.addEventListener('resize', () => { rerender(); queueSide(); });
document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('.cmt-side-col, .sheet-edit')) queueSide(); });

// 図解の見出しの横：その図解（中の文章も含む）の未解決のコメントの数
export function BlockCommentChip(blockId) {
  const list = commentsOf().filter((c) => !c.done && c.at && c.at.b === blockId);
  if (!list.length) return h('span', { class: 'cmt-chip-ph' });
  return h('button', {
    class: 'cmt-chip', title: 'この図解のコメントを見る', 'aria-label': `この図解のコメント ${list.length}件`,
    onclick: (e) => { e.stopPropagation(); reset(S.route.params.d); C.open = true; C.hidden = false; C.compose = null; goTo(sorted(list)[0]); },
  }, icon('comment', 14), String(list.length));
}

// ヘッダーのボタン（未解決の数つき）
export function CommentsButton() {
  const n = openCount();
  return h('button', {
    class: 'btn cmt-btn' + (commentsOpen() ? ' on' : ''), title: 'コメントを見る・書く（Ctrl+Alt+M で選んだ所にコメント）', 'aria-pressed': commentsOpen() ? 'true' : 'false',
    onclick: () => toggleComments(),
  }, icon('comment', 16), 'コメント', n ? h('span', { class: 'cmt-count' }, String(n)) : null);
}
