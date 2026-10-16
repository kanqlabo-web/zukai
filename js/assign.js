// 舞台図の並び順と、メンバーの割り当て（最小ストレッチ）の計算
import { S } from './state.js';
import { buildRows } from './script.js';

// この稿の舞台図を、表示される順に並べる
export function diagramSequence() {
  const d = (S.d.drafts || []).find((x) => x.id === S.route.params.d);
  if (!d) return [];
  const rows = buildRows(d.script || '', S.d.blocks || [], d.spkFix);
  const out = [];
  for (const row of rows) {
    for (const { b } of row.blocks) {
      const items = Object.values(b.items || {}).sort((x, y) => (x.order || 0) - (y.order || 0));
      for (const it of items) if (it.kind === 'diagram' && it.refId) out.push(it.refId);
    }
  }
  return out;
}

// ひとつ前の舞台図（なければ null）
export function previousShapes(diagramId) {
  const seq = diagramSequence();
  const i = seq.indexOf(diagramId);
  if (i <= 0) return null;
  const g = (S.d.diagrams || []).find((x) => x.id === seq[i - 1]);
  return g ? g.shapes || {} : null;
}

// ハンガリアン法：コスト合計が最小になる割り当て（行 n ≤ 列 m）。行ごとに選ばれた列番号を返す
function hungarian(a) {
  const n = a.length, m = a[0].length;
  const INF = 1e15;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}

// cost[i][j]（i：場所、j：メンバー）。場所 i に入るメンバー j を返す（入らない場所は -1）
export function minCostAssign(cost) {
  const n = cost.length;
  if (!n) return [];
  const m = cost[0].length;
  if (!m) return new Array(n).fill(-1);
  if (n <= m) return hungarian(cost);
  const t = Array.from({ length: m }, (_, j) => Array.from({ length: n }, (_, i) => cost[i][j]));
  const colOf = hungarian(t); // メンバー j → 場所
  const res = new Array(n).fill(-1);
  colOf.forEach((i, j) => { if (i >= 0) res[i] = j; });
  return res;
}
