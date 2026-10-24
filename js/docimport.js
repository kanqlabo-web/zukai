import { findCue } from './script.js';
// Googleドキュメントの図解を、コピー＆貼り付けで取り込む
// ドキュメントで「すべて選択 → コピー」したときのクリップボード（HTML）から、
// タイトル・図解っ子・表現したいこと・メンバー表・テーマ活動の友・タイミング・メモ・図を読み取る。
// 結果は図解PDFの取り込み（pdfimport.js の analyzeZukai）と同じ形にする。

const TITLE_RE = /^(.*?)(\d+話|第\d+話|[^\s_】]*話)図解_?(.*?)_(?:第(\d+)|最終)稿/;
const CUE_RE = /^[《≪«]\s*(.*?)\s*[》≫»](.*)$/;
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'DIV', 'TABLE', 'UL', 'OL', 'BLOCKQUOTE']);

function clean(s) {
  return String(s || '')
    .replace(/[⺀-⿟]/g, (c) => c.normalize('NFKC'))
    .replace(/[⚫⬤]/g, '●')
    // Googleドキュメントの段落内改行（Shift+Enter）は、コピーすると \v（縦タブ）になる。ふつうの改行にする
    .replace(/[\u000b\u2028\u2029]/g, '\n')
    .replace(/[    ]/g, ' ')
    .replace(/[​﻿]/g, '');
}

// 段落の文字（<br> は改行）
function textOf(el) {
  let s = '';
  const walk = (n) => {
    if (n.nodeType === 3) { s += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    if (n.tagName === 'BR') { s += '\n'; return; }
    if (n.tagName === 'IMG' || n.tagName === 'STYLE' || n.tagName === 'SCRIPT') return;
    for (const c of n.childNodes) walk(c);
  };
  walk(el);
  return clean(s).replace(/[ \t]+\n/g, '\n');
}

// 要素を「段落」と「図」と「表」の並びにする
function flatten(root) {
  const out = [];
  const walk = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const t = clean(n.nodeValue);
        if (t.trim()) out.push({ type: 'p', text: t.trim() });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'TABLE') { out.push({ type: 'table', el: n }); continue; }
      if (tag === 'BR') { out.push({ type: 'p', text: '' }); continue; }
      if (tag === 'IMG') { out.push({ type: 'img', el: n }); continue; }
      if (tag === 'STYLE' || tag === 'META' || tag === 'SCRIPT' || tag === 'COLGROUP') continue;
      const hasBlock = [...n.querySelectorAll('*')].some((c) => BLOCK_TAGS.has(c.tagName));
      if (tag === 'P' || /^H[1-6]$/.test(tag) || tag === 'LI' || !hasBlock) {
        // 段落の中の図は、段落のあとに置く
        const imgs = [...n.querySelectorAll('img')];
        const t = textOf(n);
        if (t.trim() || !imgs.length) out.push({ type: 'p', text: t.replace(/\n+$/, '') });
        for (const im of imgs) out.push({ type: 'img', el: im });
        continue;
      }
      walk(n);
    }
  };
  walk(root);
  return out;
}

function rowsOf(table) {
  const rows = [];
  for (const tr of table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr')) {
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    // 後ろの空のマスは数えない
    while (cells.length > 1 && !textOf(cells[cells.length - 1]).trim() && !cells[cells.length - 1].querySelector('img')) cells.pop();
    rows.push(cells);
  }
  return rows;
}

// メンバー表（4列で「1 名前（役）」が並ぶ）
function readCastTable(rows) {
  const cells = [];
  rows.forEach((r, ri) => r.forEach((td, ci) => {
    const t = textOf(td).replace(/\s*\n\s*/g, '').trim();
    const m = /^([0-9０-９]+|[A-Za-z]{1,4})\s+(.*)$/.exec(t);
    if (m) cells.push({ ri, ci, no: m[1], name: m[2].replace(/\s+/g, '') });
  }));
  const isNum = (c) => /^\d+$/.test(c.no.normalize('NFKC'));
  const nums = cells.filter(isNum).sort((a, b) => +a.no.normalize('NFKC') - +b.no.normalize('NFKC'));
  const tags = cells.filter((c) => !isNum(c));
  return [...nums, ...tags].map((c) => `${c.no} ${c.name}`).join('\n');
}
function looksCast(rows) {
  if (!rows.length || Math.max(...rows.map((r) => r.length)) < 3) return false;
  let hit = 0, all = 0;
  for (const r of rows) for (const td of r) { const t = textOf(td).trim(); if (!t) continue; all++; if (/^([0-9０-９]+|[A-Za-z]{1,4})\s+\S/.test(t)) hit++; }
  return all > 0 && hit / all > 0.6;
}

// 図：クリップボードの画像を読み込めたら写真として入れる
export function figureOf(img) {
  // Googleの図形描画（中身はあとでGoogleから取り出す）
  const dId = img.getAttribute('data-drawing');
  if (dId) {
    const w = +img.getAttribute('data-w') || 0, h = +img.getAttribute('data-h') || 0;
    return { drawing: { id: dId, w, h }, w, h };
  }
  const src = img.getAttribute('src') || '';
  if (!src) return null;
  const st = img.getAttribute('style') || '';
  const w = parseFloat((/width:\s*([\d.]+)px/.exec(st) || [])[1] || img.getAttribute('width')) || 0;
  const h = parseFloat((/height:\s*([\d.]+)px/.exec(st) || [])[1] || img.getAttribute('height')) || 0;
  return {
    w, h,
    load: async () => {
      if (src.startsWith('data:')) return (await fetch(src)).blob();
      try {
        const r = await fetch(src, { mode: 'cors', credentials: 'omit' });
        if (r.ok) return r.blob();
      } catch (e) { /* 次の方法で */ }
      // CORS を許していない画像は、<img crossOrigin> で読んでみる
      return new Promise((resolve) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => {
          try {
            const cv = document.createElement('canvas');
            cv.width = im.naturalWidth; cv.height = im.naturalHeight;
            cv.getContext('2d').drawImage(im, 0, 0);
            cv.toBlob((b) => resolve(b), 'image/png');
          } catch (e) { resolve(null); }
        };
        im.onerror = () => resolve(null);
        im.src = src;
      });
    },
  };
}

export function isDocsHtml(html) {
  return /docs-internal-guid|<table|<p[\s>]/i.test(String(html || ''));
}

export function analyzeDocHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const items = flatten(doc.body);
  const tracks = [];
  let castText = '';
  let cur = null;
  const newTrack = (title) => {
    const m = TITLE_RE.exec(title || '') || [];
    cur = { title: title || '', prefix: m[1] || '', ep: m[2] || '', track: (m[3] || '').trim(), draftNo: +(m[4] || 1), zukaikko: '', theme: '', rows: [] };
    tracks.push(cur);
    return cur;
  };
  for (const it of items) {
    if (it.type === 'p') {
      const t = it.text.trim();
      if (!t) continue;
      if (TITLE_RE.test(t)) {
        // 同じタイトルが続くとき（ページの頭など）は同じトラック
        if (!cur || cur.title !== t) newTrack(t);
        continue;
      }
      if (/^図解っ子/.test(t)) { (cur || newTrack('')).zukaikko = t.replace(/^図解っ子\s*[:：]\s*/, ''); continue; }
      if (/^表現したいこと/.test(t)) { (cur || newTrack('')).theme = t.replace(/^表現したいこと[^:：]*[:：]\s*/, ''); continue; }
      continue;
    }
    if (it.type !== 'table') continue;
    const rows = rowsOf(it.el);
    if (!rows.length) continue;
    if (looksCast(rows)) { if (!castText) castText = readCastTable(rows); continue; }
    // 凡例だけの小さな表（《》タイミング ●動き…）は飛ばす
    const allText = rows.map((r) => r.map((td) => textOf(td)).join(' ')).join(' ');
    if (rows.length === 1 && /タイミング/.test(allText) && /動き/.test(allText) && allText.length < 60) continue;
    // 図解の本体は2列の表（3列以上はメンバー表などなので使わない）
    if (Math.max(...rows.map((r) => r.length)) !== 2) continue;
    const T = cur || newTrack('');
    for (const r of rows) {
      if (r.length < 2) continue;
      T.rows.push({ left: flatten(r[0]), right: flatten(r[r.length - 1]) });
    }
  }
  return { cast: castText, tracks: tracks.filter((t) => t.rows.length).map(buildTrack) };
}

function buildTrack(t) {
  let script = '';
  const out = [];
  let lastOff = 0;
  for (const row of t.rows) {
    // 左：テーマ活動の友（空の段落は空行）
    const lines = [];
    for (const it of row.left) if (it.type === 'p') lines.push(...it.text.split('\n'));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    const rowStart = script.length + (script && lines.length ? 1 : 0);
    if (lines.length) script += (script ? '\n' : '') + lines.join('\n');
    const rowEnd = script.length;
    // 右：《タイミング》ごとの説明と図
    const blocks = [];
    let blk = null;
    const start = (cue) => { blk = { cue, parts: [], text: [] }; blocks.push(blk); };
    const flush = () => { if (blk && blk.text.length) { blk.parts.push({ kind: 'text', text: blk.text.join('\n') }); blk.text = []; } };
    for (const it of row.right) {
      if (it.type === 'img') {
        if (!blk) start('');
        flush();
        const f = figureOf(it.el);
        if (f) blk.parts.push({ kind: 'figure', fig: f });
        continue;
      }
      if (it.type !== 'p') continue;
      for (const ln of it.text.split('\n')) {
        const m = CUE_RE.exec(ln.trim());
        if (m) { flush(); start(m[1].trim()); if (m[2].trim()) blk.text.push(m[2].trim()); continue; }
        if (!blk) { if (!ln.trim()) continue; start(''); }
        blk.text.push(ln);
      }
    }
    flush();
    for (const b of blocks) {
      const items = b.parts.map((p) => (p.kind === 'text' ? { kind: 'text', text: p.text.replace(/\n{3,}/g, '\n\n').trim() } : p))
        .filter((p) => p.kind !== 'text' || p.text.replace(/[●\s]/g, ''));
      if (!items.length && !b.cue) continue;
      let off = rowStart, anchorText = '';
      if (b.cue && script) {
        const f = findCue(script, b.cue, { from: lastOff, near: rowStart, end: rowEnd });
        if (f) { off = f.i; anchorText = f.text; }
      }
      if (off < lastOff) { off = lastOff; anchorText = ''; }
      lastOff = off;
      out.push({ cue: anchorText || b.cue, offset: off, anchorText, items });
    }
  }
  return { title: t.title, prefix: t.prefix, ep: t.ep, track: t.track, draftNo: t.draftNo, zukaikko: t.zukaikko, theme: t.theme, script, blocks: out };
}

// ---------- コピーしたときの「ドキュメントの中身」（Googleドキュメント専用の形式）から組み立てる ----------
// 文章と表の形（\x10 表の始まり・\x12 行・\x1c マス・\x11 表の終わり）と、図形描画・写真の場所がわかる。
// それを、ふつうの HTML に直して analyzeDocHtml に渡す。写真はクリップボードの HTML から順に使う。
export const SLICE_TYPE = 'application/x-vnd.google-docs-document-slice-clip+wrapped';
export function sliceToHtml(sliceText, html) {
  let R;
  try { R = JSON.parse(JSON.parse(sliceText).data).resolved; } catch (e) { return null; }
  const sp = R && R.dsl_spacers;
  if (typeof sp !== 'string') return null;
  const em = R.dsl_entitymap || {};
  const pos = R.dsl_entitypositionmap || {};
  const inlineAt = {}, posAt = {};
  (pos.inline || []).forEach((v, i) => { if (v) inlineAt[i] = v; });
  (pos.positioned || []).forEach((v, i) => { if (v) posAt[i] = v; });
  // 写真（クリップボードの HTML に入っている順）
  const photos = [];
  if (html) for (const m of html.matchAll(/<img\b[^>]*>/gi)) photos.push(m[0]);
  let photoIdx = 0;
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const objHtml = (key) => {
    const e = em[key] && em[key].ee_eo;
    if (!e) return '';
    if (e.d_id) return `<img data-drawing="${esc(e.d_id)}" data-w="${e.i_wth || 0}" data-h="${e.i_ht || 0}">`;
    const ph = photos[photoIdx++];
    return ph || '';
  };
  let out = '';
  let para = '';
  const after = [];
  const cellOpen = [], rowOpen = [];
  const flush = () => { out += `<p>${para}</p>`; para = ''; out += after.splice(0).join(''); };
  for (let i = 0; i < sp.length; i++) {
    const ch = sp[i];
    if (posAt[i]) for (const k of posAt[i]) after.push(`<p>${objHtml(k)}</p>`);
    if (ch === '\x10') { out += '<table><tbody>'; cellOpen.push(false); rowOpen.push(false); continue; }
    if (ch === '\x12') { const d = rowOpen.length - 1; if (cellOpen[d]) out += '</td>'; if (rowOpen[d]) out += '</tr>'; out += '<tr>'; rowOpen[d] = true; cellOpen[d] = false; continue; }
    if (ch === '\x1c') { const d = cellOpen.length - 1; if (cellOpen[d]) out += '</td>'; out += '<td>'; cellOpen[d] = true; continue; }
    if (ch === '\x11') { const d = cellOpen.length - 1; if (para) flush(); if (cellOpen[d]) out += '</td>'; if (rowOpen[d]) out += '</tr>'; out += '</tbody></table>'; cellOpen.pop(); rowOpen.pop(); continue; }
    if (ch === '\n') { flush(); continue; }
    if (inlineAt[i]) { para += inlineAt[i].map(objHtml).join(''); continue; }
    para += esc(ch);
  }
  if (para || after.length) flush();
  // タイトル（表題）は HTML のほうにしかないことがあるので、先頭に足す
  let title = '';
  if (html) {
    const t = /【[^】<]*】[^<]*?話図解_[^<]*?_(?:第\d+|最終)稿/.exec(html.replace(/<[^>]+>/g, ''));
    if (t && !sp.includes(t[0])) title = `<p>${esc(t[0])}</p>`;
  }
  return title + out;
}
