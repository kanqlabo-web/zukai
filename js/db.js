// データ保存の窓口。Firebase（共有）とデモ（このブラウザのみ）を切り替える。
import { firebaseConfig } from './firebase-config.js';

export const DEL = { __del: true };
let impl = null;
export let mode = 'local';

export async function initDB() {
  if (firebaseConfig && firebaseConfig.apiKey) {
    impl = await import('./db-firebase.js');
    mode = 'firebase';
  } else {
    impl = await import('./db-local.js');
    mode = 'local';
  }
  await impl.init(firebaseConfig, DEL);
}

// Firestore は undefined を保存できないので取り除く
function clean(v) {
  if (v === DEL) return v;
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) if (v[k] !== undefined) o[k] = clean(v[k]);
    return o;
  }
  return v;
}

let errorHandler = (e) => console.error(e);
export function onDBError(fn) { errorHandler = fn; }
function guard(p) { return p.catch((e) => { errorHandler(e); throw e; }); }

export const db = {
  get: (path) => guard(impl.get(path)),
  set: (path, data) => guard(impl.set(path, clean(data))),
  update: (path, patch) => guard(impl.update(path, clean(patch))),
  remove: (path) => guard(impl.remove(path)),
  list: (col, where) => guard(impl.list(col, where)),
  watchDoc: (path, cb, onErr) => impl.watchDoc(path, cb, onErr || errorHandler),
  watchList: (col, where, cb, onErr) => impl.watchList(col, where, cb, onErr || errorHandler),
  batch: (ops) => guard(impl.batch(ops.map((o) => ({ ...o, data: o.data && clean(o.data) })))),
};

export const auth = {
  onChange: (cb) => impl.onAuth(cb),
  signIn: () => impl.signIn(),
  signOut: () => impl.signOut(),
};

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function newId(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = '';
  for (const x of a) s += ABC[x % ABC.length];
  return s;
}
