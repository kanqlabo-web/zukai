// キャスト一覧の番号付けと参照
// 番号は一覧の上から順に 1, 2, 3… と自動で付く。「記号」を設定した人（CD など）は番号を使わない。
import { newId } from './db.js';

export function ensureCastIds(cast) {
  let changed = false;
  const out = (cast || []).map((c) => {
    if (c.id) return c;
    changed = true;
    return { ...c, id: newId(8) };
  });
  return { cast: out, changed };
}

export function numberCast(cast) {
  let n = 0;
  return (cast || []).map((c) => ({ ...c, no: c.tag ? String(c.tag) : String(++n) }));
}

export function castIndex(cast) {
  const list = numberCast(cast);
  const byId = {}, byNo = {};
  for (const c of list) {
    if (c.id) byId[c.id] = c;
    if (!(c.no in byNo)) byNo[c.no] = c;
  }
  return { list, byId, byNo };
}

// 舞台図の丸がどのキャストか（古いデータは番号で照合）
export function personCast(s, idx) {
  if (!idx) return null;
  if (s.cid) return idx.byId[s.cid] || null;
  if (s.no != null && s.no !== '') return idx.byNo[String(s.no)] || null;
  return null;
}

export function personNo(s, idx) {
  if (s.cid) { const c = idx && idx.byId[s.cid]; return c ? c.no : ''; }
  return s.no == null ? '' : String(s.no);
}

export function castLabel(c) {
  if (!c) return '';
  return `${c.no} ${c.name}${c.role ? '（' + c.role + '）' : ''}`;
}
