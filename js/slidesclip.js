// Googleスライド（と図形描画）でコピーした図形を、図解メーカーの図形に直す
// クリップボードの application/x-vnd.google-docs-drawings-object+wrapped を読む
// ・中身は { data: "{ resolved: [記録…] }" }。記録の頭の数字が種類：
//   [3, id, 形, [a,b,c,d,tx,ty], [属性の番号, 値, …], ページ] 図形（形 8 ＝ 楕円）
//   [2, id, [子のid…], [a,b,c,d,tx,ty], ページ]             グループ（子の行列にかける）
//   [15, id, null, 位置, 文字]                               図形の中の文字
//   [17, id, null, 始め, 終わり, [], [4, 文字の色, 6, 文字の大きさ(pt)]] 文字の書式
// ・形：8 楕円、6 四角、108 テキストボックス、153 線、4 フリーハンド（属性 12 に点の並び）、太い矢印は ARROWS
//   知らない形は、同じ大きさの四角にする
// ・属性：14 塗りのあり（0 ＝なし）、15 塗りの色、19 線の色、22 線の太さ（25 EMU 単位）
//   12 フリーハンドの線：[[閉じる?, ?, [命令, 数の個数, …], [x, y, …], …]]（命令 0 ＝移動、1 ＝直線）
// ・座標は 25 EMU 単位。図形のもとの大きさは 120000 四方で、行列で大きさを変える
import { W, H } from './stage.js';

export const SLIDES_TYPE = 'application/x-vnd.google-docs-drawings-object+wrapped';
const BASE = 120000;
const SLIDE_W = 365760; // 16:9 のスライドの横幅（25 EMU 単位）
const PERSON_D = 40; // 図解メーカーの人の直径
const KIND = { 8: 'ellipse', 6: 'rect', 108: 'text', 153: 'line', 4: 'free', 72: 'arrow', 45: 'arrow', 102: 'arrow', 24: 'arrow' };
// 太い矢印：もとの枠（0〜1）の中の中心線と、軸の太さ（枠の短い辺に対する割合）
// 72 右矢印、45 左矢印吹き出し、102 U ターン矢印、24 曲線矢印（くるりと回る）
const ARROWS = {
  72: { pts: [[0, 0.5], [1, 0.5]], w: 0.5 },
  45: { pts: [[1, 0.5], [0, 0.5]], w: 0.3 },
  102: { pts: [[0.17, 1], [0.17, 0.4], [0.3, 0.12], [0.5, 0.05], [0.7, 0.12], [0.8, 0.4], [0.8, 0.9]], w: 0.25, smooth: true },
  24: { pts: [[0.95, 0.1], [0.45, 0.08], [0.1, 0.25], [0.08, 0.5], [0.3, 0.75], [0.6, 0.8], [0.95, 0.75]], w: 0.18, smooth: true },
};
const PT = 12700 / 25; // 1pt（25 EMU 単位）

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
  const shapes = new Map(), groups = new Map(), texts = new Map(), sizes = new Map();
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
    } else if (r[0] === 17 && Array.isArray(r[6])) {
      for (let i = 0; i + 1 < r[6].length; i += 2) if (r[6][i] === 6 && typeof r[6][i + 1] === 'number') sizes.set(r[1], Math.max(sizes.get(r[1]) || 0, r[6][i + 1]));
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
    // フリーハンド：点の並び（属性 12）。行列はそのまま点にかける
    let pts = null, closed = false;
    if (KIND[s.kind] === 'free' && Array.isArray(s.props[12])) {
      pts = [];
      for (const seg of s.props[12]) {
        if (!Array.isArray(seg) || !Array.isArray(seg[3])) continue;
        const v = seg[3];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push(P(v[i], v[i + 1]));
        if (seg[0] === 1 && s.props[14] !== 0 && s.props[15] != null) closed = true;
      }
    }
    // 線：もとの枠の対角（行列が負なら向きが逆になる）
    if (KIND[s.kind] === 'line') pts = [P(0, 0), P(BASE, BASE)];
    const arrow = ARROWS[s.kind];
    if (arrow) pts = arrow.pts.map(([u, v]) => P(u * BASE, v * BASE));
    // 線の先：28 始点、29 終点（0 ＝なし）
    const hs = !!s.props[28], he = !!s.props[29];
    out.push({
      kind: s.kind, text: t, cx, cy, pts, closed, pt: sizes.get(s.id) || 0, arrow,
      head: hs && he ? 'both' : he ? 'end' : hs ? 'start' : 'none',
      w: BASE * Math.hypot(m[0], m[1]), h: BASE * Math.hypot(m[2], m[3]),
      rot: (Math.atan2(m[1], m[0]) * 180) / Math.PI,
      fill: s.props[15] != null && s.props[14] !== 0 ? rgb(s.props[15]) : null,
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
  const xs = list.flatMap((s) => (s.pts ? s.pts.map((q) => q[0]) : [s.cx - Math.abs(s.w) / 2, s.cx + Math.abs(s.w) / 2]));
  const ys = list.flatMap((s) => (s.pts ? s.pts.map((q) => q[1]) : [s.cy - Math.abs(s.h) / 2, s.cy + Math.abs(s.h) / 2]));
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
    const kind = KIND[s.kind];
    if (kind === 'text') {
      if (t) out.push({ t: 'text', text: t, x: Math.round(X(s.cx)), y: Math.round(Y(s.cy)), size: Math.max(10, Math.round((s.pt || 14) * PT * k)), rot: 0, seq: seq++ });
      continue;
    }
    if (kind === 'arrow' && s.pts) {
      const w = Math.max(6, Math.round(Math.min(Math.abs(s.w), Math.abs(s.h)) * k * s.arrow.w));
      const q = s.pts.map((v) => [X(v[0]), Y(v[1])]);
      if (!s.arrow.smooth) out.push({ t: 'arrow', style: 'block', head: 'end', width: w, x1: q[0][0], y1: q[0][1], x2: q[1][0], y2: q[1][1], seq: seq++ });
      else out.push({ t: 'line', style: 'block', head: 'end', width: w, mode: 'smooth', pts: q, seq: seq++ });
      continue;
    }
    if (kind === 'line' || kind === 'free') {
      const pts = [];
      for (const q of s.pts || []) {
        const v = [X(q[0]), Y(q[1])];
        const l = pts[pts.length - 1];
        if (!l || Math.hypot(l[0] - v[0], l[1] - v[1]) > 3) pts.push(v);
      }
      if (pts.length < 2) continue;
      if (s.closed && pts.length >= 3) out.push({ t: 'blob', sharp: true, pts, ...(s.fill ? { fill: areaFill(s.fill) } : {}), seq: seq++ });
      else if (kind === 'line' && s.head !== 'none') out.push({ t: 'arrow', style: 'line', head: s.head === 'start' ? 'end' : s.head, ...(s.head === 'start' ? { x1: pts[1][0], y1: pts[1][1], x2: pts[0][0], y2: pts[0][1] } : { x1: pts[0][0], y1: pts[0][1], x2: pts[pts.length - 1][0], y2: pts[pts.length - 1][1] }), seq: seq++ });
      else out.push({ t: 'line', pts, ...(kind === 'free' ? { mode: 'smooth' } : {}), ...(s.head !== 'none' ? { head: s.head } : {}), seq: seq++ });
      continue;
    }
    const base = { seq: seq++ };
    if (s.fill) base.fill = areaFill(s.fill);
    if (!s.line) base.noline = true;
    const rot = Math.round(s.rot * 10) / 10;
    if (kind === 'ellipse') out.push({ t: 'ellipse', x: X(s.cx), y: Y(s.cy), rx: Math.round(s.w * k * 5) / 10, ry: Math.round(s.h * k * 5) / 10, rot, ...base });
    else out.push({ t: 'rect', x: Math.round(X(s.cx)), y: Math.round(Y(s.cy)), w: Math.round(s.w * k), h: Math.round(s.h * k), rot, ...base });
    // 図形の中の文字は、文字として置く（あとで図形の名前にする）
    if (t) out.push({ t: 'text', text: t, x: Math.round(X(s.cx)), y: Math.round(Y(s.cy)), size: 20, rot: 0, seq: seq++ });
  }
  return out;
}
