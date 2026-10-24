// 取り込んだ図形描画（PDFのベクター）を、図解メーカーの図（diagram）として保存する形にする
import { newId } from './db.js';
import { LAYER, insideShape, shapeArea, textBox, isRegion } from './stage.js';
import { numberCast } from './cast.js';
import { convertDrawing, frameOf, svgToPage } from './drawconv.js';

// 舞台の図らしいか（横長の背景画像）
export function isStageFig(f) {
  if (!f || f.kind !== 'image') return false;
  const ar = (f.x1 - f.x0) / Math.max(1, f.y1 - f.y0);
  return ar > 1.9 && ar < 2.7 && f.x1 - f.x0 > 80;
}

// page・fig：readPdf の結果 / cast：メンバー一覧（番号→人）/ chars：文字の候補
export async function diagramFromPdf(page, fig, opts = {}) {
  const frame = await frameOf(fig);
  return toDiagram(await convertDrawing(page, fig, { chars: opts.chars || '', frame }), opts);
}
// Googleの図形描画の SVG から
export async function diagramFromSvg(svg, opts = {}) {
  const { page, fig } = svgToPage(svg);
  const frame = await frameOf(fig);
  return toDiagram(await convertDrawing(page, fig, { chars: opts.chars || '', frame }), opts);
}
// SVG を写真（PNG）にする（「写真のまま入れる」とき・図に直せなかったとき）
export function svgToPng(svg) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const im = new Image();
    im.onload = () => {
      const vb = (/viewBox="([^"]+)"/.exec(svg) || [])[1];
      const [, , vw, vh] = vb ? vb.split(/[\s,]+/).map(Number) : [0, 0, 800, 600];
      const k = 1600 / vw;
      const cv = document.createElement('canvas'); cv.width = 1600; cv.height = Math.round(vh * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      // まわりの余白を切る
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
      for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
        const k = (y * cv.width + x) * 4;
        if (d[k] + d[k + 1] + d[k + 2] < 740) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { cv.toBlob((b) => resolve(b), 'image/png'); return; }
      const pad = 8;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(cv.width, x1 + pad); y1 = Math.min(cv.height, y1 + pad);
      const c2 = document.createElement('canvas'); c2.width = x1 - x0; c2.height = y1 - y0;
      c2.getContext('2d').drawImage(cv, x0, y0, c2.width, c2.height, 0, 0, c2.width, c2.height);
      c2.toBlob((b) => resolve(b), 'image/png');
    };
    im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    im.src = url;
  });
}
// すでに舞台の座標になっている形の並びから（Googleスライドの図形など）
export function diagramFromShapes(list, opts = {}) { return toDiagram(list, opts); }
async function toDiagram(list, { cast = [] } = {}) {
  const persons = list.filter((s) => s.t === 'person');
  if (persons.length + list.filter((s) => s.t !== 'person' && s.t !== 'text').length < 1) return null;
  const nums = numberCast(cast);
  const byNo = {};
  for (const c of nums) byNo[c.no] = c;
  const shapes = {};
  const roleVis = {};
  const shown = new Set();
  let k = 0;
  const base = Date.now();
  // キャラ名（人のそばの、その人の役の表記と同じ文字）は、図の文字ではなく「キャラ名を表示」にする
  for (const s of list) {
    if (s.t !== 'text' || !s.nearNo) continue;
    const c = byNo[s.nearNo];
    const label = c && c.roles && c.roles[0] && c.roles[0].label;
    if (label && label.replace(/\s/g, '') === s.text.replace(/\s/g, '')) { shown.add(c.id); s.drop = true; }
  }
  // 図形の中に書いてある文字は、その図形の名前にする（いちばん小さい、文字がすっぽり入る図形）
  nameRegions(list);
  for (const s of list) {
    if (s.drop) continue;
    const id = newId(8);
    const o = { ...s, id, z: (LAYER[s.t] || 0) * 1e13 + base + k++ };
    delete o.seq; delete o.nearNo;
    if (s.t === 'person') {
      let c = s.no && byNo[s.no];
      // 円の中に名前が書いてある人：メンバー一覧の表記・役名・名前と同じ（またはその頭）なら、その人
      if (!c && s.label) {
        const L = s.label.replace(/\s/g, '');
        c = nums.find((m) => (m.roles || []).some((r) => (r.label || '').replace(/\s/g, '') === L)) ||
          nums.find((m) => [m.name, ...(m.roles || []).map((r) => r.name)].some((v) => v && L.length >= 2 && String(v).replace(/\s/g, '').startsWith(L)));
        if (c) { o.no = undefined; delete o.label; shown.add(c.id); }
      }
      if (c) { o.cid = c.id; delete o.no; } else if (!s.no) delete o.no;
    }
    shapes[id] = o;
  }
  // 役の表記がある人：図にキャラ名が書いてあった人だけ表示
  for (const s of Object.values(shapes)) {
    if (s.t !== 'person' || !s.cid) continue;
    const c = nums.find((x) => x.id === s.cid);
    if (c && c.roles && c.roles[0] && c.roles[0].label) roleVis[`${c.id}_0`] = shown.has(c.id);
  }
  return { shapes, roleVis };
}

export function textInRegion(t, regions) {
  const b = textBox(t);
  const m = 1;
  let best = null, ba = Infinity;
  for (const r of regions) {
    if (!isRegion(r)) continue;
    const ok = insideShape(r, t.x, t.y) && [[b[0] + m, b[1] + m], [b[2] - m, b[1] + m], [b[0] + m, b[3] - m], [b[2] - m, b[3] - m]].every(([x, y]) => insideShape(r, x, y));
    if (!ok) continue;
    const a = shapeArea(r);
    if (a < ba) { ba = a; best = r; }
  }
  return best;
}
function nameRegions(list) {
  const regions = list.filter((s) => isRegion(s) && !s.name);
  const got = new Map();
  for (const s of list) {
    if (s.t !== 'text' || s.drop || !String(s.text || '').trim()) continue;
    const r = textInRegion(s, regions);
    if (!r) continue;
    // 囲んでいる図形のなかに、ほかの小さな図形が入っていたら（エリアの中の文字など）名前にしない
    if (regions.some((o) => o !== r && shapeArea(o) < shapeArea(r) && insideShape(r, o.x, o.y))) continue;
    if (!got.has(r)) got.set(r, []);
    got.get(r).push(s);
  }
  for (const [r, ts] of got) {
    ts.sort((a, b) => a.y - b.y || a.x - b.x);
    r.name = ts.map((t) => String(t.text).replace(/\n/g, '')).join('');
    r.showName = true;
    for (const t of ts) t.drop = true;
  }
}
