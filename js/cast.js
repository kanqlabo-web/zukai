// メンバー一覧の番号付けと参照
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

// 役の一覧（兼役は複数）。古いデータ（role / label の1つだけ）にも対応
export function rolesOf(c) {
  if (!c) return [];
  if (Array.isArray(c.roles)) return c.roles.map((r) => r || { name: '', label: '' });
  if (c.role || c.label) return [{ name: c.role || '', label: c.label || '' }];
  return [];
}
export function roleText(c) { return rolesOf(c).map((r) => r.name).filter(Boolean).join('・'); }

export function numberCast(cast) {
  let n = 0;
  return (cast || []).map((c) => ({ ...c, no: c.tag ? String(c.tag) : String(++n), roles: rolesOf(c) }));
}

// 図ごとの役名の表示（未設定なら、最初の役だけ表示）
export const roleKey = (cid, i) => `${cid}_${i}`;
// 役名を出すか。図で決めていなければ、黒い円で囲んだ人（役・人として扱う人）だけ出す
export function roleVisible(roleVis, cid, i, ring) {
  const v = roleVis && roleVis[roleKey(cid, i)];
  return v === undefined || v === null ? i === 0 && !!ring : !!v;
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

// 図の丸がどのメンバーか（古いデータは番号で照合）
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
  const r = roleText(c);
  return `${c.no} ${c.name}${r ? '（' + r + '）' : ''}`;
}
