// アプリのバージョン
// main に push するたびに VERSION と DATE を上げ、CHANGELOG.md に1行足す。
// 開いている人のブラウザは、サーバーのこのファイルと比べて「新しい版があります」を出す。
export const VERSION = '1.2.0';
export const DATE = '2026-10-24';

export const CHANGELOG_URL = 'https://github.com/kanqlabo-web/zukai/blob/main/CHANGELOG.md';
export const versionLabel = () => `バージョン ${VERSION}（${DATE}）`;

// サーバーにある最新のバージョン（取れなければ null）
async function latestVersion() {
  try {
    const res = await fetch(new URL('./version.js', import.meta.url), { cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.text()).match(/VERSION\s*=\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

// 新しい版に読み込み直す。普通の再読み込みではブラウザに残った古い js / css が使われることがあるので、先に取り直しておく。
export async function reloadToLatest() {
  const urls = new Set(performance.getEntriesByType('resource').map((e) => e.name)
    .filter((u) => u.startsWith(location.origin) && /\.(m?js|css)(\?|$)/.test(u)));
  await Promise.all([...urls].map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
  location.reload();
}

// 起動時・画面に戻ってきたとき・30分ごとに確かめ、新しい版があれば onNew(新しいバージョン) を呼ぶ
export function watchForUpdate(onNew) {
  let told = false, last = 0;
  const check = async () => {
    if (told || Date.now() - last < 60 * 1000) return;
    last = Date.now();
    const v = await latestVersion();
    if (v && v !== VERSION) { told = true; onNew(v); }
  };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 30 * 60 * 1000);
}
