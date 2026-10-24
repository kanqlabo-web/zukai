// Googleスライド（と図形描画）でコピーした図形を、図解メーカーの図形に直す
// クリップボードの application/x-vnd.google-docs-drawings-object+wrapped を読む
// ・中身は { data: "{ resolved: [記録…] }" }。記録の頭の数字が種類：
//   [3, id, 形, [a,b,c,d,tx,ty], [属性の番号, 値, …], ページ] 図形（形 8 ＝ 楕円）
//   [2, id, [子のid…], [a,b,c,d,tx,ty], ページ]             グループ（子の行列にかける）
//   [15, id, null, 位置, 文字]                               図形の中の文字
// ・属性：15 塗りの色、19 線の色、22 線の太さ（25 EMU 単位）
// ・座標は 25 EMU 単位。図形のもとの大きさは 120000 四方で、行列で大きさを変える
import { W, H } from './stage.js';

export const SLIDES_TYPE = 'application/x-vnd.google-docs-drawings-object+wrapped';
const BASE = 120000;
const SLIDE_W = 365760; // 16:9 のスライドの横幅（25 EMU 単位）
const PERSON_D = 40; // 図解メーカーの人の直径
const KIND = { 8: 'ellipse' };

const mulM = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const rgb = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(String(c || '')); if (!m) return null; const n = parseInt(m[1], 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const gray = (c) => (c[0] + c[1] + c[2]) / 3;
function areaFill(c) {
  const v = gray(c);
  if (v > 0.97) return 'white';
  if (v > 0.88) return 'light';
  if (v > 0.6) return 'gray';
  return 'dark';
}

// 記録を読む（読めなければ null）
export function parseSlidesClip(raw) {
  let rec;
  try {
    const outer = JSON.parse(raw);
    const inner = typeof outer.data === 'string' ? JSON.parse(outer.data) : outer.data;
    rec = inner && inner.resolved;
  } catch (e) { return null; }
  if (!Array.isArray(rec)) return null;
  const shapes = new Map(), groups = new Map(), texts = new Map();
  for (const r of rec) {
    if (!Array.isArray(r)) continue;
    if (r[0] === 3 && Array.isArray(r[3])) {
      const props = {};
      const p = Array.isArray(r[4]) ? r[4] : [];
      for (let i = 0; i + 1 < p.length; i += 2) props[p[i]] = p[i + 1];
      shapes.set(r[1], { id: r[1], kind: r[2], m: r[3], props });
    } else if (r[0] === 2 && Array.isArray(r[2])) groups.set(r[1], { kids: r[2], m: Array.isArray(r[3]) ? r[3] : [1, 0, 0, 1, 0, 0] });
    else if (r[0] === 15 && typeof r[4] === 'string') {
      if (!texts.has(r[1])) texts.set(r[1], []);
      texts.get(r[1]).push([r[3] || 0, r[4]]);
    }
  }
  // グループの行列を、中の図形にかける（グループの中のグループもある）
  const parent = new Map();
  for (const [gid, g] of groups) for (const k of g.kids) parent.set(k, gid);
  const out = [];
  for (const s of shapes.values()) {
    let m = s.m;
    for (let g = parent.get(s.id), guard = 0; g && guard < 20; g = parent.get(g), guard++) m = mulM(groups.get(g).m, m);
    const t = (texts.get(s.id) || []).sort((a, b) => a[0] - b[0]).map((v) => v[1]).join('').replace(/\n+$/, '');
    const P = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const [cx, cy] = P(BASE / 2, BASE / 2);
    out.push({
      kind: s.kind, text: t, cx, cy,
      w: BASE * Math.hypot(m[0], m[1]), h: BASE * Math.hypot(m[2], m[3]),
      rot: (Math.atan2(m[1], m[0]) * 180) / Math.PI,
      fill: s.props[15] != null ? rgb(s.props[15]) : null,
      line: s.props[19] != null ? rgb(s.props[19]) : null,
    });
  }
  return out;
}

// 図形の並び → 舞台の図形（at を中心に置く）。人の大きさを図解メーカーの人にそろえる
export function slidesToShapes(list, at) {
  if (!list || !list.length) return [];
  const isCircle = (s) => KIND[s.kind] === 'ellipse' && Math.abs(s.w - s.h) < Math.max(s.w, s.h) * 0.15;
  // 名前の入った円の大きさを、人の大きさとする
  const named = list.filter((s) => isCircle(s) && s.text.trim()).map((s) => (s.w + s.h) / 2).sort((a, b) => a - b);
  const pd = named.length ? named[Math.floor(named.length / 2)] : null;
  const isPerson = (s) => isCircle(s) && (s.text.trim() || (pd ? Math.abs((s.w + s.h) / 2 / pd - 1) < 0.35 : false));
  let k = pd ? PERSON_D / pd : (W - 20) / SLIDE_W;
  // 舞台に入りきらないときは縮める
  const xs = list.flatMap((s) => [s.cx - s.w / 2, s.cx + s.w / 2]), ys = list.flatMap((s) => [s.cy - s.h / 2, s.cy + s.h / 2]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  k = Math.min(k, (W - 40) / Math.max(1, x1 - x0), (H - 40) / Math.max(1, y1 - y0));
  const ox = at[0] - ((x0 + x1) / 2) * k, oy = at[1] - ((y0 + y1) / 2) * k;
  const X = (v) => Math.round((ox + v * k) * 10) / 10, Y = (v) => Math.round((oy + v * k) * 10) / 10;
  const out = [];
  let seq = 0;
  for (const s of list) {
    const t = s.text.trim();
    if (isPerson(s)) {
      const p = { t: 'person', x: Math.round(X(s.cx)), y: Math.round(Y(s.cy)), no: '', ring: true, seq: seq++ };
      if (s.fill) { const v = gray(s.fill); if (v < 0.3) p.fill = 'black'; else if (v < 0.95) p.fill = 'gray'; }
      if (t) p.label = t.replace(/\n/g, '');
      // 名前の入った円より小さい・大きい丸は、その大きさのまま
      const r = Math.round(((s.w + s.h) / 4) * k * 10) / 10;
      if (Math.abs(r - PERSON_D / 2) > 1) p.r = r;
      out.push(p);
      continue;
    }
    const base = { seq: seq++ };
    if (s.fill) base.fill = areaFill(s.fill);
    if (!s.line) base.noline = true;
    const rot = Math.round(s.rot * 10) / 10;
    if (KIND[s.kind] === 'ellipse') out.push({ t: 'ellipse', x: X(s.cx), y: Y(s.cy), rx: Math.round(s.w * k * 5) / 10, ry: Math.round(s.h * k * 5) / 10, rot, ...base });
    else out.push({ t: 'rect', x: Math.round(X(s.cx)), y: Math.round(Y(s.cy)), w: Math.round(s.w * k), h: Math.round(s.h * k), rot, ...base });
    // 図形の中の文字は、文字として置く（あとで図形の名前にする）
    if (t) out.push({ t: 'text', text: t, x: Math.round(X(s.cx)), y: Math.round(Y(s.cy)), size: 20, rot: 0, seq: seq++ });
  }
  return out;
}
