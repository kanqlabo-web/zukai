// Googleドキュメントの「図形描画」で描いた図解（PDFに書き出したもの）を、図解メーカーの図に直す
// ・赤い丸付き数字（①…）→ 人（番号）。外側の円 → 黒い円、後ろの灰色の円 → 塗り
// ・楕円・四角・そのほかの閉じた形 → 楕円・四角・囲み、開いた線 → 線
// ・図の中の文字（PDFでは文字の形の線になっている）→ 字形を見比べて文字に戻す
// 座標：PDFのページ（pt・上から下）→ 舞台（横 10〜990・縦 10〜460）

const GLYPH_BASE = 'fonts/g/';

// ---------- 字形データ ----------
let loadJson = async (path) => { const r = await fetch(GLYPH_BASE + path); return r.ok ? r.json() : {}; };
export function setGlyphLoader(fn) { loadJson = fn; }
const chunks = new Map();
async function glyphOf(key, cp) {
  const id = `${key}/${(cp >> 8).toString(16).padStart(2, '0')}.json`;
  if (!chunks.has(id)) chunks.set(id, loadJson(id).catch(() => ({})));
  const c = await chunks.get(id);
  return c[cp] || null;
}

// ---------- 形を点の並び（多角形）にする ----------
function bez(p0, p1, p2, p3, n, out) {
  for (let i = 1; i <= n; i++) {
    const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}
// PDFの path（['M',x,y] ['L',x,y] ['C',…] ['Z']）→ 部分ごとの点の並び
export function subpaths(path, n = 6) {
  const out = [];
  let cur = null;
  for (const c of path) {
    if (c[0] === 'M') { cur = { pts: [[c[1], c[2]]], closed: false, ops: 'M' }; out.push(cur); }
    else if (!cur) continue;
    else if (c[0] === 'L') { cur.pts.push([c[1], c[2]]); cur.ops += 'L'; }
    else if (c[0] === 'C') { bez(cur.pts[cur.pts.length - 1], [c[1], c[2]], [c[3], c[4]], [c[5], c[6]], n, cur.pts); cur.ops += 'C'; }
    else if (c[0] === 'Z') { cur.closed = true; cur.ops += 'Z'; }
  }
  for (const s of out) {
    const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
    s.x0 = Math.min(...xs); s.x1 = Math.max(...xs); s.y0 = Math.min(...ys); s.y1 = Math.max(...ys);
  }
  return out.filter((s) => s.pts.length > 1);
}
// 字形データ（相対 m l c q z・上向き）→ 点の並び（下向き）
function fontPolys(d) {
  const out = [];
  let cur = null, cx = 0, cy = 0;
  const re = /([mlcqz])([^mlcqz]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const v = (m[2].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const bx = cx, by = cy;
    if (m[1] === 'm') { cx = bx + v[0]; cy = by + v[1]; cur = [[cx, -cy]]; out.push(cur); }
    else if (!cur) continue;
    else if (m[1] === 'l') { cx = bx + v[0]; cy = by + v[1]; cur.push([cx, -cy]); }
    else if (m[1] === 'c') { bez([bx, -by], [bx + v[0], -(by + v[1])], [bx + v[2], -(by + v[3])], [bx + v[4], -(by + v[5])], 5, cur); cx = bx + v[4]; cy = by + v[5]; }
    else if (m[1] === 'q') {
      const qx = bx + v[0], qy = by + v[1], ex = bx + v[2], ey = by + v[3];
      bez([bx, -by], [bx + (2 / 3) * (qx - bx), -(by + (2 / 3) * (qy - by))], [ex + (2 / 3) * (qx - ex), -(ey + (2 / 3) * (qy - ey))], [ex, -ey], 4, cur);
      cx = ex; cy = ey;
    }
  }
  return out.filter((p) => p.length > 2);
}

// ---------- 小さな絵にして見比べる ----------
const G = 32;
// polys を、ink の枠に合わせて G×G に塗る（0/1）。box を渡すとその枠に合わせる
function raster(polys, box) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (box) ({ x0, y0, x1, y1 } = box);
  else for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = x1 - x0, h = y1 - y0, s = Math.max(w, h) || 1;
  const ox = x0 - (s - w) / 2, oy = y0 - (s - h) / 2;
  const bm = new Uint8Array(G * G);
  const edges = [];
  for (const p of polys) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    edges.push([(a[0] - ox) / s * G, (a[1] - oy) / s * G, (b[0] - ox) / s * G, (b[1] - oy) / s * G]);
  }
  for (let r = 0; r < G; r++) {
    const y = r + 0.5;
    const xs = [];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push([ax + ((y - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1]);
    }
    xs.sort((a, b) => a[0] - b[0]);
    let wnd = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wnd += xs[k][1];
      if (wnd !== 0) for (let c = Math.max(0, Math.ceil(xs[k][0] - 0.5)); c < Math.min(G, Math.ceil(xs[k + 1][0] - 0.5)); c++) bm[r * G + c] = 1;
    }
  }
  return { bm, aspect: w / (h || 1) };
}
function iou(a, b, mask) {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) {
    if (mask && !mask[k]) continue;
    const x = a[k], y = b[k];
    if (x && y) i++;
    if (x || y) u++;
  }
  return u ? i / u : 0;
}

// ---------- 見比べる文字の候補 ----------
const KANA = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロワヲンヴー';
const COMMON = '森林木花草台座土街灯石岩舞川山海空太陽月星雲雨雪風鳥鹿馬犬猫根組道門城家椅子机幕袖客席上下手前後左右中央男女王妃魔女城塔橋船車火水光影列隊群舞旋回割根っこリンゴ';
const ASCII = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const refCache = new Map();
async function refsFor(chars) {
  const out = [];
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const key = cp < 0x2E80 && /[\x20-\x7e]/.test(ch) ? 'la4' : 'jp4';
    const id = key + ':' + cp;
    if (!refCache.has(id)) {
      const g = await glyphOf(key, cp);
      const polys = g && g[1] ? fontPolys(g[1]) : [];
      refCache.set(id, polys.length ? { ch, ascii: /[A-Za-z0-9]/.test(ch), common: COMMON.includes(ch), ...raster(polys) } : null);
    }
    const r = refCache.get(id);
    if (r) out.push(r);
  }
  return out;
}
// 丸付き数字 ①〜㊿（円の内側だけ見比べる）
const CIRCLED = [];
for (let i = 1; i <= 50; i++) CIRCLED.push(i <= 20 ? 0x2460 + i - 1 : i <= 35 ? 0x3251 + i - 21 : 0x32B1 + i - 36);
const INNER = (() => { const m = new Uint8Array(G * G); for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) m[r * G + c] = Math.hypot(c + 0.5 - G / 2, r + 0.5 - G / 2) < G * 0.36 ? 1 : 0; return m; })();
let circledRefs = null;
async function circled() {
  if (circledRefs) return circledRefs;
  circledRefs = [];
  for (let i = 0; i < 50; i++) {
    const g = await glyphOf('jp4', CIRCLED[i]);
    if (g && g[1]) circledRefs.push({ no: String(i + 1), ...raster(fontPolys(g[1])) });
  }
  return circledRefs;
}

// ---------- 色 ----------
const gray = (c) => (c[0] + c[1] + c[2]) / 3;
// 人の塗り：これより明るい灰色（ごく薄い灰色で塗る人もいる）は白とする
export const PERSON_WHITE = 0.88;
const isRed = (c) => c[0] > 0.7 && c[1] < 0.35 && c[2] < 0.35;
function areaFill(c) {
  const v = gray(c);
  if (v > 0.97) return 'white';
  if (v > 0.88) return 'light';
  if (v > 0.6) return 'gray';
  return 'dark';
}

// ---------- 舞台の枠（背景の画像から、縦横の太い線を探す） ----------
const FRAME_DEFAULT = { fx: [0.0285, 0.1008, 0.9234, 0.9952], fy: [0.0464, 0.9883] };
export async function frameOf(fig) {
  try {
    if (!fig.load || typeof createImageBitmap === 'undefined') return FRAME_DEFAULT;
    const blob = await fig.load();
    if (!blob) return FRAME_DEFAULT;
    const bmp = await createImageBitmap(blob);
    const W = Math.min(1200, bmp.width), H = Math.round(bmp.height * (W / bmp.width));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(bmp, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const dark = (x, y) => { const k = (y * W + x) * 4; return d[k] + d[k + 1] + d[k + 2] < 240; };
    const cols = [], rows = [];
    for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (dark(x, y)) n++; if (n > H * 0.45) cols.push(x); }
    for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (dark(x, y)) n++; if (n > W * 0.5) rows.push(y); }
    const runs = (a) => { const g2 = []; for (const v of a) { if (g2.length && v - g2[g2.length - 1][g2[g2.length - 1].length - 1] <= 2) g2[g2.length - 1].push(v); else g2.push([v]); } return g2.map((r) => r.reduce((s, v) => s + v, 0) / r.length); };
    const fx = runs(cols), fy = runs(rows);
    if (fx.length < 4 || fy.length < 2) return FRAME_DEFAULT;
    return { fx: [fx[0], fx[1], fx[fx.length - 2], fx[fx.length - 1]].map((v) => v / W), fy: [fy[0], fy[fy.length - 1]].map((v) => v / H) };
  } catch (e) { return FRAME_DEFAULT; }
}

// ---------- 丸付き数字の中の数字を読む ----------
// 円（外と内の輪）を除いた残りの形を数字ごとに分け、0〜9 の形と見比べる
let digitRefs = null;
async function digits() {
  if (digitRefs) return digitRefs;
  digitRefs = [];
  for (const key of ['la4', 'jp4', 'la7']) {
    for (let d = 0; d <= 9; d++) {
      const g = await glyphOf(key, 48 + d);
      if (g && g[1]) digitRefs.push({ d: String(d), ...rasterStretch(fontPolys(g[1])) });
    }
  }
  return digitRefs;
}
// 縦横をそれぞれ枠いっぱいに伸ばして塗る（細い数字と太い数字を同じ形で比べる）
function rasterStretch(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = x1 - x0 || 1, h = y1 - y0 || 1;
  const sq = polys.map((p) => p.map(([x, y]) => [((x - x0) / w) * h + x0, y]));
  const r = raster(sq, { x0, y0, x1: x0 + h, y1 });
  return { bm: r.bm, aspect: w / h };
}
async function numberOf(sp, p) {
  const D = Math.max(p.x1 - p.x0, p.y1 - p.y0);
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
  // 輪：中心がほぼ同じで、大きい部分
  const inner = sp.filter((s) => {
    const w = s.x1 - s.x0, h = s.y1 - s.y0;
    const ringLike = Math.abs(w - h) < Math.max(w, h) * 0.15 && Math.hypot((s.x0 + s.x1) / 2 - cx, (s.y0 + s.y1) / 2 - cy) < D * 0.08 && w > D * 0.6;
    return !ringLike;
  });
  if (!inner.length) return '';
  const refs = await digits();
  // 数字ごとに分ける（横に重ならないまとまり）
  const groups = [];
  for (const s of inner.sort((a, b) => a.x0 - b.x0)) {
    const g = groups[groups.length - 1];
    if (g && s.x0 < g.x1 - (s.x1 - s.x0) * 0.2) { g.sp.push(s); g.x1 = Math.max(g.x1, s.x1); }
    else groups.push({ x0: s.x0, x1: s.x1, sp: [s] });
  }
  let out = '';
  for (const g of groups) {
    const r = rasterStretch(g.sp.map((s) => s.pts));
    // 細長いのは 1（書体によって 1 の形がちがうため、形より幅で決める）
    if (groups.length === 1 ? r.aspect < 0.45 : (g.x1 - g.x0) / D < 0.26) { out += '1'; continue; }
    let best = '', bs = -1;
    for (const ref of refs) {
      const a = Math.min(r.aspect, ref.aspect) / Math.max(r.aspect, ref.aspect);
      const v = iou(r.bm, ref.bm) * (0.3 + 0.7 * a);
      if (v > bs) { bs = v; best = ref.d; }
    }
    out += best;
  }
  return out.replace(/^0+/, '');
}

// ---------- 本体 ----------
// page: readPdf の1ページ / fig: 図の範囲（x0,y0,x1,y1 上から下）/ chars: 文字の候補（文字列）
// 形から読んだ文字が、知っている言葉（名前・役名）と1〜2字だけ違うなら、その言葉に直す（アユ→アニ など）
export function snapWord(t, words) {
  const s = String(t || '');
  if (!words || !words.length || s.length < 2 || s.length > 8 || /\s/.test(s)) return s;
  let best = null, bd = Infinity, tie = false;
  for (const w of words) {
    if (w.length !== s.length) continue;
    let d = 0;
    let ok = true;
    for (let i = 0; i < s.length && d <= bd; i++) {
      if (w[i] === s[i]) continue;
      d++;
      // 英数字の違い（ドA と ドC など）は読み違いではなく別の名前なので、直さない
      if (/[A-Za-z0-9]/.test(w[i] + s[i])) ok = false;
    }
    if (!ok) continue;
    if (d < bd) { bd = d; best = w; tie = false; } else if (d === bd && w !== best) tie = true;
  }
  const limit = s.length <= 3 ? 1 : 2;
  return best && bd > 0 && bd <= limit && !tie ? best : s;
}
export async function convertDrawing(page, fig, { chars = '', frame = null, words = [] } = {}) {
  const fr = frame || FRAME_DEFAULT;
  const W = fig.x1 - fig.x0, H = fig.y1 - fig.y0;
  const FX = fr.fx.map((v) => fig.x0 + v * W), FY = fr.fy.map((v) => fig.y0 + v * H);
  const DX = [10, 90, 910, 990];
  const mx = (x) => { for (let i = 0; i < 3; i++) if (x <= FX[i + 1] || i === 2) return DX[i] + ((x - FX[i]) * (DX[i + 1] - DX[i])) / (FX[i + 1] - FX[i]); return x; };
  const my = (y) => 10 + ((y - FY[0]) * 450) / (FY[1] - FY[0]);
  const scale = 980 / (FX[3] - FX[0]);
  const M = (p) => [Math.round(mx(p[0]) * 10) / 10, Math.round(my(p[1]) * 10) / 10];
  const tol = 2;
  const vis = page.paths.filter((p) => p.x0 >= fig.x0 - tol && p.x1 <= fig.x1 + tol && p.y0 >= fig.y0 - tol && p.y1 <= fig.y1 + tol
    && ((p.fill && (p.fa ?? 1) > 0.05) || (p.stroke && (p.sa ?? 1) > 0.05))
    && !((p.x1 - p.x0) > W * 0.9 && (p.y1 - p.y0) > H * 0.9));
  const used = new Set();
  const ctr = (p) => [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2];
  const size = (p) => Math.max(p.x1 - p.x0, p.y1 - p.y0);
  const isCircle = (p) => { const w = p.x1 - p.x0, h = p.y1 - p.y0; return Math.abs(w - h) < Math.max(w, h) * 0.12 && /^MC{4,6}Z?$/.test(p.path.map((c) => c[0]).join('')); };
  const shapes = [];
  let seq = 0;

  // 人：赤い丸付き数字
  const persons = [];
  for (const p of vis) {
    if (!p.fill || !isRed(p.fc)) continue;
    const w = p.x1 - p.x0, h = p.y1 - p.y0;
    if (Math.abs(w - h) > Math.max(w, h) * 0.15 || w < 5 || w > 40) continue;
    const sp = subpaths(p.path);
    if (sp.length < 2) continue;
    used.add(p);
    persons.push({ p, c: ctr(p), d: w, no: await numberOf(sp, p), seq: p.seq, ring: false, fill: 'white' });
  }
  // 番号なしの人：黒く塗った円（人の大きさ）
  const pd = persons.length ? persons.map((x) => x.d).sort((a, b) => a - b)[Math.floor(persons.length / 2)] : 13;
  for (const p of vis) {
    if (used.has(p) || !p.fill || p.stroke || !isCircle(p) || gray(p.fc) > 0.25) continue;
    const d = size(p);
    if (d < pd * 0.7 || d > pd * 1.4) continue;
    used.add(p);
    persons.push({ p, c: ctr(p), d, no: '', seq: p.seq, ring: true, fill: 'white', plain: true });
  }
  // 線で描いた小さな円（中に名前を書いた人）：黒い円の人。中の文字は、あとで名前にする
  for (const p of vis) {
    if (used.has(p) || !p.stroke || !isCircle(p) || isRed(p.sc)) continue;
    const d = size(p), c = ctr(p);
    if (d < 6 || d > 40) continue;
    if (persons.some((x) => Math.hypot(x.c[0] - c[0], x.c[1] - c[1]) < x.d * 0.25)) continue;
    used.add(p);
    const twin = vis.find((q) => q !== p && !used.has(q) && q.fill && isCircle(q) && Math.abs(size(q) - d) < 1.5 && Math.hypot(ctr(q)[0] - c[0], ctr(q)[1] - c[1]) < 1.5);
    let fill = 'white';
    if (twin) { used.add(twin); if ((twin.fa ?? 1) > 0.05) { const v = gray(twin.fc); if (v < 0.3) fill = 'black'; else if (v < PERSON_WHITE) fill = 'gray'; } }
    persons.push({ p, c, d, no: '', seq: p.seq, ring: true, fill, circle: true });
  }
  // 人のまわりの円：大きい円 → 黒い円、同じ大きさの塗り → 塗り
  for (const q of vis) {
    if (used.has(q) || !isCircle(q)) continue;
    const c = ctr(q), d = size(q);
    const who = persons.find((x) => Math.hypot(x.c[0] - c[0], x.c[1] - c[1]) < x.d * 0.25);
    if (!who) continue;
    const k = d / who.d;
    if (k > 1.15 && k < 2.4 && q.stroke && gray(q.sc) < 0.6) { who.ring = true; used.add(q); }
    else if (k > 0.8 && k <= 1.15) {
      if (q.fill && (q.fa ?? 1) > 0.05) { const v = gray(q.fc); if (v < 0.3) who.fill = 'black'; else if (v < PERSON_WHITE) who.fill = 'gray'; }
      used.add(q);
    }
  }
  // 人のまわりの四角・三角（丸のかわりに、見分けるために使うことがある）
  for (const q of vis) {
    if (used.has(q) || !q.stroke || isCircle(q)) continue;
    const sp = subpaths(q.path);
    if (sp.length !== 1 || !/^ML+Z?$/.test(q.path.map((c) => c[0]).join(''))) continue;
    const n = dedupe(sp[0].pts).length;
    const kind = n === 4 ? 'square' : n === 3 ? 'tri' : null;
    if (!kind) continue;
    const c = ctr(q), d = size(q);
    // 三角は、重心（下寄り）のあたりに番号がある
    const cc = kind === 'tri' ? [sp[0].pts.slice(0, 3).reduce((a, v) => a + v[0], 0) / 3, sp[0].pts.slice(0, 3).reduce((a, v) => a + v[1], 0) / 3] : c;
    const who = persons.find((x) => !x.outline && (Math.hypot(x.c[0] - cc[0], x.c[1] - cc[1]) < x.d * 0.35 || Math.hypot(x.c[0] - c[0], x.c[1] - c[1]) < x.d * 0.35));
    if (!who) continue;
    const k = d / who.d;
    if (k < 1.1 || k > 2.8) continue;
    used.add(q);
    who.ring = true; who.outline = kind;
    const twin = vis.find((f) => f !== q && !used.has(f) && f.fill && !f.stroke && Math.abs(f.x0 - q.x0) < 1.5 && Math.abs(f.x1 - q.x1) < 1.5 && Math.abs(f.y0 - q.y0) < 1.5 && Math.abs(f.y1 - q.y1) < 1.5);
    const fc = q.fill && (q.fa ?? 1) > 0.05 ? q.fc : twin && (twin.fa ?? 1) > 0.05 ? twin.fc : null;
    if (twin) used.add(twin);
    if (fc) { const v = gray(fc); if (v < 0.3) who.fill = 'black'; else if (v < PERSON_WHITE) who.fill = 'gray'; }
  }
  const personShape = new Map();
  for (const x of persons) {
    const [px, py] = M(x.c);
    const s = { t: 'person', x: Math.round(px), y: Math.round(py), no: x.no, seq: x.seq };
    personShape.set(x, s);
    if (x.ring) s.ring = true;
    if (x.fill !== 'white') s.fill = x.fill;
    if (x.outline) s.outline = x.outline;
    shapes.push(s);
  }

  // 文字：小さな、塗りだけの形（文字の線）
  // 文字は濃い色の塗りだけ。薄い塗りで同じ枠の線がある形（白抜きの小さな矢印など）は文字ではない
  const outlined = (p) => vis.some((q) => q !== p && q.stroke && Math.abs(q.x0 - p.x0) < 1.5 && Math.abs(q.x1 - p.x1) < 1.5 && Math.abs(q.y0 - p.y0) < 1.5 && Math.abs(q.y1 - p.y1) < 1.5);
  const textPaths = vis.filter((p) => !used.has(p) && p.fill && !p.stroke && !isRed(p.fc) && gray(p.fc) < 0.6 && !outlined(p) && (p.y1 - p.y0) < 18 && (p.x1 - p.x0) < 160 && !isCircle(p) && p.path.length > 6);
  const pool = [...new Set([...String(chars || '').normalize('NFKC'), ...COMMON, ...KANA, ...ASCII])].filter((ch) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9ー々]/u.test(ch));
  // 図形描画を PDF でも取り出せたときは、PDF の中の本当の文字を使う（形から読むと、アニ→アユのように間違えることがある）
  const claimed = new Set();
  const realText = (p) => {
    const T = page.texts;
    if (!T || !T.length) return null;
    const m = 3;
    const gs = T.filter((g) => !claimed.has(g) && g.x + g.w / 2 >= p.x0 - m && g.x + g.w / 2 <= p.x1 + m && g.y - g.size * 0.35 >= p.y0 - m && g.y - g.size * 0.35 <= p.y1 + m);
    if (!gs.length) return null;
    for (const g of gs) claimed.add(g);
    const lines = [];
    for (const g of gs.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
      const L = lines[lines.length - 1];
      if (L && Math.abs(g.y - L.y) < g.size * 0.5) L.gs.push(g); else lines.push({ y: g.y, gs: [g] });
    }
    const txt = lines.map((L) => {
      const sorted = L.gs.sort((a, b) => a.x - b.x);
      let t = '';
      sorted.forEach((g, i) => { if (i && g.x - (sorted[i - 1].x + sorted[i - 1].w) > g.size * 0.25 && /[A-Za-z0-9]$/.test(t)) t += ' '; t += g.text; });
      return t.trim();
    }).filter(Boolean);
    return txt.length ? { lines: txt, em: Math.max(...gs.map((g) => g.size)) } : null;
  };
  const reals = new Map(textPaths.map((p) => [p, realText(p)]));
  const textRefs = textPaths.some((p) => !reals.get(p)) ? await refsFor(pool) : [];
  for (const p of textPaths) {
    used.add(p);
    const real = reals.get(p);
    const sp = subpaths(p.path);
    // 行に分ける（縦にはっきり空いているところで分ける。「森」のように上下に分かれた字は分けない）
    const maxH = Math.max(...sp.map((s) => s.y1 - s.y0));
    const lines = [];
    for (const s of sp.slice().sort((a, b) => a.y0 - b.y0)) {
      const L = lines[lines.length - 1];
      if (L && s.y0 < L.y1 + maxH * 0.22) { L.sp.push(s); L.y1 = Math.max(L.y1, s.y1); }
      else lines.push({ y0: s.y0, y1: s.y1, sp: [s] });
    }
    lines.sort((a, b) => a.y0 - b.y0);
    // 「ニ」「こ」「三」のような横線だけの行は、本当の行ではない（となりの行とまとめる）
    const PW = p.x1 - p.x0;
    for (let guard = 0; guard < 20 && lines.length > 1; guard++) {
      const k = lines.findIndex((l) => l.y1 - l.y0 < PW * 0.25);
      if (k < 0) break;
      const L0 = lines[k];
      const up = k > 0 ? L0.y0 - lines[k - 1].y1 : Infinity, dn = k < lines.length - 1 ? lines[k + 1].y0 - L0.y1 : Infinity;
      const j = up <= dn ? k - 1 : k + 1;
      const T2 = lines[j];
      T2.sp.push(...L0.sp); T2.y0 = Math.min(T2.y0, L0.y0); T2.y1 = Math.max(T2.y1, L0.y1);
      lines.splice(k, 1);
    }
    let em = real ? real.em : 0;
    const out = real ? real.lines.slice() : [];
    for (const L of real ? [] : lines) {
      const e = (L.y1 - L.y0) / 0.86;
      em = Math.max(em, e);
      // 文字ごとに分ける：横に重なる部分をまとめ（かたまり）、続くかたまりを1字にするかどうかを、
      // 字形の似かたがいちばん高くなるように決める
      const atoms = [];
      for (const s2 of L.sp.sort((a2, b2) => a2.x0 - b2.x0)) {
        const c = atoms[atoms.length - 1];
        if (c && s2.x0 < c.x1 - Math.min(s2.x1 - s2.x0, c.x1 - c.x0) * 0.3) { c.sp.push(s2); c.x1 = Math.max(c.x1, s2.x1); }
        else atoms.push({ x0: s2.x0, x1: s2.x1, sp: [s2] });
      }
      const memo = new Map();
      const judge = (i, j) => {
        const k = i + ':' + j;
        if (memo.has(k)) return memo.get(k);
        const sps = atoms.slice(i, j + 1).flatMap((x) => x.sp);
        const r = raster(sps.map((s2) => s2.pts));
        let best = '', bs = 0;
        for (const ref of textRefs) {
          const a2 = Math.min(r.aspect, ref.aspect) / Math.max(r.aspect, ref.aspect);
          const v = iou(r.bm, ref.bm) * (0.6 + 0.4 * a2) * (ref.ascii ? 0.85 : 1) * (ref.common ? 1.04 : 1);
          if (v > bs) { bs = v; best = ref.ch; }
        }
        // 小さい「ァ」と大きい「ア」は形が同じなので、行の高さに対する大きさで決める
        const hh = Math.max(...sps.map((s2) => s2.y1)) - Math.min(...sps.map((s2) => s2.y0));
        const SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ', BIG = 'あいうえおつやゆよわアイウエオツヤユヨワ';
        if (SMALL.includes(best) && hh > e * 0.53) best = BIG[SMALL.indexOf(best)];
        else if (BIG.includes(best) && hh < e * 0.44) best = SMALL[BIG.indexOf(best)];
        const res = { ch: bs > 0.3 ? best : '？', score: bs };
        memo.set(k, res);
        return res;
      };
      const n = atoms.length;
      const dp = new Array(n + 1).fill(-Infinity), from = new Array(n + 1).fill(-1);
      dp[0] = 0;
      for (let j = 1; j <= n; j++) {
        for (let i = j - 1; i >= 0; i--) {
          const w = atoms[j - 1].x1 - atoms[i].x0;
          if (i < j - 1 && w > e * 1.3) break;
          const r = judge(i, j - 1);
          const v = dp[i] + r.score * w - e * 0.06; // 字は少なめに
          if (v > dp[j]) { dp[j] = v; from[j] = i; }
        }
      }
      const parts = [];
      for (let j = n; j > 0; j = from[j]) parts.unshift(judge(from[j], j - 1).ch);
      let t = parts.join('');
      // 長音：カタカナのあとの「一」は「ー」
      t = t.replace(/([ァ-ヴー])[一⼀－—]/g, '$1ー');
      out.push(snapWord(t, words));
    }
    // 円の中の文字は、その人の名前（縦書きの名前もあるので、行はつなげる）
    const tc = ctr(p);
    const owner = persons.find((x) => x.circle && Math.hypot(x.c[0] - tc[0], x.c[1] - tc[1]) < x.d * 0.55);
    if (owner) { (owner.texts = owner.texts || []).push({ y: p.y0, x: p.x0, t: out.join('') }); continue; }
    const [tx, ty] = M(ctr(p));
    shapes.push({ t: 'text', text: out.join('\n'), x: Math.round(tx), y: Math.round(ty), size: Math.max(10, Math.round(em * scale)), seq: p.seq, _c: ctr(p) });
  }

  // 円の中の名前（上から、左から順につなぐ）
  for (const x of persons) if (x.texts) personShape.get(x).label = x.texts.sort((a, b) => a.y - b.y || a.x - b.x).map((v) => v.t).join('');

  // そのほかの形
  const rest = vis.filter((p) => !used.has(p));
  const fillOnly = rest.filter((p) => p.fill && !p.stroke);
  const strokes = rest.filter((p) => p.stroke);
  const bboxArea = (p) => (p.x1 - p.x0) * (p.y1 - p.y0);
  for (const p of strokes) {
    // 同じ形の塗り（別の命令で塗っていることがある）
    let fc = p.fill && (p.fa ?? 1) > 0.05 ? p.fc : null;
    const twin = fillOnly.find((f) => !used.has(f) && Math.abs(f.x0 - p.x0) < 1.5 && Math.abs(f.x1 - p.x1) < 1.5 && Math.abs(f.y0 - p.y0) < 1.5 && Math.abs(f.y1 - p.y1) < 1.5);
    if (twin) { fc = twin.fc; used.add(twin); }
    used.add(p);
    const s = shapeOf(p, M, scale, fc, false);
    if (s) { s.seq = p.seq; shapes.push(s); }
  }
  for (const p of fillOnly) {
    if (used.has(p) || bboxArea(p) < 4) continue;
    used.add(p);
    const s = shapeOf(p, M, scale, p.fc, true);
    if (s) { s.seq = p.seq; shapes.push(s); }
  }
  shapes.sort((a, b) => a.seq - b.seq);
  // 人のそばの文字（キャラ名かもしれない）
  for (const s of shapes) {
    if (s.t !== 'text') continue;
    const near = shapes.filter((x) => x.t === 'person').map((x) => ({ x, d: Math.hypot(x.x - s.x, x.y - s.y) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 75) s.nearNo = near.x.no;
    delete s._c;
  }
  return shapes;
}

function shapeOf(p, M, scale, fc, noline) {
  const ops = p.path.map((c) => c[0]).join('');
  const sw = Math.max(1.5, Math.round((p.lw || 0.75) * scale * 10) / 10);
  const dashed = p.dash && p.dash.length && p.dash.some((v) => v > 0);
  const fill = fc ? areaFill(fc) : null;
  const base = {};
  if (dashed) base.dashed = true;
  if (sw !== 3) base.sw = Math.min(8, sw);
  if (fill && fill !== 'white') base.fill = fill; else if (fill === 'white') base.fill = 'white';
  if (noline) base.noline = true;
  // 楕円（ベジエ4本）
  if (/^MCCCCZ?$/.test(ops)) {
    const P = [p.path[0].slice(1, 3), ...p.path.slice(1, 5).map((c) => c.slice(5, 7))].slice(0, 4).map(M);
    const cx = (P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, cy = (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4;
    const ax = (P[0][0] - P[2][0]) / 2, ay = (P[0][1] - P[2][1]) / 2, bx = (P[1][0] - P[3][0]) / 2, by = (P[1][1] - P[3][1]) / 2;
    const rx = Math.hypot(ax, ay), ry = Math.hypot(bx, by);
    if (rx > 2 && ry > 2) return { t: 'ellipse', x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10, rx: Math.round(rx * 10) / 10, ry: Math.round(ry * 10) / 10, rot: Math.round((Math.atan2(ay, ax) * 180) / Math.PI * 10) / 10, ...base };
  }
  const sp = subpaths(p.path, 8);
  if (!sp.length) return null;
  // 四角（軸に沿った4点）
  if (sp.length === 1 && /^ML{3,4}Z$/.test(ops)) {
    const q = sp[0].pts.map(M);
    const xs = q.map((v) => v[0]), ys = q.map((v) => v[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const axis = q.every((v) => (Math.abs(v[0] - x0) < 1.5 || Math.abs(v[0] - x1) < 1.5) && (Math.abs(v[1] - y0) < 1.5 || Math.abs(v[1] - y1) < 1.5));
    if (axis && x1 - x0 > 3 && y1 - y0 > 3) return { t: 'rect', x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2), w: Math.round(x1 - x0), h: Math.round(y1 - y0), ...base };
  }
  const main = sp.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0];
  const pts = dedupe(main.pts.map(M));
  // 線で描いた形でも、始まりと終わりがほぼ同じなら閉じた形（白抜き矢印の外形など）
  const nearlyClosed = pts.length >= 4 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 6;
  if ((main.closed || nearlyClosed) && pts.length >= 3) return { t: 'blob', sharp: true, pts, ...base };
  if (pts.length >= 2) { const s = { t: 'line', pts, ...base }; delete s.fill; delete s.noline; return s; }
  return null;
}
function dedupe(pts) {
  const out = [];
  for (const q of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 0.8) out.push(q); }
  if (out.length > 2) { const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.8) out.pop(); }
  return out;
}

// ---------- Googleの図形描画（SVG）を、PDFのページと同じ形にする ----------
// 返り値：{ page: { paths, figs }, fig }（座標は pt に近い大きさにそろえる：舞台の背景画像の幅 ≒ 335）
function parseColor(c) {
  if (!c || c === 'none') return null;
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (m) { const n = parseInt(m[1], 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const r = /rgba?\(([^)]+)\)/.exec(c);
  if (r) { const p = r[1].split(/[\s,]+/).map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  if (/^#([0-9a-f]{3})$/i.test(c)) { const h = c.slice(1); return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16) / 255); }
  return [0, 0, 0];
}
const mulM = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
function parseTransform(t) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  const re = /(matrix|translate|scale)\(([^)]*)\)/g;
  let x;
  while ((x = re.exec(t))) {
    const v = x[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (x[1] === 'matrix') m = mulM(m, v);
    else if (x[1] === 'translate') m = mulM(m, [1, 0, 0, 1, v[0] || 0, v[1] || 0]);
    else if (x[1] === 'scale') m = mulM(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
  }
  return m;
}
// SVG の d（相対・絶対の m l h v c s q t z）→ ['M',x,y] ['L',x,y] ['C',…] ['Z']（行列をかける）
function svgD(d, M) {
  const P = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  const toks = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, lc = null, lq = null;
  const n = () => Number(toks[i++]);
  const num = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'Z') { out.push(['Z']); cx = sx; cy = sy; lc = lq = null; continue; }
    if (!num()) { i++; continue; }
    if (C === 'M') { let x = n(), y = n(); if (rel) { x += cx; y += cy; } out.push(['M', ...P(x, y)]); cx = sx = x; cy = sy = y; cmd = rel ? 'l' : 'L'; lc = lq = null; }
    else if (C === 'L') { let x = n(), y = n(); if (rel) { x += cx; y += cy; } out.push(['L', ...P(x, y)]); cx = x; cy = y; lc = lq = null; }
    else if (C === 'H') { let x = n(); if (rel) x += cx; out.push(['L', ...P(x, cy)]); cx = x; lc = lq = null; }
    else if (C === 'V') { let y = n(); if (rel) y += cy; out.push(['L', ...P(cx, y)]); cy = y; lc = lq = null; }
    else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = n(); y1 = n(); if (rel) { x1 += cx; y1 += cy; } } else { x1 = lc ? 2 * cx - lc[0] : cx; y1 = lc ? 2 * cy - lc[1] : cy; }
      let x2 = n(), y2 = n(), x = n(), y = n();
      if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
      out.push(['C', ...P(x1, y1), ...P(x2, y2), ...P(x, y)]); lc = [x2, y2]; lq = null; cx = x; cy = y;
    } else if (C === 'Q' || C === 'T') {
      let qx, qy;
      if (C === 'Q') { qx = n(); qy = n(); if (rel) { qx += cx; qy += cy; } } else { qx = lq ? 2 * cx - lq[0] : cx; qy = lq ? 2 * cy - lq[1] : cy; }
      let x = n(), y = n(); if (rel) { x += cx; y += cy; }
      out.push(['C', ...P(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy)), ...P(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)), ...P(x, y)]);
      lq = [qx, qy]; lc = null; cx = x; cy = y;
    } else i++;
  }
  return out;
}
// pdf：同じ図形描画を PDF で取り出したページ（{ width, height, glyphs }）。あれば、その文字を page.texts にする
export function svgToPage(svg, pdf = null) {
  const items = []; // { kind:'path'|'image', attrs, m }
  const stack = [[1, 0, 0, 1, 0, 0]];
  const attrsOf = (s) => { const a = {}; const re = /([\w:-]+)="([^"]*)"/g; let x; while ((x = re.exec(s))) a[x[1]] = x[2]; return a; };
  const re = /<(\/?)(g|path|image|clipPath|svg)\b([^>]*?)(\/?)>/g;
  let x, inClip = 0;
  while ((x = re.exec(svg))) {
    const [, close, tag, rest, self] = x;
    if (tag === 'clipPath') { if (close) inClip--; else if (!self) inClip++; continue; }
    if (tag === 'g') {
      if (close) stack.pop();
      else { const a = attrsOf(rest); const m = mulM(stack[stack.length - 1], parseTransform(a.transform)); if (!self) stack.push(m); }
      continue;
    }
    if (inClip || close) continue;
    if (tag === 'path') items.push({ kind: 'path', a: attrsOf(rest), m: stack[stack.length - 1] });
    if (tag === 'image') items.push({ kind: 'image', a: attrsOf(rest), m: stack[stack.length - 1] });
  }
  // 背景の画像（舞台の枠）
  const imgs = items.filter((it) => it.kind === 'image').map((it) => {
    const a = it.a, m = mulM(it.m, parseTransform(a.transform));
    const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, hh = +a.height || 0;
    const xs = [x, x + w].map((v) => m[0] * v + m[4]), ys = [y, y + hh].map((v) => m[3] * v + m[5]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), href: a['xlink:href'] || a.href || '' };
  }).sort((p, q) => (q.x1 - q.x0) * (q.y1 - q.y0) - (p.x1 - p.x0) * (p.y1 - p.y0));
  const bg = imgs.find((im) => (im.x1 - im.x0) / Math.max(1, im.y1 - im.y0) > 1.8);
  const vb = (/viewBox="([^"]+)"/.exec(svg) || [])[1];
  const [vx, vy, vw, vh] = vb ? vb.split(/[\s,]+/).map(Number) : [0, 0, 800, 600];
  const frameBox = bg || { x0: vx, y0: vy, x1: vx + vw, y1: vy + vh };
  const k = 335 / (frameBox.x1 - frameBox.x0);
  const S = [k, 0, 0, k, -frameBox.x0 * k, -frameBox.y0 * k];
  const paths = [];
  let seq = 0;
  for (const it of items) {
    if (it.kind !== 'path') continue;
    const a = it.a;
    const M = mulM(S, mulM(it.m, parseTransform(a.transform)));
    const fill = a.fill && a.fill !== 'none' ? parseColor(a.fill) : null;
    const stroke = a.stroke && a.stroke !== 'none' ? parseColor(a.stroke) : null;
    if (!fill && !stroke) continue;
    const path = svgD(a.d || '', M);
    if (!path.length) continue;
    const xs = [], ys = [];
    for (const c of path) for (let j = 1; j < c.length; j += 2) { xs.push(c[j]); ys.push(c[j + 1]); }
    const sc = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
    paths.push({
      seq: seq++, path, fill: !!fill, stroke: !!stroke, eo: a['fill-rule'] === 'evenodd',
      fa: fill ? (a['fill-opacity'] != null ? +a['fill-opacity'] : 1) : 0, sa: stroke ? (a['stroke-opacity'] != null ? +a['stroke-opacity'] : 1) : 0,
      fc: fill || [0, 0, 0], sc: stroke || [0, 0, 0], lw: (a['stroke-width'] != null ? +a['stroke-width'] : 1) * sc,
      dash: a['stroke-dasharray'] && a['stroke-dasharray'] !== 'none' ? a['stroke-dasharray'].split(/[\s,]+/).map((v) => +v * sc) : [],
      x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
    });
  }
  const T = (v, o) => v * k + o;
  const fig = { kind: 'image', x0: 0, y0: 0, x1: (frameBox.x1 - frameBox.x0) * k, y1: (frameBox.y1 - frameBox.y0) * k, seq: -1 };
  if (bg && /^data:/.test(bg.href)) fig.load = async () => (await fetch(bg.href)).blob();
  void T;
  // PDF の文字の位置（PDF のページ ＝ 図形描画の全体 ＝ SVG の viewBox）を、上の paths と同じ座標にする
  const texts = [];
  if (pdf && pdf.glyphs && pdf.width && pdf.height) {
    const kx = vw / pdf.width, ky = vh / pdf.height;
    for (const g of pdf.glyphs) {
      if (!g.text || !String(g.text).trim()) continue;
      texts.push({ text: g.text, x: (vx + g.x * kx - frameBox.x0) * k, y: (vy + g.y * ky - frameBox.y0) * k, w: (g.w || 0) * kx * k, size: (g.size || 10) * ky * k });
    }
  }
  return { page: { paths, figs: [fig], glyphs: [], texts }, fig, hasFrame: !!bg };
}
