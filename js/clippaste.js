// 図の編集画面への貼り付け（Googleドキュメント・スライド・ほかのアプリ・画像ファイルから）
// 返すもの：新しく置く図形の配列（id なし）／ 'internal'（この図解メーカーの中でコピーした図形）／ null（貼れるものがない）
import { SLICE_TYPE, sliceToHtml, figureOf } from './docimport.js';
import { drawingSvg, drawingPdf } from './pdfimport.js';
import { diagramFromSvg, svgToPng, diagramFromShapes } from './drawimport.js';
import { SLIDES_TYPE, parseSlidesClip, slidesToShapes } from './slidesclip.js';
import { auth, mode } from './db.js';
import { W, H } from './stage.js';

export const MARK = '［図解メーカーの図形］';

// 画像を図に入れられる大きさ・形式にする（図のデータは1件1MBまでなので、小さめに）
export async function imageData(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('画像を読めませんでした')); i.src = url; });
    let w = im.naturalWidth || 300, h = im.naturalHeight || 200;
    const MAX = 900;
    const k = Math.min(1, MAX / Math.max(w, h));
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.drawImage(im, 0, 0, w, h);
    // 透明なところがあるか（あれば PNG / WebP、なければ JPEG）
    let alpha = false;
    try {
      const d = g.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 16) if (d[i] < 250) { alpha = true; break; }
    } catch (e) { /* 読めない画像 */ }
    const toUrl = (type, q) => cv.toDataURL(type, q);
    let src;
    if (alpha) {
      src = toUrl('image/webp', 0.85);
      if (!src.startsWith('data:image/webp') || src.length > 400000) src = toUrl('image/png');
      if (src.length > 400000) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); src = toUrl('image/jpeg', 0.82); }
    } else {
      src = toUrl('image/jpeg', 0.85);
      if (src.length > 400000) src = toUrl('image/jpeg', 0.6);
    }
    return { src, w, h };
  } finally { URL.revokeObjectURL(url); }
}

// 図の中に置く大きさ（だいたい舞台の 4 割まで）
export function imageShape(img, at, i = 0) {
  const k = Math.min(1, (W * 0.4) / img.w, (H * 0.6) / img.h);
  return { t: 'image', src: img.src, x: Math.round(at[0] + i * 24), y: Math.round(at[1] + i * 24), w: Math.round(img.w * k), h: Math.round(img.h * k), rot: 0 };
}

async function blobsToShapes(blobs, at) {
  const out = [];
  for (const b of blobs) {
    if (!b) continue;
    try { out.push(imageShape(await imageData(b), at, out.length)); } catch (e) { console.warn(e); }
  }
  return out;
}

// dt：貼り付けのデータ（ClipboardEvent.clipboardData） / at：置く位置 / opts.cast：メンバー一覧（図形描画を図に直すとき）
export async function shapesFromClipboard(dt, at, opts = {}) {
  if (!dt) return null;
  const types = [...dt.types];
  const text = types.includes('text/plain') ? dt.getData('text/plain') : '';
  if (text && text.trim() === MARK) return 'internal';

  // 1) 画像ファイル（スクリーンショット・ブラウザでコピーした画像など）
  const files = [...(dt.files || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) return blobsToShapes(files, at);

  // 2) Googleスライド：図形の形・位置・文字がそのまま入っている（丸→人、丸の中の文字→名前）
  if (types.includes(SLIDES_TYPE)) {
    const list = slidesToShapes(parseSlidesClip(dt.getData(SLIDES_TYPE)), at);
    if (list.length) {
      const d = await diagramFromShapes(list, { cast: opts.cast || [], roleList: opts.roleList || [] });
      const out = d ? Object.values(d.shapes).map(({ id, z, ...s }) => s) : list.map(({ seq, ...s }) => s);
      if (out.length) return out;
    }
  }

  // 3) Googleドキュメント：図形描画は Google から取り出す、写真はそのまま
  let html = types.includes('text/html') ? dt.getData('text/html') : '';
  if (types.includes(SLICE_TYPE)) {
    try { html = sliceToHtml(dt.getData(SLICE_TYPE), html) || html; } catch (e) { console.warn(e); }
  }
  if (html && /<img\b/i.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const figs = [...doc.querySelectorAll('img')].map(figureOf).filter(Boolean);
    const out = [];
    let token = null;
    for (const f of figs) {
      if (f.drawing) {
        if (mode === 'local') continue;
        try {
          if (!token) token = await auth.driveToken(true);
          const svg = await drawingSvg(f.drawing.id, token);
          // 舞台の図ならそのまま図形に直す。それ以外（木や石の絵など）は画像として置く
          let d = null;
          try { d = await diagramFromSvg(svg, { cast: opts.cast || [], roleList: opts.roleList || [], chars: opts.chars || '', pdf: await drawingPdf(f.drawing.id, token) }); } catch (e) { /* 舞台の図ではない */ }
          if (d && Object.keys(d.shapes || {}).length) { out.push(...Object.values(d.shapes).map(({ id, ...s }) => s)); continue; }
          const png = await svgToPng(svg);
          if (png) out.push(...await blobsToShapes([png], [at[0] + out.length * 24, at[1] + out.length * 24]));
        } catch (e) { console.warn(e); opts.onError && opts.onError(e); }
      } else if (f.load) {
        const b = await f.load().catch(() => null);
        if (b) out.push(...await blobsToShapes([b], [at[0] + out.length * 24, at[1] + out.length * 24]));
        else opts.onError && opts.onError(new Error('画像を読み込めませんでした（コピー元が画像の読み込みを許可していません）'));
      }
    }
    if (out.length) return out;
  }

  // 4) 文字だけなら、文字の図形にする
  if (text && text.trim()) {
    const t = text.replace(/\r/g, '').trim().slice(0, 400);
    return [{ t: 'text', text: t, x: Math.round(at[0]), y: Math.round(at[1]), size: 24, rot: 0 }];
  }
  return null;
}
