// 文字の直接編集（Word・Googleドキュメントのように、選んだ文字に色や灰色の塗りを付ける）
//
// データの形：文字列 text と、飾り marks = [{ s, e, k: 'c' | 'bg' | 'b', v }]
//   k='c'  … 文字の色（v = black / blue / pink / red / gray）
//   k='bg' … 背景の塗り（v = gray）
//   k='b'  … 太字（v = 1）
// 画面では contenteditable の要素に1行ずつ <div> で描き、入力のたびに中身を読み直して保存する。
import { h, render } from './vdom.js';

// gray はキャラ名と同じ色（画面とPDFで、キャラ名と同じ色になるよう CSS の --label-gray を使う）
export const TEXT_COLORS = { black: '#000000', blue: '#0000ff', pink: '#ff00ff', red: '#e00000', gray: '#d9d9d9' };
export const BG_COLORS = { gray: '#cccccc' };

// ---------- 飾りの変換 ----------
export function attrsOf(text, marks) {
  const n = (text || '').length;
  const c = new Array(n).fill(null), bg = new Array(n).fill(null), b = new Array(n).fill(null);
  for (const m of marks || []) {
    const arr = m.k === 'bg' ? bg : m.k === 'b' ? b : c;
    for (let i = Math.max(0, m.s); i < Math.min(n, m.e); i++) arr[i] = m.v;
  }
  return { c, bg, b };
}
export function marksOf(c, bg, b) {
  const out = [];
  for (const [k, arr] of [['c', c], ['bg', bg], ['b', b || []]]) {
    let i = 0;
    while (i < arr.length) {
      if (!arr[i]) { i++; continue; }
      let j = i;
      while (j < arr.length && arr[j] === arr[i]) j++;
      out.push({ s: i, e: j, k, v: arr[i] });
      i = j;
    }
  }
  return out;
}
// 区間 [s, e) を、飾りの変わり目で分ける
export function runsOf(s, e, at) {
  const out = [];
  let i = s;
  while (i < e) {
    let j = i + 1;
    const bb = at.b || [];
    while (j < e && at.c[j] === at.c[i] && at.bg[j] === at.bg[i] && (bb[j] || null) === (bb[i] || null)) j++;
    out.push({ s: i, e: j, c: at.c[i] || null, bg: at.bg[i] || null, b: bb[i] || null });
    i = j;
  }
  return out;
}
export function markStyle(c, bg, b) {
  const st = {};
  if (c === 'gray') st.color = 'var(--label-gray, #d9d9d9)';
  else if (c && TEXT_COLORS[c]) st.color = TEXT_COLORS[c];
  if (bg && BG_COLORS[bg]) st.background = BG_COLORS[bg];
  if (b) st.fontWeight = '700';
  return st;
}
// 1つの区間の span（data-* は、打ち直したときに読み直すため）
export function runSpan(text, r, extra = {}) {
  return h('span', { 'data-c': r.c || '', 'data-bg': r.bg || '', 'data-b': r.b || '', style: markStyle(r.c, r.bg, r.b), ...extra }, text.slice(r.s, r.e));
}

// ---------- 画面の中身を読む ----------
const BLOCK = new Set(['DIV', 'P', 'LI']);
function readNodes(root) {
  const chars = [];
  const push = (ch, c, bg, b) => chars.push([ch, c, bg, b]);
  const walk = (node, c, bg, b) => {
    if (node.nodeType === 3) {
      for (const ch of node.data.replace(/​/g, '')) push(ch === ' ' ? ' ' : ch, c, bg, b);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      if (node.dataset && node.dataset.c !== undefined) c = node.dataset.c || null;
      if (node.dataset && node.dataset.bg !== undefined) bg = node.dataset.bg || null;
      if (node.dataset && node.dataset.b !== undefined) b = node.dataset.b || null;
      if (node.tagName === 'BR') {
        // 行の最後の <br> は、空の行を表示するためのもの
        const last = !node.nextSibling && node.parentNode && node.parentNode !== root && BLOCK.has(node.parentNode.tagName);
        if (!last && !(node.dataset && node.dataset.tail)) push('\n', null, null);
        return;
      }
      if (node !== root && BLOCK.has(node.tagName) && chars.length && chars[chars.length - 1][0] !== '\n') push('\n', null, null);
    }
    for (const ch of node.childNodes) walk(ch, c, bg, b);
  };
  walk(root, null, null, null);
  return chars;
}
export function readEditor(el) {
  const chars = readNodes(el);
  return { text: chars.map((x) => x[0]).join(''), c: chars.map((x) => x[1]), bg: chars.map((x) => x[2]), b: chars.map((x) => x[3]) };
}

// 文字の位置（何文字目か）。行（直下の <div>）ごとに数える
function lineGroups(el) {
  const groups = [];
  let cur = null;
  for (const ch of el.childNodes) {
    if (ch.nodeType === 1 && BLOCK.has(ch.tagName)) { groups.push([ch]); cur = null; }
    else { if (!cur) { cur = []; groups.push(cur); } cur.push(ch); }
  }
  return groups;
}
function lenOf(nodes) {
  const div = document.createElement('div');
  for (const n of nodes) div.appendChild(n.cloneNode(true));
  return readNodes(div).length;
}
function offsetAt(el, node, off) {
  const groups = lineGroups(el);
  let topIdx = -1, top = null;
  if (node === el) {
    // 行と行のあいだ
    const target = el.childNodes[off];
    let pos = 0;
    for (const g of groups) {
      if (target && g.includes(target)) return pos;
      pos += lenOf(g) + 1;
    }
    return Math.max(0, pos - 1);
  }
  for (let n = node; n && n !== el; n = n.parentNode) top = n;
  groups.forEach((g, i) => { if (g.includes(top)) topIdx = i; });
  if (topIdx < 0) return 0;
  let pos = 0;
  for (let i = 0; i < topIdx; i++) pos += lenOf(groups[i]) + 1;
  const g = groups[topIdx];
  const r = document.createRange();
  r.setStartBefore(g[0]);
  try { r.setEnd(node, off); } catch (e) { return pos; }
  const div = document.createElement('div');
  div.appendChild(r.cloneContents());
  // 行の <div> の中身だけを数える
  const inner = div.firstChild && div.firstChild.nodeType === 1 && BLOCK.has(div.firstChild.tagName) && div.childNodes.length === 1 ? div.firstChild : div;
  let n = 0;
  const walk = (x) => {
    if (x.nodeType === 3) { n += x.data.replace(/\u200b/g, '').length; return; }
    if (x.nodeType !== 1) return;
    if (x.tagName === 'BR') return;
    for (const c of x.childNodes) walk(c);
  };
  walk(inner);
  return pos + n;
}
export function selectionIn(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const a = offsetAt(el, r.startContainer, r.startOffset);
  const b = r.collapsed ? a : offsetAt(el, r.endContainer, r.endOffset);
  return [Math.min(a, b), Math.max(a, b)];
}
// 何文字目かの場所に、カーソルを置く
export function pointAt(el, target) {
  // 自分で描いた形：行ごとの <div class="rl">。その中の文字を数える
  const lines = [...el.children].filter((x) => x.classList.contains('rl'));
  let pos = 0;
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const len = readNodes(L).length;
    if (target <= pos + len || li === lines.length - 1) {
      let rest = Math.max(0, Math.min(target - pos, len));
      const tw = document.createTreeWalker(L, NodeFilter.SHOW_TEXT);
      let t, lastT = null;
      while ((t = tw.nextNode())) {
        lastT = t;
        if (rest <= t.data.length) return [t, rest];
        rest -= t.data.length;
      }
      return lastT ? [lastT, lastT.data.length] : [L, 0];
    }
    pos += len + 1;
  }
  return [el, 0];
}
export function setSelectionIn(el, a, b = a) {
  const sel = window.getSelection();
  if (!sel) return;
  const [n1, o1] = pointAt(el, a);
  const [n2, o2] = pointAt(el, b);
  const r = document.createRange();
  try { r.setStart(n1, o1); r.setEnd(n2, o2); } catch (e) { return; }
  sel.removeAllRanges();
  sel.addRange(r);
}

// ---------- 編集できる欄 ----------
// opts.lines()   … 1行ずつの vnode（h('div', { class: 'rl …' }, …)）を返す
// opts.onChange(text, c, bg, b) … 書き換わったとき（呼ばれた側で保存し、画面を描き直す）
let lastEditor = null; // 最後に触った欄（ツールバーの色を付ける先）
export function lastRichEditor() { return lastEditor && document.contains(lastEditor) ? lastEditor : null; }

// 描き直す（中身が同じなら何もしない）。打ち込みでブラウザが中身を変えているので、毎回まっさらにしてから描く
function paint(el, force) {
  const o = el._rt;
  if (!force && el._sig === o.sig && o.sig != null) return;
  el._sig = o.sig;
  const focused = document.activeElement === el;
  const sel = el._pendingSel || (focused ? selectionIn(el) : null);
  el._pendingSel = null;
  el.textContent = '';
  el._vkids = [];
  render(el, o.lines());
  if (focused && sel) setSelectionIn(el, sel[0], sel[1]);
}
// 呼び出し側が描き直すまでのあいだ、手元の内容でとりあえず描く
function paintModel(el, text, c, bg, b, sel) {
  el.textContent = '';
  el._vkids = [];
  const at = { c, bg, b };
  let pos = 0;
  render(el, text.split('\n').map((ln) => {
    const st = pos; pos += ln.length + 1;
    const runs = runsOf(st, st + ln.length, at);
    return h('div', { class: 'rl' }, runs.length ? runs.map((r) => runSpan(text, r)) : h('br'));
  }));
  el._sig = null; // 次の描き直しは必ず行う
  el._pendingSel = sel;
  setSelectionIn(el, sel[0], sel[1]);
}

function setup(el) {
  if (el._rtSetup) return;
  el._rtSetup = true;
  el.addEventListener('compositionstart', () => { el._composing = true; });
  el.addEventListener('compositionend', () => { el._composing = false; changed(el); });
  el.addEventListener('input', (e) => { if (el._composing || e.isComposing) return; changed(el); });
  el.addEventListener('focus', () => { lastEditor = el; });
  el.addEventListener('keyup', () => { lastEditor = el; });
  el.addEventListener('mouseup', () => { lastEditor = el; });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      insertPlain(el, '\n');
    }
  });
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    insertPlain(el, t.replace(/\r\n?/g, '\n'));
  });
}
// 選んでいるところを、飾りなしの文字で置きかえる（改行・貼り付け）
function insertPlain(el, str) {
  const sel = selectionIn(el);
  if (!sel) return;
  const m = readEditor(el);
  const [a, b] = sel;
  // 打ち込んだ文字は、直前の文字の色を受け継ぐ（改行は受け継がない）
  const inheritC = str === '\n' ? null : a > 0 ? m.c[a - 1] : null;
  const inheritBg = str === '\n' ? null : a > 0 ? m.bg[a - 1] : null;
  const inheritB = str === '\n' ? null : a > 0 ? m.b[a - 1] : null;
  const text = m.text.slice(0, a) + str + m.text.slice(b);
  const c = [...m.c.slice(0, a), ...Array.from(str, () => inheritC), ...m.c.slice(b)];
  const bg = [...m.bg.slice(0, a), ...Array.from(str, () => inheritBg), ...m.bg.slice(b)];
  const bo = [...m.b.slice(0, a), ...Array.from(str, () => inheritB), ...m.b.slice(b)];
  paintModel(el, text, c, bg, bo, [a + str.length, a + str.length]);
  el._rt.onChange(text, c, bg, bo);
}
function changed(el) {
  const m = readEditor(el);
  el._pendingSel = selectionIn(el);
  el._sig = null;
  el._rt.onChange(m.text, m.c, m.bg, m.b);
}

// 選んだ文字に、色や塗りを付ける（ツールバーから）
export function applyToSelection(el, k, v) {
  const sel = selectionIn(el);
  if (!sel || sel[0] === sel[1]) return false;
  const m = readEditor(el);
  const arr = k === 'bg' ? m.bg : k === 'b' ? m.b : m.c;
  // 太字は切り替え（選んだ文字がすべて太字なら外す）
  if (k === 'b') {
    let all = true;
    for (let i = sel[0]; i < sel[1]; i++) if (m.text[i] !== '\n' && !m.b[i]) all = false;
    v = all ? null : 1;
  }
  for (let i = sel[0]; i < sel[1]; i++) if (m.text[i] !== '\n') arr[i] = v || null;
  el.focus();
  paintModel(el, m.text, m.c, m.bg, m.b, sel);
  el._rt.onChange(m.text, m.c, m.bg, m.b);
  return true;
}

function focusEnd(el) {
  if (!el._rt.autofocus || el._focusedOnce) return;
  el._focusedOnce = true;
  el.focus();
  setSelectionIn(el, readEditor(el).text.length);
}

// opts: { key, cls, autofocus, lines, onChange, placeholder, sig（中身の目印。変わったときだけ描き直す） }
export function RichEdit(opts) {
  return h('div', {
    key: opts.key, class: 'rich ' + (opts.cls || ''), contenteditable: opts.editable === false ? 'false' : 'true', spellcheck: 'false', manual: true,
    'data-placeholder': opts.placeholder || null, 'data-pkey': opts.pkey || null,
    ref: (el) => { el._rt = opts; setup(el); paint(el, true); focusEnd(el); },
    update: (el) => { el._rt = opts; if (!el._composing) paint(el); focusEnd(el); },
  });
}

// 文字列を書き換えたときに、飾りの位置をずらす（前後の同じ部分はそのまま）
export function shiftMarks(oldText, newText, marks) {
  if (!marks || !marks.length || oldText === newText) return marks || [];
  let p = 0;
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++;
  let q = 0;
  while (q < oldText.length - p && q < newText.length - p && oldText[oldText.length - 1 - q] === newText[newText.length - 1 - q]) q++;
  const oldEnd = oldText.length - q, newEnd = newText.length - q, d = newEnd - oldEnd;
  const at = attrsOf(oldText, marks);
  const fill = (arr) => [...arr.slice(0, p), ...new Array(newEnd - p).fill(null), ...arr.slice(oldEnd)];
  void d;
  return marksOf(fill(at.c), fill(at.bg), fill(at.b));
}
