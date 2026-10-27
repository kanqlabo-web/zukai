// 取り込んだ形（点の並び）に、スライドの図形（カーブ矢印など）を重ねて、いちばん合う種類・位置・大きさ・向き・調整値を探す
// 合えば { t: 'preset', … } を、合わなければ null を返す
import { PRESETS, presetPaths, presetToStage } from './preset.js';

const KINDS = ['curvedUpArrow', 'curvedDownArrow', 'curvedLeftArrow', 'curvedRightArrow', 'uturnArrow', 'bentArrow'];

// 点の並びを、ほぼ等間隔の点にする
function resample(polys, step) {
  const out = [];
  for (const p of polys) {
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / step));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    if (p.length) out.push(p[p.length - 1]);
  }
  return out;
}
// 点から線分の集まりまでのいちばん近い距離
function nearest(q, segs) {
  let m = Infinity;
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2));
    const d = Math.hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dy * t);
    if (d < m) m = d;
  }
  return m;
}
const segsOf = (polys) => polys.flatMap((p) => p.slice(1).map((q, i) => [p[i], q]));

// 取り込んだ形の線までの距離を、細かい升目に前もって計算しておく（升目の間はなめらかにつなぐ）
function distField(polys, diag) {
  const all = polys.flat(), segs = segsOf(polys);
  const pad = diag * 0.3, c = diag / 200;
  const x0 = Math.min(...all.map((q) => q[0])) - pad, y0 = Math.min(...all.map((q) => q[1])) - pad;
  const nx = Math.ceil((Math.max(...all.map((q) => q[0])) + pad - x0) / c) + 1, ny = Math.ceil((Math.max(...all.map((q) => q[1])) + pad - y0) / c) + 1;
  const g = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = nearest([x0 + i * c, y0 + j * c], segs);
  return ([x, y]) => {
    const u = (x - x0) / c, v = (y - y0) / c;
    if (u < 0 || v < 0 || u >= nx - 1 || v >= ny - 1) return nearest([x, y], segs);
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * nx + i;
    return (g[k] * (1 - fu) + g[k + 1] * fu) * (1 - fv) + (g[k + nx] * (1 - fu) + g[k + nx + 1] * fu) * fv;
  };
}

// polys：取り込んだ形の線（舞台の座標。外形の線と、同じ図形の塗りの部分）
export function fitPreset(polys) {
  const all = polys.flat();
  if (all.length < 8) return null;
  const xs = all.map((q) => q[0]), ys = all.map((q) => q[1]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (diag < 10) return null;
  // 取り込んだ形の点（同じ所に重なった点は1つに）
  const seen = new Set();
  const src = resample(polys, diag / 50).filter((q) => { const k = Math.round(q[0] / (diag / 100)) + ',' + Math.round(q[1] / (diag / 100)); if (seen.has(k)) return false; seen.add(k); return true; });
  const dist = distField(polys, diag);
  // 形の線（舞台の座標）
  const model = (s) => {
    const T = presetToStage(s);
    return presetPaths(s.preset, s.w, s.h, s.adj, true).map((p) => (p.closed ? p.pts.concat([p.pts[0]]) : p.pts).map(T));
  };
  // ずれ：取り込んだ形の点から形の線まで、形の線の点から取り込んだ形の線までの、平均の距離
  const loss = (s) => {
    if (s.w < 4 || s.h < 4) return Infinity;
    const m = model(s), mSegs = segsOf(m), mPts = resample(m, diag / 50);
    let a = 0, b = 0;
    for (const q of src) a += nearest(q, mSegs);
    for (const q of mPts) b += dist(q);
    return a / src.length + b / mPts.length;
  };
  // 回す角を決めたときの、枠の大きさと中心（その向きで、取り込んだ形が入る四角）
  const boxAt = (rot) => {
    const r = (rot * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r);
    const u = all.map((q) => q[0] * c + q[1] * n), v = all.map((q) => -q[0] * n + q[1] * c);
    const u0 = Math.min(...u), u1 = Math.max(...u), v0 = Math.min(...v), v1 = Math.max(...v);
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    return { x: cu * c - cv * n, y: cu * n + cv * c, w: u1 - u0, h: v1 - v0 };
  };
  const cands = [];
  for (const preset of KINDS) for (const fh of [false, true]) for (let rot = 0; rot < 360; rot += 30) {
    const s = { t: 'preset', preset, fh, rot, ...boxAt(rot), adj: { ...PRESETS[preset].av } };
    cands.push({ s, e: loss(s) });
  }
  cands.sort((a, b) => a.e - b.e);
  let best = null;
  for (const c of cands.slice(0, 6)) {
    const r = refine(c.s, loss, diag);
    if (!best || r.e < best.e) best = r;
  }
  // いちばん合ったものを、何回か合わせ直してから、点を細かくして確かめる
  if (best) {
    const srcSegs = segsOf(polys), srcFine = resample(polys, diag / 150);
    const exact = (s) => {
      if (s.w < 4 || s.h < 4) return Infinity;
      const T = presetToStage(s);
      const m = presetPaths(s.preset, s.w, s.h, s.adj).map((p) => (p.closed ? p.pts.concat([p.pts[0]]) : p.pts).map(T));
      const mSegs = segsOf(m), mPts = resample(m, diag / 150);
      let a = 0, b = 0;
      for (const q of srcFine) a += nearest(q, mSegs);
      for (const q of mPts) b += nearest(q, srcSegs);
      return a / srcFine.length + b / mPts.length;
    };
    // 合わせ直しを、動かす幅を小さくしながら何回か（途中で止まった所から抜け出すため）
    for (const k of [1, 0.5, 0.3, 0.2, 0.1, 0.05]) { const r = refine(best.s, loss, diag, k); if (r.e < best.e) best = r; }
    best = { s: best.s, e: exact(best.s) };

  }
  if (!best || best.e > Math.max(1.2, diag * 0.012)) return null;
  const s = best.s, r1 = (v) => Math.round(v * 10) / 10;
  const adj = {};
  for (const k in s.adj) adj[k] = Math.round(s.adj[k]);
  return { t: 'preset', preset: s.preset, x: r1(s.x), y: r1(s.y), w: r1(s.w), h: r1(s.h), rot: r1(((s.rot % 360) + 360) % 360), ...(s.fh ? { fh: true } : {}), adj };
}

// ネルダー・ミードで、位置・大きさ・向き・調整値を少しずつ動かして、ずれを小さくする
function refine(s0, loss, diag, scale = 1) {
  const keys = Object.keys(s0.adj);
  const toV = (s) => [s.x, s.y, s.w, s.h, s.rot, ...keys.map((k) => s.adj[k] / 1000)];
  const toS = (v) => ({ ...s0, x: v[0], y: v[1], w: v[2], h: v[3], rot: v[4], adj: Object.fromEntries(keys.map((k, i) => [k, Math.max(0, v[5 + i] * 1000)])) });
  const f = (v) => loss(toS(v));
  const n = 5 + keys.length;
  const v0 = toV(s0);
  const steps = [diag * 0.05, diag * 0.05, diag * 0.08, diag * 0.08, 8, ...keys.map(() => 5)].map((d) => d * scale);
  let simplex = [v0, ...steps.map((d, i) => { const v = v0.slice(); v[i] += d; return v; })].map((v) => ({ v, e: f(v) }));
  for (let it = 0; it < 500; it++) {
    simplex.sort((a, b) => a.e - b.e);
    if (simplex[n].e - simplex[0].e < 1e-5) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i].v[j] / n;
    const w = simplex[n];
    const at = (k) => c.map((x, j) => x + k * (w.v[j] - x));
    const r = { v: at(-1) }; r.e = f(r.v);
    if (r.e < simplex[0].e) {
      const e = { v: at(-2) }; e.e = f(e.v);
      simplex[n] = e.e < r.e ? e : r;
    } else if (r.e < simplex[n - 1].e) simplex[n] = r;
    else {
      const k = { v: at(r.e < w.e ? -0.5 : 0.5) }; k.e = f(k.v);
      if (k.e < Math.min(w.e, r.e)) simplex[n] = k;
      else simplex = simplex.map((p, i) => (i === 0 ? p : (() => { const v = p.v.map((x, j) => simplex[0].v[j] + (x - simplex[0].v[j]) / 2); return { v, e: f(v) }; })()));
    }
  }
  simplex.sort((a, b) => a.e - b.e);
  return { s: toS(simplex[0].v), e: simplex[0].e };
}
