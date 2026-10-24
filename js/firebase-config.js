// ▼ Firebase の設定（README の手順 2・3）。
// apiKey が空のままだと「デモモード」で動き、データはこのブラウザの中だけに保存されます。
export const firebaseConfig = {
  apiKey: "AIzaSyDFBoS_DMNN9EB7ohza1ijwHpDzFD93WBA",
  // ログインの画面を、いま開いているサイトと同じ場所で出す（iPhone などで「missing initial state」になるのを防ぐ）
  // ※ Google Cloud の OAuth クライアントに https://zukai-8a392.web.app/__/auth/handler の登録が必要
  authDomain: /^zukai-8a392\.(web\.app|firebaseapp\.com)$/.test(location.hostname) ? location.hostname : "zukai-8a392.firebaseapp.com",
  projectId: "zukai-8a392",
  // 同時に開いている人の表示に使う Realtime Database（シンガポール）。使えないときは自動で Firestore を使う
  databaseURL: "https://zukai-8a392-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "zukai-8a392.firebasestorage.app",
  messagingSenderId: "1037109594548",
  appId: "1:1037109594548:web:25bbd638884bbe337a4ae1",
  measurementId: "G-LF065LJ352"
};
