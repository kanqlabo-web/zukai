// 文字と図をベクター（文字は文字データのまま）でPDFにする
// 画面に並べたA4のページを、ブラウザが配置したとおりの位置で、PDFの命令に置き換える。
//  ・文字：fonts/g/ の字形データ（Noto Sans CJK JP・Liberation Sans）から Type3 フォントを作って埋め込む。
//          使った文字だけを入れる。文字として選んだり検索したりできる（ToUnicode つき）
//  ・図（SVG）：線・円・楕円・四角・パス・文字をそのままベクターで描く
//  ・写真：JPEG のまま貼る

const A4W = 595.28, A4H = 841.89;
const GLYPH_BASE = 'fonts/g/';

// ---------- 字形データ ----------
const chunkCache = new Map(); // 'jp4/30' -> Promise<obj>
function loadChunk(key, hi) {
  const id = `${key}/${hi.toString(16).padStart(2, '0')}`;
  if (!chunkCache.has(id)) {
    chunkCache.set(id, fetch(GLYPH_BASE + id + '.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return chunkCache.get(id);
}
const glyphs = new Map(); // 'jp4:12354' -> [adv, path] | null
async function prepare(needs) {
  // needs: Set of 'key:cp'
  const byChunk = new Map();
  for (const n of needs) {
    if (glyphs.has(n)) continue;
    const [key, cps] = n.split(':');
    const cp = Number(cps);
    const id = key + '/' + (cp >> 8);
    if (!byChunk.has(id)) byChunk.set(id, [key, cp >> 8]);
  }
  await Promise.all([...byChunk.values()].map(async ([key, hi]) => {
    const data = await loadChunk(key, hi);
    for (const cp in data) glyphs.set(key + ':' + cp, data[cp]);
  }));
  for (const n of needs) if (!glyphs.has(n)) glyphs.set(n, null);
}
const hasGlyph = (key, cp) => !!glyphs.get(key + ':' + cp);

// 字形のパス（相対座標の m l c q z）を、変換してPDFのパスにする
function glyphOps(d, tf) {
  const out = [];
  let cx = 0, cy = 0;
  const re = /([mlcqz])([^mlcqz]*)/g;
  let m;
  const P = (x, y) => { const [a, b] = tf(x, y); return `${num(a)} ${num(b)}`; };
  while ((m = re.exec(d))) {
    const c = m[1];
    const v = m[2].match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    const bx = cx, by = cy;
    if (c === 'm') { cx = bx + v[0]; cy = by + v[1]; out.push(P(cx, cy) + ' m'); }
    else if (c === 'l') { cx = bx + v[0]; cy = by + v[1]; out.push(P(cx, cy) + ' l'); }
    else if (c === 'c') {
      out.push(`${P(bx + v[0], by + v[1])} ${P(bx + v[2], by + v[3])} ${P(bx + v[4], by + v[5])} c`);
      cx = bx + v[4]; cy = by + v[5];
    } else if (c === 'q') {
      const qx = bx + v[0], qy = by + v[1], ex = bx + v[2], ey = by + v[3];
      out.push(`${P(bx + (2 / 3) * (qx - bx), by + (2 / 3) * (qy - by))} ${P(ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey))} ${P(ex, ey)} c`);
      cx = ex; cy = ey;
    } else if (c === 'z') { out.push('h'); } // 次の m は、閉じる前の最後の点からの相対（作るときと同じ）
  }
  return out.join('\n');
}
const num = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };

// どの字形で描くか（画面の font-family に合わせる）
function fontKeyFor(cp, family, bold) {
  const w = bold ? '7' : '4';
  if (cp === 0x25CF && /ZukaiDot/i.test(family)) return 'dot';
  const latinFirst = /^\s*"?(Arial|Arimo|ZukaiDot)/i.test(family) || /^\s*ZukaiDot\s*,\s*Arial/i.test(family);
  if (latinFirst && (cp < 0x2E80) && !(cp >= 0x2460 && cp <= 0x24FF) && !(cp >= 0x2500 && cp < 0x2E80) && hasGlyph('la' + w, cp)) return 'la' + w;
  if (hasGlyph('jp' + w, cp)) return 'jp' + w;
  if (hasGlyph('la' + w, cp)) return 'la' + w;
  return null;
}
function candidates(cp, family, bold) {
  const w = bold ? '7' : '4';
  const out = ['jp' + w + ':' + cp];
  if (cp < 0x2E80) out.push('la' + w + ':' + cp);
  if (cp === 0x25CF && /ZukaiDot/i.test(family)) out.push('dot:' + cp);
  return out;
}

// ---------- Type3 フォント（256字ずつ） ----------
class Fonts {
  constructor() { this.map = new Map(); this.subs = []; }
  // 字形 key:cp を、PDFのフォント名と1バイトの番号にする
  use(key, cp) {
    const id = key + ':' + cp;
    let u = this.map.get(id);
    if (u) return u;
    let sub = this.subs.find((s) => s.key === key && s.cps.length < 255);
    if (!sub) { sub = { key, cps: [], name: 'T' + (this.subs.length + 1) }; this.subs.push(sub); }
    sub.cps.push(cp);
    u = { name: sub.name, code: sub.cps.length };
    this.map.set(id, u);
    return u;
  }
}

// ---------- 色 ----------
let colorCanvas = null;
function rgb(c) {
  if (!c || c === 'none' || c === 'transparent') return null;
  let m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) {
    colorCanvas = colorCanvas || document.createElement('canvas').getContext('2d');
    colorCanvas.fillStyle = '#000';
    colorCanvas.fillStyle = c;
    const v = colorCanvas.fillStyle;
    if (v.startsWith('#')) {
      const n = parseInt(v.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    m = /rgba?\(([^)]+)\)/.exec(v);
    if (!m) return null;
  }
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const a = p.length >= 4 ? p[3] : 1;
  if (a === 0) return null;
  return [p[0], p[1], p[2], a];
}
// 半透明は白と混ぜる（背景はほぼ白なので）
const mix = (c) => c.slice(0, 3).map((v) => (v * c[3] + 255 * (1 - c[3])) / 255);
const fillCol = (c) => mix(c).map(num).join(' ') + ' rg';
const strokeCol = (c) => mix(c).map(num).join(' ') + ' RG';

// ---------- SVGのパス d を PDF に ----------
function svgPathOps(d) {
  const out = [];
  const toks = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, lcx = null, lcy = null, lq = null;
  const n = () => Number(toks[i++]);
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
  const P = (x, y) => `${num(x)} ${num(y)}`;
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { out.push('h'); cx = sx; cy = sy; lcx = lq = null; continue; }
    if (!isNum()) { if (C !== 'Z') i++; continue; }
    if (C === 'M') {
      let x = n(), y = n(); if (rel) { x += cx; y += cy; }
      out.push(P(x, y) + ' m'); cx = sx = x; cy = sy = y; lcx = lq = null;
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') { let x = n(), y = n(); if (rel) { x += cx; y += cy; } out.push(P(x, y) + ' l'); cx = x; cy = y; lcx = lq = null; }
    else if (C === 'H') { let x = n(); if (rel) x += cx; out.push(P(x, cy) + ' l'); cx = x; lcx = lq = null; }
    else if (C === 'V') { let y = n(); if (rel) y += cy; out.push(P(cx, y) + ' l'); cy = y; lcx = lq = null; }
    else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = n(); y1 = n(); if (rel) { x1 += cx; y1 += cy; } }
      else { x1 = lcx != null ? 2 * cx - lcx : cx; y1 = lcy != null ? 2 * cy - lcy : cy; }
      let x2 = n(), y2 = n(), x = n(), y = n();
      if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
      out.push(`${P(x1, y1)} ${P(x2, y2)} ${P(x, y)} c`);
      lcx = x2; lcy = y2; lq = null; cx = x; cy = y;
    } else if (C === 'Q' || C === 'T') {
      let qx, qy;
      if (C === 'Q') { qx = n(); qy = n(); if (rel) { qx += cx; qy += cy; } }
      else { qx = lq ? 2 * cx - lq[0] : cx; qy = lq ? 2 * cy - lq[1] : cy; }
      let x = n(), y = n(); if (rel) { x += cx; y += cy; }
      out.push(`${P(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy))} ${P(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y))} ${P(x, y)} c`);
      lq = [qx, qy]; lcx = null; cx = x; cy = y;
    } else if (C === 'A') {
      const rx = n(), ry = n(), rot = n(), large = n(), sweep = n();
      let x = n(), y = n(); if (rel) { x += cx; y += cy; }
      for (const seg of arcToBeziers(cx, cy, rx, ry, rot, large, sweep, x, y)) out.push(`${P(seg[0], seg[1])} ${P(seg[2], seg[3])} ${P(seg[4], seg[5])} c`);
      cx = x; cy = y; lcx = lq = null;
    } else i++;
  }
  return out.join('\n');
}
function arcToBeziers(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  let l = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
  const s = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (s * rx * y1p) / ry, cyp = (-s * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out = [];
  const d = dt / segs, k = (4 / 3) * Math.tan(d / 4);
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const dpt = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let i = 0; i < segs; i++) {
    const a = t1 + i * d, b = a + d;
    const p0 = pt(a), p1 = pt(b), d0 = dpt(a), d1 = dpt(b);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]]);
  }
  return out;
}
function ellipseOps(cx, cy, rx, ry) {
  const k = 0.5522847498;
  const P = (x, y) => `${num(x)} ${num(y)}`;
  return [
    `${P(cx + rx, cy)} m`,
    `${P(cx + rx, cy + ry * k)} ${P(cx + rx * k, cy + ry)} ${P(cx, cy + ry)} c`,
    `${P(cx - rx * k, cy + ry)} ${P(cx - rx, cy + ry * k)} ${P(cx - rx, cy)} c`,
    `${P(cx - rx, cy - ry * k)} ${P(cx - rx * k, cy - ry)} ${P(cx, cy - ry)} c`,
    `${P(cx + rx * k, cy - ry)} ${P(cx + rx, cy - ry * k)} ${P(cx + rx, cy)} c`, 'h'].join('\n');
}
function roundRectOps(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `${num(x)} ${num(y)} ${num(w)} ${num(h)} re`;
  const k = 0.5522847498 * r;
  const P = (a, b) => `${num(a)} ${num(b)}`;
  return [`${P(x + r, y)} m`, `${P(x + w - r, y)} l`, `${P(x + w - r + k, y)} ${P(x + w, y + r - k)} ${P(x + w, y + r)} c`,
    `${P(x + w, y + h - r)} l`, `${P(x + w, y + h - r + k)} ${P(x + w - r + k, y + h)} ${P(x + w - r, y + h)} c`,
    `${P(x + r, y + h)} l`, `${P(x + r - k, y + h)} ${P(x, y + h - r + k)} ${P(x, y + h - r)} c`,
    `${P(x, y + r)} l`, `${P(x, y + r - k)} ${P(x + r - k, y)} ${P(x + r, y)} c`, 'h'].join('\n');
}

// ---------- 1ページ ----------
// まず「描くもの」を集め（文字は字形を読み込んでから決める）、そのあと PDF の命令にする
function fontMetrics(font) {
  const ctx = fontMetrics.ctx || (fontMetrics.ctx = document.createElement('canvas').getContext('2d'));
  ctx.font = font;
  const m = ctx.measureText('Ag');
  return [m.fontBoundingBoxAscent, m.fontBoundingBoxDescent];
}

function collectPage(page, images) {
  const items = []; // {k:'rect'|'ell'|'text'|'img'|'clip'|'unclip'|'svg', ...}
  const pr = page.getBoundingClientRect();
  const fit = pr.width / page.offsetWidth || 1;
  const R = (r) => ({ x: (r.left - pr.left) / fit, y: (r.top - pr.top) / fit, w: r.width / fit, h: r.height / fit });

  const textItem = (node, cs) => {
    const text = node.nodeValue;
    if (!text || !text.trim()) return;
    const col = rgb(cs.color);
    if (!col) return;
    const fs = parseFloat(cs.fontSize);
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
    const [asc0, desc0] = fontMetrics(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
    const asc = asc0 != null ? asc0 : fs * 0.9, desc = desc0 != null ? desc0 : fs * 0.22;
    const range = document.createRange();
    let i = 0;
    for (const ch of text) {
      const n = ch.length;
      if (ch.trim() || ch === ' ' || ch === '\u3000') {
        range.setStart(node, i); range.setEnd(node, i + n);
        const rs = range.getClientRects();
        if (rs.length) {
          const r = R(rs[0]);
          const base = r.y + (r.h - (asc + desc)) / 2 + asc;
          items.push({ k: 'text', cp: ch.codePointAt(0), x: r.x, y: base, size: fs, bold, family: cs.fontFamily, col });
        }
      }
      i += n;
    }
  };

  const walk = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const rects = el.getClientRects();
    const box = R(el.getBoundingClientRect());
    const tag = el.tagName.toLowerCase();
    const bg = rgb(cs.backgroundColor);
    if (bg) {
      const round = parseFloat(cs.borderTopLeftRadius) || 0;
      for (const rr of rects) {
        const r = R(rr);
        if (round >= Math.min(r.w, r.h) / 2 - 0.5) items.push({ k: 'ell', x: r.x + r.w / 2, y: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2, col: bg });
        else items.push({ k: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, r: round, col: bg });
      }
    }
    if (tag === 'svg') { items.push({ k: 'svg', el, box }); return; }
    if (tag === 'img') { if (el.complete && el.naturalWidth) items.push({ k: 'img', el, box }); return; }
    for (const [side, rect] of [
      ['Top', (w) => [box.x, box.y, box.w, w]], ['Bottom', (w) => [box.x, box.y + box.h - w, box.w, w]],
      ['Left', (w) => [box.x, box.y, w, box.h]], ['Right', (w) => [box.x + box.w - w, box.y, w, box.h]]]) {
      const w = parseFloat(cs['border' + side + 'Width']) || 0;
      if (!w || cs['border' + side + 'Style'] === 'none' || cs['border' + side + 'Style'] === 'hidden') continue;
      const col = rgb(cs['border' + side + 'Color']);
      if (!col) continue;
      const [x, y, ww, hh] = rect(w);
      items.push({ k: 'rect', x, y, w: ww, h: hh, col });
    }
    const clip = cs.overflow === 'hidden' || cs.overflowX === 'hidden';
    if (clip) items.push({ k: 'clip', x: box.x, y: box.y, w: box.w, h: box.h });
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) textItem(ch, cs);
      else if (ch.nodeType === 1) walk(ch);
    }
    if (clip) items.push({ k: 'unclip' });
  };
  walk(page);
  return { items, pr, fit, W: page.offsetWidth, H: page.offsetHeight };
}

// SVG の中身を集める（座標は要素ごとの行列つき）
function collectSvg(svg, pr, fit) {
  const out = [];
  const base = new DOMMatrix().scale(1 / fit, 1 / fit).translate(-pr.left, -pr.top);
  const mat = (el) => { const m = el.getScreenCTM(); return m ? base.multiply(DOMMatrix.fromMatrix(m)) : null; };
  // 図の外枠で切る
  const sb = svg.getBoundingClientRect();
  out.push({ k: 'clip', x: (sb.left - pr.left) / fit, y: (sb.top - pr.top) / fit, w: sb.width / fit, h: sb.height / fit });
  const walk = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'g' || tag === 'svg') { for (const c of el.children) walk(c); return; }
    if (tag === 'defs' || tag === 'title' || tag === 'style') return;
    const m = mat(el);
    if (!m) return;
    const op = parseFloat(cs.opacity);
    const style = {
      fill: rgb(cs.fill), stroke: rgb(cs.stroke), sw: parseFloat(cs.strokeWidth) || 1,
      dash: cs.strokeDasharray && cs.strokeDasharray !== 'none' ? cs.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter((v) => !isNaN(v)) : null,
      cap: cs.strokeLinecap, join: cs.strokeLinejoin, miter: parseFloat(cs.strokeMiterlimit) || 4,
      fo: parseFloat(cs.fillOpacity), so: parseFloat(cs.strokeOpacity), op: isNaN(op) ? 1 : op,
      paintOrder: cs.paintOrder || 'normal',
    };
    if (style.fill) style.fill[3] *= (isNaN(style.fo) ? 1 : style.fo) * style.op;
    if (style.stroke) style.stroke[3] *= (isNaN(style.so) ? 1 : style.so) * style.op;
    const A = (n) => parseFloat(el.getAttribute(n)) || 0;
    let path = null;
    if (tag === 'circle') path = ellipseOps(A('cx'), A('cy'), A('r'), A('r'));
    else if (tag === 'ellipse') path = ellipseOps(A('cx'), A('cy'), A('rx'), A('ry'));
    else if (tag === 'rect') path = roundRectOps(A('x'), A('y'), A('width'), A('height'), A('rx') || A('ry'));
    else if (tag === 'line') { path = `${num(A('x1'))} ${num(A('y1'))} m\n${num(A('x2'))} ${num(A('y2'))} l`; style.fill = null; }
    else if (tag === 'polygon' || tag === 'polyline') {
      const p = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      const parts = [];
      for (let i = 0; i + 1 < p.length; i += 2) parts.push(`${num(p[i])} ${num(p[i + 1])} ${i ? 'l' : 'm'}`);
      if (tag === 'polygon') parts.push('h');
      path = parts.join('\n');
    } else if (tag === 'image') {
      // 図に貼り付けた画像
      const href = el.getAttribute('href') || el.getAttribute('xlink:href');
      if (href) out.push({ k: 'simg', m, href, x: A('x'), y: A('y'), w: A('width'), h: A('height') });
      return;
    } else if (tag === 'path') path = svgPathOps(el.getAttribute('d') || '');
    else if (tag === 'text') {
      const n = el.getNumberOfChars();
      const str = el.textContent;
      const chars = [...str];
      // getNumberOfChars は UTF-16 の数。サロゲートはまず無いので、そのまま対応させる
      const fs = parseFloat(cs.fontSize);
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      const [asc0, desc0] = fontMetrics(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
      const asc = asc0 != null ? asc0 : fs * 0.9, desc = desc0 != null ? desc0 : fs * 0.22;
      const list = [];
      let ci = 0;
      for (let i = 0; i < n && ci < chars.length; i++) {
        const ch = chars[ci];
        if (ch.length === 2) { ci++; i++; }
        else ci++;
        if (!ch.trim()) continue;
        let ext;
        try { ext = el.getExtentOfChar(i - (ch.length === 2 ? 1 : 0)); } catch (e) { continue; }
        const base = ext.y + (ext.height - (asc + desc)) / 2 + asc;
        list.push({ cp: ch.codePointAt(0), x: ext.x, y: base });
      }
      out.push({ k: 'stext', m, chars: list, size: fs, bold, family: cs.fontFamily, style });
      return;
    } else return;
    out.push({ k: 'spath', m, path, style });
  };
  for (const c of svg.children) walk(c);
  out.push({ k: 'unclip' });
  return out;
}

// ---------- PDF に組み立てる ----------
export async function buildVectorPdf(pages, onProgress) {
  if (document.fonts) await document.fonts.ready;
  const collected = [];
  for (const page of pages) {
    const c = collectPage(page);
    const items = [];
    for (const it of c.items) {
      if (it.k === 'svg') items.push(...collectSvg(it.el, c.pr, c.fit));
      else items.push(it);
    }
    c.items = items;
    collected.push(c);
  }
  // 使う字形を読み込む
  const needs = new Set();
  for (const c of collected) for (const it of c.items) {
    if (it.k === 'text') for (const n of candidates(it.cp, it.family, it.bold)) needs.add(n);
    if (it.k === 'stext') for (const ch of it.chars) for (const n of candidates(ch.cp, it.family, it.bold)) needs.add(n);
  }
  await prepare(needs);

  const fonts = new Fonts();
  const imgs = []; // {bytes,w,h}
  const contents = [];
  for (let pi = 0; pi < collected.length; pi++) {
    const c = collected[pi];
    const k = A4W / c.W;
    const ops = [`${num(k)} 0 0 ${num(-k)} 0 ${num(A4H)} cm`, '1 1 1 rg', `0 0 ${num(c.W)} ${num(c.H)} re f`];
    const setStroke = (st) => {
      const o = [strokeCol(st.stroke), `${num(st.sw)} w`];
      o.push(`${{ round: 1, square: 2 }[st.cap] || 0} J`, `${{ round: 1, bevel: 2 }[st.join] || 0} j`, `${num(st.miter)} M`);
      o.push(st.dash && st.dash.length && st.dash.some((v) => v > 0) ? `[${st.dash.map(num).join(' ')}] 0 d` : '[] 0 d');
      return o.join(' ');
    };
    const drawGlyph = (key, cp, x, y, size, col) => {
      const u = fonts.use(key, cp);
      ops.push(`BT ${fillCol(col)} /${u.name} ${num(size)} Tf 1 0 0 -1 ${num(x)} ${num(y)} Tm <${u.code.toString(16).padStart(2, '0')}> Tj ET`);
    };
    for (const it of c.items) {
      if (it.k === 'rect') ops.push(`${fillCol(it.col)} ${it.r ? roundRectOps(it.x, it.y, it.w, it.h, it.r) : `${num(it.x)} ${num(it.y)} ${num(it.w)} ${num(it.h)} re`} f`);
      else if (it.k === 'ell') ops.push(`${fillCol(it.col)} ${ellipseOps(it.x, it.y, it.rx, it.ry)} f`);
      else if (it.k === 'clip') ops.push(`q ${num(it.x)} ${num(it.y)} ${num(it.w)} ${num(it.h)} re W n`);
      else if (it.k === 'unclip') ops.push('Q');
      else if (it.k === 'text') {
        const key = fontKeyFor(it.cp, it.family, it.bold);
        if (key) drawGlyph(key, it.cp, it.x, it.y, it.size, it.col);
      } else if (it.k === 'img') {
        const im = await jpegOf(it.el);
        if (!im) continue;
        imgs.push(im);
        const b = it.box;
        ops.push(`q ${num(b.w)} 0 0 ${num(-b.h)} ${num(b.x)} ${num(b.y + b.h)} cm /Im${imgs.length} Do Q`);
      } else if (it.k === 'simg') {
        const el = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = it.href; });
        const im = el && await jpegOf(el);
        if (!im) continue;
        imgs.push(im);
        const m = it.m;
        ops.push(`q ${[m.a, m.b, m.c, m.d, m.e, m.f].map(num).join(' ')} cm ${num(it.w)} 0 0 ${num(-it.h)} ${num(it.x)} ${num(it.y + it.h)} cm /Im${imgs.length} Do Q`);
      } else if (it.k === 'spath') {
        const st = it.style;
        if (!st.fill && !st.stroke) continue;
        const m = it.m;
        const paint = st.fill && st.stroke ? 'B' : st.fill ? 'f' : 'S';
        ops.push(`q ${[m.a, m.b, m.c, m.d, m.e, m.f].map(num).join(' ')} cm ${st.fill ? fillCol(st.fill) : ''} ${st.stroke ? setStroke(st) : ''}\n${it.path}\n${paint} Q`);
      } else if (it.k === 'stext') {
        const st = it.style, m = it.m;
        ops.push(`q ${[m.a, m.b, m.c, m.d, m.e, m.f].map(num).join(' ')} cm`);
        const keyed = it.chars.map((ch) => ({ ...ch, key: fontKeyFor(ch.cp, it.family, it.bold) })).filter((ch) => ch.key);
        // 文字のふち（白い縁取り）：字形の形をそのまま太い線で描いてから、文字を重ねる
        if (st.stroke && st.sw > 0 && /^stroke/.test(st.paintOrder)) {
          const s = it.size / 1000;
          const parts = keyed.map((ch) => glyphOps(glyphs.get(ch.key + ':' + ch.cp)[1], (gx, gy) => [ch.x + gx * s, ch.y - gy * s]));
          ops.push(`${setStroke({ ...st, cap: 'round', join: st.join })}\n${parts.join('\n')}\nS`);
        }
        if (st.fill) for (const ch of keyed) drawGlyph(ch.key, ch.cp, ch.x, ch.y, it.size, st.fill);
        ops.push('Q');
      }
    }
    contents.push(ops.join('\n'));
    if (onProgress) onProgress(pi + 1, collected.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return writePdf(contents, fonts, imgs);
}

function jpegOf(img) {
  return new Promise((resolve) => {
    try {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0);
      cv.toBlob(async (b) => resolve(b ? { bytes: new Uint8Array(await b.arrayBuffer()), w: cv.width, h: cv.height } : null), 'image/jpeg', 0.92);
    } catch (e) { resolve(null); }
  });
}

function utf16hex(cp) {
  const s = String.fromCodePoint(cp);
  let h = '';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
  return h;
}

function writePdf(contents, fonts, imgs) {
  const enc = new TextEncoder();
  const parts = [];
  let size = 0;
  const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  let nextId = 3;
  const alloc = () => nextId++;
  const objs = []; // [id, chunks]
  // 番号を先に決める
  const pageIds = contents.map(() => ({ page: alloc(), content: alloc() }));
  const fontIds = fonts.subs.map((s) => ({ font: alloc(), tu: alloc(), procs: s.cps.map(() => alloc()) }));
  const imgIds = imgs.map(() => alloc());
  const fontRes = fonts.subs.map((s, i) => `/${s.name} ${fontIds[i].font} 0 R`).join(' ');
  const imgRes = imgs.map((_, i) => `/Im${i + 1} ${imgIds[i]} 0 R`).join(' ');
  const resources = `<< /Font << ${fontRes} >> /XObject << ${imgRes} >> >>`;
  const stream = (dict, body) => {
    const b = typeof body === 'string' ? enc.encode(body) : body;
    return [`<< ${dict} /Length ${b.length} >>\nstream\n`, b, '\nendstream'];
  };
  objs.push([1, ['<< /Type /Catalog /Pages 2 0 R >>']]);
  objs.push([2, [`<< /Type /Pages /Kids [${pageIds.map((p) => p.page + ' 0 R').join(' ')}] /Count ${contents.length} >>`]]);
  contents.forEach((c, i) => {
    objs.push([pageIds[i].page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${A4H}] /Resources ${resources} /Contents ${pageIds[i].content} 0 R >>`]]);
    objs.push([pageIds[i].content, stream('', c)]);
  });
  fonts.subs.forEach((s, i) => {
    const ids = fontIds[i];
    const widths = [];
    const diffs = [];
    const bfc = [];
    s.cps.forEach((cp, j) => {
      const g = glyphs.get(s.key + ':' + cp) || [500, ''];
      const code = j + 1;
      widths.push(g[0]);
      diffs.push(`/g${code}`);
      bfc.push(`<${code.toString(16).padStart(2, '0')}> <${utf16hex(cp)}>`);
      objs.push([ids.procs[j], stream('', `${g[0]} 0 d0\n${g[1] ? glyphOps(g[1], (x, y) => [x, y]) + '\nf' : ''}`)]);
    });
    const procs = s.cps.map((_, j) => `/g${j + 1} ${ids.procs[j]} 0 R`).join(' ');
    objs.push([ids.font, [`<< /Type /Font /Subtype /Type3 /FontBBox [-1000 -1000 2000 2000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << ${procs} >> /Encoding << /Type /Encoding /Differences [1 ${diffs.join(' ')}] >> /FirstChar 1 /LastChar ${s.cps.length} /Widths [${widths.join(' ')}] /Resources << >> /ToUnicode ${ids.tu} 0 R >>`]]);
    const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n`
      + chunks(bfc, 100).map((g) => `${g.length} beginbfchar\n${g.join('\n')}\nendbfchar\n`).join('')
      + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    objs.push([ids.tu, stream('', cmap)]);
  });
  imgs.forEach((im, i) => {
    objs.push([imgIds[i], stream(`/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, im.bytes)]);
  });
  objs.sort((a, b) => a[0] - b[0]);
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  for (const [id, ch] of objs) {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    for (const x of ch) push(x);
    push('\nendobj\n');
  }
  const xref = size;
  let x = `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let k = 1; k < nextId; k++) x += String(offsets[k] || 0).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
