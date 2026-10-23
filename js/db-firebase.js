// 共有モード：Firebase（Firestore + Googleログイン）に保存する。
const V = '12.19.0';
const BASE = `https://www.gstatic.com/firebasejs/${V}/`;

let F, A, fs, auth, DEL;

export async function init(cfg, del) {
  DEL = del;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(BASE + 'firebase-app.js'),
    import(BASE + 'firebase-auth.js'),
    import(BASE + 'firebase-firestore.js'),
  ]);
  F = fsMod;
  A = authMod;
  const app = appMod.initializeApp(cfg);
  try {
    fs = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn('オフラインキャッシュを使わずに起動します', e);
    fs = F.getFirestore(app);
  }
  auth = A.getAuth(app);
  try { await A.setPersistence(auth, A.browserLocalPersistence); } catch (e) { /* 既定のまま */ }
}

const ref = (p) => F.doc(fs, p);
function q(col, where) {
  const c = F.collection(fs, col);
  if (!where) return c;
  return where.length === 3 ? F.query(c, F.where(where[0], where[1], where[2])) : F.query(c, F.where(where[0], '==', where[1]));
}
// Firestore は「配列の中の配列」を保存できないため、内側の配列を { _a: [...] } に包んで保存し、読むときに戻す
// （手書き囲み・線の点の並び [[x, y], …] など）
const plain = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
function enc(v, inArr = false) {
  if (Array.isArray(v)) { const a = v.map((x) => enc(x, true)); return inArr ? { _a: a } : a; }
  if (plain(v)) { const o = {}; for (const k in v) o[k] = enc(v[k]); return o; }
  return v;
}
function dec(v) {
  if (Array.isArray(v)) return v.map(dec);
  if (plain(v)) {
    const ks = Object.keys(v);
    if (ks.length === 1 && ks[0] === '_a' && Array.isArray(v._a)) return v._a.map(dec);
    const o = {}; for (const k of ks) o[k] = dec(v[k]); return o;
  }
  return v;
}
function conv(patch) {
  const o = {};
  for (const k in patch) o[k] = patch[k] && patch[k].__del ? F.deleteField() : enc(patch[k]);
  return o;
}
const data = (s) => dec(s.data());

export async function get(path) {
  const s = await F.getDoc(ref(path));
  return s.exists() ? data(s) : null;
}
// 手元の控え（開いている画面のデータ）から読む。なければサーバーから
export async function getCached(path) {
  try { const s = await F.getDocFromCache(ref(path)); return s.exists() ? data(s) : null; } catch (e) { return get(path); }
}
export async function set(path, d) { await F.setDoc(ref(path), enc(d)); }
export async function update(path, patch) { await F.updateDoc(ref(path), conv(patch)); }
export async function remove(path) { await F.deleteDoc(ref(path)); }
export async function list(col, where) {
  const s = await F.getDocs(q(col, where));
  return s.docs.map((d) => ({ id: d.id, ...data(d) }));
}
export async function batch(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = F.writeBatch(fs);
    for (const o of ops.slice(i, i + 400)) {
      if (o.op === 'set') b.set(ref(o.path), enc(o.data));
      else if (o.op === 'update') b.update(ref(o.path), conv(o.data));
      else if (o.op === 'remove') b.delete(ref(o.path));
    }
    await b.commit();
  }
}
// リンク共有でライブラリーに参加する（編集者として試し、だめなら閲覧者として）
export async function joinWork(w, key, email) {
  const r = ref(`works/${w}`);
  const lastJoin = { by: email, key, at: Date.now() };
  try {
    await F.updateDoc(r, { participants: F.arrayUnion(email), lastJoin });
    return 'editor';
  } catch (e) {
    if (e.code !== 'permission-denied') throw e;
  }
  await F.updateDoc(r, { participants: F.arrayUnion(email), viewers: F.arrayUnion(email), lastJoin });
  return 'viewer';
}

export function watchDoc(path, cb, onErr) {
  return F.onSnapshot(ref(path), (s) => cb(s.exists() ? data(s) : null), onErr);
}
export function watchList(col, where, cb, onErr) {
  return F.onSnapshot(q(col, where), (s) => cb(s.docs.map((d) => ({ id: d.id, ...data(d) }))), onErr);
}

export function onAuth(cb) {
  return A.onAuthStateChanged(auth, (u) => {
    cb(u ? { uid: u.uid, email: (u.email || '').toLowerCase(), name: u.displayName || u.email, photo: u.photoURL } : null);
  });
}
export async function signIn() {
  const p = new A.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  await A.signInWithPopup(auth, p);
}
export async function signOut() { await A.signOut(auth); }
// Googleドライブのファイルを読むための一時的な鍵（選んだファイルだけ読める drive.file）
// readAll=true：URL で指定したドキュメントを読むため、ドライブ全体を読める許可（drive.readonly）をもらう
const driveTok = {};
export async function driveToken(readAll = false) {
  const k = readAll ? 'all' : 'file';
  if (driveTok[k] && driveTok[k].until > Date.now()) return driveTok[k].token;
  const p = new A.GoogleAuthProvider();
  p.addScope(readAll ? 'https://www.googleapis.com/auth/drive.readonly' : 'https://www.googleapis.com/auth/drive.file');
  if (auth.currentUser && auth.currentUser.email) p.setCustomParameters({ login_hint: auth.currentUser.email });
  const r = auth.currentUser ? await A.reauthenticateWithPopup(auth.currentUser, p) : await A.signInWithPopup(auth, p);
  const c = A.GoogleAuthProvider.credentialFromResult(r);
  if (!c || !c.accessToken) throw new Error('Googleドライブの許可をもらえませんでした');
  driveTok[k] = { token: c.accessToken, until: Date.now() + 50 * 60 * 1000 };
  return driveTok[k].token;
}
