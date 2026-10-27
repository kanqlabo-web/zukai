// Googleスライド・図形描画の図形（OOXML のプリセット図形）を、元と同じ式で描く
// 定義は OOXML（ECMA-376）の presetShapeDefinitions.xml から、曲がり矢印などの分だけを写したもの
// ・av：調整値の既定（adj1 など。100000 分率）、gd：計算式の並び、p：描く線（fill：norm ＝ふつうの塗り、darkenLess ＝少し濃い塗り、none ＝塗りなし。stroke：線を描くか）
// ・命令：M・L は点（式の名前か数）、A は楕円の弧（横半径・縦半径・始めの角・回す角。角は 60000 分の 1 度）、C はベジエ、Z は閉じる
export const PRESETS = {"curvedUpArrow":{"av":{"adj1":25000,"adj2":50000,"adj3":25000},"gd":[["maxAdj2","*/ 50000 w ss"],["a2","pin 0 adj2 maxAdj2"],["a1","pin 0 adj1 100000"],["th","*/ ss a1 100000"],["aw","*/ ss a2 100000"],["q1","+/ th aw 4"],["wR","+- wd2 0 q1"],["q7","*/ wR 2 1"],["q8","*/ q7 q7 1"],["q9","*/ th th 1"],["q10","+- q8 0 q9"],["q11","sqrt q10"],["idy","*/ q11 h q7"],["maxAdj3","*/ 100000 idy ss"],["a3","pin 0 adj3 maxAdj3"],["ah","*/ ss adj3 100000"],["x3","+- wR th 0"],["q2","*/ h h 1"],["q3","*/ ah ah 1"],["q4","+- q2 0 q3"],["q5","sqrt q4"],["dx","*/ q5 wR h"],["x5","+- wR dx 0"],["x7","+- x3 dx 0"],["q6","+- aw 0 th"],["dh","*/ q6 1 2"],["x4","+- x5 0 dh"],["x8","+- x7 dh 0"],["aw2","*/ aw 1 2"],["x6","+- r 0 aw2"],["y1","+- t ah 0"],["swAng","at2 ah dx"],["mswAng","+- 0 0 swAng"],["iy","+- t idy 0"],["ix","+/ wR x3 2"],["q12","*/ th 1 2"],["dang2","at2 idy q12"],["swAng2","+- dang2 0 swAng"],["mswAng2","+- 0 0 swAng2"],["stAng3","+- cd4 0 swAng"],["swAng3","+- swAng dang2 0"],["stAng2","+- cd4 0 dang2"]],"p":[{"fill":"norm","stroke":false,"c":[["M","x6","t"],["L","x8","y1"],["L","x7","y1"],["A","wR","h","stAng3","swAng3"],["A","wR","h","stAng2","swAng2"],["L","x4","y1"],["Z"]]},{"fill":"darkenLess","stroke":false,"c":[["M","wR","b"],["A","wR","h","cd4","cd4"],["L","th","t"],["A","wR","h","cd2","-5400000"],["Z"]]},{"fill":"none","stroke":true,"c":[["M","ix","iy"],["A","wR","h","stAng2","swAng2"],["L","x4","y1"],["L","x6","t"],["L","x8","y1"],["L","x7","y1"],["A","wR","h","stAng3","swAng"],["L","wR","b"],["A","wR","h","cd4","cd4"],["L","th","t"],["A","wR","h","cd2","-5400000"]]}]},"curvedDownArrow":{"av":{"adj1":25000,"adj2":50000,"adj3":25000},"gd":[["maxAdj2","*/ 50000 w ss"],["a2","pin 0 adj2 maxAdj2"],["a1","pin 0 adj1 100000"],["th","*/ ss a1 100000"],["aw","*/ ss a2 100000"],["q1","+/ th aw 4"],["wR","+- wd2 0 q1"],["q7","*/ wR 2 1"],["q8","*/ q7 q7 1"],["q9","*/ th th 1"],["q10","+- q8 0 q9"],["q11","sqrt q10"],["idy","*/ q11 h q7"],["maxAdj3","*/ 100000 idy ss"],["a3","pin 0 adj3 maxAdj3"],["ah","*/ ss adj3 100000"],["x3","+- wR th 0"],["q2","*/ h h 1"],["q3","*/ ah ah 1"],["q4","+- q2 0 q3"],["q5","sqrt q4"],["dx","*/ q5 wR h"],["x5","+- wR dx 0"],["x7","+- x3 dx 0"],["q6","+- aw 0 th"],["dh","*/ q6 1 2"],["x4","+- x5 0 dh"],["x8","+- x7 dh 0"],["aw2","*/ aw 1 2"],["x6","+- r 0 aw2"],["y1","+- b 0 ah"],["swAng","at2 ah dx"],["mswAng","+- 0 0 swAng"],["iy","+- b 0 idy"],["ix","+/ wR x3 2"],["q12","*/ th 1 2"],["dang2","at2 idy q12"],["stAng","+- 3cd4 swAng 0"],["stAng2","+- 3cd4 0 dang2"],["swAng2","+- dang2 0 cd4"],["swAng3","+- cd4 dang2 0"]],"p":[{"fill":"norm","stroke":false,"c":[["M","x6","b"],["L","x4","y1"],["L","x5","y1"],["A","wR","h","stAng","mswAng"],["L","x3","t"],["A","wR","h","3cd4","swAng"],["L","x8","y1"],["Z"]]},{"fill":"darkenLess","stroke":false,"c":[["M","ix","iy"],["A","wR","h","stAng2","swAng2"],["L","l","b"],["A","wR","h","cd2","swAng3"],["Z"]]},{"fill":"none","stroke":true,"c":[["M","ix","iy"],["A","wR","h","stAng2","swAng2"],["L","l","b"],["A","wR","h","cd2","cd4"],["L","x3","t"],["A","wR","h","3cd4","swAng"],["L","x8","y1"],["L","x6","b"],["L","x4","y1"],["L","x5","y1"],["A","wR","h","stAng","mswAng"]]}]},"curvedLeftArrow":{"av":{"adj1":25000,"adj2":50000,"adj3":25000},"gd":[["maxAdj2","*/ 50000 h ss"],["a2","pin 0 adj2 maxAdj2"],["a1","pin 0 adj1 a2"],["th","*/ ss a1 100000"],["aw","*/ ss a2 100000"],["q1","+/ th aw 4"],["hR","+- hd2 0 q1"],["q7","*/ hR 2 1"],["q8","*/ q7 q7 1"],["q9","*/ th th 1"],["q10","+- q8 0 q9"],["q11","sqrt q10"],["idx","*/ q11 w q7"],["maxAdj3","*/ 100000 idx ss"],["a3","pin 0 adj3 maxAdj3"],["ah","*/ ss a3 100000"],["y3","+- hR th 0"],["q2","*/ w w 1"],["q3","*/ ah ah 1"],["q4","+- q2 0 q3"],["q5","sqrt q4"],["dy","*/ q5 hR w"],["y5","+- hR dy 0"],["y7","+- y3 dy 0"],["q6","+- aw 0 th"],["dh","*/ q6 1 2"],["y4","+- y5 0 dh"],["y8","+- y7 dh 0"],["aw2","*/ aw 1 2"],["y6","+- b 0 aw2"],["x1","+- l ah 0"],["swAng","at2 ah dy"],["mswAng","+- 0 0 swAng"],["ix","+- l idx 0"],["iy","+/ hR y3 2"],["q12","*/ th 1 2"],["dang2","at2 idx q12"],["swAng2","+- dang2 0 swAng"],["swAng3","+- swAng dang2 0"],["stAng3","+- 0 0 dang2"]],"p":[{"fill":"norm","stroke":false,"c":[["M","l","y6"],["L","x1","y4"],["L","x1","y5"],["A","w","hR","swAng","swAng2"],["A","w","hR","stAng3","swAng3"],["L","x1","y8"],["Z"]]},{"fill":"darkenLess","stroke":false,"c":[["M","r","y3"],["A","w","hR","0","-5400000"],["L","l","t"],["A","w","hR","3cd4","cd4"],["Z"]]},{"fill":"none","stroke":true,"c":[["M","r","y3"],["A","w","hR","0","-5400000"],["L","l","t"],["A","w","hR","3cd4","cd4"],["L","r","y3"],["A","w","hR","0","swAng"],["L","x1","y8"],["L","l","y6"],["L","x1","y4"],["L","x1","y5"],["A","w","hR","swAng","swAng2"]]}]},"curvedRightArrow":{"av":{"adj1":25000,"adj2":50000,"adj3":25000},"gd":[["maxAdj2","*/ 50000 h ss"],["a2","pin 0 adj2 maxAdj2"],["a1","pin 0 adj1 a2"],["th","*/ ss a1 100000"],["aw","*/ ss a2 100000"],["q1","+/ th aw 4"],["hR","+- hd2 0 q1"],["q7","*/ hR 2 1"],["q8","*/ q7 q7 1"],["q9","*/ th th 1"],["q10","+- q8 0 q9"],["q11","sqrt q10"],["idx","*/ q11 w q7"],["maxAdj3","*/ 100000 idx ss"],["a3","pin 0 adj3 maxAdj3"],["ah","*/ ss a3 100000"],["y3","+- hR th 0"],["q2","*/ w w 1"],["q3","*/ ah ah 1"],["q4","+- q2 0 q3"],["q5","sqrt q4"],["dy","*/ q5 hR w"],["y5","+- hR dy 0"],["y7","+- y3 dy 0"],["q6","+- aw 0 th"],["dh","*/ q6 1 2"],["y4","+- y5 0 dh"],["y8","+- y7 dh 0"],["aw2","*/ aw 1 2"],["y6","+- b 0 aw2"],["x1","+- r 0 ah"],["swAng","at2 ah dy"],["stAng","+- cd2 0 swAng"],["mswAng","+- 0 0 swAng"],["ix","+- r 0 idx"],["iy","+/ hR y3 2"],["q12","*/ th 1 2"],["dang2","at2 idx q12"],["swAng2","+- dang2 0 cd4"],["swAng3","+- cd4 dang2 0"],["stAng3","+- cd2 0 dang2"]],"p":[{"fill":"norm","stroke":false,"c":[["M","l","hR"],["A","w","hR","cd2","mswAng"],["L","x1","y4"],["L","r","y6"],["L","x1","y8"],["L","x1","y7"],["A","w","hR","stAng","swAng"],["Z"]]},{"fill":"darkenLess","stroke":false,"c":[["M","r","th"],["A","w","hR","3cd4","swAng2"],["A","w","hR","stAng3","swAng3"],["Z"]]},{"fill":"none","stroke":true,"c":[["M","l","hR"],["A","w","hR","cd2","mswAng"],["L","x1","y4"],["L","r","y6"],["L","x1","y8"],["L","x1","y7"],["A","w","hR","stAng","swAng"],["L","l","hR"],["A","w","hR","cd2","cd4"],["L","r","th"],["A","w","hR","3cd4","swAng2"]]}]},"uturnArrow":{"av":{"adj1":25000,"adj2":25000,"adj3":25000,"adj4":43750,"adj5":75000},"gd":[["a2","pin 0 adj2 25000"],["maxAdj1","*/ a2 2 1"],["a1","pin 0 adj1 maxAdj1"],["q2","*/ a1 ss h"],["q3","+- 100000 0 q2"],["maxAdj3","*/ q3 h ss"],["a3","pin 0 adj3 maxAdj3"],["q1","+- a3 a1 0"],["minAdj5","*/ q1 ss h"],["a5","pin minAdj5 adj5 100000"],["th","*/ ss a1 100000"],["aw2","*/ ss a2 100000"],["th2","*/ th 1 2"],["dh2","+- aw2 0 th2"],["y5","*/ h a5 100000"],["ah","*/ ss a3 100000"],["y4","+- y5 0 ah"],["x9","+- r 0 dh2"],["bw","*/ x9 1 2"],["bs","min bw y4"],["maxAdj4","*/ bs 100000 ss"],["a4","pin 0 adj4 maxAdj4"],["bd","*/ ss a4 100000"],["bd3","+- bd 0 th"],["bd2","max bd3 0"],["x3","+- th bd2 0"],["x8","+- r 0 aw2"],["x6","+- x8 0 aw2"],["x7","+- x6 dh2 0"],["x4","+- x9 0 bd"],["x5","+- x7 0 bd2"],["cx","+/ th x7 2"]],"p":[{"fill":"norm","stroke":true,"c":[["M","l","b"],["L","l","bd"],["A","bd","bd","cd2","cd4"],["L","x4","t"],["A","bd","bd","3cd4","cd4"],["L","x9","y4"],["L","r","y4"],["L","x8","y5"],["L","x6","y4"],["L","x7","y4"],["L","x7","x3"],["A","bd2","bd2","0","-5400000"],["L","x3","th"],["A","bd2","bd2","3cd4","-5400000"],["L","th","b"],["Z"]]}]},"bentArrow":{"av":{"adj1":25000,"adj2":25000,"adj3":25000,"adj4":43750},"gd":[["a2","pin 0 adj2 50000"],["maxAdj1","*/ a2 2 1"],["a1","pin 0 adj1 maxAdj1"],["a3","pin 0 adj3 50000"],["th","*/ ss a1 100000"],["aw2","*/ ss a2 100000"],["th2","*/ th 1 2"],["dh2","+- aw2 0 th2"],["ah","*/ ss a3 100000"],["bw","+- r 0 ah"],["bh","+- b 0 dh2"],["bs","min bw bh"],["maxAdj4","*/ 100000 bs ss"],["a4","pin 0 adj4 maxAdj4"],["bd","*/ ss a4 100000"],["bd3","+- bd 0 th"],["bd2","max bd3 0"],["x3","+- th bd2 0"],["x4","+- r 0 ah"],["y3","+- dh2 th 0"],["y4","+- y3 dh2 0"],["y5","+- dh2 bd 0"],["y6","+- y3 bd2 0"]],"p":[{"fill":"norm","stroke":true,"c":[["M","l","b"],["L","l","y5"],["A","bd","bd","cd2","cd4"],["L","x4","dh2"],["L","x4","t"],["L","r","aw2"],["L","x4","y4"],["L","x4","y3"],["L","x3","y3"],["A","bd2","bd2","3cd4","-5400000"],["L","th","b"],["Z"]]}]}};

// 図形の種類と、画面に出す名前
export const PRESET_NAMES = {
  curvedUpArrow: '上カーブ矢印', curvedDownArrow: '下カーブ矢印', curvedLeftArrow: '左カーブ矢印', curvedRightArrow: '右カーブ矢印',
  uturnArrow: 'U ターン矢印', bentArrow: '曲折矢印',
};

const ANG = (v) => (v * Math.PI) / 10800000;
function guides(name, w, h, adj) {
  adj = adj || {};
  const def = PRESETS[name];
  const ss = Math.min(w, h);
  const g = {
    w, h, l: 0, t: 0, r: w, b: h, hc: w / 2, vc: h / 2, wd2: w / 2, hd2: h / 2, wd4: w / 4, hd4: h / 4, wd8: w / 8, hd8: h / 8,
    ss, ls: Math.max(w, h), ssd2: ss / 2, ssd4: ss / 4, ssd6: ss / 6, ssd8: ss / 8, ssd16: ss / 16, ssd32: ss / 32,
    cd2: 10800000, cd4: 5400000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000,
  };
  for (const k in def.av) g[k] = adj[k] != null ? adj[k] : def.av[k];
  const V = (x) => (x in g ? g[x] : Number(x));
  for (const [n, f] of def.gd) {
    const [op, ...a] = f.split(/\s+/);
    const x = a.map(V);
    let v;
    switch (op) {
      case 'val': v = x[0]; break;
      case '*/': v = (x[0] * x[1]) / x[2]; break;
      case '+-': v = x[0] + x[1] - x[2]; break;
      case '+/': v = (x[0] + x[1]) / x[2]; break;
      case '?:': v = x[0] > 0 ? x[1] : x[2]; break;
      case 'abs': v = Math.abs(x[0]); break;
      case 'at2': v = (Math.atan2(x[1], x[0]) * 10800000) / Math.PI; break;
      case 'cat2': v = x[0] * Math.cos(Math.atan2(x[2], x[1])); break;
      case 'sat2': v = x[0] * Math.sin(Math.atan2(x[2], x[1])); break;
      case 'cos': v = x[0] * Math.cos(ANG(x[1])); break;
      case 'sin': v = x[0] * Math.sin(ANG(x[1])); break;
      case 'tan': v = x[0] * Math.tan(ANG(x[1])); break;
      case 'max': v = Math.max(x[0], x[1]); break;
      case 'min': v = Math.min(x[0], x[1]); break;
      case 'mod': v = Math.hypot(x[0], x[1], x[2]); break;
      case 'pin': v = x[1] < x[0] ? x[0] : x[1] > x[2] ? x[2] : x[1]; break;
      case 'sqrt': v = Math.sqrt(Math.max(0, x[0])); break;
      default: v = 0;
    }
    g[n] = Number.isFinite(v) ? v : 0;
  }
  return V;
}

// 図形の線（もとの枠 0〜w・0〜h の中の座標）。coarse：点を少なめに（形を探すとき用）。返り値：[{ fill, stroke, d（SVG の path）, pts（点の並び。閉じた形は closed） }]
export function presetPaths(name, w, h, adj, coarse = false) {
  if (!PRESETS[name]) return [];
  const V = guides(name, w, h, adj);
  return PRESETS[name].p.map((p) => {
    let d = '', cx = 0, cy = 0, closed = false;
    const pts = [];
    const f = (v) => Math.round(v * 100) / 100;
    for (const c of p.c) {
      if (c[0] === 'M' || c[0] === 'L') { cx = V(c[1]); cy = V(c[2]); d += `${c[0]}${f(cx)},${f(cy)}`; pts.push([cx, cy]); }
      else if (c[0] === 'Z') { d += 'Z'; closed = true; }
      else if (c[0] === 'C') { const v = c.slice(1).map(V); d += `C${v.map(f).join(',')}`; for (let i = 1; i <= 8; i++) { const t = i / 8, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, e = 3 * (1 - t) * t * t, k = t ** 3; pts.push([a * cx + b * v[0] + e * v[2] + k * v[4], a * cy + b * v[1] + e * v[3] + k * v[5]]); } cx = v[4]; cy = v[5]; }
      else if (c[0] === 'A') {
        // 楕円の弧：角は見た目の角なので、楕円の媒介変数の角に直す
        const wR = V(c[1]), hR = V(c[2]), st = ANG(V(c[3])), sw = ANG(V(c[4]));
        const par = (a) => Math.atan2(wR * Math.sin(a), hR * Math.cos(a));
        const t0 = par(st);
        const ox = cx - wR * Math.cos(t0), oy = cy - hR * Math.sin(t0);
        let dt = par(st + sw) - t0;
        if (sw > 0 && dt < 0) dt += 2 * Math.PI;
        if (sw < 0 && dt > 0) dt -= 2 * Math.PI;
        if (Math.abs(sw) >= 2 * Math.PI - 1e-9) dt = sw;
        const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
        for (let i = 0; i < n; i++) {
          const a0 = t0 + (dt * i) / n, a1 = t0 + (dt * (i + 1)) / n, k = (4 / 3) * Math.tan((a1 - a0) / 4);
          const P = (t) => [ox + wR * Math.cos(t), oy + hR * Math.sin(t)], D = (t) => [-wR * Math.sin(t), hR * Math.cos(t)];
          const p0 = P(a0), p1 = P(a1), d0 = D(a0), d1 = D(a1);
          d += `C${f(p0[0] + k * d0[0])},${f(p0[1] + k * d0[1])},${f(p1[0] - k * d1[0])},${f(p1[1] - k * d1[1])},${f(p1[0])},${f(p1[1])}`;
        }
        const m = Math.max(coarse ? 2 : 4, Math.ceil(Math.abs(dt) / (Math.PI / (coarse ? 10 : 24))));
        for (let i = 1; i <= m; i++) { const t = t0 + (dt * i) / m; pts.push([ox + wR * Math.cos(t), oy + hR * Math.sin(t)]); }
        const e = [ox + wR * Math.cos(t0 + dt), oy + hR * Math.sin(t0 + dt)];
        cx = e[0]; cy = e[1];
      }
    }
    return { fill: p.fill, stroke: p.stroke, d, pts, closed };
  });
}

// 図形（{ preset, x, y, w, h, rot, fh, adj }）の枠の中の座標 → 舞台の座標
export function presetToStage(s) {
  const r = ((s.rot || 0) * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r), fx = s.fh ? -1 : 1;
  return ([u, v]) => { const x = (u - s.w / 2) * fx, y = v - s.h / 2; return [s.x + x * c - y * n, s.y + x * n + y * c]; };
}
// 舞台の座標で、図形の外形（塗る形の点の並び）
export function presetPolys(s) {
  const T = presetToStage(s);
  return presetPaths(s.preset, s.w, s.h, s.adj).filter((p) => p.fill !== 'none').map((p) => p.pts.map(T));
}
