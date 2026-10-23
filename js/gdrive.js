// Googleドライブのドキュメントを選んで、図形描画（図）ごと取り込む
// ドキュメントを「HTML（zip）」で書き出してもらうと、図形描画が画像（PNG）として入っている。
// その HTML を、コピー＆貼り付けの取り込み（docimport.js）と同じように読む。
import { auth } from './db.js';
import { firebaseConfig } from './firebase-config.js';
import { readPdf } from './pdfread.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Googleの部品を読み込めませんでした'));
    document.head.appendChild(s);
  });
}

// ドキュメントを選ぶ画面（Google Picker）
async function pickDoc(token) {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('ファイル選択の画面を読み込めませんでした')) }));
  const G = window.google.picker;
  return new Promise((resolve, reject) => {
    const view = new G.DocsView(G.ViewId.DOCUMENTS);
    const picker = new G.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(firebaseConfig.apiKey)
      .setAppId(firebaseConfig.messagingSenderId)
      .setOrigin(location.protocol + '//' + location.host)
      .setCallback((d) => {
        if (d.action === G.Action.PICKED) resolve(d.docs[0]);
        else if (d.action === G.Action.CANCEL) resolve(null);
        else if (d.action === G.Action.ERROR) reject(new Error('ファイル選択の画面でエラーが起きました'));
      })
      .build();
    picker.setVisible(true);
  });
}

// zip を開く（ブラウザの展開機能を使う）
async function unzip(buf) {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('書き出したファイルを開けませんでした');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const lnlen = dv.getUint16(loc + 26, true), lxlen = dv.getUint16(loc + 28, true);
    const data = b.subarray(loc + 30 + lnlen + lxlen, loc + 30 + lnlen + lxlen + csize);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  return out;
}

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const mimeOf = (n) => (/\.png$/i.test(n) ? 'image/png' : /\.jpe?g$/i.test(n) ? 'image/jpeg' : /\.gif$/i.test(n) ? 'image/gif' : 'image/png');

// ドキュメントの URL から ID を取り出す
export const docIdOf = (url) => { const m = /\/document\/d\/([\w-]{20,})/.exec(String(url || '')) || /^([\w-]{25,})$/.exec(String(url || '').trim()); return m ? m[1] : null; };

// ドキュメントを選んで（または URL で指定して）、図を埋め込んだ HTML にする
export async function pickDocHtml(onStep, docUrl) {
  let doc;
  let token;
  if (docUrl) {
    const id = docIdOf(docUrl);
    if (!id) throw new Error('GoogleドキュメントのURLではないようです');
    token = await auth.driveToken(true);
    doc = { id, name: '' };
  } else {
    token = await auth.driveToken();
    doc = await pickDoc(token);
  }
  if (!doc) return null;
  if (onStep) onStep('ドキュメントを読み込んでいます…');
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}/export?mimeType=application%2Fzip`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).error.message; } catch (e) { /* なし */ }
    throw new Error(`ドキュメントを書き出せませんでした（${r.status}）${msg ? '：' + msg : ''}`);
  }
  const files = await unzip(await r.arrayBuffer());
  const htmlName = Object.keys(files).find((n) => /\.html?$/i.test(n));
  if (!htmlName) throw new Error('書き出したファイルにHTMLがありませんでした');
  let html = new TextDecoder().decode(files[htmlName]);
  // images/image1.png などを、そのまま埋め込む
  html = html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (m, a, src, c) => {
    const key = decodeURIComponent(src);
    const f = files[key] || files[Object.keys(files).find((n) => n.endsWith('/' + key) || n === key.replace(/^\.\//, ''))];
    return f ? `${a}data:${mimeOf(key)};base64,${b64(f)}${c}` : m;
  });
  // 図形描画を図に直すために、PDFでも書き出して、線や文字を読む
  let pdfFigs = [];
  try {
    if (onStep) onStep('図形描画を読み込んでいます…');
    const rp = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}/export?mimeType=application%2Fpdf`, { headers: { Authorization: 'Bearer ' + token } });
    if (rp.ok) {
      const pages = await readPdf(new Uint8Array(await rp.arrayBuffer()));
      pages.forEach((pg) => { for (const f of pg.figs.filter((x) => x.kind === 'image').sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) pdfFigs.push({ page: pg, fig: f }); });
    }
  } catch (e) { console.warn('PDFで書き出せませんでした', e); pdfFigs = []; }
  return { html, name: doc.name || '', pdfFigs };
}

// HTMLの図と、PDFの図を、順番と縦横の比で組にする
export function pairFigures(result, pdfFigs) {
  if (!pdfFigs || !pdfFigs.length) return 0;
  const figs = [];
  for (const T of result.tracks) for (const b of T.blocks) for (const it of b.items) if (it.kind === 'figure' && it.fig) figs.push(it.fig);
  let j = 0, n = 0;
  const ar = (f) => (f.x1 - f.x0) / Math.max(1, f.y1 - f.y0);
  for (const f of figs) {
    const want = f.w && f.h ? f.w / f.h : null;
    for (let k = j; k < Math.min(pdfFigs.length, j + 4); k++) {
      const a = ar(pdfFigs[k].fig);
      if (!want || Math.abs(a - want) / want < 0.15) { f.pdf = pdfFigs[k]; j = k + 1; n++; break; }
    }
  }
  return n;
}

// ---------- PDFをドライブに保存 ----------
// 権限は「このアプリで作ったファイル・選んだフォルダだけ」（drive.file）。
// 作ったファイルには目印（appProperties.zukai）を付けておき、次からは同じファイルを上書きする（リンクが変わらない）。
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';

async function gfetch(url, token, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token } });
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).error.message; } catch (e) { /* 本文なし */ }
    const err = new Error(`Googleドライブ：${r.status} ${msg}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// 前に保存したファイル（同じ稿・同じ話のPDF）
export async function findSavedPdf(token, key) {
  const q = `appProperties has { key='zukai' and value='${key.replace(/'/g, '')}' } and trashed=false`;
  const r = await gfetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink,parents,modifiedTime)&orderBy=modifiedTime desc&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`, token);
  const f = (r.files || [])[0];
  if (!f) return null;
  if (f.parents && f.parents[0]) {
    try { const p = await gfetch(`${API}/files/${f.parents[0]}?fields=name&supportsAllDrives=true`, token); f.folderName = p.name; } catch (e) { /* フォルダ名は見えないこともある */ }
  }
  return f;
}

// 保存先のフォルダを選ぶ
export async function pickFolder(token, title = 'PDFを保存するフォルダを選んでください') {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('フォルダを選ぶ画面を読み込めませんでした')) }));
  const G = window.google.picker;
  return new Promise((resolve, reject) => {
    const mine = new G.DocsView(G.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setParent('root').setLabel('マイドライブ');
    const shared = new G.DocsView(G.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setEnableDrives(true).setLabel('共有ドライブ');
    const sharedWithMe = new G.DocsView(G.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setOwnedByMe(false).setLabel('共有アイテム');
    const picker = new G.PickerBuilder()
      .setTitle(title)
      .addView(mine).addView(sharedWithMe).addView(shared)
      .enableFeature(G.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(firebaseConfig.apiKey)
      .setAppId(firebaseConfig.messagingSenderId)
      .setOrigin(location.protocol + '//' + location.host)
      .setCallback((d) => {
        if (d.action === G.Action.PICKED) resolve({ id: d.docs[0].id, name: d.docs[0].name });
        else if (d.action === G.Action.CANCEL) resolve(null);
        else if (d.action === G.Action.ERROR) reject(new Error('フォルダを選ぶ画面でエラーが起きました'));
      })
      .build();
    picker.setVisible(true);
  });
}

function multipart(meta, blob) {
  const fd = new FormData();
  fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  fd.append('file', blob);
  return fd;
}

// 新しく作る（folder.id のフォルダへ）／ fileId があれば中身を置き換える
// target：'application/pdf'、または 'application/vnd.google-apps.document'（Word のファイルを渡すと、Googleドキュメントに変換される）
export async function uploadPdf(token, { blob, name, key, folderId, fileId, target = 'application/pdf' }) {
  const fields = 'id,name,webViewLink';
  if (fileId) {
    return gfetch(`${UP}/files/${fileId}?uploadType=multipart&supportsAllDrives=true&fields=${fields}`, token, { method: 'PATCH', body: multipart({ name }, blob) });
  }
  const meta = { name, mimeType: target, appProperties: { zukai: key } };
  if (folderId) meta.parents = [folderId];
  return gfetch(`${UP}/files?uploadType=multipart&supportsAllDrives=true&fields=${fields}`, token, { method: 'POST', body: multipart(meta, blob) });
}
