// 同時に開いている人の表示（Googleドキュメントのように）
// works/{w}/presence/{メール} に「いまどこを開いているか」を数秒おきに書き、ほかの人の分を読んで表示する。
// 書き込みは「元に戻す」の履歴に残さない。閲覧者は書き込めないので、表示されない。
import { h } from './vdom.js';
import { db, mode } from './db.js';
import { S, rerender, go } from './state.js';
import { draftName } from './model.js';
import { selectionIn, pointAt } from './richtext.js';

const TTL = 45000; // これより前に更新が止まった人は、もういないとみなす
const BEAT = 15000;
const COLORS = ['#e8710a', '#1a73e8', '#d93025', '#188038', '#a142f4', '#e52592', '#0f9d9d', '#b06000'];

export function colorOf(email) {
  let x = 0;
  for (const c of String(email || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[x % COLORS.length];
}
const docPath = (w, email) => `works/${w}/presence/${String(email).replace(/\//g, '_')}`;
export const presenceCol = (w) => `works/${w}/presence`;

let curW = null;
let me = {};
let timer = null;

function send(leave) {
  if (!curW || !S.user || mode === 'local') return;
  const u = S.user;
  const data = { ...me, email: u.email, name: u.name || u.email, photo: u.photo || '', at: leave ? 0 : Date.now() };
  db.setQuiet(docPath(curW, u.email), data).catch(() => { /* 閲覧者などは書けない */ });
}
function sendSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => send(false), 250);
}

// いまの場所を知らせる（w が変わったら、前のライブラリーからは抜ける）
export function setPresence(w, patch) {
  if (w !== curW) {
    if (curW) { clearTimeout(timer); send(true); }
    curW = w || null;
    me = {};
  }
  if (!curW) return;
  const next = { ...me, ...patch };
  if (JSON.stringify(next) === JSON.stringify(me)) return;
  me = next;
  sendSoon();
}
export function presenceHere() { return me; }

setInterval(() => { if (curW && document.visibilityState !== 'hidden') send(false); }, BEAT);
// 来なくなった人を消すために、ときどき描き直す
setInterval(() => { if ((S.d.presence || []).length) rerender(); }, 10000);
window.addEventListener('pagehide', () => { if (curW) send(true); });
document.addEventListener('visibilitychange', () => { if (curW && document.visibilityState === 'visible') send(false); });

// 稿の画面：いまどのタイミング・どの行にいるか
document.addEventListener('focusin', (e) => {
  if (!curW || S.route.name !== 'draft' || S.ui.editDiagram) return;
  const t = e.target;
  if (!t || !t.closest) return;
  const blk = t.closest('[data-pblock]');
  const row = t.closest('[data-prow]');
  if (blk) setPresence(curW, { block: blk.getAttribute('data-pblock'), row: null });
  else if (row && t.closest('.scol')) setPresence(curW, { block: null, row: Number(row.getAttribute('data-prow')) });
});

// ほかの人（自分以外・いまいる人）
export function others() {
  const now = Date.now();
  const mine = S.user && S.user.email;
  return (S.d.presence || []).filter((p) => p.email && p.email !== mine && now - (p.at || 0) < TTL)
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));
}

export function placeOf(p) {
  const dr = p.d && (S.d.drafts || []).find((x) => x.id === p.d);
  const tr = dr && (S.d.tracks || []).find((t) => t.id === dr.trackId);
  const where = dr ? `${tr ? tr.title + ' ' : ''}${draftName(dr)}` : p.view === 'cast' ? 'メンバー一覧' : p.view === 'people' ? '共有' : 'ライブラリーのページ';
  return p.g ? `${where}の図を編集中` : p.view === 'print' ? `${where}（PDF）` : where;
}

function face(p, cls) {
  const c = p.color || colorOf(p.email);
  return p.photo
    ? h('img', { class: cls, src: p.photo, alt: '', referrerpolicy: 'no-referrer', style: { borderColor: c } })
    : h('span', { class: cls + ' ph', style: { borderColor: c, background: c } }, String(p.name || '?').slice(0, 1));
}

// ヘッダーのアイコン（押すと、その人がいる所へ）
export function PresenceBar() {
  const list = others();
  if (!list.length) return null;
  const w = S.route.params && S.route.params.w;
  return h('div', { class: 'presence-bar' }, list.slice(0, 6).map((p) => h('button', {
    key: p.email, class: 'pres-face', title: `${p.name}：${placeOf(p)}`,
    onclick: () => { if (w && p.d) go(`#/w/${w}/d/${p.d}`); else if (w) go(`#/w/${w}`); },
  }, face(p, 'pav'))), list.length > 6 ? h('span', { class: 'pres-more', title: list.slice(6).map((p) => p.name).join('、') }, `+${list.length - 6}`) : null);
}

// 名前の札
export function NameTag(p, extra) {
  return h('span', { class: 'pres-tag', style: { background: p.color || colorOf(p.email) } }, p.name, extra || '');
}
export function NameTags(list, cls) {
  // 人がいなくても空の枠を置く（前後の要素が作り直されないように）
  return h('div', { class: 'pres-tags ' + (cls || '') + (list.length ? '' : ' empty') }, list.map((p) => h('span', { key: p.email, class: 'pres-tag', style: { background: p.color || colorOf(p.email) } }, p.name)));
}
// 枠の色（いちばん目の人の色）
export const ringStyle = (list) => (list.length ? { boxShadow: `0 0 0 2px ${list[0].color || colorOf(list[0].email)}` } : null);

// ---------- 文字のカーソル（Googleドキュメントのように） ----------
// 送る：いま文字を打っている欄（data-pkey）と、何文字目か
function caretNow() {
  const a = document.activeElement;
  if (!a || !a.closest) return null;
  if ((a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.getAttribute('data-pkey')) {
    return { k: a.getAttribute('data-pkey'), o: a.selectionEnd == null ? 0 : a.selectionEnd };
  }
  const el = a.closest('[data-pkey]');
  if (!el || !el.isContentEditable) return null;
  const r = selectionIn(el);
  if (!r) return null;
  const key = el.getAttribute('data-pkey');
  const m = /^script@(\d+)$/.exec(key);
  return m ? { k: 'script', o: Number(m[1]) + r[1] } : { k: key, o: r[1] };
}
document.addEventListener('selectionchange', () => {
  if (!curW || S.route.name !== 'draft' || S.ui.editDiagram) return;
  const c = caretNow();
  if (c) setPresence(curW, { caret: c });
});

// 描く：ページの上に重ねた層に、ほかの人のカーソルと名前を置く
let layer = null;
function caretRect(p) {
  const c = p.caret;
  if (!c) return null;
  let el, off = c.o;
  if (c.k === 'script') {
    let best = null, bs = -1;
    for (const x of document.querySelectorAll('[data-pkey^="script@"]')) {
      const st = Number(x.getAttribute('data-pkey').slice(7));
      if (st <= c.o && st > bs) { bs = st; best = x; }
    }
    if (!best) return null;
    el = best; off = c.o - bs;
  } else {
    el = document.querySelector(`[data-pkey="${CSS.escape(c.k)}"]`);
  }
  if (!el) return null;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const cs = getComputedStyle(el);
    const cv = caretRect.cv || (caretRect.cv = document.createElement('canvas'));
    const g = cv.getContext('2d');
    g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const r = el.getBoundingClientRect();
    const tw = g.measureText(String(el.value || '').slice(0, off)).width;
    const fs = parseFloat(cs.fontSize) || 14;
    const lh = fs * 1.3;
    const x = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + tw - el.scrollLeft;
    return { x: Math.min(x, r.right - 2), y: r.top + (r.height - lh) / 2, h: lh };
  }
  const [node, o] = pointAt(el, off);
  const range = document.createRange();
  try {
    if (node.nodeType === 3) { range.setStart(node, Math.min(o, node.data.length)); range.collapse(true); }
    else { range.selectNodeContents(node); range.collapse(true); }
  } catch (e) { return null; }
  let r = range.getClientRects()[0] || range.getBoundingClientRect();
  if (!r || (!r.height && !r.width && !r.top)) {
    const host = node.nodeType === 3 ? node.parentElement : node;
    r = host.getBoundingClientRect();
    return { x: r.left, y: r.top, h: Math.max(16, Math.min(r.height, 24)) };
  }
  return { x: r.left, y: r.top, h: r.height || 18 };
}
export function paintCarets() {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'pres-carets';
    document.body.appendChild(layer);
  }
  const d = S.route && S.route.name === 'draft' && !S.ui.editDiagram ? S.route.params.d : null;
  const list = d ? others().filter((p) => p.d === d && !p.g && p.caret) : [];
  const html = [];
  for (const p of list) {
    const r = caretRect(p);
    if (!r) continue;
    const c = colorOf(p.email);
    const x = r.x + window.scrollX, y = r.y + window.scrollY;
    const name = String(p.name || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    html.push(`<div class="pc" style="left:${x}px;top:${y}px;height:${r.h}px;background:${c}"><span class="pc-name" style="background:${c}">${name}</span></div>`);
  }
  const out = html.join('');
  if (layer._last !== out) { layer.innerHTML = out; layer._last = out; }
}
window.addEventListener('resize', () => requestAnimationFrame(paintCarets));
document.addEventListener('scroll', () => requestAnimationFrame(paintCarets), true);
