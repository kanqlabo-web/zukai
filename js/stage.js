// 舞台図の描画（編集画面・一覧・PDFで共通）
import { h } from './vdom.js';

export const W = 1000;
export const H = 470;
const INK = '#1a1a1a';
const NUM = '#e60012';
export const FILLS = { white: '#ffffff', gray: '#c8c8c8', black: '#1a1a1a' };
export const LAYER = { blob: 0, ellipse: 0, rect: 0, arrow: 1, person: 2, text: 3 };

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
  if (s.t === 'blob') {
    const p = s.pts || [];
    if (!p.length) return [0, 0];
    return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
  }
  return [s.x, s.y];
}

export function moveShape(s, dx, dy) {
  const n = { ...s };
  if (s.t === 'arrow') { n.x1 += dx; n.y1 += dy; n.x2 += dx; n.y2 += dy; }
  else if (s.t === 'blob') n.pts = s.pts.map((p) => [p[0] + dx, p[1] + dy]);
  else { n.x += dx; n.y += dy; }
  return n;
}

const HIT = { stroke: 'transparent', 'stroke-width': 22, fill: 'none', 'pointer-events': 'stroke' };

export function shapeNode(s, { selected = false, interactive = false } = {}) {
  const sel = selected ? ' sel' : '';
  const common = { key: s.id, 'data-id': interactive ? s.id : null, class: 'shape' + sel };
  const dash = s.dashed ? '12 9' : null;
  const sw = s.sw || 3;
  if (s.t === 'person') {
    const r = s.r || 20;
    const label = s.no == null ? '' : String(s.no);
    const fs = label.length <= 1 ? r * 1.1 : label.length === 2 ? r * 0.98 : r * 0.78;
    return h('g', { ...common, transform: `translate(${s.x},${s.y})` },
      h('circle', { r, fill: FILLS[s.fill] || '#fff', stroke: INK, 'stroke-width': 2.4 }),
      label ? h('text', {
        'text-anchor': 'middle', 'dominant-baseline': 'central', y: 1, fill: NUM,
        'font-size': fs.toFixed(1), 'font-weight': 700, 'font-family': 'Arial, Helvetica, sans-serif',
      }, label) : null,
      selected ? h('circle', { r: r + 7, fill: 'none', class: 'sel-ring' }) : null,
    );
  }
  if (s.t === 'ellipse' || s.t === 'rect') {
    const fill = s.fill === 'light' ? '#ececec' : s.fill === 'white' ? '#fff' : 'none';
    const tr = `translate(${s.x},${s.y}) rotate(${s.rot || 0})`;
    const shape = s.t === 'ellipse'
      ? h('ellipse', { rx: s.rx, ry: s.ry, fill, stroke: INK, 'stroke-width': sw, 'stroke-dasharray': dash })
      : h('rect', { x: -s.w / 2, y: -s.h / 2, width: s.w, height: s.h, rx: s.round ? Math.min(28, s.w / 4, s.h / 4) : 0, fill, stroke: INK, 'stroke-width': sw, 'stroke-dasharray': dash });
    const hit = s.t === 'ellipse'
      ? h('ellipse', { rx: s.rx, ry: s.ry, ...HIT })
      : h('rect', { x: -s.w / 2, y: -s.h / 2, width: s.w, height: s.h, ...HIT });
    return h('g', { ...common, transform: tr }, shape, interactive ? hit : null,
      selected ? (s.t === 'ellipse'
        ? h('ellipse', { rx: s.rx + 8, ry: s.ry + 8, fill: 'none', class: 'sel-ring' })
        : h('rect', { x: -s.w / 2 - 8, y: -s.h / 2 - 8, width: s.w + 16, height: s.h + 16, fill: 'none', class: 'sel-ring' })) : null);
  }
  if (s.t === 'blob') {
    const d = smoothPath(s.pts, true);
    const fill = s.fill === 'light' ? '#ececec' : 'none';
    return h('g', { ...common },
      h('path', { d, fill, stroke: INK, 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-linejoin': 'round' }),
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
        'font-family': '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic",Meiryo,sans-serif',
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

// 静的な舞台図（一覧・PDF用）
export function StageSVG(shapes, cls = 'stage') {
  return h('svg', { class: cls, viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg', preserveAspectRatio: 'xMidYMid meet' },
    stageFrame(),
    h('g', null, sortShapes(shapes).map((s) => shapeNode(s))));
}
