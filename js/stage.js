// 図の描画（編集画面・一覧・PDFで共通）
import { h } from './vdom.js';
import { personCast, personNo, personRole, roleShort, rolesOf, roleVisible } from './cast.js';

export const W = 1000;
export const H = 470;
const INK = '#1a1a1a';
const NUM = '#e60012';
// 文字は Arial（ない端末は同じ幅の Arimo）、日本語は Noto Sans JP
const FONT = 'Arial, Arimo, "Noto Sans JP", sans-serif';
// 丸付き数字の文字（①〜⑳、㉑〜㉟、㊱〜㊿）
const CIRCLED_FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", Meiryo, "MS Gothic", sans-serif';
export function circledNumber(no) {
  const n = /^\d+$/.test(String(no || '')) ? parseInt(no, 10) : 0;
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32b1 + n - 36);
  return '';
}
// 囲み・楕円・四角の塗り
const AREA_FILLS = { light: '#ececec', white: '#ffffff', gray: '#bfbfbf', dark: '#555555' };
export const FILLS = { white: '#ffffff', gray: '#c8c8c8', black: '#1a1a1a' };
// 人の外側の形：ふつうは丸。見分けるために四角（square）や三角（tri）で描くこともある
export function personOutline(kind, r, attrs) {
  if (kind === 'square') return h('rect', { x: -r, y: -r, width: 2 * r, height: 2 * r, ...attrs });
  if (kind === 'tri') { const a = r * 1.75; return h('polygon', { points: `0,${(-a).toFixed(1)} ${(a * 0.92).toFixed(1)},${(a * 0.62).toFixed(1)} ${(-a * 0.92).toFixed(1)},${(a * 0.62).toFixed(1)}`, ...attrs }); }
  return h('circle', { r, ...attrs });
}
export const LAYER = { image: 0, blob: 0, ellipse: 0, rect: 0, line: 1, arrow: 1, person: 2, text: 3 };

export function stageFrame() {
  const t = 5;
  return h('g', { class: 'frame', 'pointer-events': 'none' },
    h('rect', { x: 10, y: 10, width: 980, height: 450, fill: '#fff', stroke: INK, 'stroke-width': 3 }),
    h('line', { x1: 10, y1: 10, x2: 990, y2: 10, stroke: INK, 'stroke-width': t }),
    h('line', { x1: 10, y1: 460, x2: 990, y2: 460, stroke: INK, 'stroke-width': t }),
    h('line', { x1: 90, y1: 10, x2: 90, y2: 460, stroke: INK, 'stroke-width': t }),
    h('line', { x1: 910, y1: 10, x2: 910, y2: 460, stroke: INK, 'stroke-width': t }),
    h('rect', { x: 90, y: 395, width: 62, height: 65, fill: 'none', stroke: INK, 'stroke-width': t }),
    h('rect', { x: 848, y: 395, width: 62, height: 65, fill: 'none', stroke: INK, 'stroke-width': t }),
    h('line', { x1: 500, y1: 10, x2: 500, y2: 460, stroke: '#888', 'stroke-width': 3, 'stroke-dasharray': '14 10' }),
    h('line', { x1: 90, y1: 235, x2: 910, y2: 235, stroke: '#888', 'stroke-width': 3, 'stroke-dasharray': '14 10' }),
  );
}

export function sortShapes(shapes) {
  return Object.values(shapes || {}).filter(Boolean).sort((a, b) => (a.z || 0) - (b.z || 0));
}

// なめらかな閉曲線（Catmull-Rom → ベジェ）
export function smoothPath(pts, closed = true) {
  if (!pts || pts.length < 2) return '';
  const n = pts.length;
  const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return closed ? d + 'Z' : d;
}

// 手書きの点を間引く
export function simplify(pts, minDist = 18) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minDist) out.push(p);
  }
  return out;
}

// 開いた線（Catmull-Rom）の点を細かく取る
function sampleOpen(pts, per = 8) {
  const n = pts.length;
  if (n < 3) return pts.map((p) => [p[0], p[1]]);
  const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = 0; k < per; k++) out.push(bez(p1, c1, c2, p2, k / per));
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
function bez(a, b, c, d, t) {
  const u = 1 - t;
  return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
}
// 線（直線・曲線・手書き線）の形を、細かい点の並びにする
export function linePoints(s) {
  const p = s.pts || [];
  if (p.length < 2) return p.slice();
  if (s.mode === 'curve' && p.length === 4) return Array.from({ length: 41 }, (_, i) => bez(p[0], p[1], p[2], p[3], i / 40));
  if (s.mode === 'free' || s.mode === 'smooth') return sampleOpen(p);
  return p.map((q) => [q[0], q[1]]); // 直線：点を順につなぐ（折れ線）
}
export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}
// 線の上の、始点から距離 d の位置と向き
export function pointAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= l || i === pts.length - 1) {
      const t = l ? Math.max(0, Math.min(1, d / l)) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ux: l ? (b[0] - a[0]) / l : 1, uy: l ? (b[1] - a[1]) / l : 0 };
    }
    d -= l;
  }
  const q = pts[0] || [0, 0];
  return { x: q[0], y: q[1], ux: 1, uy: 0 };
}
function linePath(s) {
  const p = s.pts || [];
  if (p.length < 2) return '';
  const f = (q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
  if (s.mode === 'curve' && p.length === 4) return `M${f(p[0])}C${f(p[1])} ${f(p[2])} ${f(p[3])}`;
  if (s.mode === 'free' || s.mode === 'smooth') return smoothPath(p, false);
  return 'M' + p.map(f).join('L');
}

// 線の d0〜d1 の部分だけを取り出す
function slicePts(pts, d0, d1) {
  const out = [];
  let acc = 0;
  const a = pointAt(pts, d0);
  out.push([a.x, a.y]);
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc > d0 && acc < d1) out.push(pts[i]);
  }
  const b = pointAt(pts, d1);
  out.push([b.x, b.y]);
  return out;
}
// 曲線・折れ線の矢印。style='block' なら幅のある白抜きの太い矢印
export function lineArrowShape(s) {
  const P = linePoints(s);
  const L = polyLength(P);
  const head = s.head || 'none';
  const atEnd = head === 'end' || head === 'both', atStart = head === 'both' || head === 'start';
  if (s.style === 'block') {
    // 太い矢印：中心線を太い線で描き（角が折れても形が崩れない）、先に三角を付ける
    const w = s.width || 40, hl = Math.min(L * 0.45, w * 1.2);
    const d0 = atStart ? hl : 0, d1 = atEnd ? L - hl : L;
    const heads = [];
    const tri = (d, base) => {
      const t = pointAt(P, d), bp = pointAt(P, base);
      const nx = -bp.uy, ny = bp.ux;
      return [[bp.x + nx * w, bp.y + ny * w], [t.x, t.y], [bp.x - nx * w, bp.y - ny * w]];
    };
    if (atEnd) heads.push(tri(L, d1));
    if (atStart) heads.push(tri(0, d0));
    // 本体は三角の根元より少し先まで（つなぎ目の線を消すため）
    // 矢印のない端は、外側の黒い線が端の線として見えるよう、内側を少し短くする
    const body = slicePts(P, atStart ? d0 : 2.4, atEnd ? Math.max(d0 + 1, d1) : L - 2.4);
    // 三角の根元から、まっすぐ少しだけ中へ（曲がっていても三角からはみ出さない）
    if (atEnd) { const q = pointAt(P, d1); body.push([q.x + q.ux * w * 0.3, q.y + q.uy * w * 0.3]); }
    if (atStart) { const q = pointAt(P, d0); body.unshift([q.x - q.ux * w * 0.3, q.y - q.uy * w * 0.3]); }
    const core = slicePts(P, d0, Math.max(d0 + 1, d1));
    return { kind: 'block', w, body, core, heads, pts: P };
  }
  const size = 20;
  const d0 = atStart ? size * 0.7 : 0, d1 = atEnd ? L - size * 0.7 : L;
  const heads = [];
  if (atEnd) { const a = pointAt(P, Math.max(0, L - size)); const e = P[P.length - 1]; heads.push(arrowHead(a.x, a.y, e[0], e[1], size)); }
  if (atStart) { const a = pointAt(P, Math.min(L, size)); const e = P[0]; heads.push(arrowHead(a.x, a.y, e[0], e[1], size)); }
  return { kind: 'line', pts: slicePts(P, d0, Math.max(d0 + 1, d1)), heads };
}

function arrowHead(x1, y1, x2, y2, size) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const l = [x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45)];
  const r = [x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45)];
  return `${x2},${y2} ${l[0]},${l[1]} ${r[0]},${r[1]}`;
}

function blockArrowPoints(s) {
  const { x1, y1, x2, y2 } = s;
  const w = s.width || 46;
  const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const nx = -uy, ny = ux;
  const head = Math.min(len * 0.55, w * 1.3);
  const bx = x2 - ux * head, by = y2 - uy * head;
  const hw = w / 2, hh = w;
  const p = [
    [x1 + nx * hw, y1 + ny * hw], [bx + nx * hw, by + ny * hw], [bx + nx * hh, by + ny * hh],
    [x2, y2], [bx - nx * hh, by - ny * hh], [bx - nx * hw, by - ny * hw], [x1 - nx * hw, y1 - ny * hw],
  ];
  return p.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ');
}

export function shapeCenter(s) {
  if (s.t === 'arrow') return [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
  if (s.t === 'blob' || s.t === 'line') {
    const p = s.t === 'line' ? linePoints(s) : s.pts || [];
    if (!p.length) return [0, 0];
    return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
  }
  return [s.x, s.y];
}

export function moveShape(s, dx, dy) {
  const n = { ...s };
  if (s.t === 'arrow') { n.x1 += dx; n.y1 += dy; n.x2 += dx; n.y2 += dy; }
  else if (s.t === 'blob' || s.t === 'line') n.pts = s.pts.map((p) => [p[0] + dx, p[1] + dy]);
  else { n.x += dx; n.y += dy; }
  return n;
}

const HIT = { stroke: 'transparent', 'stroke-width': 22, fill: 'none', 'pointer-events': 'stroke' };

export function shapeNode(s, { selected = false, interactive = false, idx = null } = {}) {
  const sel = selected ? ' sel' : '';
  const common = { key: s.id, 'data-id': interactive ? s.id : null, class: 'shape' + sel };
  const dash = s.dashed ? '12 9' : null;
  const sw = s.sw || 3;
  if (s.t === 'person') {
    // 立ち位置は赤の丸付き数字（文字の ①〜㊿）。役や人として扱う・一人ひとりとして見るときは、外側に黒い円（ring）。
    // 番号のない人は黒い円だけ
    const r = s.r || 20;
    const label = personNo(s, idx);
    const fill = FILLS[s.fill] || '#fff';
    const circled = circledNumber(label);
    let mark = null;
    if (circled) {
      mark = h('text', {
        'text-anchor': 'middle', 'dominant-baseline': 'central', fill: NUM,
        'font-size': (r * 1.4).toFixed(1), 'font-family': CIRCLED_FONT,
      }, circled);
    } else if (label) {
      // ㊿ より大きい番号や数字でない番号は、赤い円と数字で描く
      const ri = r * 0.65;
      const fs = label.length <= 2 ? ri * 1.0 : ri * 0.8;
      mark = [h('circle', { r: ri, fill: 'none', stroke: NUM, 'stroke-width': 1.6 }),
        h('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.5, fill: NUM, 'font-size': fs.toFixed(1), 'font-family': FONT }, label)];
    }
    const ring = s.ring || !label;
    // 役で置いた人は、役が決まればそのメンバーとして（閲覧モードで、メンバーで置いた図からもすべって動く）
    const pc = s.rid && !s.cid ? personCast(s, idx) : null;
    return h('g', { ...common, 'data-pk': s.cid ? 'c' + s.cid : pc ? 'c' + pc.id : s.rid ? 'r' + s.rid : s.no ? 'n' + s.no : 'i' + s.id, transform: `translate(${s.x},${s.y})` },
      personOutline(s.outline, r, { fill: ring || s.fill && s.fill !== 'white' ? fill : 'transparent', stroke: ring ? INK : 'none', 'stroke-width': 2.4 }),
      // 丸付き数字の内側は塗りつぶして、後ろの線が数字にかからないようにする
      circled ? h('circle', { r: r * 0.64, fill }) : null,
      mark,
      selected ? h('circle', { r: r + 7, fill: 'none', class: 'sel-ring' }) : null,
    );
  }
  if (s.t === 'ellipse' || s.t === 'rect') {
    const fill = AREA_FILLS[s.fill] || 'none';
    const tr = `translate(${s.x},${s.y}) rotate(${s.rot || 0})`;
    const shape = s.t === 'ellipse'
      ? h('ellipse', { rx: s.rx, ry: s.ry, fill, stroke: s.noline ? 'none' : INK, 'stroke-width': sw, 'stroke-dasharray': dash })
      : h('rect', { x: -s.w / 2, y: -s.h / 2, width: s.w, height: s.h, rx: s.round ? Math.min(28, s.w / 4, s.h / 4) : 0, fill, stroke: s.noline ? 'none' : INK, 'stroke-width': sw, 'stroke-dasharray': dash });
    const hit = s.t === 'ellipse'
      ? h('ellipse', { rx: s.rx, ry: s.ry, ...HIT })
      : h('rect', { x: -s.w / 2, y: -s.h / 2, width: s.w, height: s.h, ...HIT });
    return h('g', { ...common, transform: tr }, shape, interactive ? hit : null,
      selected ? (s.t === 'ellipse'
        ? h('ellipse', { rx: s.rx + 8, ry: s.ry + 8, fill: 'none', class: 'sel-ring' })
        : h('rect', { x: -s.w / 2 - 8, y: -s.h / 2 - 8, width: s.w + 16, height: s.h + 16, fill: 'none', class: 'sel-ring' })) : null);
  }
  if (s.t === 'image') {
    // 貼り付けた画像（Googleドキュメントの図・写真など）
    // ink：下絵から取り込んだ黒い線（舞台いっぱい）。押しても選ばれない（空いている所の範囲選択のじゃまにならないように）
    return h('g', { ...common, transform: `translate(${s.x},${s.y}) rotate(${s.rot || 0})`, 'pointer-events': s.ink ? 'none' : null },
      h('image', { href: s.src, x: -s.w / 2, y: -s.h / 2, width: s.w, height: s.h, preserveAspectRatio: 'none' }),
      interactive ? h('rect', { x: -s.w / 2, y: -s.h / 2, width: s.w, height: s.h, fill: 'transparent', stroke: 'none' }) : null,
      selected ? h('rect', { x: -s.w / 2 - 6, y: -s.h / 2 - 6, width: s.w + 12, height: s.h + 12, fill: 'none', class: 'sel-ring' }) : null);
  }
  if (s.t === 'blob') {
    // sharp：角のある多角形（取り込んだ矢印など）。ふだんはなめらかな囲み
    const d = s.sharp ? 'M' + (s.pts || []).map((q) => `${q[0]},${q[1]}`).join('L') + 'Z' : smoothPath(s.pts, true);
    const fill = AREA_FILLS[s.fill] || 'none';
    return h('g', { ...common },
      h('path', { d, fill, stroke: s.noline ? 'none' : INK, 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-linejoin': 'round' }),
      interactive ? h('path', { d, ...HIT }) : null,
      selected ? h('path', { d, fill: 'none', class: 'sel-ring' }) : null);
  }
  if (s.t === 'line' && ((s.head && s.head !== 'none') || s.style === 'block')) {
    // 矢印つきの線（曲線矢印・太い曲線矢印）
    const d = linePath(s);
    const A = lineArrowShape(s);
    const f = (q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
    const join = s.mode === 'smooth' || s.mode === 'free' ? 'round' : 'miter';
    const bw = 2.4;
    const shape = A.kind === 'block'
      ? [
        // 外側の黒い線 → 三角 → 内側の白（灰）で、ひとつながりの白抜き矢印にする
        h('path', { key: 'bo', d: 'M' + A.core.map(f).join('L'), fill: 'none', stroke: INK, 'stroke-width': A.w + bw * 2, 'stroke-linejoin': join, 'stroke-miterlimit': 3, 'stroke-linecap': 'butt' }),
        ...A.heads.map((t, i) => h('polygon', { key: 'h' + i, points: t.map(f).join(' '), fill: '#f2f2f2', stroke: INK, 'stroke-width': bw, 'stroke-linejoin': 'miter' })),
        h('path', { key: 'bi', d: 'M' + A.body.map(f).join('L'), fill: 'none', stroke: '#f2f2f2', 'stroke-width': A.w, 'stroke-linejoin': join, 'stroke-miterlimit': 3, 'stroke-linecap': 'butt' }),
      ]
      : [h('path', { d: 'M' + A.pts.map(f).join('L'), fill: 'none', stroke: INK, 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        ...A.heads.map((pt, i) => h('polygon', { key: 'hd' + i, points: pt, fill: INK }))];
    return h('g', { ...common }, shape,
      interactive ? h('path', { d, ...HIT, 'stroke-width': A.kind === 'block' ? (s.width || 40) + 10 : 22 }) : null,
      selected ? h('path', { d, fill: 'none', class: 'sel-ring' }) : null);
  }
  if (s.t === 'line') {
    const d = linePath(s);
    return h('g', { ...common },
      h('path', { d, fill: 'none', stroke: INK, 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      interactive ? h('path', { d, ...HIT }) : null,
      selected ? h('path', { d, fill: 'none', class: 'sel-ring' }) : null);
  }
  if (s.t === 'arrow') {
    const { x1, y1, x2, y2 } = s;
    if (s.style === 'block') {
      const pts = blockArrowPoints(s);
      return h('g', { ...common },
        h('polygon', { points: pts, fill: '#f2f2f2', stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
        interactive ? h('polygon', { points: pts, ...HIT, fill: 'transparent', 'pointer-events': 'all' }) : null,
        selected ? h('polygon', { points: pts, fill: 'none', class: 'sel-ring' }) : null);
    }
    const head = s.head || 'end';
    const size = 22;
    const shorten = (ax, ay, bx, by) => {
      const L = Math.hypot(bx - ax, by - ay) || 1;
      return [bx - ((bx - ax) / L) * size * 0.7, by - ((by - ay) / L) * size * 0.7];
    };
    let [ex, ey] = head === 'end' || head === 'both' ? shorten(x1, y1, x2, y2) : [x2, y2];
    let [sx, sy] = head === 'both' ? shorten(x2, y2, x1, y1) : [x1, y1];
    return h('g', { ...common },
      h('line', { x1: sx, y1: sy, x2: ex, y2: ey, stroke: '#444', 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-linecap': 'round' }),
      head === 'end' || head === 'both' ? h('polygon', { points: arrowHead(x1, y1, x2, y2, size), fill: '#444' }) : null,
      head === 'both' ? h('polygon', { points: arrowHead(x2, y2, x1, y1, size), fill: '#444' }) : null,
      interactive ? h('line', { x1, y1, x2, y2, ...HIT }) : null,
      selected ? h('line', { x1, y1, x2, y2, class: 'sel-ring' }) : null);
  }
  if (s.t === 'text') {
    const size = s.size || 24;
    const lines = String(s.text || '').split('\n');
    return h('g', { ...common, transform: `translate(${s.x},${s.y}) rotate(${s.rot || 0})` },
      h('text', {
        'text-anchor': 'middle', 'dominant-baseline': 'central', fill: s.color === 'red' ? NUM : INK,
        'font-size': size, 'font-weight': s.bold ? 700 : 400,
        'font-family': FONT, ...HALO,
      }, lines.map((ln, i) => h('tspan', { x: 0, dy: i === 0 ? -((lines.length - 1) * size * 0.6) : size * 1.2 }, ln || ' '))),
      interactive ? h('rect', {
        x: -Math.max(20, maxLen(lines) * size * 0.55), y: -(lines.length * size * 0.65),
        width: Math.max(40, maxLen(lines) * size * 1.1), height: lines.length * size * 1.3, fill: 'transparent',
      }) : null,
      selected ? h('rect', {
        x: -Math.max(20, maxLen(lines) * size * 0.55) - 4, y: -(lines.length * size * 0.65) - 4,
        width: Math.max(40, maxLen(lines) * size * 1.1) + 8, height: lines.length * size * 1.3 + 8, fill: 'none', class: 'sel-ring',
      }) : null);
  }
  return null;
}

function maxLen(lines) { return Math.max(1, ...lines.map((l) => [...l].length)); }

// ---------- 図形の内側判定・面積 ----------
const rotPt = (x, y, deg) => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// 点が図形の内側にあり、縁から margin 以上離れているか
export function insideShape(s, x, y, margin = 0) {
  if (s.t === 'ellipse' || s.t === 'rect') {
    const [lx, ly] = rotPt(x - s.x, y - s.y, -(s.rot || 0));
    if (s.t === 'rect') return Math.abs(lx) <= s.w / 2 - margin && Math.abs(ly) <= s.h / 2 - margin;
    const rx = s.rx - margin, ry = s.ry - margin;
    if (rx <= 0 || ry <= 0) return false;
    return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
  }
  if (s.t === 'blob') {
    const p = s.pts || [];
    if (p.length < 3 || !inPoly(x, y, p)) return false;
    if (!margin) return true;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (distSeg(x, y, p[j][0], p[j][1], p[i][0], p[i][1]) < margin) return false;
    return true;
  }
  return false;
}
export function shapeBBox(s) {
  if (s.t === 'blob' || s.t === 'line' || s.t === 'arrow') {
    const p = s.t === 'line' ? linePoints(s) : s.t === 'arrow' ? [[s.x1, s.y1], [s.x2, s.y2]] : s.pts;
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  if (s.t === 'ellipse' || s.t === 'rect' || s.t === 'image') {
    const hw = s.t === 'ellipse' ? s.rx : s.w / 2, hh = s.t === 'ellipse' ? s.ry : s.h / 2;
    const c = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => rotPt(a, b, s.rot || 0));
    const xs = c.map((q) => q[0] + s.x), ys = c.map((q) => q[1] + s.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [0, 0, 0, 0];
}
export function shapeArea(s) {
  if (s.t === 'ellipse') return Math.PI * s.rx * s.ry;
  if (s.t === 'rect') return s.w * s.h;
  if (s.t === 'blob') {
    const p = s.pts; let a = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
    return Math.abs(a / 2);
  }
  return 0;
}
export const isRegion = (s) => s && (s.t === 'ellipse' || s.t === 'rect' || s.t === 'blob');
// 人を入れられる図形（囲み・線）。矢印（矢の先のある線・太い矢印）には入れない
export const isFillable = (s) => isRegion(s) || (s && s.t === 'line' && s.style !== 'block' && (!s.head || s.head === 'none'));
// 名前を付けられる図形
export const canName = (s) => isRegion(s) || (s && s.t === 'line' && s.style !== 'block') || (s && s.t === 'arrow');

// ---------- 役名・図形名の自動配置（重ならない場所を探す） ----------
// 文字のまわりを白くふちどって、線が字に重ならないようにする
const HALO = { stroke: '#fff', 'stroke-width': 5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' };
const ROLE_FS = 17;
const NAME_FS = 22;
const LABEL_FONT = FONT;
function textW(str, fs) {
  let w = 0;
  for (const ch of String(str)) w += /[\x00-\xff]/.test(ch) ? fs * 0.58 : fs * 1.0;
  return w;
}
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
function overlapArea(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const hgt = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && hgt > 0 ? w * hgt : 0;
}
export function textBox(s) {
  const size = s.size || 24;
  const lines = String(s.text || '').split('\n');
  const w = Math.max(...lines.map((l) => textW(l, size)));
  return [s.x - w / 2, s.y - (lines.length * size * 0.65), s.x + w / 2, s.y + (lines.length * size * 0.65)];
}

// 図の中の線（枠・中央の点線・図形の輪郭・線・矢印）を、短い線分の集まりにする
function strokeSegs(list) {
  const segs = [];
  const poly = (pts, closed) => { for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]); if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]); };
  // 舞台の枠と中央の点線
  poly([[10, 10], [990, 10], [990, 460], [10, 460]], true);
  poly([[90, 10], [90, 460]]); poly([[910, 10], [910, 460]]);
  poly([[500, 10], [500, 460]]); poly([[90, 235], [910, 235]]);
  const rot = (x, y, cx, cy, deg) => { const a = (deg || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a); return [cx + x * c - y * sn, cy + x * sn + y * c]; };
  for (const sh of list) {
    if (sh.t === 'ellipse' && !sh.noline) poly(Array.from({ length: 28 }, (_, i) => { const t = (i / 28) * Math.PI * 2; return rot(sh.rx * Math.cos(t), sh.ry * Math.sin(t), sh.x, sh.y, sh.rot); }), true);
    else if (sh.t === 'rect' && !sh.noline) poly([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => rot(a * sh.w / 2, b * sh.h / 2, sh.x, sh.y, sh.rot)), true);
    else if (sh.t === 'blob' && !sh.noline) poly(sh.sharp ? sh.pts || [] : sampleOpen([...(sh.pts || []), (sh.pts || [])[0]].filter(Boolean)), true);
    else if (sh.t === 'line') { if (sh.style === 'block') { const A = lineArrowShape(sh); poly(A.pts, false); A.heads.forEach((t) => poly(t, true)); } else poly(linePoints(sh), false); }
    else if (sh.t === 'arrow') { if (sh.style === 'block') poly(blockArrowPoints(sh).split(' ').map((q) => q.split(',').map(Number)), true); else poly([[sh.x1, sh.y1], [sh.x2, sh.y2]], false); }
  }
  return segs;
}
// 線分が箱（[x0,y0,x1,y1]）を通るか
function segHitsBox([[ax, ay], [bx, by]], box, pad = 2) {
  const x0 = box[0] - pad, y0 = box[1] - pad, x1 = box[2] + pad, y1 = box[3] + pad;
  if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) return false;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
const lineHits = (segs, box) => segs.reduce((n, sg) => n + (segHitsBox(sg, box) ? 1 : 0), 0);

// interactive：編集画面では、説明書き（キャラ名・図形の名前）をドラッグで動かせるようにする
export function layoutLabels(list, idx, roleVis = {}, interactive = false) {
  const segs = strokeSegs(list);
  const obstacles = [];
  for (const s of list) {
    if (s.t === 'person') { const r = s.r || 20; obstacles.push([s.x - r, s.y - r, s.x + r, s.y + r]); }
    else if (s.t === 'text') obstacles.push(textBox(s));
  }
  const placed = [];
  const out = [];
  // 編集画面では説明書きをつかんで動かせる（data-label に、持ち主の図形と今の中心を入れておく）
  const dragAttrs = (id, kind, box) => (interactive
    ? { 'pointer-events': 'all', 'data-label': id, 'data-lkind': kind, 'data-lc': `${((box[0] + box[2]) / 2).toFixed(1)},${((box[1] + box[3]) / 2).toFixed(1)}`, style: 'cursor: move' }
    : { 'pointer-events': 'none' });
  const nameBox = (sh, w, hh) => {
    if (!Array.isArray(sh.nameOff)) return null;
    const [ax, ay] = shapeCenter(sh);
    const cx = ax + sh.nameOff[0], cy = ay + sh.nameOff[1];
    return [cx - w / 2, cy - hh / 2, cx + w / 2, cy + hh / 2];
  };
  const bad = (box) => box[0] < 12 || box[2] > 988 || box[1] < 12 || box[3] > 458;
  {
    const persons = list.filter((s) => s.t === 'person').sort((a, b) => a.y - b.y || a.x - b.x);
    for (const s of persons) {
      const pr = personRole(s, idx);
      const c = pr ? null : personCast(s, idx);
      const parts = c ? rolesOf(c).map((r, i) => (r.label && roleVisible(roleVis, c.id, i, s.ring) ? r.label : '')) : [];
      // 役で置いた人：その役の名前だけ（役が決まっていれば、メンバーの図ごとの表示・非表示に従う）
      if (pr && (!pr.c || roleVisible(roleVis, pr.c.id, pr.i, s.ring, true))) parts.push(roleShort(pr.role, pr.c && pr.c.roles[pr.i]));
      if (s.label) parts.push(s.label);
      const text = parts.filter(Boolean).join('・');
      if (!text) continue;
      const r = s.r || 20;
      const w = textW(text, ROLE_FS), hh = ROLE_FS * 1.1, g = 3;
      const cands = [
        [s.x + r + g, s.y - hh / 2], [s.x - r - g - w, s.y - hh / 2],
        [s.x - w / 2, s.y + r + 1], [s.x - w / 2, s.y - r - hh - 1],
        [s.x + r * 0.7, s.y - r - hh * 0.7], [s.x + r * 0.7, s.y + r * 0.6],
        [s.x - r * 0.7 - w, s.y - r - hh * 0.7], [s.x - r * 0.7 - w, s.y + r * 0.6],
      ];
      // 近くに空きがないときのために、少し離れた場所も候補にする
      for (const d of [10, 22]) {
        cands.push([s.x + r + g + d, s.y - hh / 2], [s.x - r - g - w - d, s.y - hh / 2], [s.x - w / 2, s.y + r + 1 + d], [s.x - w / 2, s.y - r - hh - 1 - d]);
      }
      let best = null, bestScore = Infinity;
      // 手で動かした位置があれば、そこに置く
      const fixed = Array.isArray(s.labelOff);
      if (fixed) { const cx = s.x + s.labelOff[0], cy = s.y + s.labelOff[1]; best = [cx - w / 2, cy - hh / 2, cx + w / 2, cy + hh / 2]; bestScore = 0; }
      for (let i = 0; !fixed && i < cands.length; i++) {
        const [x, y] = cands[i];
        const box = [x, y, x + w, y + hh];
        // 線にかかる場所は大きく減点（字と線が重ならないように）
        let score = i * 0.5 + (bad(box) ? 5000 : 0) + lineHits(segs, box) * 3000;
        for (const o of obstacles) score += overlapArea(box, o) * 3;
        for (const o of placed) score += overlapArea(box, o) * 3;
        if (score < bestScore) { bestScore = score; best = box; }
        if (score < 1) break;
      }
      placed.push(best);
      out.push(h('text', {
        key: 'rl' + s.id, x: best[0], y: best[1] + hh * 0.52, 'dominant-baseline': 'central', 'font-size': ROLE_FS,
        fill: '#111', 'font-family': LABEL_FONT, class: 'role-label', ...HALO, ...dragAttrs(s.id, 'role', best),
      }, text));
    }
  }
  // 線・矢印の名前：線の真ん中の横の、空いている側に置く
  for (const s of list.filter((x) => (x.t === 'line' || x.t === 'arrow') && x.name && x.showName !== false)) {
    const text = s.name;
    const w = textW(text, NAME_FS), hh = NAME_FS * 1.15;
    const pts = s.t === 'line' ? linePoints(s) : [[s.x1, s.y1], [s.x2, s.y2]];
    const L = polyLength(pts);
    let best = null, bestScore = Infinity;
    const fixedL = nameBox(s, w, hh);
    if (fixedL) best = fixedL;
    for (const f of fixedL ? [] : [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const m = pointAt(pts, L * f);
      const nx = -m.uy, ny = m.ux;
      const off = (s.t === 'arrow' && s.style === 'block' ? (s.width || 46) : 8) + 6;
      for (const sg of [-1, 1]) {
        // 法線方向へ、文字の箱が線にかからない距離だけ離す
        const ext = Math.abs(nx) * w / 2 + Math.abs(ny) * hh / 2;
        const cx = m.x + sg * nx * (off + ext), cy = m.y + sg * ny * (off + ext);
        const box = [cx - w / 2, cy - hh / 2, cx + w / 2, cy + hh / 2];
        let score = Math.abs(f - 0.5) * 40 + (sg > 0 ? 1 : 0) + (bad(box) ? 1e6 : 0) + lineHits(segs, box) * 3000;
        for (const o of obstacles) score += overlapArea(box, o);
        for (const o of placed) score += overlapArea(box, o);
        if (score < bestScore) { bestScore = score; best = box; }
      }
    }
    placed.push(best);
    out.push(h('text', {
      key: 'nl' + s.id, x: (best[0] + best[2]) / 2, y: (best[1] + best[3]) / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': NAME_FS, fill: '#222', 'font-family': LABEL_FONT, class: 'name-label', ...HALO, ...dragAttrs(s.id, 'name', best),
    }, text));
  }
  const regions = list.filter((s) => isRegion(s) && s.name && s.showName !== false);
  for (const s of regions) {
    const text = s.name;
    const w = textW(text, NAME_FS), hh = NAME_FS * 1.15;
    const bb = shapeBBox(s);
    const [cx, cy] = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    let best = null, bestScore = Infinity;
    const step = 14;
    const fixedR = nameBox(s, w, hh);
    if (fixedR) { best = fixedR; bestScore = 0; }
    for (let y = bb[1] + hh / 2; !fixedR && y <= bb[3] - hh / 2; y += step) {
      for (let x = bb[0] + w / 2; x <= bb[2] - w / 2; x += step) {
        const box = [x - w / 2, y - hh / 2, x + w / 2, y + hh / 2];
        if (!insideShape(s, box[0], box[1], 2) || !insideShape(s, box[2], box[1], 2) || !insideShape(s, box[0], box[3], 2) || !insideShape(s, box[2], box[3], 2)) continue;
        let score = Math.hypot(x - cx, y - cy) * 0.02 + lineHits(segs, box) * 3000;
        for (const o of obstacles) score += overlapArea(box, o);
        for (const o of placed) score += overlapArea(box, o);
        if (score < bestScore) { bestScore = score; best = box; }
      }
    }
    if (!fixedR && (!best || bestScore > w * hh * 0.25)) {
      // 内側に空きがなければ、外側の上か下に置く
      const top = [cx - w / 2, bb[1] - hh - 2, cx + w / 2, bb[1] - 2];
      const bot = [cx - w / 2, bb[3] + 2, cx + w / 2, bb[3] + hh + 2];
      const sc = (box) => (bad(box) ? 1e6 : 0) + obstacles.concat(placed).reduce((a, o) => a + overlapArea(box, o), 0);
      const alt = sc(top) <= sc(bot) ? top : bot;
      if (!best || sc(alt) < bestScore) best = alt;
    }
    placed.push(best);
    out.push(h('text', {
      key: 'nl' + s.id, x: (best[0] + best[2]) / 2, y: (best[1] + best[3]) / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': NAME_FS, fill: '#222', 'font-family': LABEL_FONT, class: 'name-label', ...HALO, ...dragAttrs(s.id, 'name', best),
    }, text));
  }
  return out;
}

// 静的な図（一覧・PDF用）
export function StageSVG(shapes, { cls = 'stage', idx = null, roleVis = {} } = {}) {
  const list = sortShapes(shapes);
  return h('svg', { class: cls, viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg', preserveAspectRatio: 'xMidYMid meet' },
    stageFrame(),
    h('g', null, list.map((s) => shapeNode(s, { idx }))),
    h('g', null, layoutLabels(list, idx, roleVis)));
}
