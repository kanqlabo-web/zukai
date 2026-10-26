// ベータ版の機能（ためし中の機能）。ふだんの画面には出さず、アカウントのメニューでオンにした端末だけに出す
// いまベータ版にあるもの：動きの変更（moves.js）、音声（audio.js）
const KEY = 'zukai.beta';
let on = false;
try { on = localStorage.getItem(KEY) === '1'; } catch (e) { /* 使えない環境 */ }
export const betaOn = () => on;
export function setBeta(v) {
  on = !!v;
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { /* noop */ }
}
