// 図の編集画面（パソコン・スマホ・タブレット対応、同時編集は図形ごとに反映）
import { h, render } from './vdom.js';
import { db, DEL, newId } from './db.js';
import { S, rerender, toast, pickFile } from './state.js';
import { P, createImage, thumbOf } from './model.js';
import { loadPhoto, warpToStage, TracePicker, initialCorners } from './trace.js';
import { textInRegion } from './drawimport.js';
import { shapesFromClipboard, MARK } from './clippaste.js';
import { W, H, stageFrame, StageSVG, shapeNode, sortShapes, moveShape, shapeCenter, shapeBBox, simplify, LAYER, layoutLabels, isRegion, isFillable, canName, insideShape, linePoints } from './stage.js';
import { fillWeight, pointsFor } from './fill.js';
import { workIndex, roleListOf, personCast, personNo, personRole, roleShort, rolesOf, roleText, roleVisible, roleKey } from './cast.js';
import { isDialogOpen } from './dialog.js';
import { UndoButtons, undoAll, redoAll } from './undo.js';
import { icon } from './icons.js';
import { MenuBar, ContextMenu, openContextMenu, closeMenus, menuOpen, MOD } from './menubar.js';
import { ask } from './dialog.js';
import { previousShapes, minCostAssign, diagramSequence } from './assign.js';
import { setPresence, others, colorOf, sharePointer } from './presence.js';

let E = null;
let unsub = null;
let clipboard = [];
let zSeq = 0;
const ZOOMS = [1, 1.5, 2, 3];

export function openEditor(w, id) {
  if (unsub) unsub();
  E = {
    w, id, shapes: {}, loaded: false, tool: 'select', sel: new Set(), temp: {}, drag: null,
    zoom: 1, undo: [], redo: [], personCid: null, personRid: null, personFill: 'white', personRing: false, multi: false, lastTap: null,
    filter: 'all', roleVis: {}, focusText: null, fillCount: '', fillMode: null, hmode: null, inline: null, poly: null,
    propagate: false, linkPeople: false, // 図を開くたびに、どちらもオフから始める
  };
  S.ui.editDiagram = id;
  fingers.clear();
  setPresence(w, { g: id, sel: [] });
  unsub = db.watchDoc(P.doc(w, 'diagrams', id), (g) => {
    if (!E) return;
    if (!g) { toast('この図は削除されました'); closeEditor(); return; }
    E.shapes = g.shapes || {};
    E.roleVis = g.roleVis || {};
    E.draftId = g.draftId;
    E.trace = g.trace || null;
    loadTrace();
    E.loaded = true;
    for (const sid of [...E.sel]) if (!E.shapes[sid]) E.sel.delete(sid);
    draw();
  });
  document.body.classList.add('modal-open');
  window.addEventListener('keydown', onKey);
  // ブラウザの「戻る」（スマホの戻るジェスチャー）で、ページではなく図の編集だけを閉じるよう、履歴を1つ足す
  if (!(window.history.state && window.history.state.zukaiEditor)) window.history.pushState({ zukaiEditor: id }, '');
  rerender();
}

export const isEditorOpen = () => !!E;

// noBack：「戻る」やページの移動で閉じるとき（足した履歴はもう戻っている）
export function closeEditor(noBack) {
  if (!noBack && window.history.state && window.history.state.zukaiEditor) window.history.back();
  closeMenus();
  if (E) setPresence(E.w, { g: null, sel: null });
  // 直した図を、ホームのカードの絵にする（履歴には残さない）
  if (E && E.changed) db.updateQuiet(P.work(E.w), { thumb: thumbOf({ id: E.id, shapes: E.shapes, roleVis: E.roleVis }) }).catch(() => {});
  if (unsub) unsub();
  unsub = null;
  E = null;
  S.ui.editDiagram = null;
  document.body.classList.remove('modal-open');
  window.removeEventListener('keydown', onKey);
  rerender();
}

window.addEventListener('popstate', () => {
  if (E && !(window.history.state && window.history.state.zukaiEditor)) closeEditor(true);
});

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

// ---------- 後の図にも反映 ----------
// 変えた「項目」ごとに、あとの図でもその項目が変える前と同じなら、同じように変える。
//   位置・大きさ・色や塗り・黒い円・名前・番号など、項目は別々に判定する
//   あとの図でその項目がすでに違っていたら、その項目はそこで止める（それより後の図にも反映しない）
// 人：
//   あとの図で、この図から大きく動いている（PERSON_FAR より離れている）人には、番号の入れ替え以外は反映しない
//   動かしたときは、あとの図で近くにいれば、同じだけ動かす
//   番号の入れ替えは、あとの図でもその人が同じ番号のままなら、どこにいても反映する（同じ番号の人が2人になるときは反映しない）
// 消す：あとの図でも変える前とまったく同じなら消す
// 新しく置いたもの：あとの図が、この図の背景をすべて含んでいる（この図から続いている）あいだは追加する。
//   人は、黒い円のない人だけ追加する（その番号の人がすでにいる図には追加しない）
const PERSON_FAR = 200;
function setPropPref(v) { E.propagate = v; draw(); }
function distToPoly(pts, x, y) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}
const isPerson = (s) => !!s && s.t === 'person';
const stable = (o) => (o == null ? 'null' : typeof o !== 'object' ? JSON.stringify(o) : Array.isArray(o) ? '[' + o.map(stable).join(',') + ']' : '{' + Object.keys(o).sort().map((k) => k + ':' + stable(o[k])).join(',') + '}');
const same = (a, b) => stable(a) === stable(b);
const POS = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'pts'];
const IDENT = ['cid', 'no'];
const PROP_GROUPS = [POS, ['rx', 'ry', 'w', 'h'], IDENT];
const IGNORE = new Set(['id', 't']); // 前面へ・背面へ（z）も反映する
function changedGroups(b, a) {
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !IGNORE.has(k) && !same(b[k], a[k]));
  const groups = [];
  const used = new Set();
  for (const g of PROP_GROUPS) if (keys.some((k) => g.includes(k))) { groups.push(g); g.forEach((k) => used.add(k)); }
  for (const k of keys) if (!used.has(k)) groups.push([k]);
  return groups;
}
// 人が誰か（メンバーの id。役で置いた人は、役が決まっていればそのメンバー、未定なら役）
function cidOf(s) {
  if (!isPerson(s)) return null;
  if (s.cid) return s.cid;
  if (!s.rid) return null;
  const c = personCast(s, idx());
  return c ? c.id : 'r:' + s.rid;
}

// あとの図の中から、同じ図形を探す（id が同じもの。なければ、種類・中身・場所がほぼ同じもの）
const MATCH_TOL = 40;
const bodyOf = (s) => { const o = { ...s }; delete o.id; delete o.z; return o; };
function centerOf(s) {
  if (Array.isArray(s.pts) && s.pts.length) {
    let x = 0, y = 0, n = 0;
    for (const p of s.pts) { const q = Array.isArray(p) ? p : [p.x, p.y]; x += q[0] || 0; y += q[1] || 0; n++; }
    return [x / n, y / n];
  }
  if (s.x1 !== undefined) return [((s.x1 || 0) + (s.x2 || 0)) / 2, ((s.y1 || 0) + (s.y2 || 0)) / 2];
  return [(s.x || 0) + (s.w || 0) / 2, (s.y || 0) + (s.h || 0) / 2];
}
function shiftShape(s, dx, dy) {
  const o = {};
  const r = (v) => Math.round(v * 10) / 10;
  if (s.x !== undefined) { o.x = r(s.x + dx); o.y = r((s.y || 0) + dy); }
  if (s.x1 !== undefined) { o.x1 = r(s.x1 + dx); o.y1 = r(s.y1 + dy); o.x2 = r(s.x2 + dx); o.y2 = r(s.y2 + dy); }
  if (Array.isArray(s.pts)) o.pts = s.pts.map((p) => (Array.isArray(p) ? [r(p[0] + dx), r(p[1] + dy), ...p.slice(2)] : { ...p, x: r(p.x + dx), y: r(p.y + dy) }));
  return o;
}
// b→a が形を変えない平行移動なら、そのずれを返す
function moveDelta(b, a) {
  const cb = centerOf(b), ca = centerOf(a);
  const dx = ca[0] - cb[0], dy = ca[1] - cb[1];
  const t = shiftShape(b, dx, dy);
  const near = (u, v) => (Array.isArray(u) ? Array.isArray(v) && u.length === v.length && u.every((x, i) => near(x, v[i]))
    : u && typeof u === 'object' ? v && Object.keys(u).every((k) => near(u[k], v[k]))
    : typeof u === 'number' ? typeof v === 'number' && Math.abs(u - v) < 1.5 : u === v);
  return Object.keys(t).every((k) => near(t[k], a[k])) ? [dx, dy] : null;
}
function matchLater(sh, id, b, used) {
  if (sh[id] && !used.has(id) && (!b || sh[id].t === b.t)) return id;
  if (!b) return null;
  if (isPerson(b)) {
    const key = cidOf(b);
    if (!key) return null;
    const hit = Object.keys(sh).filter((k) => !used.has(k) && cidOf(sh[k]) === key);
    return hit.length === 1 ? hit[0] : null;
  }
  const bb = stable(bodyOf(b)), cb = centerOf(b);
  let best = null, bd = Infinity;
  for (const k of Object.keys(sh)) {
    const x = sh[k];
    if (!x || x.t !== b.t || used.has(k)) continue;
    if (stable(bodyOf(x)) === bb) return k;
    const sameWord = (b.t === 'text' && (x.text || '') === (b.text || '')) || (b.name && x.name === b.name);
    const c = centerOf(x);
    const d = Math.hypot(c[0] - cb[0], c[1] - cb[1]) * (sameWord ? 0.3 : 1) + (sameWord ? 0 : MATCH_TOL);
    if (d < bd) { bd = d; best = k; }
  }
  return bd <= MATCH_TOL ? best : null;
}

function propagation(changes, beforeShapes) {
  if (!E.propagate) return [];
  const seq = diagramSequence();
  const i = seq.indexOf(E.id);
  if (i < 0) return [];
  const later = seq.slice(i + 1).map((id) => (S.d.diagrams || []).find((g) => g.id === id)).filter(Boolean);
  const sceneIds = Object.keys(beforeShapes).filter((id) => beforeShapes[id] && !isPerson(beforeShapes[id]));
  // 図形ごとの、まだ反映を続けている項目
  const act = {};
  for (const id of Object.keys(changes)) {
    const b = beforeShapes[id] || null, a = changes[id];
    if (b && a) act[id] = { kind: 'mod', groups: changedGroups(b, a) };
    else if (b && !a) act[id] = { kind: 'del' };
    else if (!b && a) act[id] = { kind: 'add' };
  }
  const refOf = {};
  const out = [];
  out.skipped = new Set(); // 大きく離れていて反映しなかった人の番号
  for (const g of later) {
    const ids = Object.keys(act);
    if (!ids.length) break;
    const sh = g.shapes || {};
    const used = new Set();
    const lidOf = {};
    for (const id of ids) { const m = matchLater(sh, id, refOf[id] || beforeShapes[id] || null, used); if (m) { used.add(m); lidOf[id] = m; } }
    // 背景の図形がおおむね同じなら、同じ場面の続きの図とみなす（追加を反映する）
    const scUsed = new Set(used);
    const matchedScene = sceneIds.filter((id) => { const m = matchLater(sh, id, beforeShapes[id], scUsed); if (m) scUsed.add(m); return m; }).length;
    const linked = !sceneIds.length || matchedScene >= Math.ceil(sceneIds.length * 0.6);
    const ch = {};
    const idOfL = {};
    for (const id of ids) {
      const st = act[id], b = beforeShapes[id], a = changes[id];
      const lid = lidOf[id] || id;
      const l = lidOf[id] ? sh[lid] : null;
      idOfL[lid] = id;
      if (st.kind === 'del') {
        // 消す：あとの図にもあれば消す（人は、大きく離れていなければ）
        const farP = l && isPerson(b) && Math.hypot((l.x || 0) - (b.x || 0), (l.y || 0) - (b.y || 0)) > PERSON_FAR;
        if (l && !farP) ch[lid] = null; else delete act[id];
      } else if (st.kind === 'add') {
        const c = cidOf(a);
        if (linked && !sh[id] && !(c && Object.values(sh).some((x) => cidOf(x) === c))) ch[id] = a; else delete act[id];
      } else {
        if (!l) { delete act[id]; continue; }
        const person = isPerson(b);
        const far = person && Math.hypot((l.x || 0) - (b.x || 0), (l.y || 0) - (b.y || 0)) > PERSON_FAR;
        const n = { ...l };
        st.groups = st.groups.filter((grp) => {
          if (grp === IDENT) {
            if (!grp.every((k) => same(l[k], b[k]))) return false;
          } else if (person && far) {
            out.skipped.add(personNo(b, idx()) || '番号なし');
            return false; // 大きく動いている人には反映しない
          } else if (!person && grp === POS && !grp.every((k) => same(l[k], b[k]))) {
            // 場所が少しずれている図形：ただの平行移動なら、同じだけ動かす
            const d = moveDelta(b, a);
            if (!d) return false;
            Object.assign(n, shiftShape(l, d[0], d[1]));
            return true;
          } else if (person && grp === POS) {
            // 近くにいれば、同じだけ動かす
            n.x = Math.round((l.x || 0) + (a.x - b.x));
            n.y = Math.round((l.y || 0) + (a.y - b.y));
            return true;
          } else if (!grp.every((k) => same(l[k], b[k]))) return false;
          for (const k of grp) { if (a[k] === undefined) delete n[k]; else n[k] = a[k]; }
          return true;
        });
        if (!st.groups.length) delete act[id];
        else refOf[id] = l; // 次の図では、この図での（変える前の）形を手がかりに探す
        if (!same(n, l)) ch[lid] = n;
      }
    }
    // 同じ番号の人が2人になる変更は、この図から先には反映しない
    const res = { ...sh };
    for (const id in ch) { if (ch[id] == null) delete res[id]; else res[id] = ch[id]; }
    const count = {};
    for (const x of Object.values(res)) { const c = cidOf(x); if (c) count[c] = (count[c] || 0) + 1; }
    for (const id of Object.keys(ch)) {
      const c = cidOf(ch[id]);
      if (!c || count[c] < 2 || same(c, cidOf(sh[id]))) continue;
      const st = act[idOfL[id] || id];
      if (!sh[id]) { delete ch[id]; delete act[idOfL[id] || id]; continue; }
      const n = { ...ch[id] };
      for (const k of IDENT) { if (sh[id][k] === undefined) delete n[k]; else n[k] = sh[id][k]; }
      if (st) { st.groups = st.groups.filter((grp) => grp !== IDENT); if (!st.groups.length) delete act[idOfL[id] || id]; }
      if (same(n, sh[id])) delete ch[id]; else ch[id] = n;
    }
    const keys = Object.keys(ch);
    if (keys.length) out.push({ gid: g.id, after: ch, before: Object.fromEntries(keys.map((id) => [id, sh[id] ? clone(sh[id]) : null])) });
  }
  return out;
}
let propToastAt = 0;
function applyProp(list, which) {
  for (const p of list || []) {
    const patch = {};
    for (const id in p[which]) patch['shapes.' + id] = p[which][id] == null ? DEL : p[which][id];
    db.update(P.doc(E.w, 'diagrams', p.gid), patch).catch((e) => toast('あとの図に反映できませんでした: ' + (e.message || e), 'error'));
  }
}

async function commit(changes, record = true) {
  const ids = Object.keys(changes);
  if (!ids.length) return;
  const before = {};
  for (const id of ids) before[id] = clone(E.shapes[id]) || null;
  const prop = record ? propagation(changes, clone(E.shapes)) : [];
  if (record) {
    E.undo.push({ before, after: clone(changes), prop });
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
  if (prop.length) {
    applyProp(prop, 'after');
    if (Date.now() - propToastAt > 4000 && !(prop.skipped && prop.skipped.size)) { propToastAt = Date.now(); toast(`あとの${prop.length}枚の図にも反映しました`); }
  }
  if (prop.skipped && prop.skipped.size) {
    toast(`${[...prop.skipped].join('・')}は、あとの図で離れた場所にいるため、あとの図は変えていません`, 'info', 5000);
  }
  E.changed = true;
  try { await db.update(path(), patch); } catch (e) { toast('図を保存できませんでした: ' + (e.message || e), 'error', 6000); }
}

function undo() {
  const op = E.undo.pop();
  if (!op) return;
  E.redo.push(op);
  commit(clone(op.before), false);
  applyProp(op.prop, 'before');
}
function redo() {
  const op = E.redo.pop();
  if (!op) return;
  E.undo.push(op);
  commit(clone(op.after), false);
  applyProp(op.prop, 'after');
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
function idx() { return workIndex(S.d.work); }
// 舞台に立つメンバー（CD係など記号の人は図解に出さない）
const onStage = (ix) => ix.list.filter((c) => c.id && !c.tag);
// ひとつ前の図での各メンバーの位置
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
  delete n.no; delete n.rid;
  if (cid) n.cid = cid; else { delete n.cid; n.no = ''; }
  return n;
}
// 人を役で置く（メンバーは、その役を付けた人が自動でなる）。rid が空なら役をやめて番号なしに
function withRid(s, rid) {
  if (!rid) return withCid(s, '');
  const n = { ...s, rid };
  delete n.no; delete n.cid;
  return n;
}
// その役の人（役で置いた人か、その役のメンバーで置いた人）
function findPersonOfRole(shapes, ix, rid, exceptId) {
  const a = ix.byRid[rid];
  return Object.values(shapes).find((s) => s && s.t === 'person' && s.id !== exceptId
    && ((s.rid === rid && !s.cid) || (a && (personCast(s, ix) || {}).id === a.c.id)));
}
function nextRid(shapes, after) {
  const ix = idx();
  const list = ix.roles;
  let start = 0;
  if (after) { const i = list.findIndex((r) => r.id === after); if (i >= 0) start = i + 1; }
  for (let k = 0; k < list.length; k++) {
    const r = list[(start + k) % list.length];
    if (r.id !== after && !findPersonOfRole(shapes, ix, r.id)) return r.id;
  }
  return null;
}
function placeRole(shapes, ix, rid, x, y) {
  const role = ix.roleById[rid];
  if (!role) { E.personRid = null; draw(); return; }
  const existing = findPersonOfRole(shapes, ix, rid);
  if (existing) {
    commit({ [existing.id]: { ...existing, x, y } });
    toast(`「${role.name || role.label}」を移動しました`);
    E.personRid = null;
    return;
  }
  const id = newId(8);
  const s = { id, t: 'person', rid, x, y, fill: E.personFill, r: 20, z: zFor('person'), ...(E.personRing ? { ring: true } : {}) };
  commit({ [id]: s });
  E.personRid = nextRid({ ...shapes, [id]: s }, rid);
  if (!E.personRid) { E.personCid = null; toast('役の一覧の役をすべて配置しました。次はメンバーを置きます。'); }
}
// 選んだ人の役を変える。同じ役の人がほかにいれば、その人と入れ替える
function setPersonRole(one, rid) {
  const base = E.shapes[one.id];
  if (!base) return;
  const ix = idx();
  if ((base.rid || '') === rid && !base.cid) return;
  const ch = { [one.id]: withRid(base, rid) };
  const other = rid ? findPersonOfRole(E.shapes, ix, rid, one.id) : null;
  if (other) {
    ch[other.id] = base.rid && !base.cid ? withRid(other, base.rid) : withCid(other, (personCast(base, ix) || {}).id || '');
    toast('同じ役の人と入れ替えました', 'info', 4000);
  }
  commit(ch);
}
function findPersonOf(shapes, cid, ix, exceptId) {
  return Object.values(shapes).find((s) => s && s.t === 'person' && s.id !== exceptId && (personCast(s, ix) || {}).id === cid);
}

function placePerson(p) {
  const shapes = merged();
  const ix = idx();
  const cid = E.personCid != null ? E.personCid : nextCid(shapes);
  const x = Math.round(p[0]), y = Math.round(p[1]);
  if (E.personRid) { placeRole(shapes, ix, E.personRid, x, y); return; }
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
  const s = withCid({ id, t: 'person', x, y, fill: E.personFill, r: 20, z: zFor('person'), ...(E.personRing ? { ring: true } : {}) }, cid);
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
    changes[id] = { id, t: 'person', cid: c.id, fill: E.personFill, r: 20, z: zFor('person'), ...(E.personRing ? { ring: true } : {}), x: 130 + (i % perRow) * 49, y: 60 + Math.floor(i / perRow) * 50 };
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

// ---------- はける：選んだ人を、近いほうの袖（上手・下手）へ動かす ----------
// 袖は舞台の左右の枠（x 10〜90 と 910〜990）。重ならないよう、もとの上下の並び順のまま縦に並べる。
// 入りきらないときは2列の互い違いにし、それでも足りなければ間を詰める
const WINGS = { left: [10, 90], right: [910, 990] };
function exitPersons() {
  const ps = selectedShapes().filter(isPerson);
  if (!ps.length) return;
  const all = merged();
  const ch = {};
  for (const side of ['left', 'right']) {
    const [x0, x1] = WINGS[side];
    const mine = ps.filter((s) => (side === 'left' ? s.x < W / 2 : s.x >= W / 2)).sort((a, b) => a.y - b.y || a.x - b.x);
    if (!mine.length) continue;
    const sel = new Set(mine.map((s) => s.id));
    // すでに袖にいる（選んでいない）人の場所はあけておく
    const stay = Object.values(all).filter((s) => isPerson(s) && !sel.has(s.id) && !ps.includes(s) && s.x >= x0 && s.x <= x1);
    const r = Math.max(...mine.map((s) => s.r || 20));
    const top = 10 + r + 3, bottom = 460 - r - 3;
    const cx = (x0 + x1) / 2;
    const free = (n, step, cols) => {
      const slots = [];
      for (let i = 0; i < n; i++) {
        const y = top + i * step;
        const x = cols === 1 ? cx : cx + (i % 2 ? 1 : -1) * Math.min(16, (x1 - x0) / 2 - r);
        if (!stay.some((o) => Math.hypot(o.x - x, o.y - y) < r + (o.r || 20) - 2)) slots.push([x, y]);
      }
      return slots;
    };
    let slots = free(Math.floor((bottom - top) / (2 * r + 3)) + 1, 2 * r + 3, 1);
    if (slots.length < mine.length) slots = free(Math.floor((bottom - top) / (r + 2)) + 1, r + 2, 2);
    if (slots.length < mine.length) {
      const step = (bottom - top) / Math.max(1, mine.length - 1);
      slots = mine.map((_, i) => [cx + (i % 2 ? 1 : -1) * Math.min(16, (x1 - x0) / 2 - r), top + i * step]);
    }
    // 上下の順番を保ったまま、もとの高さに近い場所へ
    let k = 0;
    mine.forEach((s, i) => {
      const left = mine.length - i;
      let best = k;
      for (let j = k; j <= slots.length - left; j++) {
        if (Math.abs(slots[j][1] - s.y) < Math.abs(slots[best][1] - s.y)) best = j;
      }
      ch[s.id] = { ...cur(s.id), x: Math.round(slots[best][0]), y: Math.round(slots[best][1]) };
      k = best + 1;
    });
  }
  commit(ch);
}

// ---------- 選んだ人の自動入れ替え ----------
function selectedPersons(ix = idx()) {
  return selectedShapes().filter((s) => s.t === 'person' && !s.rid && personCast(s, ix) && !personCast(s, ix).tag); // 役で置いた人は、役で決まるので入れ替えない
}
function reassignStretch() {
  const ix = idx();
  const ps = selectedPersons(ix);
  const prev = prevPositions(ix);
  if (!prev) { toast('ひとつ前の図がないため、最小ストレッチは使えません', 'error'); return; }
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
  if (clipboard.length) {
    toast(`${clipboard.length}個をコピーしました（別の図にも貼り付けられます）`);
    // ほかのアプリからの貼り付けと区別するため、パソコンのクリップボードにも目印を入れておく
    try { navigator.clipboard.writeText(MARK).catch(() => {}); } catch (e) { /* noop */ }
  }
}
// ほかのアプリ（Googleドキュメント・スライドなど）からの貼り付け
async function pasteExternal(dt) {
  const at = [W / 2, H / 2];
  let busy = setTimeout(() => toast('貼り付けています…'), 400);
  let list;
  try {
    list = await shapesFromClipboard(dt, at, { cast: (S.d.work && S.d.work.cast) || [], roleList: roleListOf(S.d.work), onError: (e) => toast(e.message || String(e), 'error', 8000) });
  } finally { clearTimeout(busy); }
  if (list === 'internal' || (!list && clipboard.length)) { paste(); return; }
  if (!list || !list.length) { toast('貼り付けられるもの（図形・画像・文字）がありませんでした', 'error', 6000); return; }
  const ch = {};
  const ids = [];
  for (const sh of list) {
    const id = newId(8);
    ch[id] = { ...sh, id, z: zFor(sh.t) };
    ids.push(id);
  }
  commit(ch);
  E.sel = new Set(ids);
  draw();
  const imgs = list.filter((x) => x.t === 'image').length;
  toast(imgs === list.length ? `画像を${imgs}枚貼り付けました` : `${list.length}個を貼り付けました`);
}
document.addEventListener('paste', (e) => {
  if (!E || isDialogOpen() || E.inline) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  pasteExternal(e.clipboardData);
}, true);
function paste() { if (clipboard.length) duplicateList(clipboard, 20, 20); }
function cutSel() { if (!E.sel.size) return; copySel(); deleteSel(); }
// メニューの「貼り付け」：ほかのアプリからのものも読めるときは読む（読めないブラウザでは、この画面でコピーしたものだけ）
async function pasteFromMenu() {
  if (clipboard.length) { paste(); return; }
  toast(`${MOD}V で貼り付けてください（ほかのアプリからの貼り付けは、キーボードでだけできます）`, 'info', 5000);
}
const SHORTCUTS = [
  ['元に戻す', 'Z'], ['やり直す', 'Y'], ['切り取り', 'X'], ['コピー', 'C'], ['貼り付け', 'V'], ['複製', 'D'], ['すべて選択', 'A'],
  ['前面へ移動', 'Shift+↑'], ['背面へ移動', 'Shift+↓'], ['ショートカットの一覧', '/'],
];
function showShortcuts() {
  ask({
    title: 'キーボード ショートカット', ok: '閉じる', cancel: false, fields: [],
    message: SHORTCUTS.map(([a, k]) => `${a}　${MOD}${k}`).join('\n')
      + '\n削除　Delete\n少し動かす　矢印キー（Shift で大きく）\n選ぶのをやめる　Esc\n名前を書く　ダブルクリック',
  });
}

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
  const ph = s.t === 'person' ? (personCast(s, idx()) || personRole(s, idx()) ? '書き添える文字' : '役名') : s.t === 'text' ? '文字' : '名前（例：森、台座）';
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
  if (!E || isDialogOpen() || E.tracePick) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoAll() : undoAll(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redoAll(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateList(selectedShapes()); return; }
  if (mod && e.key.toLowerCase() === 'c') { copySel(); return; }
  if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); cutSel(); return; }
  if (mod && e.key === '/') { e.preventDefault(); showShortcuts(); return; }
  if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); reorder(e.key === 'ArrowUp'); return; }
  // Ctrl+V は「貼り付け」の操作（paste）で受け取る（ほかのアプリからの画像や図形も貼れるように）
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); E.sel = new Set(Object.values(E.shapes).filter(passes).map((x) => x.id)); draw(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
  if (E.hmode) { if (e.key === 'Escape') cancelHeight(); if (e.key === 'Enter') applyHeight(); return; }
  if (E.poly) {
    if (e.key === 'Enter') { e.preventDefault(); finishPoly(); }
    else if (e.key === 'Escape') cancelPoly();
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); undoPolyPoint(); }
    return;
  }
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
function nearestPerson(p, range) {
  let best = null, bd = Infinity;
  for (const sh of Object.values(merged())) {
    if (!isPerson(sh) || !passes(sh)) continue;
    const d = Math.hypot(sh.x - p[0], sh.y - p[1]) - (sh.r || 20);
    if (d < range && d < bd) { bd = d; best = sh.id; }
  }
  return best;
}

// 2本指：つまんで拡大・縮小、動かしてスクロール（スマホ・タブレット）
const fingers = new Map();
function pinchStart() {
  const wrap = svgEl().parentElement;
  const [a, b] = [...fingers.values()];
  E.drag = null; E.temp = {};
  E.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: E.zoom, m0: [(a.x + b.x) / 2, (a.y + b.y) / 2], sl: wrap.scrollLeft, st: wrap.scrollTop };
  draw();
}
function pinchMove() {
  const svg = svgEl(), wrap = svg.parentElement, r = wrap.getBoundingClientRect();
  const [a, b] = [...fingers.values()];
  const P0 = E.pinch;
  const z = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(1, P0.z0 * Math.hypot(a.x - b.x, a.y - b.y) / P0.d0));
  const m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  // つまんだ所が指の下に残るよう、拡大した分だけスクロールを合わせる
  const cx = (P0.sl + P0.m0[0] - r.left) / P0.z0, cy = (P0.st + P0.m0[1] - r.top) / P0.z0;
  E.zoom = Math.round(z * 100) / 100;
  svg.style.width = `${E.zoom * 100}%`;
  wrap.scrollLeft = cx * E.zoom - (m[0] - r.left);
  wrap.scrollTop = cy * E.zoom - (m[1] - r.top);
  draw();
}

function down(e) {
  if (!E || !E.loaded) return;
  if (e.pointerType === 'touch') {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 1) E.selBefore = new Set(E.sel); // 2本目が来たら、1本目で変わった選択を戻す
    if (fingers.size === 2) { e.preventDefault(); if (E.selBefore) E.sel = E.selBefore; pinchStart(); return; }
    if (fingers.size > 2 || E.pinch) return;
  }
  if (E.tool === 'pan') return;
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
  // 説明書き（キャラ名・図形の名前）をつかんだ
  const lEl = E.tool === 'select' && e.target.closest('[data-label]');
  if (lEl) {
    const lid = lEl.getAttribute('data-label'), kind = lEl.getAttribute('data-lkind');
    const owner = cur(lid);
    if (owner) {
      const c0 = lEl.getAttribute('data-lc').split(',').map(Number);
      const anchor = kind === 'role' ? [owner.x, owner.y] : shapeCenter(owner);
      const bb = kind === 'role' ? null : shapeBBox(owner);
      // 動かせる範囲：人は丸のすぐ周り（半径＋約40）、図形は図形の外側約30まで
      const max = kind === 'role' ? (owner.r || 20) + 40 : Infinity;
      const box = bb ? [bb[0] - 30, bb[1] - 30, bb[2] + 30, bb[3] + 30] : null;
      E.sel = new Set([lid]);
      E.drag = { type: 'label', id: lid, kind, p0: p, c0, anchor, max, box, moved: false };
      draw();
      return;
    }
  }
  const sEl = e.target.closest('[data-id]');
  let id = sEl && sEl.getAttribute('data-id');
  if (id && E.tool === 'select' && !passes(cur(id))) id = null;
  // 指で押したとき：人は小さいので、指先の近く（画面で約22px）にいる人を優先してつかむ
  if (E.tool === 'select' && e.pointerType === 'touch' && !isPerson(cur(id))) {
    const near = nearestPerson(p, 22 * W / svg.getBoundingClientRect().width);
    if (near) id = near;
  }
  const additive = e.shiftKey || e.metaKey || e.ctrlKey || E.multi;
  const t = E.tool;
  if (t === 'select') {
    if (id) {
      if (additive && E.sel.has(id)) { E.sel.delete(id); draw(); return; }
      const wasOnly = E.sel.size > 1 && E.sel.has(id) && !additive;
      if (additive) E.sel.add(id);
      else if (!E.sel.has(id)) E.sel = new Set([id]);
      const ids = [...E.sel];
      // 図と人を連動：動かす図形の中（線なら近く）にいる人も一緒に動かす
      if (E.linkPeople) {
        const all = merged();
        for (const sh of ids.map((i) => all[i]).filter((x) => x && !isPerson(x))) {
          for (const pr of Object.values(all)) {
            if (!isPerson(pr) || ids.includes(pr.id)) continue;
            const inRegion = isRegion(sh) && insideShape(sh, pr.x, pr.y, 0);
            const nearLine = sh.t === 'line' && distToPoly(linePoints(sh), pr.x, pr.y) < (pr.r || 20) + 14;
            if (inRegion || nearLine) ids.push(pr.id);
          }
        }
      }
      E.drag = { type: 'move', p0: p, ids, orig: Object.fromEntries(ids.map((i) => [i, clone(cur(i))])), moved: false, tapId: id, wasOnly };
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
    E.temp[nid] = { id: nid, t: 'arrow', style: t === 'block' ? 'block' : 'line', head: 'end', ...(t === 'block' ? { width: E.blockW || 46 } : {}), x1: p[0], y1: p[1], x2: p[0], y2: p[1], z: zFor('arrow') };
    E.drag = { type: 'create', id: nid, p0: p };
  } else if (['line', 'curve', 'carrow', 'cblock'].includes(t)) {
    polyClick(p);
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
  if (E && e.pointerType === 'touch' && fingers.has(e.pointerId)) {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (E.pinch) { if (fingers.size >= 2) pinchMove(); return; }
  }
  if (E && E.poly && !E.drag) { polyHover(svgPt(e)); return; }
  if (!E || !E.drag) return;
  const p = svgPt(e);
  const d = E.drag;
  d.shift = e.shiftKey;
  if (d.type === 'harrow') {
    if (d.kind === 'hp1') { E.hmode.x1 = p[0]; E.hmode.y1 = p[1]; } else { E.hmode.x2 = p[0]; E.hmode.y2 = p[1]; }
    heightPreview();
  } else if (d.type === 'label') {
    const dx = p[0] - d.p0[0], dy = p[1] - d.p0[1];
    if (!d.moved && Math.hypot(dx, dy) * unitPx() < 3) return;
    d.moved = true;
    let ox = d.c0[0] + dx - d.anchor[0], oy = d.c0[1] + dy - d.anchor[1];
    const len = Math.hypot(ox, oy);
    if (len > d.max) { ox *= d.max / len; oy *= d.max / len; }
    if (d.box) {
      ox = Math.max(d.box[0], Math.min(d.box[2], d.anchor[0] + ox)) - d.anchor[0];
      oy = Math.max(d.box[1], Math.min(d.box[3], d.anchor[1] + oy)) - d.anchor[1];
    }
    E.temp[d.id] = { ...E.shapes[d.id], [d.kind === 'role' ? 'labelOff' : 'nameOff']: [Math.round(ox), Math.round(oy)] };
    draw();
    return;
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
      else if (o.t === 'image') {
        // 画像は縦横の比を変えない（Shift を押すと自由に）
        if (d.shift) { s.w = Math.round(Math.max(12, Math.abs(lx) * 2)); s.h = Math.round(Math.max(12, Math.abs(ly) * 2)); }
        else { const k = Math.max(12 / Math.min(o.w, o.h), Math.max(Math.abs(lx) * 2 / o.w, Math.abs(ly) * 2 / o.h)); s.w = Math.round(o.w * k); s.h = Math.round(o.h * k); }
      }
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

function up(e) {
  if (e && fingers.has(e.pointerId)) {
    fingers.delete(e.pointerId);
    if (E && E.pinch) { if (fingers.size === 0) { E.pinch = null; draw(); } return; }
  }
  if (!E || !E.drag) return;
  const d = E.drag;
  E.drag = null;
  if (d.type === 'harrow') { draw(); return; }
  if (d.type === 'label') {
    if (d.moved && E.temp[d.id]) commit({ [d.id]: E.temp[d.id] });
    else {
      // 説明書きをダブルクリックすると、自動の位置に戻す
      const now = Date.now();
      if (E.lastTap && E.lastTap.id === 'L' + d.id && now - E.lastTap.t < 450) { E.lastTap = null; resetLabelPos(d.id, d.kind); }
      else E.lastTap = { id: 'L' + d.id, t: now };
      E.temp = {};
    }
    draw();
    return;
  }
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
    if (s.t === 'arrow') {
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

// ---------- 直線・曲線：点を順に打って作る ----------
// 直線は点を順につなぐ（ギザギザも作れる）。曲線は点の間をなめらかにつなぐ
function polyClick(p) {
  const q = [Math.round(p[0]), Math.round(p[1])];
  const mode = E.tool === 'line' ? 'straight' : 'smooth';
  // 曲線矢印・太い曲線矢印は、矢印の先を付けた曲線
  const extra = E.tool === 'carrow' ? { head: 'end' } : E.tool === 'cblock' ? { head: 'end', style: 'block', width: E.blockW || 40 } : {};
  if (!E.poly) {
    const id = newId(8);
    E.poly = { id, mode, extra, pts: [q], z: zFor('line') };
  } else {
    const last = E.poly.pts[E.poly.pts.length - 1];
    // 最後の点をもう一度押したら（ダブルクリックを含む）確定
    if (Math.hypot(last[0] - q[0], last[1] - q[1]) * unitPx() < 12) { finishPoly(); return; }
    E.poly.pts.push(q);
  }
  polyHover(q);
}
function polyHover(p) {
  const pl = E.poly;
  E.temp = { [pl.id]: { id: pl.id, t: 'line', mode: pl.mode, ...(pl.extra || {}), pts: [...pl.pts, p], z: pl.z } };
  draw();
}
function finishPoly() {
  const pl = E.poly;
  if (!pl) return;
  E.poly = null;
  E.temp = {};
  if (pl.pts.length < 2) { draw(); return; }
  commit({ [pl.id]: { id: pl.id, t: 'line', mode: pl.mode, ...(pl.extra || {}), pts: pl.pts, z: pl.z } });
  E.sel = new Set([pl.id]);
  E.tool = 'select';
  draw();
}
function cancelPoly() { E.poly = null; E.temp = {}; draw(); }
function undoPolyPoint() {
  if (!E.poly) return;
  E.poly.pts.pop();
  if (!E.poly.pts.length) { cancelPoly(); return; }
  polyHover(E.poly.pts[E.poly.pts.length - 1]);
}
function setLineMode(s, mode) {
  const pts = s.mode === 'curve' ? [s.pts[0], s.pts[s.pts.length - 1]] : s.pts;
  commit({ [s.id]: { ...s, mode, pts } });
}

// 太矢印の太さ（つまみで自由に＋よく使う太さのボタン）
function WidthControl(value, onLive, onSet) {
  return h('div', { class: 'prop width-ctl' }, h('span', null, '太さ'),
    h('input', {
      type: 'range', min: 12, max: 120, step: 2, value, class: 'grow',
      oninput: (e) => onLive(+e.target.value), onchange: (e) => onSet(+e.target.value),
    }),
    h('span', { class: 'small width-num' }, String(value)),
    Seg([[24, '細'], [40, '普通'], [64, '太'], [96, '特太']], value, onSet));
}
function setWidthLive(list, v) {
  for (const x of list) E.temp[x.id] = { ...E.shapes[x.id], width: v };
  draw();
}

function BlockToolPanel() {
  return h('div', null,
    h('div', { class: 'panel-title' }, '太矢印を引く'),
    h('p', { class: 'small' }, '始点から終点へドラッグします。太さは先に選んでおけます（引いたあとも、選んで変えられます）。'),
    WidthControl(E.blockW || 46, (v) => { E.blockW = v; draw(); }, (v) => { E.blockW = v; draw(); }));
}
function PolyPanel() {
  const n = E.poly ? E.poly.pts.length : 0;
  return h('div', null,
    h('div', { class: 'panel-title' }, { curve: '曲線を引く', carrow: '曲線矢印を引く', cblock: '太い曲線矢印を引く' }[E.tool] || '直線を引く'),
    h('p', { class: 'small' }, E.tool !== 'line'
      ? '曲げたい所を順に押していくと、点の間がなめらかにつながります。'
      : '角にしたい所を順に押していくと、点の間がまっすぐつながります（ギザギザも作れます）。'),
    h('p', { class: 'muted small' }, '最後の点をもう一度押す（ダブルクリック）か Enter で完成。Esc でやめます。'),
    E.tool === 'cblock' ? WidthControl(E.blockW || 40, (v) => { E.blockW = v; if (E.poly) { E.poly.extra.width = v; polyHover(E.poly.pts[E.poly.pts.length - 1]); } else draw(); }, (v) => { E.blockW = v; if (E.poly) E.poly.extra.width = v; draw(); }) : null,
    n ? h('div', { class: 'panel-actions' },
      h('button', { class: 'btn small primary', disabled: n < 2, onclick: finishPoly }, `完成（${n}点）`),
      h('button', { class: 'btn small', onclick: undoPolyPoint }, '1点戻す'),
      h('button', { class: 'btn small', onclick: cancelPoly }, 'やめる')) : null);
}

// ---------- 描画 ----------
function handlesFor(s, upx) {
  const r = Math.max(7, Math.min(30, 9 / upx));
  const hs = [];
  const H1 = (kind, x, y, cls = '') => h('circle', { key: kind, 'data-h': `${kind}:${s.id}`, cx: x, cy: y, r, class: 'handle ' + cls, 'stroke-width': 2 / upx });
  const local = (x, y) => { const [a, b] = rot(x, y, s.rot || 0); return [s.x + a, s.y + b]; };
  if (s.t === 'ellipse' || s.t === 'rect' || s.t === 'image') {
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
  } else if (s.t === 'line' && s.mode !== 'free' && s.mode !== 'curve') {
    s.pts.forEach((q, i) => hs.push(H1('pt' + i, q[0], q[1])));
  } else if (s.t === 'line' && s.mode === 'curve') {
    const p = s.pts;
    if (p.length === 4) {
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
  person: () => [h('circle', { cx: 12, cy: 12, r: 8, fill: 'none', stroke: '#e60012', 'stroke-width': 1.6 }), h('text', { x: 12, y: 16, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#e60012' }, '1')],
  ellipse: () => h('ellipse', { cx: 12, cy: 12, rx: 9.5, ry: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
  rect: () => h('rect', { x: 3, y: 6, width: 18, height: 12, rx: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
  blob: () => h('path', { d: 'M4 13c0-5 5-8 9-6s7 1 7 5-4 3-6 5-10 2-10-4z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
  arrow: () => [h('line', { x1: 3, y1: 17, x2: 18, y2: 7, stroke: 'currentColor', 'stroke-width': 2 }), h('path', { d: 'M21 5l-7.5 0.6 4.4 5.6z', fill: 'currentColor' })],
  block: () => h('path', { d: 'M2 9h11V5l8 7-8 7v-4H2z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
  line: () => h('line', { x1: 3, y1: 19, x2: 21, y2: 5, stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
  curve: () => [h('path', { d: 'M3 19C6 5 16 21 21 5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' })],
  carrow: () => [h('path', { d: 'M3 19C5 8 13 5 18 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }), h('path', { d: 'M21 8.5l-6.5 2.6 1.2-7z', fill: 'currentColor' })],
  cblock: () => h('path', { d: 'M3 20C3 11 8 7 14 7V3.5l7 6-7 6V11c-4 0-7 3-7 9z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linejoin': 'round' }),
  freeline: () => h('path', { d: 'M3 15c3-6 5 4 8-2s4-6 6-2 3 3 4 0', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
  text: () => h('text', { x: 12, y: 17.5, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: 'currentColor' }, 'あ'),
};
const TOOLS = [
  ['select', '選択'], ['person', '人'], ['ellipse', '楕円'], ['rect', '四角'], ['blob', '手書き囲み'],
  ['line', '直線'], ['curve', '曲線'], ['freeline', '手書き線'], ['arrow', '矢印'], ['carrow', '曲線矢印'], ['block', '太矢印'], ['cblock', '太い曲線矢印'], ['text', '文字'], ['pan', 'スクロール'],
];
const HINTS = {
  select: '図形をドラッグで移動。空いている所をドラッグすると範囲選択。図形や人をダブルクリック（ダブルタップ）すると名前や役名を書けます。',
  person: '舞台をタップすると、右の一覧で選んだ番号の人を置きます。続けてタップすると次の番号になります。',
  ellipse: 'ドラッグして楕円を描きます（タップだけなら標準の大きさ）。',
  rect: 'ドラッグして四角を描きます。あとで回転もできます。',
  blob: '指やマウスで囲みたい形をなぞってください。自動で閉じた線になります。',
  line: '点を順に押して直線（折れ線）を引きます。',
  curve: '点を順に押すと、間がなめらかにつながった曲線になります。',
  carrow: '点を順に押すと、なめらかな曲線の矢印になります。最後に押した点が矢印の先です。',
  cblock: '点を順に押すと、白抜きの太い曲線の矢印になります。最後に押した点が矢印の先です。',
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
  return h('details', { class: 'rules' }, h('summary', null, 'キャラクターの表記のルール'), h('div', { class: 'rules-body small' }, rules));
}

function PersonPanel(shapes) {
  const ix = idx();
  const placed = placedCids(shapes, ix);
  const nextRole = E.personRid ? ix.roleById[E.personRid] : null;
  const nextUp = nextRole ? null : E.personCid != null ? E.personCid : nextCid(shapes);
  const nm = nextUp ? ix.byId[nextUp] : null;
  const nextA = nextRole ? ix.byRid[nextRole.id] : null;
  return h('div', null,
    nextRole
      ? h('div', { class: 'panel-title' }, '次に置く：役 ', h('b', null, nextRole.name || nextRole.label), nextA ? `（${nextA.c.no} ${nextA.c.name}）` : '（役者未定）')
      : h('div', { class: 'panel-title' }, '次に置く：', h('b', null, nm ? nm.no : '番号なし'), nm ? ` ${nm.name}` : ''),
    h('div', { class: 'prop' }, h('span', null, '塗り'), Seg([['white', '白'], ['gray', '灰'], ['black', '黒']], E.personFill, (v) => { E.personFill = v; draw(); })),
    h('div', { class: 'prop' }, h('span', null, '黒い円'), Seg([[false, 'なし'], [true, 'あり']], E.personRing, (v) => { E.personRing = v; draw(); })),
    h('p', { class: 'muted small tight' }, '黒い円で囲むのは、役や人として扱うとき・一人ひとりとして見るときです。ふだんの立ち位置は赤の丸付き数字だけにします。'),
    onStage(ix).length ? h('div', { class: 'chips' }, onStage(ix).map((m) => h('button', {
      key: 'c' + m.id, class: 'chip' + (placed.has(m.id) ? ' placed' : '') + (m.id === nextUp ? ' next' : ''),
      title: roleText(m) + (placed.has(m.id) ? '（配置済み：タップした場所へ移動します）' : ''), onclick: () => { E.personCid = m.id; E.personRid = null; draw(); },
    }, h('b', null, m.no), ' ', m.name, rolesOf(m).some((r) => r.label) ? h('small', null, ' ' + rolesOf(m).map((r) => r.label).filter(Boolean).join('・')) : null))) : h('p', { class: 'muted small' }, 'メンバー一覧が空です。ライブラリーページの「メンバー一覧」で入力すると番号を選べます。'),
    h('p', { class: 'muted small' }, '線を引いた名前は配置済みです。選んでタップすると、その人をタップした場所へ動かします。'),
    RoleChips(shapes, ix),
    h('div', { class: 'panel-actions' },
      h('button', { class: 'btn tiny', onclick: () => { E.personCid = ''; E.personRid = null; draw(); } }, '番号なしの人'),
      h('button', { class: 'btn tiny', onclick: lineUpRest }, '未配置の全員を並べる')),
    RulesNote());
}

// 役の一覧から置く（役者が決まっていなくても置ける。役が決まると、その人の番号で表示される）
function RoleChips(shapes, ix) {
  if (!ix.roles.length) return h('div', { class: 'role-chips-empty' });
  return h('div', { class: 'role-chips' },
    h('div', { class: 'role-box-title' }, '役で置く'),
    h('div', { class: 'chips' }, ix.roles.map((r) => {
      const a = ix.byRid[r.id];
      const placed = !!findPersonOfRole(shapes, ix, r.id);
      return h('button', {
        key: 'r' + r.id, class: 'chip role-chip' + (placed ? ' placed' : '') + (E.personRid === r.id ? ' next' : ''),
        title: (a ? `${a.c.no} ${a.c.name}` : '役者未定') + (placed ? '（配置済み：タップした場所へ移動します）' : ''),
        onclick: () => { E.personRid = r.id; draw(); },
      }, r.name || r.label, h('small', null, a ? ' ' + a.c.no : ' 未定'));
    })),
    h('p', { class: 'muted small tight' }, '役で置いた人は、メンバー一覧でその役を付けると、自動でその人の番号になります。'));
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
  const before = { [key]: E.roleVis[key] };
  E.roleVis = { ...E.roleVis, [key]: v };
  db.update(path(), { ['roleVis.' + key]: v });
  propRoleVis(before, { [key]: v });
  draw();
}
// キャラ名の表示も、あとの図に反映する（あとの図でも同じ設定のままなら）
function propRoleVis(before, after) {
  if (!E.propagate) return;
  const seq = diagramSequence();
  const i = seq.indexOf(E.id);
  if (i < 0) return;
  const keys = new Set(Object.keys(after));
  for (const gid of seq.slice(i + 1)) {
    const g = (S.d.diagrams || []).find((x) => x.id === gid);
    if (!g) continue;
    const rv = g.roleVis || {};
    const patch = {};
    for (const k of [...keys]) {
      const cur = rv[k] === undefined ? null : rv[k], was = before[k] === undefined ? null : before[k];
      if (cur !== was) { keys.delete(k); continue; }
      patch['roleVis.' + k] = after[k] == null ? DEL : after[k];
    }
    if (!Object.keys(patch).length) break;
    db.update(P.doc(E.w, 'diagrams', gid), patch);
  }
}

// 役ごとに、図へ役名（キャラクターの表記）を出すかどうか
// この図でのその人の役名の表示（黒い円の有無。役で置いた人は、その役を決めていなければ表示）
function visOf(cid, i) {
  const ix = idx();
  const sh = Object.values(merged()).find((x) => isPerson(x) && (personCast(x, ix) || {}).id === cid);
  const pr = sh && personRole(sh, ix);
  return roleVisible(E.roleVis, cid, i, !!(sh && sh.ring), !!(pr && pr.i === i));
}
// 説明書きの位置を自動に戻す
function resetLabelPos(id, kind) {
  const sh = { ...E.shapes[id] };
  if (!sh) return;
  delete sh[kind === 'role' ? 'labelOff' : 'nameOff'];
  commit({ [id]: sh });
}
// 選んだ人たちの役名を、まとめて表示・非表示にする（auto：黒い円に合わせる）
function setRolesMany(members, v) {
  const patch = {};
  const before = {}, after = {};
  for (const m of members) rolesOf(m).forEach((r, i) => {
    if (!r.label) return;
    const key = roleKey(m.id, i);
    before[key] = E.roleVis[key]; after[key] = v === 'auto' ? null : v;
    patch['roleVis.' + key] = v === 'auto' ? DEL : v;
    if (v === 'auto') { const n = { ...E.roleVis }; delete n[key]; E.roleVis = n; } else E.roleVis = { ...E.roleVis, [key]: v };
  });
  if (Object.keys(patch).length) { db.update(path(), patch); propRoleVis(before, after); }
  draw();
}
function RoleToggles(members, title) {
  const rows = [];
  for (const m of members) {
    rolesOf(m).forEach((r, i) => {
      if (!r.label) return;
      const on = visOf(m.id, i);
      rows.push(h('div', { key: m.id + i, class: 'role-row' },
        h('span', { class: 'role-name' }, members.length > 1 ? h('b', null, m.no + ' ') : null, r.name || '（役名なし）', h('small', null, '　' + r.label)),
        Seg([[true, '表示'], [false, '隠す']], on, (v) => setRoleVis(m.id, i, v))));
    });
  }
  if (!rows.length) {
    return members.length === 1 ? h('p', { class: 'muted small' }, '役名を出すには、メンバー一覧で「キャラクターの表記」を入力してください。') : null;
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

// 人 → 名前つきの円（楕円の図形）。名前は、書き添えの文字かキャラ名
function personsToShapes(persons) {
  const ix = idx();
  const ch = {};
  for (const p of persons) {
    const c = personCast(p, ix);
    const pr = personRole(p, ix);
    const name = (p.label || '').trim() || (pr ? roleShort(pr.role, pr.c && pr.c.roles[pr.i]) : '') || (c ? (rolesOf(c)[0] && (rolesOf(c)[0].label || rolesOf(c)[0].name)) || c.name || '' : '') || '';
    const r = (p.r || 20) + 4;
    const n = { id: p.id, t: 'ellipse', x: p.x, y: p.y, rx: r, ry: r, rot: 0, z: zFor('ellipse') };
    if (name) { n.name = name; n.showName = true; }
    if (p.fill === 'gray') n.fill = 'gray';
    if (p.fill === 'black') n.fill = 'dark';
    ch[p.id] = n;
  }
  commit(ch);
  toast(persons.length > 1 ? `${persons.length}人を図形にしました` : '図形にしました');
}

function textsToNames(texts) {
  const ch = {};
  const all = Object.values(E.shapes);
  const groups = new Map();
  for (const t of texts) {
    const r = textInRegion(t, all);
    if (!r) continue;
    if (!groups.has(r.id)) groups.set(r.id, []);
    groups.get(r.id).push(t);
  }
  for (const [rid, ts] of groups) {
    ts.sort((a, b) => a.y - b.y || a.x - b.x);
    const r = E.shapes[rid];
    ch[rid] = { ...r, name: ts.map((t) => String(t.text).replace(/\n/g, '')).join(''), showName: true };
    for (const t of ts) ch[t.id] = null;
  }
  commit(ch);
  toast('図形の名前にしました');
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
      TraceSection(),
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
    const pr = personRole(one, ix);
    if (ix.roles.length || one.rid) {
      parts.push(h('label', { class: 'prop' }, h('span', null, '役'),
        h('select', { value: one.rid && !one.cid ? one.rid : '', onchange: (e) => setPersonRole(one, e.target.value) },
          h('option', { value: '' }, '（役で置かない）'),
          ix.roles.map((r) => h('option', { key: r.id, value: r.id }, (r.name || r.label) + (ix.byRid[r.id] ? '' : '（未定）'))))));
      if (pr) parts.push(h('p', { class: 'muted small tight' }, pr.c
        ? `この役は「${pr.c.no} ${pr.c.name}」です。メンバー一覧で役を付け替えると、この人も変わります。`
        : '役者が決まっていません。メンバー一覧でこの役を付けると、その人の番号になります。'));
    }
    parts.push(h('label', { class: 'prop' }, h('span', null, '番号'),
      h('input', {
        key: 'no-' + one.id + '-' + personNo(one, ix), value: personNo(one, ix), class: 'num-in', inputmode: 'numeric',
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
        onchange: (e) => setPersonNo(one, e.target.value),
      }),
      m ? h('span', { class: 'small' }, `${m.name}${roleText(m) ? '（' + roleText(m) + '）' : ''}`) : h('span', { class: 'muted small' }, pr ? '役者未定' : '番号なし')));
    parts.push(h('p', { class: 'muted small tight' }, 'ほかの人と同じ番号にすると、2人の番号を入れ替えます。'));
    parts.push(h('label', { class: 'prop' }, h('span', null, m || pr ? '書き添え' : '役名'),
      h('input', {
        key: 'lb-' + one.id, value: one.label || '', placeholder: m || pr ? '役名の横に足す文字' : '例：村人、兵士', class: 'grow',
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
    parts.push(h('div', { class: 'panel-actions' },
      h('button', { class: 'btn small', title: '選んだ人を、近いほうの袖（上手・下手）へ動かします', onclick: exitPersons }, `はける（${persons.length}人）`)));
    const ring = persons.every((s) => !!s.ring === !!persons[0].ring) ? !!persons[0].ring : null;
    parts.push(h('div', { class: 'prop' }, h('span', null, '黒い円'), Seg([[false, 'なし'], [true, 'あり']], ring, (v) => setProps({ ring: v }, (s) => s.t === 'person'))));
    parts.push(h('p', { class: 'muted small tight' }, '黒い円で囲むのは、役や人として扱うとき・一人ひとりとして見るときです。ふだんの立ち位置は赤の丸付き数字だけにします。'));
    const ol = persons.every((s) => (s.outline || 'circle') === (persons[0].outline || 'circle')) ? persons[0].outline || 'circle' : null;
    parts.push(h('div', { class: 'prop' }, h('span', null, '囲みの形'), Seg([['circle', '丸'], ['square', '四角'], ['tri', '三角']], ol, (v) => setProps(v === 'circle' ? { outline: 'circle' } : { outline: v, ring: true }, (s) => s.t === 'person'))));
    {
      const ixx = idx();
      const ms = persons.map((x) => personCast(x, ixx)).filter((m) => m && rolesOf(m).some((r) => r.label));
      if (ms.length) {
        const states = ms.flatMap((m) => rolesOf(m).map((r, i) => (r.label ? visOf(m.id, i) : null)).filter((x) => x !== null));
        const cur = states.every((x) => x) ? true : states.every((x) => !x) ? false : null;
        parts.push(h('div', { class: 'prop' }, h('span', null, 'キャラ名'),
          Seg([[true, '表示'], [false, '隠す'], ['auto', '自動']], cur, (v) => setRolesMany(ms, v))));
        parts.push(h('p', { class: 'muted small tight' }, `選んだ${ms.length > 1 ? ms.length + '人' : '人'}のキャラ名をまとめて切り替えます。「自動」は、黒い円で囲んだ人だけ表示します。`));
      }
    }
    const movable = selectedPersons();
    if (movable.length >= 2) {
      const hasPrev = !!previousShapes(E.id);
      parts.push(h('div', { class: 'fill-box' },
        h('div', { class: 'role-box-title' }, `メンバーの自動入れ替え（${movable.length}人）`),
        h('div', { class: 'panel-actions tight-top' },
          h('button', { class: 'btn small', onclick: startHeight }, '身長順'),
          h('button', { class: 'btn small', disabled: !hasPrev, onclick: reassignStretch }, '最小ストレッチ')),
        h('div', { class: 'muted small' }, hasPrev
          ? '立ち位置はそのままで番号を入れ替えます。最小ストレッチは、ひとつ前の図からの移動がいちばん少なくなる並びにします。'
          : '立ち位置はそのままで番号を入れ替えます。最小ストレッチは、ひとつ前の図があるときに使えます。')));
    }
  }
  if (list.some((x) => Array.isArray(x.labelOff) || Array.isArray(x.nameOff))) {
    parts.push(h('div', { class: 'panel-actions' }, h('button', {
      class: 'btn small', onclick: () => {
        const ch = {};
        for (const x of list) if (Array.isArray(x.labelOff) || Array.isArray(x.nameOff)) { const n = { ...E.shapes[x.id] }; delete n.labelOff; delete n.nameOff; ch[x.id] = n; }
        commit(ch);
      },
    }, '名前・キャラ名の位置を自動に戻す')));
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
        : fmode === 'stretch' ? `まだ置いていない${restN}人を、ひとつ前の図からの移動が少なくなるように${where}並べます（人数は空欄なら全員）。`
          : `まだ置いていない${restN}人から、${where}ほどよく散らして並べます（人数は空欄なら全員）。`)));
  }
  const lines = list.filter((x) => x.t === 'line' && x.style !== 'block'); // 太い曲線矢印は線の太さを使わない
  const stroked = regions.concat(lines);
  if (one && one.t === 'line' && one.mode !== 'free') {
    const cur = one.mode === 'straight' || !one.mode ? 'straight' : 'smooth';
    parts.push(h('div', { class: 'prop' }, h('span', null, '種類'), Seg([['straight', '直線'], ['smooth', '曲線']], cur, (v) => { if (v !== cur || one.mode === 'curve') setLineMode(one, v); })));
    parts.push(h('div', { class: 'prop' }, h('span', null, '矢印'), Seg([['none', 'なし'], ['end', '片側'], ['both', '両側']], one.head || 'none', (v) => setProps({ head: v }))));
    if (one.head && one.head !== 'none') {
      parts.push(h('div', { class: 'prop' }, h('span', null, '形'), Seg([['line', '線'], ['block', '太矢印']], one.style || 'line', (v) => setProps({ style: v, width: one.width || 40 }))));
      if (one.style === 'block') parts.push(WidthControl(one.width || 40, (v) => setWidthLive([one], v), (v) => { E.blockW = v; setProps({ width: v }); }));
    }
    parts.push(h('p', { class: 'muted small tight' }, '丸い点をドラッグすると形を直せます。'));
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
      parts.push(WidthControl(one.width || 46, (v) => setWidthLive([one], v), (v) => { E.blockW = v; setProps({ width: v }); }));
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
  // 人として取り込まれたもの（石ころ・草など）を、名前つきの円の図形にする
  const inTexts = list.filter((x) => x.t === 'text' && textInRegion(x, Object.values(E.shapes)));
  if (inTexts.length) {
    parts.push(h('div', { class: 'prop' },
      h('button', { class: 'btn', title: '図形の中に書いてある文字を、その図形の名前にします', onclick: () => textsToNames(inTexts) }, '囲んでいる図形の名前にする')));
  }
  const selPeople = list.filter((x) => x.t === 'person');
  if (selPeople.length) {
    parts.push(h('div', { class: 'prop' },
      h('button', { class: 'btn', title: '人ではないもの（石ころ・草など）を、名前つきの円の図形にします', onclick: () => personsToShapes(selPeople) }, selPeople.length > 1 ? `選んだ${selPeople.length}人を図形にする` : '図形にする')));
  }
  parts.push(h('div', { class: 'panel-actions' },
    h('button', { class: 'btn tiny', onclick: () => duplicateList(list) }, '複製'),
    h('button', { class: 'btn tiny', onclick: copySel }, 'コピー'),
    h('button', { class: 'btn tiny', onclick: () => reorder(true) }, '前面へ'),
    h('button', { class: 'btn tiny', onclick: () => reorder(false) }, '背面へ'),
    h('button', { class: 'btn tiny danger', onclick: deleteSel }, '削除')));
  return h('div', null, parts);
}

// 舞台にいる人がメンバーより多いときの、控えめなお知らせ（作業の邪魔はしない）
function CountChip(shapes, ix) {
  const members = onStage(ix).length;
  const persons = Object.values(shapes).filter((s) => s && s.t === 'person');
  if (!members || persons.length <= members) return null;
  const noNum = persons.filter((s) => !personCast(s, ix)).length;
  return h('span', {
    class: 'count-chip',
    title: `舞台の人：${persons.length}人（番号なし${noNum}人を含む）／メンバー：${members}人`,
  }, `人が${persons.length - members}人多い（${persons.length}／${members}）`);
}

// ほかの人がこの図で選んでいる図形に、その人の色の枠と名前を出す
function presBox(s) {
  if (s.t === 'person') { const r = (s.r || 20) + 4; return [s.x - r, s.y - r, s.x + r, s.y + r]; }
  if (s.t === 'text') {
    const size = s.size || 24;
    const lines = String(s.text || '').split('\n');
    const w = Math.max(...lines.map((l) => [...l].reduce((a, ch) => a + (/[\x00-\xff]/.test(ch) ? size * 0.58 : size), 0)), size);
    return [s.x - w / 2 - 3, s.y - lines.length * size * 0.65, s.x + w / 2 + 3, s.y + lines.length * size * 0.65];
  }
  if (s.t === 'ellipse') {
    const t = ((s.rot || 0) * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
    const hw = Math.hypot(s.rx * c, s.ry * sn) + 8, hh = Math.hypot(s.rx * sn, s.ry * c) + 8;
    return [s.x - hw, s.y - hh, s.x + hw, s.y + hh];
  }
  const b = shapeBBox(s);
  return [b[0] - 8, b[1] - 8, b[2] + 8, b[3] + 8];
}
export function PresenceMarks(shapes, here, upx) {
  const out = [];
  for (const p of here) {
    const c = colorOf(p.email);
    let first = true;
    for (const id of p.sel || []) {
      const s = shapes[id];
      if (!s) continue;
      const [x1, y1, x2, y2] = presBox(s);
      // 自分が選んだときと同じ、形に沿った点線（色はその人の色）
      out.push(h('g', { key: p.pid + id, class: 'pres-sel', style: { '--sel': c } }, shapeNode(s, { selected: true, idx: idx() })));
      if (first) {
        const fs = 13 / upx;
        const tw = [...String(p.name)].length * fs * 0.95 + 8 / upx;
        out.push(h('g', { key: p.pid + id + 'n', 'pointer-events': 'none' },
          h('rect', { x: x1, y: y1 - fs - 6 / upx, width: tw, height: fs + 6 / upx, rx: 3 / upx, fill: c }),
          h('text', { x: x1 + 4 / upx, y: y1 - 4 / upx, 'font-size': fs, fill: '#fff', 'font-weight': 700 }, p.name)));
        first = false;
      }
    }
  }
  return out;
}

// ---------- 下絵（写真をなぞって描く） ----------
function loadTrace() {
  const id = E.trace && E.trace.img;
  if (!id) { E.traceSrc = null; E.traceFor = null; return; }
  if (E.traceFor === id) return;
  E.traceFor = id;
  E.traceSrc = null;
  const cur = E;
  db.get(P.doc(E.w, 'images', id)).then((im) => { if (E === cur && E.traceFor === id) { E.traceSrc = im ? im.data : null; draw(); } }).catch(() => {});
}

async function pickTrace() {
  const f = await pickFile('image/*');
  if (!f || !E) return;
  try {
    const photo = await loadPhoto(f);
    E.tracePick = { photo, pts: initialCorners(photo), drag: null };
    draw();
  } catch (e) { toast(e.message || String(e), 'error', 6000); }
}

async function finishTrace(corners) {
  const st = E.tracePick;
  E.tracePick = null;
  draw();
  toast('下絵を作っています…');
  try {
    const img = warpToStage(st.photo, corners);
    const old = E.trace && E.trace.img;
    const iid = await createImage(E.w, E.draftId, img);
    await db.update(path(), { trace: { img: iid, op: (E.trace && E.trace.op) || 0.5 } });
    if (old) db.remove(P.doc(E.w, 'images', old));
    E.traceHidden = false;
    toast('下絵を敷きました。上からなぞって図を作ってください');
  } catch (e) { toast('下絵を作れませんでした: ' + (e.message || e), 'error', 6000); }
}

async function removeTrace() {
  const old = E.trace && E.trace.img;
  await db.update(path(), { trace: DEL });
  if (old) db.remove(P.doc(E.w, 'images', old));
}

function TraceSection() {
  const t = E.trace;
  if (!t) {
    return h('div', { class: 'trace-sec' },
      h('div', { class: 'panel-title' }, '下絵'),
      h('p', { class: 'muted small tight' }, 'ホワイトボードなどに描いた図の写真を薄く敷いて、上からなぞって図を作れます。下絵は書き出し・閲覧モードには出ません。'),
      h('button', { class: 'btn small', onclick: pickTrace }, '写真を下絵にする'));
  }
  const op = t.op == null ? 0.5 : t.op;
  return h('div', { class: 'trace-sec' },
    h('div', { class: 'panel-title' }, '下絵'),
    h('label', { class: 'prop' }, h('span', null, '濃さ'),
      h('input', {
        type: 'range', min: 0.1, max: 0.9, step: 0.05, value: op, class: 'grow', 'aria-label': '下絵の濃さ',
        oninput: (e) => { E.trace = { ...E.trace, op: +e.target.value }; E.traceHidden = false; draw(); },
        onchange: (e) => db.update(path(), { 'trace.op': +e.target.value }),
      })),
    h('div', { class: 'panel-actions' },
      h('button', { class: 'btn tiny', onclick: () => { E.traceHidden = !E.traceHidden; draw(); } }, E.traceHidden ? '下絵を見せる' : '下絵を隠す'),
      h('button', { class: 'btn tiny', onclick: pickTrace }, '別の写真にする'),
      h('button', { class: 'btn tiny danger', onclick: removeTrace }, '下絵を外す')),
    !E.traceSrc ? h('p', { class: 'muted small' }, '下絵を読み込んでいます…') : null);
}

// ---------- メニューバー・右クリック・左の図の一覧（Googleスライドと同じ並び） ----------
function editorMenus(setTool, zoomIn, zoomOut) {
  const has = E.sel.size > 0;
  const tool = (t, label) => ({ label, checked: E.tool === t, onclick: () => setTool(t) });
  return [
    { label: '編集', items: [
      { label: '元に戻す', kbd: MOD + 'Z', onclick: undoAll },
      { label: 'やり直す', kbd: MOD + 'Y', onclick: redoAll },
      '-',
      { label: '切り取り', kbd: MOD + 'X', disabled: !has, onclick: cutSel },
      { label: 'コピー', kbd: MOD + 'C', disabled: !has, onclick: copySel },
      { label: '貼り付け', kbd: MOD + 'V', onclick: pasteFromMenu },
      { label: '複製', kbd: MOD + 'D', disabled: !has, onclick: () => duplicateList(selectedShapes()) },
      { label: '削除', kbd: 'Delete', disabled: !has, onclick: deleteSel },
      '-',
      { label: 'すべて選択', kbd: MOD + 'A', onclick: () => { setTool('select'); E.sel = new Set(Object.values(E.shapes).filter(passes).map((x) => x.id)); draw(); } },
      { label: '選択を解除', kbd: 'Esc', disabled: !has, onclick: () => { E.sel = new Set(); draw(); } },
      { label: '複数選択（タップで1つずつ追加）', checked: E.multi, onclick: () => { E.multi = !E.multi; draw(); } },
    ] },
    { label: '表示', items: [
      { label: '拡大', disabled: !zoomIn, onclick: () => { E.zoom = zoomIn; draw(); } },
      { label: '縮小', disabled: !zoomOut, onclick: () => { E.zoom = zoomOut; draw(); } },
      { label: '100%', checked: Math.abs(E.zoom - 1) < 0.01, onclick: () => { E.zoom = 1; draw(); } },
      '-',
      { label: '下絵を表示', checked: !!(E.trace && !E.traceHidden), disabled: !E.trace, onclick: () => { E.traceHidden = !E.traceHidden; draw(); } },
      { label: 'スクロール（手のひら）', checked: E.tool === 'pan', onclick: () => setTool('pan') },
    ] },
    { label: '挿入', items: [
      tool('person', '人'), tool('text', '文字'),
      '-', tool('ellipse', '楕円'), tool('rect', '四角'), tool('blob', '手書き囲み'),
      '-', tool('line', '直線'), tool('curve', '曲線'), tool('freeline', '手書き線'),
      '-', tool('arrow', '矢印'), tool('carrow', '曲線矢印'), tool('block', '太矢印'), tool('cblock', '太い曲線矢印'),
      '-', { label: E.trace ? '下絵の写真を変える' : '写真を下絵にする', onclick: pickTrace },
    ] },
    { label: '配置', items: [
      { label: '前面へ移動', kbd: MOD + 'Shift+↑', disabled: !has, onclick: () => reorder(true) },
      { label: '背面へ移動', kbd: MOD + 'Shift+↓', disabled: !has, onclick: () => reorder(false) },
      '-',
      { label: 'あとの図にも反映', checked: E.propagate, onclick: () => setPropPref(!E.propagate) },
      { label: '図と人を連動', checked: E.linkPeople, onclick: () => { E.linkPeople = !E.linkPeople; draw(); } },
    ] },
    { label: 'ヘルプ', items: [
      { label: 'キーボード ショートカット', kbd: MOD + '/', onclick: showShortcuts },
    ] },
  ];
}

// 図の上で右クリック：押した図形を選んで、その図形への操作を出す
function onContext(e) {
  if (!E || !E.loaded) return;
  const el = e.target.closest && e.target.closest('[data-id]');
  const id = el && el.getAttribute('data-id');
  if (id && E.shapes[id] && !E.sel.has(id)) E.sel = new Set([id]);
  if (!id && !E.multi) E.sel = new Set();
  if (E.tool !== 'select') E.tool = 'select';
  const has = E.sel.size > 0;
  const one = E.sel.size === 1 ? E.shapes[[...E.sel][0]] : null;
  const items = has ? [
    { label: '切り取り', kbd: MOD + 'X', onclick: cutSel },
    { label: 'コピー', kbd: MOD + 'C', onclick: copySel },
    { label: '貼り付け', kbd: MOD + 'V', onclick: pasteFromMenu },
    { label: '複製', kbd: MOD + 'D', onclick: () => duplicateList(selectedShapes()) },
    { label: '削除', kbd: 'Delete', onclick: deleteSel },
    '-',
    one && (one.t === 'text' || one.t === 'person' || canName(one)) ? { label: one.t === 'person' ? '役名を書く' : one.t === 'text' ? '文字を直す' : '名前を書く', kbd: 'ダブルクリック', onclick: () => startInline(one) } : null,
    { label: '前面へ移動', kbd: MOD + 'Shift+↑', onclick: () => reorder(true) },
    { label: '背面へ移動', kbd: MOD + 'Shift+↓', onclick: () => reorder(false) },
  ] : [
    { label: '貼り付け', kbd: MOD + 'V', onclick: pasteFromMenu },
    { label: 'すべて選択', kbd: MOD + 'A', onclick: () => { E.sel = new Set(Object.values(E.shapes).filter(passes).map((x) => x.id)); draw(); } },
    '-',
    { label: E.trace ? '下絵の写真を変える' : '写真を下絵にする', onclick: pickTrace },
  ];
  openContextMenu(e.clientX, e.clientY, items, draw);
}

// 左の一覧：このトラックの図を順番に並べ、押すとその図に切り替える（スライドの一覧と同じ）
function Filmstrip(seq, ix) {
  const byId = {};
  for (const g of S.d.diagrams || []) byId[g.id] = g;
  return h('nav', { class: 'ed-strip', 'aria-label': 'このトラックの図' }, seq.map((id, i) => {
    const g = byId[id];
    const now = id === E.id;
    return h('button', {
      key: id, class: 'strip-item' + (now ? ' on' : ''), 'aria-current': now ? 'true' : null, title: `${i + 1}枚目の図`,
      onclick: () => { if (!now) switchDiagram(id); },
    },
      h('span', { class: 'strip-no' }, String(i + 1)),
      h('span', { class: 'strip-thumb' }, StageSVG(now ? merged() : (g.shapes || {}), { cls: 'stage', idx: ix, roleVis: (now ? E.roleVis : g.roleVis) || {} })));
  }));
}
function switchDiagram(id) {
  const w = E.w, zoom = E.zoom, tool = E.tool;
  closeEditor(true);
  openEditor(w, id);
  if (E) { E.zoom = zoom; E.tool = tool === 'pan' ? 'pan' : 'select'; }
  requestAnimationFrame(() => { const el = document.querySelector('.strip-item.on'); if (el) el.scrollIntoView({ block: 'nearest' }); });
}

export function EditorView() {
  if (!E) return null;
  const shapes = merged();
  setPresence(E.w, { g: E.id, sel: [...E.sel].sort() });
  const here = others().filter((p) => p.g === E.id);
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
  const setTool = (t) => { if (E.poly) finishPoly(); E.tool = t; if (t !== 'select') E.sel = new Set(); draw(); };
  const zoomOut = [...ZOOMS].reverse().find((z) => z < E.zoom - 0.01);
  const zoomIn = ZOOMS.find((z) => z > E.zoom + 0.01);
  const seq = diagramSequence().filter((id) => (S.d.diagrams || []).some((g) => g.id === id));
  return h('div', { class: 'ed-root', role: 'dialog', 'aria-label': '図の編集' },
    // Googleスライドのように、上に名前とメニューバー（編集・表示・挿入・配置・ヘルプ）、その下に道具バー
    h('header', { class: 'ed-top' },
      h('button', { class: 'btn primary', onclick: () => closeEditor() }, '完了'),
      h('div', { class: 'ed-head' },
        h('div', { class: 'ed-title' }, '図の編集', seq.length > 1 && seq.indexOf(E.id) >= 0 ? h('span', { class: 'ed-pos muted' }, `${seq.indexOf(E.id) + 1}／${seq.length}枚目`) : null),
        MenuBar('editor', editorMenus(setTool, zoomIn, zoomOut), draw)),
      here.length ? h('div', { class: 'pres-tags in-editor', title: 'この図を開いている人' }, here.map((p) => h('span', { key: p.pid, class: 'pres-tag', style: { background: colorOf(p.email) } }, p.name))) : null,
      CountChip(shapes, ix)),
    h('div', { class: 'ed-bar' },
      h('div', { class: 'ed-top-btns' },
        UndoButtons('icon-btn'),
        h('span', { class: 'sep' }),
        h('button', { class: 'icon-btn', 'data-tip': '縮小', 'aria-label': '縮小', disabled: !zoomOut, onclick: () => { E.zoom = zoomOut; draw(); } }, icon('minus', 18)),
        h('span', { class: 'zoom-val' }, Math.round(E.zoom * 100) + '%'),
        h('button', { class: 'icon-btn', 'data-tip': '拡大', 'aria-label': '拡大', disabled: !zoomIn, onclick: () => { E.zoom = zoomIn; draw(); } }, icon('plus', 18)),
        h('span', { class: 'sep' })),
      h('nav', { class: 'ed-tools', 'aria-label': '道具' },
        TOOLS.map(([t, label]) => h('button', {
          key: t, class: 'tool' + (E.tool === t ? ' on' : ''), onclick: () => setTool(t), 'data-tip': label, 'aria-label': label, 'aria-pressed': E.tool === t ? 'true' : 'false',
        }, h('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true' }, ICONS[t]()), h('span', null, label))),
        h('button', { class: 'tool' + (E.multi ? ' on' : ''), onclick: () => { E.multi = !E.multi; draw(); }, 'data-tip': '複数選択（タップで1つずつ追加）', 'aria-label': '複数選択', 'aria-pressed': E.multi ? 'true' : 'false' },
          h('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true' },
            h('rect', { x: 3, y: 3, width: 9, height: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
            h('rect', { x: 12, y: 12, width: 9, height: 9, fill: 'currentColor' })),
          h('span', null, '複数選択')),
        // 下絵：まだなければ写真を選ぶ。あれば表示・非表示を切り替える
        h('button', {
          class: 'tool' + (E.trace && !E.traceHidden ? ' on' : ''), 'data-tip': E.trace ? '下絵を見せる・隠す' : '下絵（写真をなぞって描く）', 'aria-label': '下絵',
          onclick: () => { if (!E.trace) pickTrace(); else { E.traceHidden = !E.traceHidden; draw(); } },
        },
          h('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linejoin': 'round' },
            h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
            h('path', { d: 'M3 16l5-5 4 4 3-3 6 6' }),
            h('circle', { cx: 16, cy: 9, r: 1.6 })),
          h('span', null, '下絵'))),
      h('div', { class: 'ed-bar-end' },
        h('span', { class: 'sep' }),
        h('label', { class: 'prop-toggle', title: 'この図で直したこと（動かす・足す・消す・色・キャラ名の表示など）を、あとの図にも反映します。図を開くたびにオフに戻ります' },
          h('input', { type: 'checkbox', checked: E.propagate, onchange: (e) => setPropPref(e.target.checked) }),
          h('span', null, 'あとの図にも反映')),
        h('label', { class: 'prop-toggle', title: '楕円・四角・囲み・線を動かすと、その中（線ならそば）にいる人も一緒に動きます' },
          h('input', { type: 'checkbox', checked: E.linkPeople, onchange: (e) => { E.linkPeople = e.target.checked; draw(); } }),
          h('span', null, '図と人を連動')))),
    h('div', { class: 'ed-body' + (seq.length > 1 ? ' has-strip' : '') },
      seq.length > 1 ? Filmstrip(seq, ix) : null,
      h('div', { class: 'ed-canvas-wrap' + (E.tool === 'pan' ? ' panning' : '') },
        !E.loaded ? h('div', { class: 'muted pad' }, '読み込み中…') : null,
        h('svg', {
          id: 'ed-svg', class: 'ed-svg tool-' + E.tool, viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg',
          style: { width: `${E.zoom * 100}%` },
          onpointerdown: down, onpointerup: up, onpointercancel: up,
          onpointermove: (e) => { sharePointer(E.id, svgPt(e)); move(e); },
          onpointerleave: () => sharePointer(E.id, null),
          oncontextmenu: (e) => { e.preventDefault(); onContext(e); },
        },
          stageFrame(),
          // 下絵（なぞるための写真。書き出しには出ない）
          h('g', { class: 'trace-layer', 'pointer-events': 'none' }, E.trace && E.traceSrc && !E.traceHidden
            ? h('image', { href: E.traceSrc, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', opacity: E.trace.op == null ? 0.5 : E.trace.op }) : null),
          h('g', null, list.map((s) => shapeNode(s, { selected: E.sel.has(s.id), interactive: true, idx: ix }))),
          h('g', null, layoutLabels(list, ix, E.roleVis, E.tool === 'select')),
          h('g', { class: 'pres-marks' }, PresenceMarks(shapes, here, upx)),
          single ? h('g', { class: 'handles' }, handlesFor(single, upx)) : null,
          marquee,
          E.hmode ? HeightArrow(upx) : null),
        E.inline ? InlineBox() : null),
      h('aside', { class: 'ed-panel' },
        h('div', { class: 'rotate-hint' }, '2本指で広げると拡大、2本指で動かすとスクロールします。横向きにすると大きく編集できます。'),
        E.hmode ? HeightPanel() : E.tool === 'person' ? PersonPanel(shapes) : ['line', 'curve', 'carrow', 'cblock'].includes(E.tool) ? PolyPanel() : E.tool === 'block' ? BlockToolPanel() : SelPanel())),
    ContextMenu(),
    E.tracePick ? TracePicker(E.tracePick, { onDone: finishTrace, onCancel: () => { E.tracePick = null; draw(); }, redraw: draw }) : null);
}
