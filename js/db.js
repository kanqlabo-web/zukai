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

const raw = {
  set: (path, data) => guard(impl.set(path, clean(data))),
  update: (path, patch) => guard(impl.update(path, clean(patch))),
  remove: (path) => guard(impl.remove(path)),
  batch: (ops) => guard(impl.batch(ops.map((o) => ({ ...o, data: o.data && clean(o.data) })))),
};

export const db = {
  get: (path) => guard(impl.get(path)),
  getQuiet: (path) => impl.get(path).catch(() => null),
  setQuiet: (path, data) => impl.set(path, clean(data)),
  updateQuiet: (path, patch) => impl.update(path, clean(patch)),
  removeQuiet: (path) => impl.remove(path),
  // 同時に開いている人の表示用（Realtime Database。使えないときは available() が false）
  room: {
    available: () => !!(impl.hasRoom && impl.hasRoom()),
    set: (path, data) => impl.roomSet(path, clean(data)),
    patch: (path, data) => impl.roomPatch(path, clean(data)),
    remove: (path) => impl.roomRemove(path),
    watch: (path, cb, onErr) => impl.roomWatch(path, cb, onErr || (() => {})),
  },
  joinWork: (w, key, email) => impl.joinWork(w, key, email),
  set: (path, data) => track([path], () => raw.set(path, data)),
  update: (path, patch) => track([path], () => raw.update(path, patch)),
  remove: (path) => track([path], () => raw.remove(path)),
  list: (col, where) => guard(impl.list(col, where)),
  // 読めなくてもエラーを出さない（ホームのカードの絵など、なくても困らないもの）
  listQuiet: (col, where) => impl.list(col, where),
  watchDoc: (path, cb, onErr) => impl.watchDoc(path, cb, onErr || errorHandler),
  watchList: (col, where, cb, onErr) => impl.watchList(col, where, cb, onErr || errorHandler),
  batch: (ops) => track(ops.map((o) => o.path), () => raw.batch(ops)),
  // 数が多くても、元に戻すの履歴に必ず残す（稿の置き換えなど、消すものがあるとき）
  batchUndoable: (ops) => track(ops.map((o) => o.path), () => raw.batch(ops), true),
  // 元に戻すの履歴に残さない（サンプル作成など、大量の新しいデータを一度に書くとき）
  batchUntracked: (ops) => raw.batch(ops),
};

// ---------- 全体の「元に戻す・やり直す」 ----------
// 保存のたびに、書き換える前と後の内容を控えておき、元に戻すときは前の内容に書き戻す。
// 続けて行われた保存（0.6秒以内）は、ひとまとまりとして戻す。ライブラリーを移ったら履歴は消す。
const GROUP_MS = 600;
const MAX = 100;
const H = { undo: [], redo: [], cur: null, timer: null, paused: 0, scope: null, busy: false, listener: null };
let queue = Promise.resolve();
const readNow = (path) => (impl.getCached ? impl.getCached(path) : impl.get(path)).catch(() => undefined);
const workOf = (path) => { const m = /^works\/([^/]+)/.exec(path); return m ? m[1] : null; };
const notify = () => { if (H.listener) H.listener(); };

function closeGroup() {
  clearTimeout(H.timer); H.timer = null;
  const g = H.cur; H.cur = null;
  if (!g) return;
  // 何も変わっていない保存は履歴に残さない
  const docs = [...g.docs.entries()].filter(([, d]) => d.before !== undefined && d.after !== undefined && !same(d.before, d.after));
  if (!docs.length) return;
  H.undo.push({ w: g.w, docs });
  if (H.undo.length > MAX) H.undo.shift();
  H.redo = [];
  notify();
}

function track(paths, write, force = false) {
  // 一度にたくさん書くとき（取り込み・サンプル作成など）は、控えを取ると時間がかかるので履歴に残さない（force なら残す）
  if (H.paused || (!force && paths.length > 40)) return write();
  const w = paths.map(workOf).find(Boolean) || null;
  const run = queue.then(async () => {
    if (H.cur && H.cur.w !== w) closeGroup();
    if (!H.cur) H.cur = { w, docs: new Map() };
    const g = H.cur;
    const fresh = [...new Set(paths)].filter((p) => !g.docs.has(p));
    const befores = await Promise.all(fresh.map(readNow));
    fresh.forEach((p, i) => g.docs.set(p, { before: befores[i] }));
    try { await write(); } finally {
      const uniq = [...new Set(paths)];
      const afters = await Promise.all(uniq.map(readNow));
      uniq.forEach((p, i) => { g.docs.get(p).after = afters[i]; });
      clearTimeout(H.timer);
      H.timer = setTimeout(closeGroup, GROUP_MS);
    }
  });
  queue = run.catch(() => {});
  return run;
}

// 比べるときは、最終更新の記録と、同時編集の表示の合言葉（履歴に残さず書く）は見ない
const strip = (d) => { if (!d) return d; const o = { ...d }; delete o.updatedAt; delete o.updatedBy; delete o.presenceKey; return o; };
const stable = (o) => (o == null ? 'null' : typeof o !== 'object' ? JSON.stringify(o) : Array.isArray(o) ? '[' + o.map(stable).join(',') + ']' : '{' + Object.keys(o).sort().map((k) => k + ':' + stable(o[k])).join(',') + '}');
function same(a, b) { return stable(strip(a)) === stable(strip(b)); }

async function writeBack(path, target, current) {
  if (target == null) { if (current != null) await raw.remove(path); return; }
  if (current == null) { await raw.set(path, target); return; }
  const patch = {};
  for (const k of new Set([...Object.keys(target), ...Object.keys(current)])) {
    if (k === 'presenceKey') continue;
    if (stable(target[k]) !== stable(current[k])) patch[k] = k in target ? target[k] : DEL;
  }
  if (Object.keys(patch).length) await raw.update(path, patch);
}

// 続けて押されたときは、前の「元に戻す」が書き終わってから次を始める
// （同時に進めると、前の戻しが書き終わる前の内容と比べてしまい、ほかの人が書き換えたと誤って確かめていた）
let stepping = Promise.resolve();
function step(...a) {
  const run = stepping.then(() => stepNow(...a));
  stepping = run.catch(() => {});
  return run;
}
async function stepNow(from, to, field, other, ask) {
  closeGroup();
  await queue;
  closeGroup();
  const e = from.pop();
  if (!e) return false;
  H.busy = true; notify();
  try {
    const cur = await Promise.all(e.docs.map(([p]) => readNow(p)));
    const changed = e.docs.some(([, d], i) => cur[i] !== undefined && !same(cur[i], d[other]));
    if (changed && ask && !(await ask())) { from.push(e); return false; }
    H.paused++;
    try { for (let i = 0; i < e.docs.length; i++) await writeBack(e.docs[i][0], e.docs[i][1][field], cur[i]); } finally { H.paused--; }
    to.push(e);
    return true;
  } finally { H.busy = false; notify(); }
}

export const history = {
  canUndo: () => !H.busy && (H.undo.length > 0 || !!H.cur),
  canRedo: () => !H.busy && H.redo.length > 0,
  // ask：ほかの人がその後に変更していたときに確かめる（true で続ける）
  undo: (ask) => step(H.undo, H.redo, 'before', 'after', ask),
  redo: (ask) => step(H.redo, H.undo, 'after', 'before', ask),
  setScope: (w) => { if (H.scope !== w) { H.scope = w; H.undo = []; H.redo = []; H.cur = null; clearTimeout(H.timer); notify(); } },
  onChange: (fn) => { H.listener = fn; },
};

export const auth = {
  onChange: (cb) => impl.onAuth(cb),
  signIn: () => impl.signIn(),
  signOut: () => impl.signOut(),
  driveToken: (all) => (impl.driveToken ? impl.driveToken(all) : Promise.reject(new Error('デモモードでは使えません'))),
};

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function newId(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = '';
  for (const x of a) s += ABC[x % ABC.length];
  return s;
}
