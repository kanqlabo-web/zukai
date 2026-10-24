// 同時に開いている人の表示（Googleドキュメントのように）
// 「いまどこを開いているか」を数秒おきに書き、ほかの人の分を読んで表示する。
// 書く先は Realtime Database の presence/{作品}_{合言葉}/{uid}。合言葉（works/{w} の presenceKey）は共有されている人しか読めない。
// Realtime Database が使えないとき（設定がない・ルールで断られた・つながらない）は、前と同じ Firestore の works/{w}/presence に書く。
// 書き込みは「元に戻す」の履歴に残さない。
import { h } from './vdom.js';
import { db, mode, newId } from './db.js';
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

let curW = null;
let me = {};
let timer = null;
let room = null;   // いま書いている場所 { rt, key, base, path }
let unwatch = null;
let list = [];     // 読んだ全員の分（画面を移っても消えないよう、S.d とは別に持つ）
let useRT = null;  // Realtime Database を使うか（null：まだ分からない）
let seq = 0;

// いま開いているライブラリーの作品データ（あれば）
const workHere = (w) => (S.route.params && S.route.params.w === w ? S.d.work : null);

async function enterRoom(w) {
  const my = ++seq;
  leaveRoom();
  if (!w || !S.user || mode === 'local') return;
  let r;
  if (useRT !== false && db.room.available()) {
    const work = workHere(w) || await db.getQuiet(`works/${w}`);
    if (my !== seq || !work) return;
    let key = work.presenceKey;
    // 合言葉がまだない作品：編集できる人が作る（閲覧者は、だれかが作るまで待つ）
    if (!key && !(work.viewers || []).includes(S.user.email)) {
      key = newId(20);
      try { await db.updateQuiet(`works/${w}`, { presenceKey: key }); } catch (e) { key = null; }
      if (my !== seq) return;
    }
    if (!key) return;
    r = { rt: true, key, base: `presence/${w}_${key}`, path: `presence/${w}_${key}/${S.user.uid}` };
  } else {
    r = { rt: false, base: `works/${w}/presence`, path: docPath(w, S.user.email) };
  }
  room = r;
  const got = (v) => {
    // マウスの位置が変わっただけなら、画面全体は描き直さず、矢印だけ動かす
    const quiet = sameButPtr(list, v);
    list = v;
    if (quiet) paintPointers(); else rerender();
  };
  unwatch = r.rt ? db.room.watch(r.base, got) : db.watchList(r.base, null, got, () => {});
  send(false);
}
function leaveRoom() {
  myPtr = null;
  if (unwatch) unwatch();
  unwatch = null;
  if (room) send(true);
  room = null;
  if (list.length) { list = []; rerender(); }
}

// Realtime Database に書けなかったら、この先は Firestore を使う
function fallBack(e) {
  if (useRT === false) return;
  console.warn('Realtime Database が使えないため、同時に開いている人の表示は Firestore で行います', e);
  useRT = false;
  enterRoom(curW);
}
function putRT(r, data) {
  const p = db.room.set(r.path, data);
  if (useRT !== null) { p.catch(() => {}); return; }
  const t = setTimeout(() => { if (useRT === null) fallBack('timeout'); }, 10000);
  p.then(() => { clearTimeout(t); if (useRT === null) useRT = true; }, (e) => { clearTimeout(t); fallBack(e); });
}

function send(leave) {
  if (!room || !S.user) return;
  const u = S.user;
  const data = { ...me, email: u.email, name: u.name || u.email, photo: u.photo || '', at: leave ? 0 : Date.now() };
  if (room.rt) {
    if (myPtr) data.ptr = myPtr;
    if (leave) db.room.remove(room.path).catch(() => {});
    else putRT(room, data);
  } else {
    db.setQuiet(room.path, data).catch(() => { /* 閲覧者などは書けない */ });
  }
}
// Realtime Database のときは、続けて動いていても 0.1 秒ごとに送る（Firestore のときは、止まってから 0.25 秒後にまとめて）
let lastSent = 0;
function sendSoon() {
  clearTimeout(timer);
  if (room && room.rt) {
    const wait = Math.max(0, 100 - (Date.now() - lastSent));
    timer = setTimeout(() => { lastSent = Date.now(); send(false); }, wait);
  } else timer = setTimeout(() => send(false), 250);
}

// ---------- マウスの位置（図の編集画面。Realtime Database のときだけ） ----------
// 図の中の座標（舞台 1000×470）で送るので、画面の大きさや拡大率が違っても同じ所を指す
let myPtr = null, ptrTimer = null, ptrSent = 0;
export function sharePointer(g, xy) {
  if (!room || !room.rt) return;
  myPtr = xy ? { g, x: Math.round(xy[0]), y: Math.round(xy[1]) } : null;
  if (ptrTimer) return;
  const wait = Math.max(0, 70 - (Date.now() - ptrSent));
  ptrTimer = setTimeout(() => {
    ptrTimer = null;
    ptrSent = Date.now();
    if (room && room.rt) db.room.patch(room.path, { ptr: myPtr }).catch(() => {});
  }, wait);
}
const noPtr = (a) => JSON.stringify(a.map((p) => ({ ...p, ptr: null })));
const sameButPtr = (a, b) => a.length === b.length && noPtr(a) === noPtr(b);

let ptrLayer = null;
const ARROW = (c) => `<svg width="18" height="20" viewBox="0 0 18 20"><path d="M2 1.5 L2 16 L6 12.3 L8.8 18.5 L11.4 17.3 L8.7 11.3 L14 11 Z" fill="${c}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
export function paintPointers() {
  if (!ptrLayer) {
    ptrLayer = document.createElement('div');
    ptrLayer.className = 'pres-ptrs';
    document.body.appendChild(ptrLayer);
  }
  const g = S.ui.editDiagram;
  const svg = g && document.getElementById('ed-svg');
  const m = svg && svg.getScreenCTM();
  const box = svg && svg.closest('.ed-canvas-wrap');
  const clip = box ? box.getBoundingClientRect() : null;
  const seen = new Set();
  if (m) {
    for (const p of others()) {
      if (!p.ptr || p.ptr.g !== g || p.g !== g) continue;
      const x = m.a * p.ptr.x + m.c * p.ptr.y + m.e, y = m.b * p.ptr.x + m.d * p.ptr.y + m.f;
      const out = clip && (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom);
      let el = ptrLayer.querySelector(`[data-ptr="${CSS.escape(p.email)}"]`);
      if (!el) {
        const c = p.color || colorOf(p.email);
        el = document.createElement('div');
        el.className = 'pp';
        el.setAttribute('data-ptr', p.email);
        const name = document.createElement('span');
        name.className = 'pp-name';
        name.style.background = c;
        name.textContent = p.name || '';
        el.innerHTML = ARROW(c);
        el.appendChild(name);
        ptrLayer.appendChild(el);
      }
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.display = out ? 'none' : '';
      seen.add(p.email);
    }
  }
  for (const el of [...ptrLayer.children]) if (!seen.has(el.getAttribute('data-ptr'))) el.remove();
}
window.addEventListener('resize', () => requestAnimationFrame(paintPointers));
document.addEventListener('scroll', () => requestAnimationFrame(paintPointers), true);

// いまの場所を知らせる（w が変わったら、前のライブラリーからは抜ける）
export function setPresence(w, patch) {
  if (w !== curW) {
    clearTimeout(timer);
    curW = w || null;
    me = {};
    enterRoom(curW);
  }
  if (!curW) return;
  const next = { ...me, ...patch };
  if (JSON.stringify(next) === JSON.stringify(me)) return;
  me = next;
  sendSoon();
}
export function presenceHere() { return me; }

setInterval(() => {
  if (!curW) return;
  // ほかの人が合言葉を作った・変えたときは、そちらに移る
  const wk = workHere(curW);
  if (useRT !== false && wk && wk.presenceKey && (!room || (room.rt && room.key !== wk.presenceKey))) { enterRoom(curW); return; }
  if (document.visibilityState !== 'hidden') send(false);
}, BEAT);
// 来なくなった人を消すために、ときどき描き直す
setInterval(() => { if (list.length) rerender(); }, 10000);
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
  return list.filter((p) => p.email && p.email !== mine && now - (p.at || 0) < TTL)
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
