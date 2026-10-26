// ぶつかりの自動チェック（ベータ版の機能。beta.js）
// 図ごとに、ひとつ前の図からの人の動きを見て、次のものを探す。
//   overlap：同じ図で、人の丸が重なっている
//   cross  ：前の図から今の図へ、まっすぐ同時に動くと、途中でぶつかる（すれ違いが近すぎる）
//   far    ：前の図から大きく動いている（間に合うか、通り道があるかを確かめる）
// 動く速さや時間は分からないので、同時に動き始めて同時に着くとみなしている。
import { h } from './vdom.js';
import { personCast, personNo } from './cast.js';
import { W } from './stage.js';
import { betaOn } from './beta.js';

// 図では人が詰めて描かれることが多い（土台・かたまりなど）ので、ほぼ同じ所に描かれたときだけ重なりとする
const NEAR = 0.4;  // 半径の合計にこれを掛けた距離より近いと、重なり（丸の数字が読めないくらい）
const PASS = 16;   // 動いている途中で、これより近づくとぶつかり
const MOVE = 40;   // これより動いた人どうしだけ、途中のぶつかりを見る
const FAR = W * 0.5;
const SCENE = 0.4; // 舞台の4分の1より大きく動いた人がこの割合より多いときは、場面の変わり目とみなす

// 前の図と今の図の同じ人を結ぶための目印（メンバー → 役 → 番号）
function keyOf(s, ix) {
  const c = personCast(s, ix);
  if (c && c.id) return 'c:' + c.id;
  if (s.rid) return 'r:' + s.rid;
  if (s.no != null && s.no !== '') return 'n:' + s.no;
  return null;
}
const people = (shapes) => Object.values(shapes || {}).filter((s) => s && s.t === 'person' && Number.isFinite(s.x) && Number.isFinite(s.y));
// 舞台の袖（左右の枠の外）にいる人は、ぶつかりを見ない
const inWing = (s) => s.x < 90 || s.x > 910;

export function clashesOf(shapes, prevShapes, ix) {
  const now = people(shapes);
  const out = [];
  for (let i = 0; i < now.length; i++) {
    for (let j = i + 1; j < now.length; j++) {
      const a = now[i], b = now[j];
      if (inWing(a) && inWing(b)) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < ((a.r || 20) + (b.r || 20)) * NEAR) out.push({ kind: 'overlap', ids: [a.id, b.id], at: [(a.x + b.x) / 2, (a.y + b.y) / 2] });
    }
  }
  if (!prevShapes) return out;
  const before = {};
  for (const s of people(prevShapes)) { const k = keyOf(s, ix); if (k && !before[k]) before[k] = s; }
  const moving = [];
  const far = [];
  for (const s of now) {
    const k = keyOf(s, ix);
    const o = k && before[k];
    if (!o) continue;
    const dist = Math.hypot(s.x - o.x, s.y - o.y);
    if (dist > FAR && !(inWing(s) || inWing(o))) far.push({ kind: 'far', ids: [s.id], at: [s.x, s.y], from: [o.x, o.y] });
    moving.push({ s, o, v: [s.x - o.x, s.y - o.y], dist });
  }
  // 場面の変わり目（たくさんの人が大きく動く）では、1組ずつのぶつかりは多すぎて役に立たないので、まとめて一言だけ
  const big = moving.filter((m) => m.dist > W * 0.25);
  if (moving.length >= 4 && big.length > moving.length * SCENE) { out.push({ kind: 'scene', ids: big.map((m) => m.s.id), n: big.length }); return out; }
  out.push(...far);
  for (let i = 0; i < moving.length; i++) {
    for (let j = i + 1; j < moving.length; j++) {
      const A = moving[i], B = moving[j];
      if (A.dist < MOVE || B.dist < MOVE) continue; // 動かない人のそばを通るのは、ふつうのこと
      // 同時に動いたときの2人の距離 |d0 + t·dv| が最も近づく t（0〜1）
      const d0 = [A.o.x - B.o.x, A.o.y - B.o.y];
      const dv = [A.v[0] - B.v[0], A.v[1] - B.v[1]];
      const vv = dv[0] * dv[0] + dv[1] * dv[1];
      const t = vv ? Math.max(0, Math.min(1, -(d0[0] * dv[0] + d0[1] * dv[1]) / vv)) : 0;
      if (t <= 0.05 || t >= 0.95) continue; // 始めや終わりで近いのは、重なりのほうで見る
      const gap = Math.hypot(d0[0] + t * dv[0], d0[1] + t * dv[1]);
      if (gap < PASS) {
        const pa = [A.o.x + t * A.v[0], A.o.y + t * A.v[1]], pb = [B.o.x + t * B.v[0], B.o.y + t * B.v[1]];
        out.push({ kind: 'cross', ids: [A.s.id, B.s.id], at: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], paths: [[A.o, A.s], [B.o, B.s]] });
      }
    }
  }
  return out;
}

const KIND = {  overlap: '重なっています', cross: '動く途中でぶつかりそうです', far: '大きく動きます（間に合うか確かめてください）' };
const SHOW = 8; // 一覧に出す数（多すぎると読まれないので）
const nameOf = (shapes, id, ix) => { const s = shapes[id]; if (!s) return '?'; const c = personCast(s, ix); return [personNo(s, ix), c && c.name].filter(Boolean).join(' ') || '番号なし'; };

// 図の編集の右の欄に出す一覧。押すと、その人たちを選ぶ
export function ClashSection(list, shapes, ix, onPick) {
  if (!betaOn()) return null;
  return h('section', { class: 'clash-sec' + (list.length ? ' has' : '') },
    h('h3', null, list.length ? `ぶつかりチェック：${list.length}件` : 'ぶつかりチェック：問題なし'),
    list.length ? h('ul', null, list.slice(0, SHOW).map((c, i) => h('li', { key: i },
      h('button', { class: 'linklike', onclick: () => onPick(c.ids) },
        h('span', { class: 'clash-dot ' + c.kind }),
        c.kind === 'scene' ? `場面の変わり目です（${c.n}人が大きく動きます）。通り道は図で確かめてください`
          : `${c.ids.map((id) => nameOf(shapes, id, ix)).join('・')}が${KIND[c.kind]}`))),
      list.length > SHOW ? h('li', { key: 'more', class: 'muted small' }, `ほか ${list.length - SHOW}件（図の赤い円）`) : null) : null,
    h('p', { class: 'muted small' }, 'ひとつ前の図から、全員が同時にまっすぐ動くとみなして調べています。'));
}

// 図の上の印（赤い円と、ぶつかる通り道）
export function ClashLayer(list, upx) {
  if (!betaOn()) return h('g', { class: 'clash-layer' });
  const out = [];
  list.forEach((c, i) => {
    if (!c.at) return;
    if (c.paths) for (const [o, s] of c.paths) out.push(h('line', { key: i + 'p' + s.id, x1: o.x, y1: o.y, x2: s.x, y2: s.y, class: 'clash-path', 'stroke-width': 2 / upx, 'stroke-dasharray': `${5 / upx} ${4 / upx}` }));
    if (c.from) out.push(h('line', { key: i + 'f', x1: c.from[0], y1: c.from[1], x2: c.at[0], y2: c.at[1], class: 'clash-path far', 'stroke-width': 2 / upx, 'stroke-dasharray': `${5 / upx} ${4 / upx}` }));
    out.push(h('circle', { key: i + 'c', cx: c.at[0], cy: c.at[1], r: c.kind === 'far' ? 30 : 26, class: 'clash-mark ' + c.kind, 'stroke-width': 3 / upx }));
  });
  return h('g', { class: 'clash-layer', 'pointer-events': 'none' }, out);
}
