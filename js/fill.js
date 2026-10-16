// 図形の中・線の上に、人をほどよく均等に（少しだけばらつかせて）並べる
import { insideShape, shapeBBox, shapeArea, linePoints, polyLength, pointAt } from './stage.js';

// 人を何人くらい受け持つかの目安（囲みは面積、線は長さ）
export function fillWeight(g, r = 20) {
  if (g.t === 'line') return polyLength(linePoints(g)) * r * 2.4;
  return shapeArea(g);
}

// 囲みの中に k 人。中心が図形の内側にあれば、丸が少しはみ出してもよい
export function pointsInRegion(g, k, r, occ, rand = Math.random) {
  if (k <= 0) return [];
  const bb = shapeBBox(g);
  const bw = bb[2] - bb[0], bh = bb[3] - bb[1];
  const step = Math.max(3, Math.min(10, Math.sqrt((bw * bh) / 2500)));
  let cand = [];
  for (let y = bb[1] + step / 2; y < bb[3]; y += step) {
    for (let x = bb[0] + step / 2; x < bb[2]; x += step) if (insideShape(g, x, y, 0)) cand.push([x, y]);
  }
  if (!cand.length) {
    const c = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    return Array.from({ length: k }, () => [Math.round(c[0]), Math.round(c[1])]);
  }
  // すでに置いてある人のすぐ近くは避ける（空きがなくなるなら避けない）
  const free = cand.filter((p) => !occ.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < r * 1.7));
  if (free.length >= k * 3) cand = free;

  // 散らばった初期位置（いちばん遠い点を順に選ぶ）
  const centers = [cand[Math.floor(rand() * cand.length)].slice()];
  const dmin = cand.map((p) => Math.hypot(p[0] - centers[0][0], p[1] - centers[0][1]));
  while (centers.length < k) {
    let bi = 0;
    for (let i = 1; i < cand.length; i++) if (dmin[i] > dmin[bi]) bi = i;
    const c = cand[bi].slice();
    centers.push(c);
    for (let i = 0; i < cand.length; i++) dmin[i] = Math.min(dmin[i], Math.hypot(cand[i][0] - c[0], cand[i][1] - c[1]));
  }
  // 各人の受け持ち範囲の真ん中へ寄せる（ロイドの方法）。図形の中に収まるよう、いちばん近い内側の点に合わせる
  const nearestCand = (x, y) => {
    let b = cand[0], bd = Infinity;
    for (const p of cand) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; b = p; } }
    return b;
  };
  for (let it = 0; it < 30; it++) {
    const sx = new Float64Array(k), sy = new Float64Array(k), n = new Float64Array(k);
    for (const p of cand) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const d = (p[0] - centers[j][0]) ** 2 + (p[1] - centers[j][1]) ** 2; if (d < bd) { bd = d; bi = j; } }
      sx[bi] += p[0]; sy[bi] += p[1]; n[bi]++;
    }
    for (let j = 0; j < k; j++) if (n[j]) { const q = nearestCand(sx[j] / n[j], sy[j] / n[j]); centers[j] = [q[0], q[1]]; }
  }
  // 少しだけばらつかせる（ほかの人とぶつからない範囲で）
  const spacing = Math.sqrt(cand.length * step * step / k);
  const gap = Math.min(2 * r + 2, spacing * 0.9);
  const others = (j) => centers.filter((_, i) => i !== j).concat(occ);
  for (let j = 0; j < k; j++) {
    for (let t = 0; t < 6; t++) {
      const a = rand() * Math.PI * 2, d = Math.min(r * 0.6, spacing * (0.05 + rand() * 0.1));
      const x = centers[j][0] + Math.cos(a) * d, y = centers[j][1] + Math.sin(a) * d;
      if (!insideShape(g, x, y, 0)) continue;
      if (others(j).some((o) => Math.hypot(o[0] - x, o[1] - y) < gap)) continue;
      centers[j] = [x, y];
      break;
    }
  }
  return centers.map((c) => [Math.round(c[0]), Math.round(c[1])]);
}

// 線の上に k 人、線に沿って等間隔に
export function pointsOnLine(g, k) {
  if (k <= 0) return [];
  const pts = linePoints(g);
  const L = polyLength(pts);
  return Array.from({ length: k }, (_, i) => {
    const m = pointAt(pts, (L * (i + 0.5)) / k);
    return [Math.round(m.x), Math.round(m.y)];
  });
}

export function pointsFor(g, k, r, occ, rand) {
  return g.t === 'line' ? pointsOnLine(g, k) : pointsInRegion(g, k, r, occ, rand);
}
