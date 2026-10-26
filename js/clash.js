// ぶつかりの自動チェック（ベータ版の機能。beta.js）
// 図ごとに、ひとつ前の図からの人の動きを見て、次のものを探す。
//   overlap：同じ図で、人の丸が重なっている
//   far    ：前の図から大きく動いている（間に合うか、通り道があるかを確かめる）
// 途中のぶつかり（同時にまっすぐ動いたときのすれ違い）は、演者が自分で避けて動くので見ない（2.41.2）。
import { h } from './vdom.js';
import { personCast, personNo } from './cast.js';
import { W } from './stage.js';
import { betaOn } from './beta.js';

// 図では人が詰めて描かれることが多い（土台・かたまりなど）ので、ほぼ同じ所に描かれたときだけ重なりとする
const NEAR = 0.4;  // 半径の合計にこれを掛けた距離より近いと、重なり（丸の数字が読めないくらい）
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
    moving.push({ s, dist });
  }
  // 場面の変わり目（たくさんの人が大きく動く）では、1人ずつ出すと多すぎて役に立たないので、まとめて一言だけ
  const big = moving.filter((m) => m.dist > W * 0.25);
  if (moving.length >= 4 && big.length > moving.length * SCENE) { out.push({ kind: 'scene', ids: big.map((m) => m.s.id), n: big.length }); return out; }
  out.push(...far);
  return out;
}

const KIND = { overlap: '重なっています', far: '大きく動きます（間に合うか確かめてください）' };
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
    h('p', { class: 'muted small' }, 'ひとつ前の図と比べて、重なりと大きな移動を調べています。'));
}

// 図の上の印（赤い円と、ぶつかる通り道）
export function ClashLayer(list, upx) {
  if (!betaOn()) return h('g', { class: 'clash-layer' });
  const out = [];
  list.forEach((c, i) => {
    if (!c.at) return;
    if (c.from) out.push(h('line', { key: i + 'f', x1: c.from[0], y1: c.from[1], x2: c.at[0], y2: c.at[1], class: 'clash-path far', 'stroke-width': 2 / upx, 'stroke-dasharray': `${5 / upx} ${4 / upx}` }));
    out.push(h('circle', { key: i + 'c', cx: c.at[0], cy: c.at[1], r: c.kind === 'far' ? 30 : 26, class: 'clash-mark ' + c.kind, 'stroke-width': 3 / upx }));
  });
  return h('g', { class: 'clash-layer', 'pointer-events': 'none' }, out);
}
