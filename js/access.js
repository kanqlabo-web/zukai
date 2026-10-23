// ライブラリーの共有（Googleドライブと同じ考え方）
// participants：共有されている全員 / owners：オーナー / viewers：閲覧者 / それ以外は編集者
// linkRole：'off' | 'viewer' | 'editor'（リンクを知っている全員） / linkKey：リンク用の合言葉
import { db, newId } from './db.js';
import { S } from './state.js';
import { P } from './model.js';
import { GROUP_LOOKUP_URL } from './settings.js';

export const ROLE_LABEL = { owner: 'オーナー', editor: '編集者', viewer: '閲覧者' };

export function roleIn(work, email) {
  if (!work) return null;
  if (!Array.isArray(work.participants)) return 'owner'; // 共有の仕組みより前に作ったデモのライブラリー
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
  try { await db.setQuiet('profiles/' + user.email, { name: user.name || '', photo: user.photo || '', at: Date.now() }); } catch (e) { /* 表示用なので失敗しても続ける */ }
}
export function profileName(email, onLoad) {
  if (email in profileCache) return profileCache[email];
  profileCache[email] = '';
  db.getQuiet('profiles/' + email).then((p) => { profileCache[email] = (p && p.name) || ''; if (p && p.name && onLoad) onLoad(); }).catch(() => {});
  return '';
}

// ---------- Googleグループのメンバーを読む ----------
// 小さなウィンドウでウェブアプリ（gas/groups-webapp.gs）を開き、本人の権限でメンバー一覧を読む。
// 結果はそのウィンドウがこのサイトに戻ってきて、同じサイトの保存領域（localStorage）経由で受け渡す。
// （Googleの許可画面を通ると親ウィンドウとのつながりが切れることがあるため）
const RESULT_KEY = 'zukai-group-result';

// ボタンを押した直後（awaitの前）に呼ぶこと。ポップアップがブロックされないため
export function openGroupWindow(addrs) {
  if (!GROUP_LOOKUP_URL) return null;
  const nonce = newId(12);
  const back = location.origin + location.pathname;
  const url = GROUP_LOOKUP_URL + (GROUP_LOOKUP_URL.includes('?') ? '&' : '?')
    + 'g=' + encodeURIComponent(addrs.join(',')) + '&r=' + encodeURIComponent(back) + '&n=' + nonce;
  const w = 520, hgt = 640;
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth - w) / 2);
  const top = Math.max(0, (window.screenY || 0) + (window.outerHeight - hgt) / 2);
  const win = window.open(url, 'zukaiGroups', `width=${w},height=${hgt},left=${left},top=${top}`);
  return win ? { win, nonce } : null;
}

let cancelWait = null;
export function cancelGroupWait() { if (cancelWait) cancelWait(); }

export function waitGroups(pop, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      let r = null;
      try { r = JSON.parse(localStorage.getItem(RESULT_KEY) || 'null'); } catch (e) { r = null; }
      if (r && r.n === pop.nonce) {
        cleanup();
        try { localStorage.removeItem(RESULT_KEY); } catch (e) { /* noop */ }
        try { pop.win.close(); } catch (e) { /* noop */ }
        resolve(r.groups || {});
      }
    };
    const onStorage = (e) => { if (e.key === RESULT_KEY) check(); };
    const timer = setInterval(check, 800);
    const to = setTimeout(() => { cleanup(); reject(new Error('グループの確認が時間切れになりました。もう一度お試しください。')); }, timeout);
    const cleanup = () => { clearInterval(timer); clearTimeout(to); window.removeEventListener('storage', onStorage); cancelWait = null; };
    cancelWait = () => { cleanup(); reject(new Error('グループの確認をやめました。')); };
    window.addEventListener('storage', onStorage);
  });
}

// ウェブアプリから戻ってきたウィンドウで呼ぶ（#/gresult/〜）
export function handleGroupResult(hash) {
  const m = hash.match(/^#\/gresult\/(.+)$/);
  if (!m) return false;
  try {
    const data = JSON.parse(decodeURIComponent(m[1]));
    localStorage.setItem(RESULT_KEY, JSON.stringify({ n: data.n, groups: data.groups || {}, at: Date.now() }));
  } catch (e) { /* 壊れたデータは無視 */ }
  document.title = 'グループの確認';
  document.body.innerHTML = '<div style="font-family:Arial,sans-serif;padding:32px;text-align:center;line-height:1.7">'
    + '<h2 style="font-size:18px">グループの確認が終わりました</h2>'
    + '<p>元の画面に戻ると、メンバーが追加されています。<br>このウィンドウは閉じてかまいません。</p>'
    + '<button onclick="window.close()" style="font-size:15px;padding:8px 18px">閉じる</button></div>';
  setTimeout(() => { try { window.close(); } catch (e) { /* noop */ } }, 400);
  return true;
}
