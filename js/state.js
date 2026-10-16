// アプリ全体の状態と再描画の管理
import { db } from './db.js';

export const S = {
  phase: 'loading', // loading | login | setup | pending | ready | error
  user: null,
  role: null,
  route: { name: 'home', params: {} },
  d: {}, // 購読中のデータ
  ui: {},
  toasts: [],
  saving: 0,
};

let renderers = [];
let scheduled = false;
export function setRenderers(list) { renderers = list; }
export function rerender(only) {
  if (only) { only(); return; }
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const r of renderers) r();
  });
}

let toastSeq = 0;
export function toast(msg, kind = 'info', ms = 3200) {
  const id = ++toastSeq;
  S.toasts.push({ id, msg, kind });
  rerender();
  setTimeout(() => { S.toasts = S.toasts.filter((t) => t.id !== id); rerender(); }, ms);
}

// 入力を少し待ってからまとめて保存する
const pending = new Map();
export function saveLater(path, patch, delay = 600) {
  const cur = pending.get(path);
  if (cur) clearTimeout(cur.timer);
  const merged = { ...(cur ? cur.patch : {}), ...patch };
  const timer = setTimeout(() => flushOne(path), delay);
  pending.set(path, { patch: merged, timer });
  S.saving = pending.size;
}
async function flushOne(path) {
  const cur = pending.get(path);
  if (!cur) return;
  pending.delete(path);
  clearTimeout(cur.timer);
  S.saving = pending.size;
  try { await db.update(path, cur.patch); } catch (e) { toast('保存できませんでした: ' + (e.message || e), 'error', 6000); }
  rerender();
}
export function flushAll() { for (const p of [...pending.keys()]) flushOne(p); }
window.addEventListener('beforeunload', flushAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });

export function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 写真を縮小して JPEG の文字列にする（1枚あたり約300KB以下）
export function compressImage(file, maxSide = 1400) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, hgt = img.naturalHeight;
      const s = Math.min(1, maxSide / Math.max(w, hgt));
      w = Math.round(w * s); hgt = Math.round(hgt * s);
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, hgt);
      ctx.drawImage(img, 0, 0, w, hgt);
      let q = 0.78, data = c.toDataURL('image/jpeg', q);
      while (data.length > 400000 && q > 0.35) { q -= 0.08; data = c.toDataURL('image/jpeg', q); }
      if (data.length > 400000) {
        const c2 = document.createElement('canvas');
        c2.width = Math.round(w * 0.7); c2.height = Math.round(hgt * 0.7);
        c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height);
        data = c2.toDataURL('image/jpeg', 0.6);
        w = c2.width; hgt = c2.height;
      }
      resolve({ data, w, h: hgt });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした（HEIC形式の場合はJPEGで保存し直してください）')); };
    img.src = url;
  });
}

export function pickFile(accept = 'image/*') {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files && inp.files[0]);
    inp.click();
  });
}

export function go(hash) { location.hash = hash; }
