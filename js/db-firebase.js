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
function conv(patch) {
  const o = {};
  for (const k in patch) o[k] = patch[k] && patch[k].__del ? F.deleteField() : patch[k];
  return o;
}

export async function get(path) {
  const s = await F.getDoc(ref(path));
  return s.exists() ? s.data() : null;
}
export async function set(path, d) { await F.setDoc(ref(path), d); }
export async function update(path, patch) { await F.updateDoc(ref(path), conv(patch)); }
export async function remove(path) { await F.deleteDoc(ref(path)); }
export async function list(col, where) {
  const s = await F.getDocs(q(col, where));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function batch(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = F.writeBatch(fs);
    for (const o of ops.slice(i, i + 400)) {
      if (o.op === 'set') b.set(ref(o.path), o.data);
      else if (o.op === 'update') b.update(ref(o.path), conv(o.data));
      else if (o.op === 'remove') b.delete(ref(o.path));
    }
    await b.commit();
  }
}
// リンク共有で作品に参加する（編集者として試し、だめなら閲覧者として）
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
  return F.onSnapshot(ref(path), (s) => cb(s.exists() ? s.data() : null), onErr);
}
export function watchList(col, where, cb, onErr) {
  return F.onSnapshot(q(col, where), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr);
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
