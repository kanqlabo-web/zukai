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

export function cornersFromGray(gray, w, h) {
  // 1. 濃い線：両側（左右・上下・斜めのどれか）より暗い画素。
  //    ホワイトボードと壁の境目のような「片側だけ暗い」所は拾わない
  const d = Math.max(3, Math.round(Math.max(w, h) / 80));
  const ink = new Uint8Array(w * h);
  let n = 0;
  const G = (x, y) => gray[y * w + x];
  for (let y = d; y < h - d; y++) for (let x = d; x < w - d; x++) {
    const g = G(x, y);
    const side = Math.max(
      Math.min(G(x - d, y), G(x + d, y)), Math.min(G(x, y - d), G(x, y + d)),
      Math.min(G(x - d, y - d), G(x + d, y + d)), Math.min(G(x - d, y + d), G(x + d, y - d)));
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
