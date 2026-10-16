// 舞台図エディタ（パソコン・スマホ・タブレット対応、同時編集は図形ごとに反映）
import { h, render } from './vdom.js';
import { db, DEL, newId } from './db.js';
import { S, rerender, toast } from './state.js';
import { P } from './model.js';
import { W, H, stageFrame, shapeNode, sortShapes, moveShape, shapeCenter, simplify, LAYER, layoutLabels, isRegion, isFillable, canName } from './stage.js';
import { fillWeight, pointsFor } from './fill.js';
import { castIndex, personCast, personNo, rolesOf, roleText, roleVisible, roleKey } from './cast.js';
import { isDialogOpen } from './dialog.js';
import { previousShapes, minCostAssign } from './assign.js';

let E = null;
let unsub = null;
let clipboard = [];
let zSeq = 0;
const ZOOMS = [1, 1.5, 2, 3];

export function openEditor(w, id) {
  if (unsub) unsub();
  E = {
    w, id, shapes: {}, loaded: false, tool: 'select', sel: new Set(), temp: {}, drag: null,
    zoom: 1, undo: [], redo: [], personCid: null, personFill: 'white', multi: false, lastTap: null,
    filter: 'all', roleVis: {}, focusText: null, fillCount: '', fillMode: null, hmode: null, inline: null,
  };
  S.ui.editDiagram = id;
  unsub = db.watchDoc(P.doc(w, 'diagrams', id), (g) => {
    if (!E) return;
    if (!g) { toast('この舞台図は削除されました'); closeEditor(); return; }
    E.shapes = g.shapes || {};
    E.roleVis = g.roleVis || {};
    E.loaded = true;
    for (const sid of [...E.sel]) if (!E.shapes[sid]) E.sel.delete(sid);
    draw();
  });
  document.body.classList.add('modal-open');
  window.addEventListener('keydown', onKey);
  rerender();
}

export function closeEditor() {
  if (unsub) unsub();
  unsub = null;
  E = null;
  S.ui.editDiagram = null;
  document.body.classList.remove('modal-open');
  window.removeEventListener('keydown', onKey);
  rerender();
}

let raf = 0;
function draw() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (E) render(document.getElementById('modal'), EditorView());
  });
}

const path = () => P.doc(E.w, 'diagrams', E.id);
const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
const cur = (id) => (id in E.temp ? E.temp[id] : E.shapes[id]);
function merged() {
  const o = { ...E.shapes };
  for (const k in E.temp) { if (E.temp[k] == null) delete o[k]; else o[k] = E.temp[k]; }
  return o;
}
function zFor(t) { return (LAYER[t] || 0) * 1e13 + Date.now() + (zSeq++ % 1000) / 1000; }

async function commit(changes, record = true) {
  const ids = Object.keys(changes);
  if (!ids.length) return;
  const before = {};
  for (const id of ids) before[id] = clone(E.shapes[id]) || null;
  if (record) {
    E.undo.push({ before, after: clone(changes) });
    if (E.undo.length > 150) E.undo.shift();
    E.redo = [];
  }
  const patch = {};
  for (const id of ids) {
    if (changes[id] == null) { delete E.shapes[id]; patch['shapes.' + id] = DEL; E.sel.delete(id); }
    else { E.shapes[id] = changes[id]; patch['shapes.' + id] = changes[id]; }
  }
  E.temp = {};
  draw();
  try { await db.update(path(), patch); } catch (e) { toast('舞台図を保存できませんでした: ' + (e.message || e), 'error', 6000); }
}

function undo() {
  const op = E.undo.pop();
  if (!op) return;
  E.redo.push(op);
  commit(clone(op.before), false);
}
function redo() {
  const op = E.redo.pop();
  if (!op) return;
  E.undo.push(op);
  commit(clone(op.after), false);
}

// ---------- 座標 ----------
function svgEl() { return document.getElementById('ed-svg'); }
function svgPt(e) {
  const svg = svgEl();
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
}
function unitPx() {
  const svg = svgEl();
  return svg ? svg.getBoundingClientRect().width / W : 1;
}
const rot = (x, y, deg) => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};

// ---------- メンバー ----------
function idx() { return castIndex((S.d.work && S.d.work.cast) || []); }
// 舞台に立つメンバー（CD係など記号の人は図解に出さない）
const onStage = (ix) => ix.list.filter((c) => c.id && !c.tag);
// ひとつ前の舞台図での各メンバーの位置
function prevPositions(ix = idx()) {
  const prev = previousShapes(E.id);
  if (!prev) return null;
  const pos = {};
  for (const s of Object.values(prev)) if (s && s.t === 'person') { const c = personCast(s, ix); if (c && c.id) pos[c.id] = [s.x, s.y]; }
  return pos;
}
const FAR = 1500; // 前の図にいない人の移動コスト
function placedCids(shapes, ix = idx()) {
  const set = new Set();
  for (const s of Object.values(shapes)) if (s && s.t === 'person') { const c = personCast(s, ix); if (c && c.id) set.add(c.id); }
  return set;
}
function nextCid(shapes, after) {
  const ix = idx();
  const placed = placedCids(shapes, ix);
  const list = onStage(ix);
  let start = 0;
  if (after) { const i = list.findIndex((c) => c.id === after); if (i >= 0) start = i + 1; }
  for (let k = 0; k < list.length; k++) {
    const c = list[(start + k) % list.length];
    if (!placed.has(c.id) && c.id !== after) return c.id;
  }
  return '';
}
// 人にメンバーを割り当てる（古い番号データは消す）
function withCid(s, cid) {
  const n = { ...s };
  delete n.no;
  if (cid) n.cid = cid; else { delete n.cid; n.no = ''; }
  return n;
}
function findPersonOf(shapes, cid, ix, exceptId) {
  return Object.values(shapes).find((s) => s && s.t === 'person' && s.id !== exceptId && (personCast(s, ix) || {}).id === cid);
}

function placePerson(p) {
  const shapes = merged();
  const ix = idx();
  const cid = E.personCid != null ? E.personCid : nextCid(shapes);
  const x = Math.round(p[0]), y = Math.round(p[1]);
  if (cid) {
    const existing = findPersonOf(shapes, cid, ix);
    if (existing) {
      commit({ [existing.id]: { ...existing, x, y } });
      toast(`${ix.byId[cid].no}（${ix.byId[cid].name}）を移動しました`);
      E.personCid = null;
      return;
    }
  }
  const id = newId(8);
  const s = withCid({ id, t: 'person', x, y, fill: E.personFill, r: 20, z: zFor('person') }, cid);
  commit({ [id]: s });
  const after = { ...shapes, [id]: s };
  E.personCid = cid ? nextCid(after, cid) || '' : '';
  if (E.personCid === '' && cid) toast('メンバー全員を配置しました。次は番号なしの人になります。');
}

function lineUpRest() {
  const shapes = merged();
  const ix = idx();
  const placed = placedCids(shapes, ix);
  const rest = onStage(ix).filter((c) => !placed.has(c.id));
  if (!rest.length) { toast('未配置の人はいません'); return; }
  const changes = {};
  const perRow = 16;
  rest.forEach((c, i) => {
    const id = newId(8);
    changes[id] = { id, t: 'person', cid: c.id, fill: E.personFill, r: 20, z: zFor('person'), x: 130 + (i % perRow) * 49, y: 60 + Math.floor(i / perRow) * 50 };
  });
  commit(changes);
  E.sel = new Set(Object.keys(changes));
  E.tool = 'select';
  toast(`${rest.length}人を並べました。まとめてドラッグで動かせます。`);
}

// 番号を変える。ほかの人と番号がかぶったら、その人と入れ替える
function setPersonNo(one, raw) {
  const val = String(raw || '').trim();
  const ix = idx();
  const base = E.shapes[one.id];
  if (!base) return;
  const oldC = personCast(base, ix);
  if (val === '') { commit({ [one.id]: withCid(base, '') }); return; }
  const c = ix.byNo[val];
  if (!c || !c.id) { toast(`「${val}」はメンバー一覧にない番号です`, 'error'); draw(); return; }
  if (oldC && oldC.id === c.id) return;
  const ch = { [one.id]: withCid(base, c.id) };
  const other = findPersonOf(E.shapes, c.id, ix, one.id);
  if (other) {
    ch[other.id] = withCid(other, oldC ? oldC.id : '');
    toast(`このとき「${c.no} ${c.name}」と「${oldC ? oldC.no + ' ' + oldC.name : '番号なしの人'}」を入れ替えました。`, 'info', 5000);
  }
  commit(ch);
}

// 選んだ図形（囲み・線）を、まだ置いていない人で埋める
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fillRegions(regions) {
  const shapes = merged();
  const ix = idx();
  const placed = placedCids(shapes, ix);
  const restAll = onStage(ix).filter((c) => !placed.has(c.id));
  if (!restAll.length) { toast('まだ置いていない人がいません'); return; }
  const prev = prevPositions(ix);
  const mode = E.fillMode || (prev ? 'stretch' : 'random');
  const want = Math.min(parseInt(E.fillCount, 10) || restAll.length, restAll.length);
  const r = 20;
  // 名前の表示はよけずに、人だけをよけて並べる（名前はあとから空いている所に表示される）
  const occ = Object.values(shapes).filter((s) => s.t === 'person').map((s) => [s.x, s.y]);
  const weights = regions.map((g) => fillWeight(g, r));
  const total = weights.reduce((x, y) => x + y, 0) || 1;
  const raw = weights.map((x) => (x / total) * want);
  const alloc = raw.map(Math.floor);
  let left = want - alloc.reduce((x, y) => x + y, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (left > 0) { alloc[i]++; left--; } });
  const pts = [];
  regions.forEach((g, i) => {
    for (const q of pointsFor(g, alloc[i], r, occ)) { pts.push(q); occ.push(q); }
  });
  if (!pts.length) { toast('人を入れられる図形がありませんでした', 'error'); return; }
  let who;
  if (mode === 'stretch' && prev) {
    // 前の図からの移動がいちばん少なくなるように、場所とメンバーを組み合わせる
    const cost = pts.map(([x, y]) => restAll.map((c) => (prev[c.id] ? Math.hypot(prev[c.id][0] - x, prev[c.id][1] - y) : FAR)));
    who = minCostAssign(cost).map((j) => (j >= 0 ? restAll[j] : null));
  } else {
    const sh = shuffle(restAll.slice());
    who = pts.map((_, i) => sh[i] || null);
  }
  const ch = {};
  let used = 0;
  pts.forEach(([x, y], i) => {
    const c = who[i];
    if (!c) return;
    const id = newId(8);
    ch[id] = { id, t: 'person', cid: c.id, x, y, fill: 'white', r, z: zFor('person') };
    used++;
  });
  commit(ch);
  const how = mode === 'stretch' && prev ? '前の図からの移動が少なくなるように' : 'ランダムに';
  toast(`${used}人を${how}入れました`, 'info', 4000);
}

// ---------- 選んだ人の自動入れ替え ----------
function selectedPersons(ix = idx()) {
  return selectedShapes().filter((s) => s.t === 'person' && personCast(s, ix) && !personCast(s, ix).tag);
}
function reassignStretch() {
  const ix = idx();
  const ps = selectedPersons(ix);
  const prev = prevPositions(ix);
  if (!prev) { toast('ひとつ前の舞台図がないため、最小ストレッチは使えません', 'error'); return; }
  const members = ps.map((s) => personCast(s, ix));
  const cost = ps.map((s) => members.map((c) => (prev[c.id] ? Math.hypot(prev[c.id][0] - s.x, prev[c.id][1] - s.y) : FAR)));
  const res = minCostAssign(cost);
  const ch = {};
  let moved = 0;
  ps.forEach((s, i) => {
    const c = members[res[i]];
    if (c && c.id !== members[i].id) { ch[s.id] = withCid(E.shapes[s.id], c.id); moved++; }
  });
  if (!moved) { toast('すでに移動がいちばん少ない並びです'); return; }
  commit(ch);
  toast(`${moved}人の番号を入れ替えました（前の図からの移動が最も少ない並び）`, 'info', 5000);
}

// 身長順：矢印の向き（低い→高い）に沿って、番号の小さい人から順に並べる
function startHeight() {
  const ix = idx();
  const ps = selectedPersons(ix);
  if (ps.length < 2) return;
  const xs = ps.map((s) => s.x), ys = ps.map((s) => s.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y0 = Math.max(...ys) + 40, y1 = Math.min(...ys) - 40;
  E.hmode = { ids: ps.map((s) => s.id), x1: cx, y1: Math.min(450, y0), x2: cx, y2: Math.max(20, y1) };
  heightPreview();
  draw();
}
function heightPreview() {
  const hm = E.hmode;
  const ix = idx();
  const ps = hm.ids.map((id) => E.shapes[id]).filter(Boolean);
  const dx = hm.x2 - hm.x1, dy = hm.y2 - hm.y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const order = ps.slice().sort((a, b) => {
    const ta = (a.x - hm.x1) * ux + (a.y - hm.y1) * uy, tb = (b.x - hm.x1) * ux + (b.y - hm.y1) * uy;
    if (Math.abs(ta - tb) > 6) return ta - tb;
    return ((a.x - hm.x1) * -uy + (a.y - hm.y1) * ux) - ((b.x - hm.x1) * -uy + (b.y - hm.y1) * ux);
  });
  const members = ps.map((s) => personCast(s, ix)).sort((a, b) => (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0));
  E.temp = {};
  order.forEach((s, i) => { E.temp[s.id] = withCid(s, members[i].id); });
}
function applyHeight() {
  const ch = {};
  for (const id in E.temp) if (E.temp[id] && (E.temp[id].cid !== (E.shapes[id] || {}).cid)) ch[id] = E.temp[id];
  const n = Object.keys(ch).length;
  E.hmode = null;
  E.temp = {};
  if (n) { commit(ch); toast(`${n}人の番号を身長順に入れ替えました`); } else { toast('すでに身長順に並んでいます'); draw(); }
}
function cancelHeight() { E.hmode = null; E.temp = {}; draw(); }

const passes = (s) => !s || E.filter === 'all' || (E.filter === 'cast' ? s.t === 'person' : s.t !== 'person');

// ---------- 操作 ----------
function selectedShapes() { return [...E.sel].map((id) => cur(id)).filter(Boolean); }

function deleteSel() {
  if (!E.sel.size) return;
  const ch = {};
  for (const id of E.sel) ch[id] = null;
  E.sel = new Set();
  commit(ch);
}
function duplicateList(list, dx = 24, dy = 24) {
  const ch = {};
  const ids = [];
  for (const s of list) {
    const id = newId(8);
    ch[id] = { ...moveShape(clone(s), dx, dy), id, z: zFor(s.t) };
    ids.push(id);
  }
  commit(ch);
  E.sel = new Set(ids);
}
function setProps(patch, filter) {
  const ch = {};
  for (const s of selectedShapes()) {
    if (filter && !filter(s)) continue;
    ch[s.id] = { ...s, ...patch };
  }
  commit(ch);
}
function reorder(front) {
  const all = Object.values(E.shapes).map((s) => s.z || 0);
  const ext = front ? Math.max(0, ...all) : Math.min(0, ...all);
  const ch = {};
  let k = 1;
  for (const s of selectedShapes()) ch[s.id] = { ...s, z: front ? ext + k++ : ext - k++ };
  commit(ch);
}
function copySel() {
  clipboard = clone(selectedShapes());
  if (clipboard.length) toast(`${clipboard.length}個をコピーしました（別の図にも貼り付けられます）`);
}
function paste() { if (clipboard.length) duplicateList(clipboard, 20, 20); }

// ---------- ダブルクリックで文字を入れる（パワーポイントの図形のように） ----------
const inlineField = (s) => (s.t === 'text' ? 'text' : s.t === 'person' ? 'label' : 'name');
function startInline(s) {
  if (!s || !(s.t === 'text' || s.t === 'person' || canName(s))) return;
  E.sel = new Set([s.id]);
  E.inline = { id: s.id, value: s[inlineField(s)] || '' };
  draw();
}
function endInline(save) {
  const il = E && E.inline;
  if (!il) return;
  E.inline = null;
  const s = E.shapes[il.id];
  if (save && s) {
    const f = inlineField(s);
    const v = f === 'text' ? il.value : il.value.trim();
    if (v !== (s[f] || '')) {
      const n = { ...s, [f]: v };
      if (f === 'name' && v) n.showName = true;
      commit({ [s.id]: n });
      return;
    }
  }
  draw();
}
function InlineBox() {
  const il = E.inline;
  const s = il && E.shapes[il.id];
  const svg = svgEl();
  if (!s || !svg) return null;
  let [x, y] = shapeCenter(s);
  if (s.t === 'person') x += (s.r || 20) + 40;
  const m = svg.getScreenCTM();
  const pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
  const q = pt.matrixTransform(m);
  const multi = s.t === 'text';
  const ph = s.t === 'person' ? (personCast(s, idx()) ? '書き添える文字' : '役名') : s.t === 'text' ? '文字' : '名前（例：森、台座）';
  const common = {
    key: 'inl-' + il.id, class: 'inline-in', value: il.value, placeholder: ph,
    ref: (el) => { if (el && !el._f) { el._f = 1; setTimeout(() => { el.focus(); el.select(); }, 0); } },
    oninput: (e) => { il.value = e.target.value; },
    onkeydown: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); endInline(false); }
      else if (e.key === 'Enter' && !(multi && e.shiftKey) && !e.isComposing) { e.preventDefault(); endInline(true); }
    },
    onblur: () => endInline(true),
  };
  return h('div', { class: 'inline-box', style: { left: q.x + 'px', top: q.y + 'px' } },
    multi ? h('textarea', { ...common, rows: 2 }) : h('input', common),
    h('div', { class: 'inline-hint' }, multi ? 'Enterで決定（Shift+Enterで改行）' : 'Enterで決定 / Escでやめる'));
}

function onKey(e) {
  if (!E || isDialogOpen()) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateList(selectedShapes()); return; }
  if (mod && e.key.toLowerCase() === 'c') { copySel(); return; }
  if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); return; }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); E.sel = new Set(Object.values(E.shapes).filter(passes).map((x) => x.id)); draw(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
  if (E.hmode) { if (e.key === 'Escape') cancelHeight(); if (e.key === 'Enter') applyHeight(); return; }
  if (e.key === 'Escape') { if (E.drag) { E.drag = null; E.temp = {}; } else E.sel = new Set(); draw(); return; }
  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (nudge && E.sel.size) {
    e.preventDefault();
    const k = e.shiftKey ? 10 : 2;
    const ch = {};
    for (const s of selectedShapes()) ch[s.id] = moveShape(s, nudge[0] * k, nudge[1] * k);
    commit(ch);
  }
}

// ---------- ポインタ ----------
function down(e) {
  if (!E || !E.loaded || E.tool === 'pan') return;
  if (e.button != null && e.button > 0) return;
  if (E.inline) { e.preventDefault(); endInline(true); return; }
  e.preventDefault();
  const svg = svgEl();
  try { svg.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  const p = svgPt(e);
  const hEl = e.target.closest('[data-h]');
  if (E.hmode) {
    if (hEl && hEl.getAttribute('data-h').startsWith('hp')) E.drag = { type: 'harrow', kind: hEl.getAttribute('data-h') };
    return;
  }
  if (hEl) {
    const [kind, id] = hEl.getAttribute('data-h').split(':');
    E.drag = { type: 'handle', kind, id, p0: p, orig: clone(cur(id)) };
    return;
  }
  const sEl = e.target.closest('[data-id]');
  let id = sEl && sEl.getAttribute('data-id');
  if (id && E.tool === 'select' && !passes(cur(id))) id = null;
  const additive = e.shiftKey || e.metaKey || e.ctrlKey || E.multi;
  const t = E.tool;
  if (t === 'select') {
    if (id) {
      if (additive && E.sel.has(id)) { E.sel.delete(id); draw(); return; }
      const wasOnly = E.sel.size > 1 && E.sel.has(id) && !additive;
      if (additive) E.sel.add(id);
      else if (!E.sel.has(id)) E.sel = new Set([id]);
      E.drag = { type: 'move', p0: p, ids: [...E.sel], orig: Object.fromEntries([...E.sel].map((i) => [i, clone(cur(i))])), moved: false, tapId: id, wasOnly };
    } else {
      if (!additive) E.sel = new Set();
      E.drag = { type: 'marquee', p0: p, p1: p, base: new Set(E.sel) };
    }
  } else if (t === 'person') {
    placePerson(p);
  } else if (t === 'ellipse' || t === 'rect') {
    const nid = newId(8);
    E.temp[nid] = t === 'ellipse'
      ? { id: nid, t, x: p[0], y: p[1], rx: 4, ry: 4, rot: 0, z: zFor(t) }
      : { id: nid, t, x: p[0], y: p[1], w: 8, h: 8, rot: 0, round: true, z: zFor(t) };
    E.drag = { type: 'create', id: nid, p0: p };
  } else if (t === 'arrow' || t === 'block') {
    const nid = newId(8);
    E.temp[nid] = { id: nid, t: 'arrow', style: t === 'block' ? 'block' : 'line', head: 'end', x1: p[0], y1: p[1], x2: p[0], y2: p[1], z: zFor('arrow') };
    E.drag = { type: 'create', id: nid, p0: p };
  } else if (t === 'line' || t === 'curve') {
    const nid = newId(8);
    E.temp[nid] = { id: nid, t: 'line', mode: t === 'curve' ? 'curve' : 'straight', pts: [p, p], z: zFor('line') };
    E.drag = { type: 'create', id: nid, p0: p };
  } else if (t === 'freeline') {
    const nid = newId(8);
    E.drag = { type: 'freeline', id: nid, pts: [p] };
    E.temp[nid] = { id: nid, t: 'line', mode: 'free', pts: [p, p], z: zFor('line') };
  } else if (t === 'blob') {
    const nid = newId(8);
    E.drag = { type: 'blob', id: nid, pts: [p] };
    E.temp[nid] = { id: nid, t: 'blob', pts: [p, p], z: zFor('blob') };
  } else if (t === 'text') {
    const nid = newId(8);
    commit({ [nid]: { id: nid, t: 'text', x: Math.round(p[0]), y: Math.round(p[1]), text: '文字', size: 24, z: zFor('text') } });
    E.sel = new Set([nid]);
    E.tool = 'select';
    E.focusText = nid;
  }
  draw();
}

function move(e) {
  if (!E || !E.drag) return;
  const p = svgPt(e);
  const d = E.drag;
  if (d.type === 'harrow') {
    if (d.kind === 'hp1') { E.hmode.x1 = p[0]; E.hmode.y1 = p[1]; } else { E.hmode.x2 = p[0]; E.hmode.y2 = p[1]; }
    heightPreview();
  } else if (d.type === 'move') {
    const dx = p[0] - d.p0[0], dy = p[1] - d.p0[1];
    if (!d.moved && Math.hypot(dx, dy) * unitPx() < 4) return;
    d.moved = true;
    for (const id of d.ids) if (d.orig[id]) E.temp[id] = moveShape(d.orig[id], Math.round(dx), Math.round(dy));
  } else if (d.type === 'marquee') {
    d.p1 = p;
    const [x0, x1] = [Math.min(d.p0[0], p[0]), Math.max(d.p0[0], p[0])];
    const [y0, y1] = [Math.min(d.p0[1], p[1]), Math.max(d.p0[1], p[1])];
    const sel = new Set(d.base);
    for (const s of Object.values(E.shapes)) {
      if (!passes(s)) continue;
      const [cx, cy] = shapeCenter(s);
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) sel.add(s.id);
    }
    E.sel = sel;
  } else if (d.type === 'create') {
    const s = E.temp[d.id];
    if (s.t === 'arrow') { s.x2 = p[0]; s.y2 = p[1]; }
    else if (s.t === 'line') s.pts = [d.p0, p];
    else {
      s.x = (d.p0[0] + p[0]) / 2; s.y = (d.p0[1] + p[1]) / 2;
      if (s.t === 'ellipse') { s.rx = Math.max(4, Math.abs(p[0] - d.p0[0]) / 2); s.ry = Math.max(4, Math.abs(p[1] - d.p0[1]) / 2); }
      else { s.w = Math.max(8, Math.abs(p[0] - d.p0[0])); s.h = Math.max(8, Math.abs(p[1] - d.p0[1])); }
    }
  } else if (d.type === 'blob' || d.type === 'freeline') {
    d.pts.push(p);
    E.temp[d.id] = { ...E.temp[d.id], pts: simplify(d.pts, 6) };
  } else if (d.type === 'handle') {
    const o = d.orig;
    const s = { ...o };
    if (d.kind.startsWith('pt')) {
      const i = +d.kind.slice(2);
      const P2 = [Math.round(p[0]), Math.round(p[1])];
      s.pts = o.pts.map((q) => q.slice());
      // 曲線の端を動かしたら、その側の調整点も一緒に動かす
      if (o.mode === 'curve' && (i === 0 || i === 3)) {
        const c = i === 0 ? 1 : 2;
        s.pts[c] = [o.pts[c][0] + P2[0] - o.pts[i][0], o.pts[c][1] + P2[1] - o.pts[i][1]];
      }
      s.pts[i] = P2;
    } else if (d.kind === 'p1') { s.x1 = Math.round(p[0]); s.y1 = Math.round(p[1]); }
    else if (d.kind === 'p2') { s.x2 = Math.round(p[0]); s.y2 = Math.round(p[1]); }
    else if (d.kind === 'rotate') {
      let a = (Math.atan2(p[1] - o.y, p[0] - o.x) * 180) / Math.PI + 90;
      a = ((a % 360) + 360) % 360;
      const snap = Math.round(a / 15) * 15;
      if (Math.abs(snap - a) < 5) a = snap;
      s.rot = Math.round(a % 360);
    } else if (d.kind === 'resize') {
      const [lx, ly] = rot(p[0] - o.x, p[1] - o.y, -(o.rot || 0));
      if (o.t === 'ellipse') { s.rx = Math.round(Math.max(8, Math.abs(lx))); s.ry = Math.round(Math.max(8, Math.abs(ly))); }
      else if (o.t === 'rect') { s.w = Math.round(Math.max(16, Math.abs(lx) * 2)); s.h = Math.round(Math.max(16, Math.abs(ly) * 2)); }
      else if (o.t === 'person') { s.r = Math.round(Math.max(10, Math.min(48, Math.hypot(lx, ly) / Math.SQRT2))); }
      else if (o.t === 'blob' || o.t === 'line') {
        const [cx, cy] = shapeCenter(o);
        const d0 = Math.hypot(d.p0[0] - cx, d.p0[1] - cy) || 1;
        const k = Math.max(0.2, Math.hypot(p[0] - cx, p[1] - cy) / d0);
        s.pts = o.pts.map((q) => [Math.round(cx + (q[0] - cx) * k), Math.round(cy + (q[1] - cy) * k)]);
      }
    }
    E.temp[d.id] = s;
  }
  draw();
}

function up() {
  if (!E || !E.drag) return;
  const d = E.drag;
  E.drag = null;
  if (d.type === 'harrow') { draw(); return; }
  if (d.type === 'move') {
    if (d.moved) {
      const ch = {};
      for (const id of d.ids) if (E.temp[id]) ch[id] = E.temp[id];
      commit(ch);
    } else {
      if (d.wasOnly) E.sel = new Set([d.tapId]);
      const now = Date.now();
      const s = cur(d.tapId);
      if (E.lastTap && E.lastTap.id === d.tapId && now - E.lastTap.t < 450 && s) { E.lastTap = null; startInline(s); }
      else E.lastTap = { id: d.tapId, t: now };
      E.temp = {};
    }
  } else if (d.type === 'create') {
    const s = { ...E.temp[d.id] };
    if (s.t === 'line') {
      let [a, b] = s.pts;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 20) b = [a[0] + 200, a[1]];
      a = a.map(Math.round); b = b.map(Math.round);
      s.pts = s.mode === 'curve' ? curveFrom(a, b) : [a, b];
    } else if (s.t === 'arrow') {
      if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 20) { s.x2 = s.x1 + 160; s.y2 = s.y1; }
      for (const k of ['x1', 'y1', 'x2', 'y2']) s[k] = Math.round(s[k]);
    } else if (s.t === 'ellipse') {
      if (s.rx < 14 && s.ry < 14) { s.rx = 110; s.ry = 60; }
      s.x = Math.round(s.x); s.y = Math.round(s.y); s.rx = Math.round(s.rx); s.ry = Math.round(s.ry);
    } else {
      if (s.w < 28 && s.h < 28) { s.w = 180; s.h = 90; }
      s.x = Math.round(s.x); s.y = Math.round(s.y); s.w = Math.round(s.w); s.h = Math.round(s.h);
    }
    commit({ [d.id]: s });
    E.sel = new Set([d.id]);
    E.tool = 'select';
  } else if (d.type === 'freeline') {
    const pts = simplify(d.pts, 14).map((q) => [Math.round(q[0]), Math.round(q[1])]);
    const last = d.pts[d.pts.length - 1];
    if (pts.length && Math.hypot(last[0] - pts[pts.length - 1][0], last[1] - pts[pts.length - 1][1]) > 4) pts.push([Math.round(last[0]), Math.round(last[1])]);
    if (pts.length < 2) { E.temp = {}; }
    else {
      commit({ [d.id]: { id: d.id, t: 'line', mode: 'free', pts, z: E.temp[d.id].z } });
      E.sel = new Set([d.id]);
      E.tool = 'select';
    }
  } else if (d.type === 'blob') {
    const pts = simplify(d.pts, 16).map((q) => [Math.round(q[0]), Math.round(q[1])]);
    if (pts.length < 3) { E.temp = {}; }
    else {
      commit({ [d.id]: { id: d.id, t: 'blob', pts, z: E.temp[d.id].z } });
      E.sel = new Set([d.id]);
      E.tool = 'select';
    }
  } else if (d.type === 'handle') {
    if (E.temp[d.id]) commit({ [d.id]: E.temp[d.id] });
  } else {
    E.temp = {};
  }
  draw();
}

// 直線の両端から、ゆるく曲がった曲線を作る
function curveFrom(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L, k = L * 0.3;
  return [a, [Math.round(a[0] + dx / 3 + nx * k), Math.round(a[1] + dy / 3 + ny * k)],
    [Math.round(a[0] + (dx * 2) / 3 + nx * k), Math.round(a[1] + (dy * 2) / 3 + ny * k)], b];
}
function setLineMode(s, mode) {
  const a = s.pts[0], b = s.pts[s.pts.length - 1];
  commit({ [s.id]: { ...s, mode, pts: mode === 'curve' ? curveFrom(a, b) : [a, b] } });
}

// ---------- 描画 ----------
function handlesFor(s, upx) {
  const r = Math.max(7, Math.min(30, 9 / upx));
  const hs = [];
  const H1 = (kind, x, y, cls = '') => h('circle', { key: kind, 'data-h': `${kind}:${s.id}`, cx: x, cy: y, r, class: 'handle ' + cls, 'stroke-width': 2 / upx });
  const local = (x, y) => { const [a, b] = rot(x, y, s.rot || 0); return [s.x + a, s.y + b]; };
  if (s.t === 'ellipse' || s.t === 'rect') {
    const hw = s.t === 'ellipse' ? s.rx : s.w / 2, hh = s.t === 'ellipse' ? s.ry : s.h / 2;
    const [rx, ry] = local(hw, hh);
    const [ox, oy] = local(0, -hh - 18 / upx - 10);
    const [tx, ty] = local(0, -hh);
    hs.push(h('line', { key: 'rl', x1: tx, y1: ty, x2: ox, y2: oy, class: 'handle-line', 'stroke-width': 1.5 / upx }));
    hs.push(H1('resize', rx, ry));
    hs.push(H1('rotate', ox, oy, 'rot'));
  } else if (s.t === 'text') {
    const lines = String(s.text || '').split('\n').length;
    const [ox, oy] = local(0, -(lines * (s.size || 24) * 0.65) - 18 / upx - 8);
    hs.push(H1('rotate', ox, oy, 'rot'));
  } else if (s.t === 'arrow') {
    hs.push(H1('p1', s.x1, s.y1));
    hs.push(H1('p2', s.x2, s.y2));
  } else if (s.t === 'person') {
    const rr = (s.r || 20) + 4;
    hs.push(H1('resize', s.x + rr * 0.72, s.y + rr * 0.72));
  } else if (s.t === 'line' && s.mode !== 'free') {
    const p = s.pts;
    if (s.mode === 'curve' && p.length === 4) {
      hs.push(h('line', { key: 'g1', x1: p[0][0], y1: p[0][1], x2: p[1][0], y2: p[1][1], class: 'handle-line', 'stroke-width': 1.5 / upx }));
      hs.push(h('line', { key: 'g2', x1: p[3][0], y1: p[3][1], x2: p[2][0], y2: p[2][1], class: 'handle-line', 'stroke-width': 1.5 / upx }));
      hs.push(H1('pt1', p[1][0], p[1][1], 'rot'));
      hs.push(H1('pt2', p[2][0], p[2][1], 'rot'));
    }
    hs.push(H1('pt0', p[0][0], p[0][1]));
    hs.push(H1('pt' + (p.length - 1), p[p.length - 1][0], p[p.length - 1][1]));
  } else if (s.t === 'blob' || s.t === 'line') {
    let mx = -Infinity, my = -Infinity;
    for (const q of s.pts) { if (q[0] + q[1] > mx + my) { mx = q[0]; my = q[1]; } }
    hs.push(H1('resize', mx, my));
  }
  return hs;
}

const ICONS = {
  select: () => h('path', { d: 'M6 3l0 16 4.2-4.1 2.9 6.3 2.4-1.1-2.9-6.2 5.9 0z', fill: 'currentColor' }),
  pan: () => h('path', { d: 'M12 2l3 3h-2v5h5V8l3 3-3 3v-2h-5v5h2l-3 3-3-3h2v-5H6v2l-3-3 3-3v2h5V5H9z', fill: 'currentColor' }),
  person: () => [h('circle', { cx: 12, cy: 12, r: 8.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }), h('text', { x: 12, y: 16, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#e60012' }, '1')],
  ellipse: () => h('ellipse', { cx: 12, cy: 12, rx: 9.5, ry: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
  rect: () => h('rect', { x: 3, y: 6, width: 18, height: 12, rx: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
  blob: () => h('path', { d: 'M4 13c0-5 5-8 9-6s7 1 7 5-4 3-6 5-10 2-10-4z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
  arrow: () => [h('line', { x1: 3, y1: 17, x2: 18, y2: 7, stroke: 'currentColor', 'stroke-width': 2 }), h('path', { d: 'M21 5l-7.5 0.6 4.4 5.6z', fill: 'currentColor' })],
  block: () => h('path', { d: 'M2 9h11V5l8 7-8 7v-4H2z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
  line: () => h('line', { x1: 3, y1: 19, x2: 21, y2: 5, stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
  curve: () => [h('path', { d: 'M3 19C6 5 16 21 21 5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' })],
  freeline: () => h('path', { d: 'M3 15c3-6 5 4 8-2s4-6 6-2 3 3 4 0', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
  text: () => h('text', { x: 12, y: 17.5, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: 'currentColor' }, 'あ'),
};
const TOOLS = [
  ['select', '選択'], ['person', '人'], ['ellipse', '楕円'], ['rect', '四角'], ['blob', '手書き囲み'],
  ['line', '直線'], ['curve', '曲線'], ['freeline', '手書き線'], ['arrow', '矢印'], ['block', '太矢印'], ['text', '文字'], ['pan', 'スクロール'],
];
const HINTS = {
  select: '図形をドラッグで移動。空いている所をドラッグすると範囲選択。図形や人をダブルクリック（ダブルタップ）すると名前や役名を書けます。',
  person: '舞台をタップすると、右の一覧で選んだ番号の人を置きます。続けてタップすると次の番号になります。',
  ellipse: 'ドラッグして楕円を描きます（タップだけなら標準の大きさ）。',
  rect: 'ドラッグして四角を描きます。あとで回転もできます。',
  blob: '指やマウスで囲みたい形をなぞってください。自動で閉じた線になります。',
  line: '始点から終点へドラッグして直線を引きます。',
  curve: '始点から終点へドラッグすると曲線になります。四角い調整点を動かすと曲がり方を変えられます。',
  freeline: '指やマウスでなぞった形の線を引きます（閉じません）。',
  arrow: '始点から終点へドラッグします。',
  block: '始点から終点へドラッグすると白抜きの太い矢印になります。',
  text: '文字を置きたい場所をタップし、右の欄で文字を入力します。',
  pan: '拡大中に図を指で動かして見たい所へ移動できます。',
};

function Seg(options, value, onPick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', {
    key: String(v), class: 'seg-btn' + (value === v ? ' on' : ''), onclick: () => onPick(v),
  }, label)));
}

function RulesNote() {
  const rules = S.d.work && S.d.work.labelRules;
  if (!rules) return null;
  return h('details', { class: 'rules' }, h('summary', null, '図解での表記のルール'), h('div', { class: 'rules-body small' }, rules));
}

function PersonPanel(shapes) {
  const ix = idx();
  const placed = placedCids(shapes, ix);
  const nextUp = E.personCid != null ? E.personCid : nextCid(shapes);
  const nm = nextUp ? ix.byId[nextUp] : null;
  return h('div', null,
    h('div', { class: 'panel-title' }, '次に置く：', h('b', null, nm ? nm.no : '番号なし'), nm ? ` ${nm.name}` : ''),
    h('div', { class: 'prop' }, h('span', null, '塗り'), Seg([['white', '白'], ['gray', '灰'], ['black', '黒']], E.personFill, (v) => { E.personFill = v; draw(); })),
    onStage(ix).length ? h('div', { class: 'chips' }, onStage(ix).map((m) => h('button', {
      key: 'c' + m.id, class: 'chip' + (placed.has(m.id) ? ' placed' : '') + (m.id === nextUp ? ' next' : ''),
      title: roleText(m) + (placed.has(m.id) ? '（配置済み：タップした場所へ移動します）' : ''), onclick: () => { E.personCid = m.id; draw(); },
    }, h('b', null, m.no), ' ', m.name, rolesOf(m).some((r) => r.label) ? h('small', null, ' ' + rolesOf(m).map((r) => r.label).filter(Boolean).join('・')) : null))) : h('p', { class: 'muted small' }, 'メンバー一覧が空です。作品ページの「メンバー一覧」で入力すると番号を選べます。'),
    h('p', { class: 'muted small' }, '線を引いた名前は配置済みです。選んでタップすると、その人をタップした場所へ動かします。'),
    h('div', { class: 'panel-actions' },
      h('button', { class: 'btn tiny', onclick: () => { E.personCid = ''; draw(); } }, '番号なしの人'),
      h('button', { class: 'btn tiny', onclick: lineUpRest }, '未配置の全員を並べる')),
    RulesNote());
}

function FilterBar() {
  return h('div', { class: 'prop filter-bar' }, h('span', null, '選べるもの'),
    Seg([['all', 'すべて'], ['shapes', '図形'], ['cast', 'メンバー']], E.filter, (v) => {
      E.filter = v;
      E.sel = new Set([...E.sel].filter((id) => passes(E.shapes[id])));
      draw();
    }));
}

function HeightArrow(upx) {
  const hm = E.hmode;
  const r = Math.max(9, Math.min(30, 12 / upx));
  const L = Math.hypot(hm.x2 - hm.x1, hm.y2 - hm.y1) || 1;
  const ux = (hm.x2 - hm.x1) / L, uy = (hm.y2 - hm.y1) / L;
  const hs = 34;
  const bx = hm.x2 - ux * hs, by = hm.y2 - uy * hs;
  const head = `${hm.x2},${hm.y2} ${bx - uy * 18},${by + ux * 18} ${bx + uy * 18},${by - ux * 18}`;
  return h('g', { class: 'harrow' },
    h('line', { x1: hm.x1, y1: hm.y1, x2: bx, y2: by, stroke: '#2563eb', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.85, 'pointer-events': 'none' }),
    h('polygon', { points: head, fill: '#2563eb', opacity: 0.85, 'pointer-events': 'none' }),
    h('circle', { 'data-h': 'hp1', cx: hm.x1, cy: hm.y1, r, class: 'handle', 'stroke-width': 2 / upx }),
    h('circle', { 'data-h': 'hp2', cx: hm.x2, cy: hm.y2, r, class: 'handle', 'stroke-width': 2 / upx }),
    h('text', { x: hm.x1 - ux * (r + 16), y: hm.y1 - uy * (r + 16), 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#2563eb', 'font-size': 22, 'font-weight': 700, 'pointer-events': 'none' }, '低'),
    h('text', { x: hm.x2 + ux * (r + 16), y: hm.y2 + uy * (r + 16), 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#2563eb', 'font-size': 22, 'font-weight': 700, 'pointer-events': 'none' }, '高'));
}

function HeightPanel() {
  return h('div', null,
    h('div', { class: 'panel-title' }, '身長順に入れ替え'),
    h('p', { class: 'small' }, '青い矢印の両端（○）をドラッグして向きを決めてください。矢印の根元「低」から先「高」に向かって、番号の小さい人（身長の低い人）から順に並びます。'),
    h('p', { class: 'muted small' }, `対象：${E.hmode.ids.length}人。立ち位置は変わらず、番号だけが入れ替わります。`),
    h('div', { class: 'panel-actions' },
      h('button', { class: 'btn small primary', onclick: applyHeight }, 'この並びで決定'),
      h('button', { class: 'btn small', onclick: cancelHeight }, 'やめる')));
}

function setRoleVis(cid, i, v) {
  const key = roleKey(cid, i);
  E.roleVis = { ...E.roleVis, [key]: v };
  db.update(path(), { ['roleVis.' + key]: v });
  draw();
}

// 役ごとに、舞台図へ役名（図解での表記）を出すかどうか
function RoleToggles(members, title) {
  const rows = [];
  for (const m of members) {
    rolesOf(m).forEach((r, i) => {
      if (!r.label) return;
      const on = roleVisible(E.roleVis, m.id, i);
      rows.push(h('div', { key: m.id + i, class: 'role-row' },
        h('span', { class: 'role-name' }, members.length > 1 ? h('b', null, m.no + ' ') : null, r.name || '（役名なし）', h('small', null, '　' + r.label)),
        Seg([[true, '表示'], [false, '隠す']], on, (v) => setRoleVis(m.id, i, v))));
    });
  }
  if (!rows.length) {
    return members.length === 1 ? h('p', { class: 'muted small' }, '役名を出すには、メンバー一覧で「図解での表記」を入力してください。') : null;
  }
  return h('div', { class: 'role-box' }, h('div', { class: 'role-box-title' }, title || '役名の表示'), rows);
}

function AllRoles() {
  const ix = idx();
  const ids = placedCids(E.shapes, ix);
  const members = onStage(ix).filter((c) => ids.has(c.id) && rolesOf(c).some((r) => r.label));
  if (!members.length) return null;
  return h('details', { class: 'role-all' },
    h('summary', null, `役名の表示（${members.length}人）`),
    RoleToggles(members, ' '));
}

function SelPanel() {
  const list = selectedShapes();
  if (!list.length) {
    return h('div', null,
      E.tool === 'select' ? FilterBar() : null,
      h('p', { class: 'muted small' }, HINTS[E.tool]),
      h('ul', { class: 'tips small muted' },
        h('li', null, '複数を選ぶ：空いている所をドラッグ、または「複数選択」をオン'),
        h('li', null, 'パソコン：Ctrl+Z 元に戻す / Ctrl+D 複製 / Delete 削除 / 矢印キー 微調整')),
      AllRoles(),
      h('div', { class: 'panel-actions' },
        Object.keys(E.shapes).length ? h('button', { class: 'btn tiny', onclick: () => { E.sel = new Set(Object.values(E.shapes).filter(passes).map((x) => x.id)); draw(); } }, E.filter === 'cast' ? 'メンバーをすべて選択' : E.filter === 'shapes' ? '図形をすべて選択' : 'すべて選択') : null,
        clipboard.length ? h('button', { class: 'btn tiny', onclick: paste }, `貼り付け（${clipboard.length}個）`) : null));
  }
  const one = list.length === 1 ? list[0] : null;
  const persons = list.filter((s) => s.t === 'person');
  const regions = list.filter(isRegion);
  const fillables = list.filter(isFillable);
  const parts = [];
  parts.push(FilterBar());
  parts.push(h('div', { class: 'panel-title' }, one ? ({ person: '人', ellipse: '楕円', rect: '四角', blob: '囲み', line: '線', arrow: '矢印', text: '文字' })[one.t] : `${list.length}個を選択中`));
  if (one && one.t === 'person') {
    const ix = idx();
    const m = personCast(one, ix);
    parts.push(h('label', { class: 'prop' }, h('span', null, '番号'),
      h('input', {
        key: 'no-' + one.id + '-' + personNo(one, ix), value: personNo(one, ix), class: 'num-in', inputmode: 'numeric',
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
        onchange: (e) => setPersonNo(one, e.target.value),
      }),
      m ? h('span', { class: 'small' }, `${m.name}${roleText(m) ? '（' + roleText(m) + '）' : ''}`) : h('span', { class: 'muted small' }, '番号なし')));
    parts.push(h('p', { class: 'muted small tight' }, 'ほかの人と同じ番号にすると、2人の番号を入れ替えます。'));
    parts.push(h('label', { class: 'prop' }, h('span', null, m ? '書き添え' : '役名'),
      h('input', {
        key: 'lb-' + one.id, value: one.label || '', placeholder: m ? '役名の横に足す文字' : '例：村人、兵士', class: 'grow',
        oninput: (e) => { E.temp[one.id] = { ...one, label: e.target.value }; draw(); },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
        onchange: (e) => commit({ [one.id]: { ...E.shapes[one.id], label: e.target.value.trim() } }),
      })));
  }
  if (persons.length) {
    const f = persons.every((s) => s.fill === persons[0].fill) ? persons[0].fill : null;
    parts.push(h('div', { class: 'prop' }, h('span', null, '塗り'), Seg([['white', '白'], ['gray', '灰'], ['black', '黒']], f || 'white', (v) => setProps({ fill: v }, (s) => s.t === 'person'))));
    const r = persons.every((s) => (s.r || 20) === (persons[0].r || 20)) ? persons[0].r || 20 : null;
    parts.push(h('div', { class: 'prop' }, h('span', null, '大きさ'), Seg([[15, '小'], [20, '中'], [27, '大']], r, (v) => setProps({ r: v }, (s) => s.t === 'person'))));
    if (one) { const m = personCast(one, idx()); if (m) parts.push(RoleToggles([m])); }
    const movable = selectedPersons();
    if (movable.length >= 2) {
      const hasPrev = !!previousShapes(E.id);
      parts.push(h('div', { class: 'fill-box' },
        h('div', { class: 'role-box-title' }, `メンバーの自動入れ替え（${movable.length}人）`),
        h('div', { class: 'panel-actions tight-top' },
          h('button', { class: 'btn small', onclick: startHeight }, '身長順'),
          h('button', { class: 'btn small', disabled: !hasPrev, onclick: reassignStretch }, '最小ストレッチ')),
        h('div', { class: 'muted small' }, hasPrev
          ? '立ち位置はそのままで番号を入れ替えます。最小ストレッチは、ひとつ前の舞台図からの移動がいちばん少なくなる並びにします。'
          : '立ち位置はそのままで番号を入れ替えます。最小ストレッチは、ひとつ前の舞台図があるときに使えます。')));
    }
  }
  if (one && canName(one)) {
    parts.push(h('label', { class: 'prop' }, h('span', null, '名前'),
      h('input', {
        key: 'nm-' + one.id, value: one.name || '', placeholder: one.t === 'line' || one.t === 'arrow' ? '例：花道、行列' : '例：森、台座、太陽', class: 'grow',
        oninput: (e) => { E.temp[one.id] = { ...one, name: e.target.value }; draw(); },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
        onchange: (e) => commit({ [one.id]: { ...E.shapes[one.id], name: e.target.value.trim() } }),
      })));
  }
  const named = list.filter(canName);
  if (named.some((x) => x.name)) {
    const shown = named.every((x) => x.showName !== false);
    parts.push(h('div', { class: 'prop' }, h('span', null, '名前の表示'), Seg([[true, '表示'], [false, '隠す']], shown, (v) => setProps({ showName: v }, (x) => canName(x)))));
  }
  if (fillables.length) {
    const ix = idx();
    const restN = onStage(ix).filter((c) => !placedCids(merged(), ix).has(c.id)).length;
    const hasPrev = !!previousShapes(E.id);
    const fmode = E.fillMode || (hasPrev ? 'stretch' : 'random');
    const where = fillables.every((x) => x.t === 'line') ? '線に沿って' : '図形の中へ';
    parts.push(h('div', { class: 'fill-box' },
      h('div', { class: 'fill-row' },
        h('button', { class: 'btn small primary', disabled: !restN, onclick: () => fillRegions(fillables) }, '残りの人で埋める'),
        h('label', { class: 'fill-n' }, h('input', {
          value: E.fillCount, placeholder: String(restN), inputmode: 'numeric', 'aria-label': '入れる人数',
          oninput: (e) => { E.fillCount = e.target.value.replace(/[^0-9]/g, ''); },
        }), '人')),
      hasPrev ? h('div', { class: 'prop' }, h('span', null, '並べ方'), Seg([['stretch', '最小ストレッチ'], ['random', 'ランダム']], fmode, (v) => { E.fillMode = v; draw(); })) : null,
      h('div', { class: 'muted small' }, !restN ? 'メンバー全員がこの図に置かれています。'
        : fmode === 'stretch' ? `まだ置いていない${restN}人を、ひとつ前の舞台図からの移動が少なくなるように${where}並べます（人数は空欄なら全員）。`
          : `まだ置いていない${restN}人から、${where}ほどよく散らして並べます（人数は空欄なら全員）。`)));
  }
  const lines = list.filter((x) => x.t === 'line');
  const stroked = regions.concat(lines);
  if (one && one.t === 'line' && one.mode !== 'free') {
    parts.push(h('div', { class: 'prop' }, h('span', null, '種類'), Seg([['straight', '直線'], ['curve', '曲線']], one.mode || 'straight', (v) => { if (v !== (one.mode || 'straight')) setLineMode(one, v); })));
  }
  if (stroked.length) {
    const g = stroked[0];
    parts.push(h('div', { class: 'prop' }, h('span', null, '線'), Seg([[false, '実線'], [true, '点線']], !!g.dashed, (v) => setProps({ dashed: v }, (x) => stroked.includes(x)))));
    parts.push(h('div', { class: 'prop' }, h('span', null, '太さ'), Seg([[2, '細'], [3, '普通'], [5, '太']], g.sw || 3, (v) => setProps({ sw: v }, (x) => stroked.includes(x)))));
  }
  if (regions.length) {
    const g = regions[0];
    parts.push(h('div', { class: 'prop' }, h('span', null, '塗り'), Seg([['none', 'なし'], ['light', '薄い灰'], ['white', '白']], g.fill || 'none', (v) => setProps({ fill: v }, (x) => regions.includes(x)))));
    if (one && one.t === 'rect') parts.push(h('div', { class: 'prop' }, h('span', null, '角'), Seg([[true, '丸い'], [false, '四角']], !!one.round, (v) => setProps({ round: v }))));
  }
  if (one && one.t === 'arrow') {
    parts.push(h('div', { class: 'prop' }, h('span', null, '種類'), Seg([['line', '線'], ['block', '太矢印']], one.style || 'line', (v) => setProps({ style: v }))));
    if ((one.style || 'line') === 'line') {
      parts.push(h('div', { class: 'prop' }, h('span', null, '先端'), Seg([['end', '片側'], ['both', '両側'], ['none', 'なし']], one.head || 'end', (v) => setProps({ head: v }))));
      parts.push(h('div', { class: 'prop' }, h('span', null, '線'), Seg([[false, '実線'], [true, '点線']], !!one.dashed, (v) => setProps({ dashed: v }))));
    } else {
      parts.push(h('div', { class: 'prop' }, h('span', null, '幅'), Seg([[30, '細'], [46, '普通'], [70, '太']], one.width || 46, (v) => setProps({ width: v }))));
    }
  }
  if (one && one.t === 'text') {
    parts.push(h('label', { class: 'prop col' }, h('span', null, '文字'),
      h('textarea', {
        key: 'tx-' + one.id, rows: 2, value: one.text || '',
        ref: (el) => { if (E.focusText === one.id) { E.focusText = null; el.focus(); el.select(); } },
        oninput: (e) => { E.temp[one.id] = { ...one, text: e.target.value }; draw(); },
        onchange: (e) => commit({ [one.id]: { ...E.shapes[one.id], text: e.target.value } }),
      })));
    parts.push(h('div', { class: 'prop' }, h('span', null, '大きさ'), Seg([[18, '小'], [24, '中'], [34, '大'], [48, '特大']], one.size || 24, (v) => setProps({ size: v }))));
    parts.push(h('div', { class: 'prop' }, h('span', null, '色'), Seg([['black', '黒'], ['red', '赤']], one.color || 'black', (v) => setProps({ color: v }))));
    parts.push(h('div', { class: 'prop' }, h('span', null, '太字'), Seg([[false, 'なし'], [true, 'あり']], !!one.bold, (v) => setProps({ bold: v }))));
  }
  if (one && (one.t === 'ellipse' || one.t === 'rect' || one.t === 'text')) {
    parts.push(h('div', { class: 'prop' }, h('span', null, '回転'), Seg([[0, '0°'], [45, '45°'], [90, '90°'], [135, '135°']], one.rot || 0, (v) => setProps({ rot: v }))));
  }
  parts.push(h('div', { class: 'panel-actions' },
    h('button', { class: 'btn tiny', onclick: () => duplicateList(list) }, '複製'),
    h('button', { class: 'btn tiny', onclick: copySel }, 'コピー'),
    h('button', { class: 'btn tiny', onclick: () => reorder(true) }, '前面へ'),
    h('button', { class: 'btn tiny', onclick: () => reorder(false) }, '背面へ'),
    h('button', { class: 'btn tiny danger', onclick: deleteSel }, '削除')));
  return h('div', null, parts);
}

export function EditorView() {
  if (!E) return null;
  const shapes = merged();
  const upx = unitPx();
  const list = sortShapes(shapes);
  const ix = idx();
  const single = E.sel.size === 1 && E.tool === 'select' && !E.hmode ? shapes[[...E.sel][0]] : null;
  const d = E.drag;
  let marquee = null;
  if (d && d.type === 'marquee') {
    const x = Math.min(d.p0[0], d.p1[0]), y = Math.min(d.p0[1], d.p1[1]);
    marquee = h('rect', { x, y, width: Math.abs(d.p1[0] - d.p0[0]), height: Math.abs(d.p1[1] - d.p0[1]), class: 'marquee', 'stroke-width': 1.5 / upx });
  }
  const setTool = (t) => { E.tool = t; if (t !== 'select') E.sel = new Set(); draw(); };
  const zi = ZOOMS.indexOf(E.zoom);
  return h('div', { class: 'ed-root', role: 'dialog', 'aria-label': '舞台図の編集' },
    h('header', { class: 'ed-top' },
      h('button', { class: 'btn primary', onclick: closeEditor }, '完了'),
      h('div', { class: 'ed-title' }, '舞台図の編集'),
      h('div', { class: 'ed-top-btns' },
        h('button', { class: 'icon-btn lg', title: '元に戻す', disabled: !E.undo.length, onclick: undo }, '↶'),
        h('button', { class: 'icon-btn lg', title: 'やり直す', disabled: !E.redo.length, onclick: redo }, '↷'),
        h('span', { class: 'sep' }),
        h('button', { class: 'icon-btn lg', title: '縮小', disabled: zi <= 0, onclick: () => { E.zoom = ZOOMS[Math.max(0, zi - 1)]; draw(); } }, '−'),
        h('span', { class: 'zoom-val' }, Math.round(E.zoom * 100) + '%'),
        h('button', { class: 'icon-btn lg', title: '拡大', disabled: zi >= ZOOMS.length - 1, onclick: () => { E.zoom = ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)]; draw(); } }, '＋'))),
    h('div', { class: 'ed-body' },
      h('nav', { class: 'ed-tools' },
        TOOLS.map(([t, label]) => h('button', {
          key: t, class: 'tool' + (E.tool === t ? ' on' : ''), onclick: () => setTool(t), title: label, 'aria-pressed': E.tool === t ? 'true' : 'false',
        }, h('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true' }, ICONS[t]()), h('span', null, label))),
        h('button', { class: 'tool' + (E.multi ? ' on' : ''), onclick: () => { E.multi = !E.multi; draw(); }, title: 'タップで1つずつ追加選択' },
          h('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true' },
            h('rect', { x: 3, y: 3, width: 9, height: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
            h('rect', { x: 12, y: 12, width: 9, height: 9, fill: 'currentColor' })),
          h('span', null, '複数選択'))),
      h('div', { class: 'ed-canvas-wrap' + (E.tool === 'pan' ? ' panning' : '') },
        !E.loaded ? h('div', { class: 'muted pad' }, '読み込み中…') : null,
        h('svg', {
          id: 'ed-svg', class: 'ed-svg tool-' + E.tool, viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg',
          style: { width: `${E.zoom * 100}%` },
          onpointerdown: down, onpointermove: move, onpointerup: up, onpointercancel: up,
          oncontextmenu: (e) => e.preventDefault(),
        },
          stageFrame(),
          h('g', null, list.map((s) => shapeNode(s, { selected: E.sel.has(s.id), interactive: true, idx: ix }))),
          h('g', null, layoutLabels(list, ix, E.roleVis)),
          single ? h('g', { class: 'handles' }, handlesFor(single, upx)) : null,
          marquee,
          E.hmode ? HeightArrow(upx) : null),
        E.inline ? InlineBox() : null),
      h('aside', { class: 'ed-panel' },
        h('div', { class: 'rotate-hint' }, 'スマホは横向きにすると大きく編集できます。細かい所は右上の「＋」で拡大し、「スクロール」で移動してください。'),
        E.hmode ? HeightPanel() : E.tool === 'person' ? PersonPanel(shapes) : SelPanel())));
}
