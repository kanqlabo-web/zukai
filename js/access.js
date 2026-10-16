// 作品の共有（Googleドライブと同じ考え方）
// participants：共有されている全員 / owners：オーナー / viewers：閲覧者 / それ以外は編集者
// linkRole：'off' | 'viewer' | 'editor'（リンクを知っている全員） / linkKey：リンク用の合言葉
import { db, newId } from './db.js';
import { S } from './state.js';
import { P } from './model.js';

export const ROLE_LABEL = { owner: 'オーナー', editor: '編集者', viewer: '閲覧者' };

export function roleIn(work, email) {
  if (!work) return null;
  if (!Array.isArray(work.participants)) return 'owner'; // 共有の仕組みより前に作ったデモの作品
  if (!work.participants.includes(email)) return null;
  const owners = work.owners || work.admins || [];
  if (owners.includes(email)) return 'owner';
  if ((work.viewers || []).includes(email)) return 'viewer';
  return 'editor';
}
export const myRole = (work) => roleIn(work, S.user && S.user.email);
export const canEdit = (work) => ['owner', 'editor'].includes(myRole(work));
export const isOwner = (work) => myRole(work) === 'owner';

export function newShareFields(email) {
  return { participants: [email], owners: [email], viewers: [], linkRole: 'off', linkKey: newId(20) };
}

// 役割の一覧から、保存する形（participants / owners / viewers）を作る
export function shareFromRoles(roles) {
  const participants = Object.keys(roles);
  return {
    participants,
    owners: participants.filter((e) => roles[e] === 'owner'),
    viewers: participants.filter((e) => roles[e] === 'viewer'),
  };
}
export function rolesOfWork(work) {
  const out = {};
  for (const e of work.participants || []) out[e] = roleIn(work, e);
  return out;
}

export async function saveRoles(w, roles) {
  const s = shareFromRoles(roles);
  if (!s.owners.length) throw new Error('オーナーが1人以上必要です');
  await db.update(P.work(w), { ...s, updatedAt: Date.now() });
}

export function joinUrl(w, work) {
  const base = location.href.split('#')[0];
  if (work.linkRole && work.linkRole !== 'off') return `${base}#/join/${w}/${work.linkKey}`;
  return `${base}#/w/${w}`;
}

// ---------- 名前の表示（ログインしたことのある人のプロフィール） ----------
const profileCache = {};
export async function saveMyProfile(user) {
  try { await db.set('profiles/' + user.email, { name: user.name || '', photo: user.photo || '', at: Date.now() }); } catch (e) { /* 表示用なので失敗しても続ける */ }
}
export function profileName(email, onLoad) {
  if (email in profileCache) return profileCache[email];
  profileCache[email] = '';
  db.get('profiles/' + email).then((p) => { profileCache[email] = (p && p.name) || ''; if (p && p.name && onLoad) onLoad(); }).catch(() => {});
  return '';
}

// ---------- Googleグループの展開 ----------
export async function groupMembers(addr) {
  const g = await db.getQuiet('groups/' + addr);
  if (!g || !Array.isArray(g.members)) return null;
  return g.members.map((m) => String(m).toLowerCase());
}
