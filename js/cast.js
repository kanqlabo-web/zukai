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
// 役名を出すか。図で決めていなければ、黒い円で囲んだ人（役・人として扱う人）だけ出す。
// explicit：図の人に役を選んで置いたとき（その役の名前は、決めていなければいつも出す）
export function roleVisible(roleVis, cid, i, ring, explicit = false) {
  const v = roleVis && roleVis[roleKey(cid, i)];
  return v === undefined || v === null ? explicit || (i === 0 && !!ring) : !!v;
}

// 役の一覧（ライブラリーの roleList。役者が決まっていなくても図に置ける）
const normName = (v) => String(v || '').replace(/\s/g, '');
export function roleListOf(work) { return (work && Array.isArray(work.roleList) ? work.roleList : []).filter((r) => r && r.id); }
// メンバーの役が、役の一覧のどれか（rid で。古いデータ・手で打った役は名前が同じもの）
export function roleLink(r, roleList) {
  if (!r) return null;
  const list = roleList || [];
  if (r.rid) { const hit = list.find((x) => x.id === r.rid); if (hit) return hit; }
  const n = normName(r.name);
  return n ? list.find((x) => normName(x.name) === n) || null : null;
}

export function castIndex(cast, roleList = []) {
  const list = numberCast(cast);
  const byId = {}, byNo = {}, byRid = {}, roleById = {};
  for (const r of roleList || []) if (r && r.id) roleById[r.id] = r;
  for (const c of list) {
    if (c.id) byId[c.id] = c;
    if (!(c.no in byNo)) byNo[c.no] = c;
    if (c.tag || !c.id) continue;
    // 役の一覧の役で、表記を入れていなければ、一覧の表記を使う（元のデータは書き換えない）
    c.roles = c.roles.map((r, i) => {
      const hit = roleLink(r, roleList);
      if (!hit) return r;
      if (!byRid[hit.id]) byRid[hit.id] = { c, i };
      return !r.label && hit.label ? { ...r, label: hit.label } : r;
    });
  }
  return { list, byId, byNo, byRid, roleById, roles: Object.values(roleById) };
}
export const workIndex = (work) => castIndex((work && work.cast) || [], roleListOf(work));

// 図の丸がどのメンバーか（古いデータは番号で照合）。役で置いた人は、その役のメンバー（未定なら null）
export function personCast(s, idx) {
  if (!idx) return null;
  if (s.cid) return idx.byId[s.cid] || null;
  if (s.no != null && s.no !== '') return idx.byNo[String(s.no)] || null;
  if (s.rid) { const a = idx.byRid && idx.byRid[s.rid]; return a ? a.c : null; }
  return null;
}
// 役で置いた人の役（{ role, c, i }。c・i はその役のメンバーと、メンバーの何番目の役か）
export function personRole(s, idx) {
  if (!s || !s.rid || s.cid || !idx || !idx.roleById) return null;
  const role = idx.roleById[s.rid];
  if (!role) return null;
  const a = idx.byRid[s.rid];
  return { role, c: a ? a.c : null, i: a ? a.i : -1 };
}
// 役の、図に出す文字（表記があれば表記、なければ役名）
export function roleShort(role, memberRole) {
  return (role && role.label) || (memberRole && memberRole.label) || (role && role.name) || '';
}

export function personNo(s, idx) {
  if (s.cid) { const c = idx && idx.byId[s.cid]; return c ? c.no : ''; }
  if ((s.no == null || s.no === '') && s.rid) { const c = personCast(s, idx); return c ? c.no : ''; }
  return s.no == null ? '' : String(s.no);
}

export function castLabel(c) {
  if (!c) return '';
  const r = roleText(c);
  return `${c.no} ${c.name}${r ? '（' + r + '）' : ''}`;
}
