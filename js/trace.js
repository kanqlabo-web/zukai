// 下絵：ホワイトボードなどに描いた図解の写真を、図の編集画面に薄く敷いてなぞれるようにする
// 斜めに撮った写真も、舞台の枠の四隅を合わせると、舞台（W×H）の形にまっすぐ直す
import { h } from './vdom.js';
import { W, H } from './stage.js';

// 写真を読み込む（大きすぎる写真は長い辺 2000px まで縮める）
export function loadPhoto(file) {
  const url = URL.createObjectURL(file);
  return loadPhotoSrc(url, '写真を読み込めませんでした（HEIC形式の場合はJPEGで保存し直してください）').finally(() => URL.revokeObjectURL(url));
}

// ページにすでにある写真・画像（data: や https: の src）を読み込む
export function loadPhotoSrc(src, failMsg = 'この画像を読み込めませんでした。ファイルから選んでください') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!/^(data|blob):/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve({ canvas: c, url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height });
      } catch (e) { reject(new Error(failMsg)); }
    };
    img.onerror = () => reject(new Error(failMsg));
    img.src = src;
  });
}

// 下絵にする写真を選ぶ画面：このページ（タイミング）にある写真・画像の一覧と、ファイルから選ぶボタン
// list = [{ src, label }]。onPick(src) / onFile() / onCancel()
export function TraceChooser(list, { onPick, onFile, onCancel }) {
  return h('div', { class: 'trace-pick' },
    h('div', { class: 'trace-pick-head' },
      h('b', null, '下絵にする写真を選ぶ'),
      h('div', { class: 'muted small' }, 'このページにある写真・画像から選べます。ほかの写真はファイルから選んでください。')),
    h('div', { class: 'trace-choose-body' },
      h('div', { class: 'trace-choose-grid' }, list.map((x, i) => h('button', {
        key: 'p' + i, class: 'trace-choose-item', title: x.label, onclick: () => onPick(x.src),
      },
        h('img', { src: x.src, alt: x.label, draggable: 'false' }),
        h('span', { class: 'trace-choose-label' }, x.label))))),
    h('div', { class: 'trace-pick-foot' },
      h('button', { class: 'btn ghost', onclick: onCancel }, 'やめる'),
      h('button', { class: 'btn', onclick: onFile }, 'ファイルから選ぶ')));
}

// 4組の点から射影変換（出力の点 → 写真の点）を求める
function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // ガウスの消去法
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

// 写真の四隅（左上・右上・右下・左下）で囲んだ所を、舞台の形（W×H）の画像にする
export function warpToStage(photo, corners, out = 1000) {
  const ow = out, oh = Math.round(out * H / W);
  const m = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], corners);
  const src = photo.canvas.getContext('2d').getImageData(0, 0, photo.w, photo.h).data;
  const c = document.createElement('canvas');
  c.width = ow; c.height = oh;
  const ctx = c.getContext('2d');
  const dst = ctx.createImageData(ow, oh);
  const d = dst.data;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const z = m[6] * x + m[7] * y + 1;
      const sx = (m[0] * x + m[1] * y + m[2]) / z, sy = (m[3] * x + m[4] * y + m[5]) / z;
      const o = (y * ow + x) * 4;
      if (sx < 0 || sy < 0 || sx >= photo.w - 1 || sy >= photo.h - 1) { d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = 255; continue; }
      // となりの4画素をなめらかに混ぜる
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * photo.w + x0) * 4, i10 = i00 + 4, i01 = i00 + photo.w * 4, i11 = i01 + 4;
      for (let k = 0; k < 3; k++) {
        d[o + k] = (src[i00 + k] * (1 - fx) + src[i10 + k] * fx) * (1 - fy) + (src[i01 + k] * (1 - fx) + src[i11 + k] * fx) * fy;
      }
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
  let q = 0.75, data = c.toDataURL('image/jpeg', q);
  while (data.length > 300000 && q > 0.35) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
  return { data, w: ow, h: oh };
}

// 四隅を合わせる画面。st = { photo, pts:[[x,y]×4], drag }。onDone(四隅) / onCancel()
export function TracePicker(st, { onDone, onCancel, redraw }) {
  const { photo, pts } = st;
  // 丸の大きさ：画面で少なくとも直径30px くらいになるように（スマホでも指で動かせるよう）
  const dispW = Math.max(100, Math.min(window.innerWidth - 20, (window.innerHeight - 220) * photo.w / photo.h));
  const r = Math.max(photo.w / 45, 15 * photo.w / dispW);
  const toImg = (e) => {
    const svg = e.currentTarget.ownerSVGElement || e.currentTarget;
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return [Math.max(0, Math.min(photo.w, q.x)), Math.max(0, Math.min(photo.h, q.y))];
  };
  const NAMES = ['左上', '右上', '右下', '左下'];
  return h('div', { class: 'trace-pick' },
    h('div', { class: 'trace-pick-head' },
      h('b', null, '下絵の四隅を合わせる'),
      h('div', { class: 'muted small' }, '写真の舞台の枠（ホワイトボードの線など）の四隅に、4つの丸を動かして合わせてください。斜めに撮った写真も、舞台の形にまっすぐ直します。')),
    h('div', { class: 'trace-pick-body' },
      h('svg', {
        class: 'trace-pick-svg', viewBox: `0 0 ${photo.w} ${photo.h}`, xmlns: 'http://www.w3.org/2000/svg',
        onpointermove: (e) => { if (st.drag == null) return; e.preventDefault(); pts[st.drag] = toImg(e); redraw(); },
        onpointerup: () => { st.drag = null; }, onpointercancel: () => { st.drag = null; },
      },
        h('image', { href: photo.url, x: 0, y: 0, width: photo.w, height: photo.h }),
        h('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: 'rgba(90, 80, 168, .12)', stroke: '#5a50a8', 'stroke-width': r / 5 }),
        Loupe(st, r),
        pts.map((p, i) => h('g', { key: 'c' + i },
          h('circle', {
            cx: p[0], cy: p[1], r, fill: 'rgba(255,255,255,.35)', stroke: '#e60012', 'stroke-width': r / 4, style: { cursor: 'move', touchAction: 'none' },
            onpointerdown: (e) => { e.preventDefault(); st.drag = i; try { e.currentTarget.ownerSVGElement.setPointerCapture(e.pointerId); } catch (er) { /* noop */ } },
          }),
          h('circle', { cx: p[0], cy: p[1], r: r / 6, fill: '#e60012', 'pointer-events': 'none' }),
          h('text', { x: p[0], y: p[1] < r * 2.6 ? p[1] + r * 2.1 : p[1] - r * 1.3, 'text-anchor': 'middle', 'font-size': r * 0.9, fill: '#e60012', stroke: '#fff', 'stroke-width': r / 6, 'paint-order': 'stroke', 'pointer-events': 'none' }, NAMES[i]))))),
    h('div', { class: 'trace-pick-foot' },
      h('button', { class: 'btn ghost', onclick: onCancel }, 'やめる'),
      h('button', { class: 'btn', onclick: () => onDone([[0, 0], [photo.w, 0], [photo.w, photo.h], [0, photo.h]]) }, '直さずに使う'),
      h('button', { class: 'btn primary', onclick: () => onDone(pts.map((p) => p.slice())) }, 'この四隅で下絵にする')));
}

// 動かしている丸のまわりを拡大して、指の上に出す（指で隠れて見えないため）
function Loupe(st, r) {
  const { photo, pts, drag } = st;
  if (drag == null) return h('g', { key: 'loupe' });
  const [px, py] = pts[drag];
  const R = r * 3, Z = 3;
  const cx = Math.min(photo.w - R, Math.max(R, px));
  const cy = py - R - r * 2 > 0 ? py - R - r * 2 : py + R + r * 2;
  return h('g', { key: 'loupe', 'pointer-events': 'none' },
    h('clipPath', { id: 'trace-loupe' }, h('circle', { cx, cy, r: R })),
    h('g', { 'clip-path': 'url(#trace-loupe)' },
      h('rect', { x: cx - R, y: cy - R, width: R * 2, height: R * 2, fill: '#fff' }),
      h('image', { href: photo.url, x: 0, y: 0, width: photo.w, height: photo.h, transform: `translate(${cx} ${cy}) scale(${Z}) translate(${-px} ${-py})` })),
    h('circle', { cx, cy, r: R, fill: 'none', stroke: '#fff', 'stroke-width': r / 4 }),
    h('circle', { cx, cy, r: R, fill: 'none', stroke: '#5a50a8', 'stroke-width': r / 10 }),
    h('path', { d: `M${cx - R} ${cy}H${cx + R}M${cx} ${cy - R}V${cy + R}`, stroke: '#e60012', 'stroke-width': r / 12 }));
}

// 写真の大きさから、四隅の最初の位置（少し内側）
export function initialCorners(photo) {
  const mx = photo.w * 0.08, my = photo.h * 0.1;
  return [[mx, my], [photo.w - mx, my], [photo.w - mx, photo.h - my], [mx, photo.h - my]];
}

// 写真から舞台の枠（濃い線で描いた四角）の四隅を探す。見つからなければ null
// 濃い線を拾い（両側より暗い所）、ハフ変換で長い直線を探し、上下・左右の線の組で
// 4辺とも線が通っている四角のうち、いちばん大きいものを舞台の枠とみなす
export function detectCorners(photo) {
  try {
    const k = Math.min(1, 400 / Math.max(photo.w, photo.h));
    const w = Math.max(8, Math.round(photo.w * k)), h = Math.max(8, Math.round(photo.h * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(photo.canvas, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    const q = cornersFromGray(gray, w, h);
    return q ? q.map(([x, y]) => [x / k, y / k]) : null;
  } catch (e) { return null; }
}

// まず写真の中だけで探し、見つからなければ写真の外を白とみなしてもう一度探す
// （枠が絵の端いっぱいに描いてあるイラストのため。写真の端に写った壁などを先に拾わないよう、この順にする）
export function cornersFromGray(gray, w, h) {
  return findFrame(gray, w, h, false) || findFrame(gray, w, h, true);
}

function findFrame(gray, w, h, edgeWhite) {
  // 1. 濃い線：両側（左右・上下・斜めのどれか）より暗い画素。
  //    ホワイトボードと壁の境目のような「片側だけ暗い」所は拾わない
  const d = Math.max(3, Math.round(Math.max(w, h) / 80));
  const ink = new Uint8Array(w * h);
  let n = 0;
  // edgeWhite：写真の外は白とみなす（端いっぱいの線も拾う）。
  // そうでなければ、端の近くでは比べる間隔を端までに縮める（端のすぐ内側の細い線も拾い、端に写った壁などは拾わない）
  const G = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? Infinity : gray[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const g = G(x, y);
    let side;
    if (edgeWhite) {
      side = Math.max(
        Math.min(G(x - d, y), G(x + d, y)), Math.min(G(x, y - d), G(x, y + d)),
        Math.min(G(x - d, y - d), G(x + d, y + d)), Math.min(G(x - d, y + d), G(x + d, y - d)));
    } else {
      const dx = Math.min(d, x, w - 1 - x), dy = Math.min(d, y, h - 1 - y), e = Math.min(dx, dy);
      side = -Infinity;
      if (dx >= 2) side = Math.max(side, Math.min(G(x - dx, y), G(x + dx, y)));
      if (dy >= 2) side = Math.max(side, Math.min(G(x, y - dy), G(x, y + dy)));
      if (e >= 2) side = Math.max(side, Math.min(G(x - e, y - e), G(x + e, y + e)), Math.min(G(x - e, y + e), G(x + e, y - e)));
    }
    if (side - g > 18 && g < side * 0.85) { ink[y * w + x] = 1; n++; }
  }
  if (n < (w + h) || n > w * h * 0.4) return null;
  // 線の近く（1画素ふくらませた所）
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ink[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) near[yy * w + xx] = 1;
    }
  }
  // 2. ハフ変換（角度 1°、距離 1px）
  const NT = 180, D = Math.ceil(Math.hypot(w, h)), NR = D * 2 + 1;
  const cs = [], sn = [];
  for (let t = 0; t < NT; t++) { cs.push(Math.cos(t * Math.PI / NT)); sn.push(Math.sin(t * Math.PI / NT)); }
  const acc = new Uint32Array(NT * NR);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ink[y * w + x]) continue;
    for (let t = 0; t < NT; t++) acc[t * NR + Math.round(x * cs[t] + y * sn[t]) + D]++;
  }
  // 3. 山（まわりより多い所）を、強い順に拾う
  const minV = Math.min(w, h) * 0.2;
  const peaks = [];
  for (let t = 0; t < NT; t++) for (let p = 0; p < NR; p++) {
    const v = acc[t * NR + p];
    if (v < minV) continue;
    let top = true;
    for (let dt = -4; dt <= 4 && top; dt++) for (let dp = -6; dp <= 6; dp++) {
      if (!dt && !dp) continue;
      let tt = t + dt, pp = p + dp;
      if (tt < 0) { tt += NT; pp = NR - 1 - pp; } else if (tt >= NT) { tt -= NT; pp = NR - 1 - pp; }
      if (pp < 0 || pp >= NR) continue;
      const u = acc[tt * NR + pp];
      if (u > v || (u === v && (tt * NR + pp) < t * NR + p)) { top = false; break; }
    }
    if (top) peaks.push({ t, rho: p - D, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  const hor = [], ver = [];
  for (const L of peaks) {
    const deg = L.t * 180 / NT;
    const line = { c: cs[L.t], s: sn[L.t], rho: L.rho };
    if (Math.abs(deg - 90) <= 35) { if (hor.length < 10) hor.push(line); }
    else if (deg <= 35 || deg >= 145) { if (ver.length < 10) ver.push(line); }
  }
  if (hor.length < 2 || ver.length < 2) return null;
  const yAt = (L) => (L.rho - (w / 2) * L.c) / L.s;
  const xAt = (L) => (L.rho - (h / 2) * L.s) / L.c;
  const meet = (a, b) => {
    const det = a.c * b.s - a.s * b.c;
    if (Math.abs(det) < 1e-6) return null;
    return [(a.rho * b.s - a.s * b.rho) / det, (a.c * b.rho - a.rho * b.c) / det];
  };
  // 辺の上に線がどれだけ通っているか（0〜1）
  const cover = (p, q) => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const N = Math.max(10, Math.round(len));
    let hit = 0;
    for (let i = 0; i <= N; i++) {
      const x = Math.round(p[0] + (q[0] - p[0]) * i / N), y = Math.round(p[1] + (q[1] - p[1]) * i / N);
      if (x >= 0 && y >= 0 && x < w && y < h && near[y * w + x]) hit++;
    }
    return hit / (N + 1);
  };
  const tol = Math.max(w, h) * 0.03;
  let best = null, bestScore = 0;
  for (let i = 0; i < hor.length; i++) for (let j = i + 1; j < hor.length; j++) {
    let [T, B] = [hor[i], hor[j]];
    if (yAt(T) > yAt(B)) [T, B] = [B, T];
    if (yAt(B) - yAt(T) < h * 0.2) continue;
    for (let a = 0; a < ver.length; a++) for (let b = a + 1; b < ver.length; b++) {
      let [Lf, R] = [ver[a], ver[b]];
      if (xAt(Lf) > xAt(R)) [Lf, R] = [R, Lf];
      if (xAt(R) - xAt(Lf) < w * 0.2) continue;
      const q = [meet(T, Lf), meet(T, R), meet(B, R), meet(B, Lf)];
      if (q.some((p) => !p || p[0] < -tol || p[1] < -tol || p[0] > w + tol || p[1] > h + tol)) continue;
      // 左上→右上→右下→左下 が同じ向きに曲がる（ねじれていない）四角だけ
      let sign = 0, ok = true, area = 0;
      for (let k = 0; k < 4; k++) {
        const [p0, p1, p2] = [q[k], q[(k + 1) % 4], q[(k + 2) % 4]];
        const cr = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]);
        if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) ok = false;
        area += p0[0] * p1[1] - p1[0] * p0[1];
      }
      area = Math.abs(area) / 2;
      if (!ok || area < w * h * 0.12) continue;
      const cv = [0, 1, 2, 3].map((k) => cover(q[k], q[(k + 1) % 4]));
      if (Math.min(...cv) < 0.55) continue;
      const avg = cv.reduce((s, v) => s + v, 0) / 4;
      const score = area * avg * avg;
      if (score > bestScore) { bestScore = score; best = q; }
    }
  }
  return best && best.map(([x, y]) => [Math.max(0, Math.min(w, x)), Math.max(0, Math.min(h, y))]);
}

// ---------- 下絵の黒い線を、図の中の画像として取り込む ----------
// 下絵（舞台の形に直した写真）を読み込み、まわりより暗い所（手書きの線・文字）だけを黒、ほかを透明にした画像を作る準備をする
export function prepareInk(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      const gray = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
      // まわり（箱）の明るさの平均。照明のむらがあっても線だけを拾えるように
      const r = Math.max(6, Math.round(Math.max(w, h) / 70));
      const S = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) { row += gray[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
      }
      const diff = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
          const m = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
          diff[y * w + x] = m - gray[y * w + x];
        }
      }
      resolve({ w, h, diff });
    };
    img.onerror = () => reject(new Error('下絵を読み込めませんでした'));
    img.src = src;
  });
}

// level：まわりよりどれだけ暗ければ線とみなすか（小さいほど薄い線も拾う）。黒い線だけの透明な PNG を返す
export function inkDataUrl(ink, level) {
  const { w, h, diff } = ink;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = diff[i] > level ? 1 : 0;
  const gone = frameLines(m, w, h);
  const make = (k) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const out = ctx.createImageData(w, h);
    const d = out.data;
    for (let i = 0; i < w * h; i++) {
      const a = gone[i] ? 0 : Math.max(0, Math.min(1, (diff[i] - level) / 12));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 17;
      d[i * 4 + 3] = Math.round(a * 255);
    }
    ctx.putImageData(out, 0, 0);
    if (k === 1) return c.toDataURL('image/png');
    const s = document.createElement('canvas');
    s.width = Math.round(w * k); s.height = Math.round(h * k);
    s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
    return s.toDataURL('image/png');
  };
  // 図は1つの文書に保存するので、大きすぎるときは縮める
  let k = 1, url = make(k);
  while (url.length > 450000 && k > 0.4) { k -= 0.2; url = make(k); }
  return url;
}

// 舞台の枠の線（外枠・袖の線・袖の四角・真ん中の十字）を見つけて、消す画素を返す
// 図解メーカーの図にも同じ枠と十字があるので、取り込んだ線では二重にならないように消す。
// 下絵は写真の枠の四隅を図の四隅に合わせてあるので、線はだいたい決まった場所にある。
// その近くで、まっすぐ長く続く線（点線も）を探し、短い区間ごとに位置と太さを合わせて消す。
// 線をまたいでいる文字や矢印（線の外まで続いている所）は残す。m：線の画素（1）
export function frameLines(m, w, h) {
  const band = new Uint8Array(w * h); // 見つけた枠の線の帯
  const segs = [];
  // 横の線は (u=x, v=y)、縦の線は (u=y, v=x) として同じように扱う
  const idx = (hor, u, v) => (hor ? (u < 0 || u >= w || v < 0 || v >= h ? -1 : v * w + u) : (u < 0 || u >= h || v < 0 || v >= w ? -1 : u * w + v));
  const at = (hor, u, v) => { const i = idx(hor, u, v); return i < 0 ? 0 : m[i]; };
  const line = (hor, vmin, vmax, a, b, minCov) => {
    const V = hor ? h : w, U = hor ? w : h;
    vmin = Math.max(0, Math.round(vmin)); vmax = Math.min(V - 1, Math.round(vmax));
    a = Math.max(0, Math.round(a)); b = Math.min(U - 1, Math.round(b));
    if (b - a < 10) return;
    // 区間全体で、いちばん線が通っている位置（少し斜めでも拾えるよう上下1画素も見る）
    let best = -1, bestN = 0;
    for (let v = vmin; v <= vmax; v++) {
      let n = 0;
      for (let u = a; u <= b; u++) if (at(hor, u, v) || at(hor, u, v - 1) || at(hor, u, v + 1)) n++;
      if (n > bestN) { bestN = n; best = v; }
    }
    if (best < 0 || bestN < (b - a + 1) * minCov) return;
    // 短い区間ごとに、位置と太さを合わせる（手書きで少し曲がっていてもよいように）
    const SEG = Math.max(20, Math.round(U / 25)), R = Math.max(4, Math.round(V / 60));
    for (let s0 = a; s0 <= b; s0 += SEG) {
      const s1 = Math.min(b, s0 + SEG - 1), L = s1 - s0 + 1;
      const cov = (v) => { let n = 0; for (let u = s0; u <= s1; u++) n += at(hor, u, v); return n / L; };
      let v0 = -1, c0 = 0;
      for (let v = Math.max(vmin - R, best - R); v <= Math.min(vmax + R, best + R); v++) { const c = cov(v); if (c > c0) { c0 = c; v0 = v; } }
      if (v0 < 0 || c0 < 0.3) continue;
      let v1 = v0, v2 = v0;
      while (v1 - 1 >= 0 && v0 - v1 < R && cov(v1 - 1) >= c0 * 0.4) v1--;
      while (v2 + 1 < V && v2 - v0 < R && cov(v2 + 1) >= c0 * 0.4) v2++;
      v1 = Math.max(0, v1 - 1); v2 = Math.min(V - 1, v2 + 1);
      segs.push({ hor, s0, s1, v1, v2 });
      for (let u = s0; u <= s1; u++) for (let v = v1; v <= v2; v++) band[idx(hor, u, v)] = 1;
    }
  };
  // 外枠
  line(true, 0, h * 0.07, 0, w, 0.35); line(true, h * 0.93, h, 0, w, 0.35);
  line(false, 0, w * 0.05, 0, h, 0.35); line(false, w * 0.95, w, 0, h, 0.35);
  // 袖の線
  line(false, w * 0.05, w * 0.17, 0, h, 0.35); line(false, w * 0.83, w * 0.95, 0, h, 0.35);
  // 真ん中の十字（点線）
  line(false, w * 0.44, w * 0.56, 0, h, 0.35); line(true, h * 0.42, h * 0.6, w * 0.1, w * 0.9, 0.35);
  // 下の袖の四角（上の辺と内側の辺）
  line(true, h * 0.74, h * 0.93, w * 0.08, w * 0.26, 0.5); line(true, h * 0.74, h * 0.93, w * 0.74, w * 0.92, 0.5);
  line(false, w * 0.12, w * 0.27, h * 0.8, h, 0.5); line(false, w * 0.73, w * 0.88, h * 0.8, h, 0.5);

  // 消す。ほかの枠の線の帯でない線（文字・円・矢印など）が帯のすぐ外にある所は残す
  const gone = new Uint8Array(w * h);
  const other = (hor, u, v) => { const i = idx(hor, u, v); return i >= 0 && m[i] && !band[i]; };
  for (const { hor, s0, s1, v1, v2 } of segs) {
    for (let u = s0; u <= s1; u++) {
      // 帯のすぐ外（近くの列も）に文字などがある所は、文字を欠けさせないよう線を残す
      let keep = false;
      for (let du = -3; du <= 3 && !keep; du++) for (let k = 2; k <= 6; k++) if (other(hor, u + du, v1 - k) || other(hor, u + du, v2 + k)) { keep = true; break; }
      if (keep) continue;
      for (let v = v1; v <= v2; v++) { const i = idx(hor, u, v); if (i >= 0) gone[i] = 1; }
    }
  }
  return gone;
}

// 四隅をあとで合わせ直せるよう、元の写真を保存できる大きさにする（1つの文書に入るように縮める）。k：元の写真からの倍率
export function photoForSave(photo) {
  let k = Math.min(1, 1600 / Math.max(photo.w, photo.h)), data;
  for (;;) {
    const c = document.createElement('canvas');
    c.width = Math.round(photo.w * k); c.height = Math.round(photo.h * k);
    c.getContext('2d').drawImage(photo.canvas, 0, 0, c.width, c.height);
    data = c.toDataURL('image/jpeg', 0.8);
    if (data.length < 600000 || k < 0.3) return { data, w: c.width, h: c.height, k };
    k *= 0.8;
  }
}
