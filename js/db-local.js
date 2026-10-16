// デモモード：データをこのブラウザの localStorage に保存する。
// 同じブラウザの別タブとは即時に同期する（共有の動きを試せる）。
const KEY = 'zukai-demo-db-v1';
let DEL;
let data = {};
const listeners = new Set();
let channel = null;
let user = null;
const authCbs = new Set();

function load() {
  try { data = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { data = {}; }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('zukai-error', { detail: 'デモモードの保存容量（約5MB）がいっぱいです。写真を減らすか、Firebase を設定してください。' }));
  }
  if (channel) channel.postMessage('changed');
  notifySoon();
}
const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));

export async function init(_cfg, del) {
  DEL = del;
  load();
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel('zukai-demo');
    channel.onmessage = () => { load(); notifySoon(); };
  }
  user = { uid: 'demo', email: 'demo@example.com', name: 'デモユーザー' };
}

function applyPatch(obj, patch) {
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (v && v.__del) delete o[last];
    else o[last] = clone(v);
  }
}

function inCol(path, col) {
  if (!path.startsWith(col + '/')) return false;
  return !path.slice(col.length + 1).includes('/');
}
function listNow(col, where) {
  const out = [];
  for (const p in data) {
    if (!inCol(p, col)) continue;
    const d = data[p];
    if (where && where.length === 3 && where[1] === 'array-contains') {
      // デモモードでは参加者のない古い作品も表示する
      if (Array.isArray(d[where[0]]) && !d[where[0]].includes(where[2])) continue;
    } else if (where && d[where[0]] !== where[1]) continue;
    out.push({ id: p.slice(col.length + 1), ...clone(d) });
  }
  return out;
}

export async function get(path) { return clone(data[path]); }
export async function set(path, d) { data[path] = clone(d); persist(); }
export async function update(path, patch) {
  if (!data[path]) throw new Error('更新するデータが見つかりません: ' + path);
  applyPatch(data[path], patch);
  persist();
}
export async function remove(path) { delete data[path]; persist(); }
export async function list(col, where) { return listNow(col, where); }
export async function batch(ops) {
  for (const o of ops) {
    if (o.op === 'set') data[o.path] = clone(o.data);
    else if (o.op === 'update') { if (data[o.path]) applyPatch(data[o.path], o.data); }
    else if (o.op === 'remove') delete data[o.path];
  }
  persist();
}

let scheduled = false;
function notifySoon() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const l of listeners) fire(l);
  });
}
function fire(l) {
  const v = l.type === 'doc' ? clone(data[l.path]) : listNow(l.path, l.where);
  const s = JSON.stringify(v);
  if (s === l.last) return;
  l.last = s;
  l.cb(v);
}
export async function joinWork(w, key, email) {
  const d = data['works/' + w];
  if (!d || !d.linkRole || d.linkRole === 'off' || d.linkKey !== key) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
  d.participants = [...new Set([...(d.participants || []), email])];
  if (d.linkRole === 'viewer') d.viewers = [...new Set([...(d.viewers || []), email])];
  d.lastJoin = { by: email, key, at: Date.now() };
  persist();
  return d.linkRole;
}

export function watchDoc(path, cb) {
  const l = { type: 'doc', path, cb };
  listeners.add(l);
  queueMicrotask(() => listeners.has(l) && fire(l));
  return () => listeners.delete(l);
}
export function watchList(col, where, cb) {
  const l = { type: 'list', path: col, where, cb };
  listeners.add(l);
  queueMicrotask(() => listeners.has(l) && fire(l));
  return () => listeners.delete(l);
}

export function onAuth(cb) {
  authCbs.add(cb);
  queueMicrotask(() => cb(user));
  return () => authCbs.delete(cb);
}
export async function signIn() {
  user = { uid: 'demo', email: 'demo@example.com', name: 'デモユーザー' };
  for (const cb of authCbs) cb(user);
}
export async function signOut() {
  user = null;
  for (const cb of authCbs) cb(user);
}
