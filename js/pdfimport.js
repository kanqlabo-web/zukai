import { db, newId } from './db.js';
import { P, parseCast, emptyDraft } from './model.js';
import { compressImage } from './state.js';
import { readPdf } from './pdfread.js';
import { findCue, cueRangeEnd } from './script.js';
import { diagramFromPdf, diagramFromSvg, svgToPng, isStageFig } from './drawimport.js';
// 図解PDF（Googleドキュメントやこのツールで作ったもの）から、テーマ活動の友・タイミング・メモ・メンバーを組み立て直す。
// 文字の位置から「タイトル」「メンバー表」「左のテーマ活動の友」「右のタイミングとメモ」を見分ける。
// 図は画像として入っているので、写真として取り込む（このツールの図には戻せない）。

// Googleドキュメントの日本語は「⼦」のような部首の文字で入っていることがあるので、ふつうの漢字に直す
function clean(s) {
  return s.replace(/[⺀-⿟]/g, (c) => c.normalize('NFKC')).replace(/[⚫⬤]/g, '●').replace(/ /g, ' ');
}
const isGray = (g) => g.color && g.color[0] > 0.6 && g.color[1] > 0.6 && g.color[2] > 0.6;
const asciiWord = (c) => /[A-Za-z0-9,.!?'"’\-:;)]/.test(c || '');
const kata = (c) => /[\u30A0-\u30FFー]/.test(c || '');

// 文字を行にまとめる（同じ高さ・左から右）
function toLines(glyphs) {
  const gs = glyphs.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const g of gs) {
    let L = lines[lines.length - 1];
    if (!L || Math.abs(L.y - g.y) > Math.max(2, g.size * 0.3)) { L = { y: g.y, g: [] }; lines.push(L); }
    L.g.push(g);
  }
  for (const L of lines) {
    L.g.sort((a, b) => a.x - b.x);
    // 幅のない（次の文字と重なっている）空白は無視する
    L.g = L.g.filter((g, i) => {
      if (g.text.trim()) return true;
      const n = L.g.slice(i + 1).find((x) => x.text.trim());
      const p = L.g.slice(0, i).reverse().find((x) => x.text.trim());
      if (p && g.x < p.x + p.w - 0.5) return false; // 前の文字と重なっている
      return n && n.x >= g.x + g.w * 0.5 && !(i > 0 && !L.g[i - 1].text.trim() && L.g[i - 1].x + L.g[i - 1].w > g.x - 0.5);
    });
    if (!L.g.length) { L.text = ''; continue; }
    let text = '';
    let prev = null;
    for (const g of L.g) {
      if (prev && g.x - (prev.x + prev.w) > g.size * 0.25 && !/\s$/.test(text) && g.text !== ' ' && asciiWord(prev.text) && asciiWord(g.text)) text += ' ';
      text += g.text;
      prev = g;
    }
    L.raw = clean(text);
    L.text = L.raw.replace(/\s+/g, ' ').trim();
    L.x = L.g.find((g) => g.text.trim()) ? L.g.find((g) => g.text.trim()).x : L.g[0].x;
    const last = [...L.g].reverse().find((g) => g.text.trim()) || L.g[L.g.length - 1];
    L.right = last.x + last.w;
    L.size = Math.max(...L.g.map((g) => g.size));
    L.gray = isGray(L.g.find((g) => g.text.trim()) || L.g[0]);
    L.bold = L.g.some((g) => g.bold && g.text.trim());
  }
  return lines.filter((L) => L.text);
}

const TITLE_RE = /^(.*?)(\d+話|第\d+話|[^\s_】]*話)図解_?(.*?)_(?:第(\d+)|最終)稿/;

// 行の最初の語の幅（折り返しの判定に使う）
function firstWordW(L) {
  let w = 0;
  let mode = null;
  for (const g of L.g) {
    if (!g.text.trim()) { if (w) break; continue; }
    const m = asciiWord(g.text) ? 'a' : kata(g.text) ? 'k' : 'j';
    if (mode && m !== mode) break;
    mode = mode || m;
    w += g.w;
    if (m === 'j') break; // ひらがな・漢字は1文字（カタカナの言葉はひとまとまり）
  }
  // 行の頭に置けない「、。）」などは、前の文字といっしょに送られる
  const rest = L.g.filter((g) => g.text.trim());
  let k = 0;
  while (k < rest.length && w > rest.slice(0, k + 1).reduce((a, g) => a + g.w, 0) - 0.01) k++;
  for (; k < rest.length && /^[、。，．）」』】〕！？!?,.\)ーぁぃぅぇぉっゃゅょァィゥェォッャュョ…]$/.test(rest[k].text); k++) w += rest[k].w;
  return w;
}
// 前の行の右に、次の行の最初の語が入らなかった＝折り返し
const wrapped = (prev, L, colRight) => prev && L && prev.page === L.page && prev.right + firstWordW(L) + prev.size * 0.3 > colRight;

// 行を段落につなげる
function joinParagraphs(lines, colRight) {
  const out = []; // { text, page, y, lines }
  let cur = null;
  let prev = null;
  for (const L of lines) {
    const pitch = L.size * 1.32;
    let gapLines = 0;
    if (prev && prev.page === L.page) gapLines = Math.round((L.y - prev.y) / pitch) - 1;
    // ページをまたぐ行は、前のページの最後の行が右端まで届いていれば続き
    const cont = prev && (prev.page === L.page ? wrapped(prev, L, colRight) : prev.right + firstWordW(L) > colRight);
    if (!cur || L.gray || !cont || gapLines > 0) {
      if (cur) out.push(cur);
      for (let k = 0; k < Math.min(gapLines, 3); k++) out.push({ text: '', page: L.page, y: L.y - pitch * (k + 1), blank: true });
      cur = { text: L.text, page: L.page, y: L.y, lines: [L] };
    } else {
      const a = cur.text.slice(-1), b = L.text[0];
      cur.text += (asciiWord(a) && asciiWord(b) ? ' ' : '') + L.text;
      cur.lines.push(L);
    }
    prev = L;
  }
  if (cur) out.push(cur);
  return out;
}

// メンバー表：4列のマスを読む
function readCast(glyphs, left, right) {
  const colW = (right - left) / 4;
  const cols = [[], [], [], []];
  for (const g of glyphs) cols[Math.max(0, Math.min(3, Math.floor((g.x - left) / colW)))].push(g);
  const cells = [];
  cols.forEach((gs, ci) => {
    for (const L of toLines(gs)) {
      const m = /^([0-9０-９]+|[A-Za-z]{1,4})\s+(.*)$/.exec(L.text);
      const startX = left + ci * colW;
      if (m && L.x - startX < colW * 0.25) cells.push({ ci, y: L.y, no: m[1], name: m[2] });
      else if (cells.length) {
        const last = [...cells].reverse().find((c) => c.ci === ci);
        if (last) last.name += L.text;
      }
    }
  });
  const nums = cells.filter((c) => /^\d+$/.test(c.no.normalize('NFKC'))).sort((a, b) => +a.no.normalize('NFKC') - +b.no.normalize('NFKC'));
  const tags = cells.filter((c) => !/^\d+$/.test(c.no.normalize('NFKC')));
  return [...nums, ...tags].map((c) => `${c.no} ${c.name.replace(/\s+/g, '')}`).join('\n');
}

export function analyzeZukai(pages) {
  const tracks = [];
  let castText = '';
  let cur = null;
  for (let pi = 0; pi < pages.length; pi++) {
    const pg = pages[pi];
    const lines = toLines(pg.glyphs);
    if (!lines.length) continue;
    const left = Math.min(...lines.map((L) => L.x));
    const right = pg.width - left;
    const divider = left + (right - left) * 0.365;
    // タイトル（各ページの一番上）
    const titleLine = lines.find((L) => L.y < pg.height * 0.12 && TITLE_RE.test(L.text));
    const title = titleLine ? titleLine.text : (cur ? cur.title : '');
    const legend = lines.find((L) => /タイミング/.test(L.text) && /動き/.test(L.text));
    const info = lines.filter((L) => /^図解っ子|^表現したいこと/.test(L.text));
    if (!cur || title !== cur.title || info.length) {
      const m = TITLE_RE.exec(title) || [];
      cur = {
        title, prefix: m[1] || '', ep: m[2] || '', track: (m[3] || '').trim(), draftNo: +(m[4] || 1),
        zukaikko: '', theme: '', scriptLines: [], noteLines: [],
      };
      tracks.push(cur);
    }
    let top = titleLine ? titleLine.y + 2 : 0;
    if (legend) {
      // メンバー表と、図解っ子・表現したいこと
      const zk = info.find((L) => /^図解っ子/.test(L.text));
      const th = info.find((L) => /^表現したいこと/.test(L.text));
      if (zk) cur.zukaikko = zk.text.replace(/^図解っ子\s*[:：]\s*/, '');
      if (th) cur.theme = th.text.replace(/^表現したいこと[^:：]*[:：]\s*/, '');
      const infoBottom = Math.max(top, ...info.map((L) => L.y));
      if (!castText) castText = readCast(pg.glyphs.filter((g) => g.y > infoBottom + 2 && g.y < legend.y - 2), left, right);
      top = legend.y + 2;
    }
    const body = pg.glyphs.filter((g) => g.y > top);
    for (const L of toLines(body.filter((g) => g.x < divider))) { L.page = pi; cur.scriptLines.push(L); }
    for (const L of toLines(body.filter((g) => g.x >= divider))) { L.page = pi; cur.noteLines.push(L); }
    // 右の列の図（図など）。文字の行と同じ並びに入れる
    for (const f of pg.figs || []) {
      if (f.x0 < divider - 5 || f.y1 - f.y0 < 30 || f.x1 - f.x0 < 30 || f.y0 < top) continue;
      f.pdfPage = pg; // 図形描画を図に直すときに使う
      cur.noteLines.push({ fig: f, page: pi, y: f.y0, bottom: f.y1, size: 10, text: '' });
    }
    cur.noteLines.sort((p, q) => p.page - q.page || p.y - q.y);
    cur.colRightS = Math.max(cur.colRightS || 0, ...cur.scriptLines.filter((L) => L.page === pi).map((L) => L.right));
    cur.colRightN = Math.max(cur.colRightN || 0, ...cur.noteLines.filter((L) => L.page === pi).map((L) => L.right));
  }
  return { cast: castText, tracks: tracks.filter((t) => t.scriptLines.length || t.noteLines.length).map(buildTrack) };
}

function buildTrack(t) {
  // テーマ活動の友
  const paras = joinParagraphs(t.scriptLines, t.colRightS);
  let script = '';
  const at = []; // 段落の文字位置
  paras.forEach((p, i) => {
    if (i) script += '\n';
    at.push({ off: script.length, page: p.page, y: p.y, end: 0, lines: p.lines || [] });
    script += p.text;
    at[at.length - 1].end = script.length;
  });
  // メモ：《タイミング》ごと、またはテーマ活動の友の段落の頭と同じ高さで新しい段（行）が始まるところで区切る
  const paraStart = (L) => at.some((a) => a.page === L.page && Math.abs(a.y - L.y) < 3);
  const blocks = [];
  let blk = null;
  let prev = null;
  for (const L of t.noteLines) {
    const prevBottom = prev ? (prev.fig ? prev.bottom : prev.y) : 0;
    const gap = prev && prev.page === L.page ? L.y - prevBottom : 0;
    const cue = L.fig ? null : /^[《≪«]\s*(.*?)\s*[》≫»](.*)$/.exec(L.text);
    const newRow = !L.fig && paraStart(L) && (!prev || (prev.page === L.page ? gap > L.size * 2.2 : true));
    if (!blk || cue || (newRow && !(blk.parts.length === 0 && blk.text.length === 0))) {
      const R = cue ? cueRangeEnd(cue[2]) : null;
      blk = { cue: cue ? cue[1].trim() : '', cueEnd: R ? R.end : '', page: L.page, y: L.y, parts: [], text: [] };
      blocks.push(blk);
      if (cue) { const rest = R ? R.rest : cue[2]; if (rest.trim()) blk.text.push({ L, t: rest.trim() }); prev = L; continue; }
    }
    if (L.fig) {
      if (blk.text.length) blk.parts.push({ kind: 'text', lines: blk.text });
      blk.text = [];
      blk.parts.push({ kind: 'figure', fig: L.fig });
    } else {
      if (gap > L.size * 2.2 && blk.text.length && !(prev && prev.fig)) blk.text.push({ L: null, t: '' });
      blk.text.push({ L, t: L.text });
    }
    prev = L;
  }
  const out = [];
  let lastOff = 0;
  for (const b of blocks) {
    if (b.text.length) b.parts.push({ kind: 'text', lines: b.text });
    const items = b.parts.map((p) => {
      if (p.kind !== 'text') return p;
      const ls = p.lines;
      let text = '';
      ls.forEach((x, i) => {
        if (!i) { text = x.t; return; }
        const pl = ls[i - 1].L;
        const cont = pl && x.L && x.t && !/^[●☆＊*→]/.test(x.t) && (pl.page === x.L.page ? wrapped(pl, x.L, t.colRightN) : pl.right + firstWordW(x.L) > t.colRightN);
        if (cont) text += (asciiWord(text.slice(-1)) && asciiWord(x.t[0]) ? ' ' : '') + x.t;
        else text += '\n' + x.t;
      });
      return { kind: 'text', text: text.replace(/\n{3,}/g, '\n\n').trim() };
    }).filter((p) => p.kind !== 'text' || p.text.replace(/[●\s]/g, ''));
    // テーマ活動の友の中の位置：同じページの同じ高さの段落から探す
    const near = at.filter((a) => a.page === b.page && a.y <= b.y + 4).pop() || at.filter((a) => a.page <= b.page).pop() || at[0];
    if (!items.length && !b.cue) continue;
    let off = null;
    let anchorText = '';
    // 《タイミング》の語句：前のタイミングより前には戻らない
    if (b.cue && script) {
      const f = findCue(script, b.cue, { from: lastOff, near: near ? near.off : 0, end: near ? near.end : Infinity });
      if (f) { off = f.i; anchorText = f.text; lastOff = off; }
    }
    const o = { cue: anchorText || b.cue, offset: off, near: near ? near.off : 0, anchorText, items };
    if (b.cueEnd) {
      const f = script && anchorText ? findCue(script, b.cueEnd, { from: off + 1, near: off }) : null;
      o.cueEnd = f ? f.text : b.cueEnd;
      if (f) { o.endOffset = f.i; o.endText = f.text; }
    }
    out.push(o);
  }
  // 語句のない段（図だけなど）：同じ高さの段落の位置。ただし前後の段を追い越さない
  let lo = 0;
  for (let i = 0; i < out.length; i++) {
    const o = out[i];
    if (o.offset == null) {
      const nx = out.slice(i + 1).find((x) => x.anchorText);
      const hi = nx ? nx.offset : Infinity;
      o.offset = Math.max(lo, Math.min(o.near, hi));
    }
    lo = o.offset;
    delete o.near;
  }
  return {
    title: t.title, prefix: t.prefix, ep: t.ep, track: t.track, draftNo: t.draftNo,
    zukaikko: t.zukaikko, theme: t.theme, script, blocks: out,
  };
}

// ---------- ライブラリーに取り込む ----------
export async function readZukaiPdf(file, onProgress) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = await readPdf(bytes, onProgress);
  return analyzeZukai(pages);
}

const trackTitle = (t) => String(t || '').replace(/^トラ(?!ック)/, 'トラック');
const now = () => Date.now();

// result: analyzeZukai の結果 / epId: 取り込む先の話（null なら epTitle で新しく作る）/ replaceCast: メンバー一覧を置き換える
// Googleの図形描画を SVG で取り出す
export async function drawingSvg(id, token) {
  const r = await fetch(`https://docs.google.com/drawings/d/${encodeURIComponent(id)}/export/svg`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('図形描画を取り出せませんでした（' + r.status + '）');
  return r.text();
}

// 図形描画を PDF で取り出す（図の中の文字を、形からではなく本当の文字で読むため）。だめなら null
export async function drawingPdf(id, token) {
  try {
    const r = await fetch(`https://docs.google.com/drawings/d/${encodeURIComponent(id)}/export/pdf`, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const pages = await readPdf(new Uint8Array(await r.arrayBuffer()));
    return pages[0] && pages[0].glyphs.length ? pages[0] : null;
  } catch (e) { console.warn('図形描画を PDF で取り出せませんでした', e); return null; }
}

export async function importZukai(w, result, { epId, epTitle, replaceCast, existingEpisodes, tracks, drafts, user, asNewTrack = false, trackName = null, cast = [], roleList = [], vectorize = true, driveToken = null, toTrack = null, toDraftId = null, appendTo = null, replace = false, onProgress = null }, onStep) {
  // replace：toDraftId の稿の中身（テマ友・タイミング・図・写真）を全部消してから入れる。元に戻す（Ctrl+Z）で戻せるよう、履歴に残す
  // appendTo：toDraftId の稿に中身があるとき、その稿の今の内容（{ script, zukaikko, theme }）。テマ友は後ろに足し、タイミングの位置もずらす
  // onProgress(文, 済んだ図の数, 図の数)：図を1枚読むごとに呼ぶ（画面に進み具合を出す）
  // toTrack：このトラックに入れる（toDraftId があればその稿に、なければ次の稿として）
  let castList = cast || [];
  if (replaceCast && result.cast) { castList = parseCast(result.cast); await db.update(P.work(w), { cast: castList, updatedAt: now() }); }
  // 図の中の文字を読むときの候補：ドキュメントの文字
  const chars = [result.cast || '', ...castList.flatMap((c) => [c.name, ...(c.roles || []).map((r) => `${r.name || ''}${r.label || ''}`)]),
    ...result.tracks.flatMap((T) => [T.script, ...T.blocks.flatMap((b) => [b.cue, ...b.items.map((i) => i.text || '')])])].join('');
  if (!epId) {
    epId = newId();
    await db.set(P.doc(w, 'episodes', epId), { title: epTitle || '取り込んだ話', order: (existingEpisodes || []).length + 1, createdAt: now() });
  }
  const epTracks = (tracks || []).filter((t) => t.episodeId === epId);
  let order = epTracks.length;
  const made = [];
  const isFig = (it) => it.kind === 'figure' && it.fig && (it.fig.drawing || it.fig.render || it.fig.load || it.fig.pdf);
  const figTotal = result.tracks.reduce((a, T) => a + T.blocks.reduce((b2, b) => b2 + b.items.filter(isFig).length, 0), 0);
  let figDone = 0;
  const failed = []; // 読めなかった図（タイミングの文字）
  const tick = () => { figDone++; if (onProgress) onProgress(`図を読み込んでいます（${figDone}／${figTotal}）`, figDone, figTotal); };
  if (onProgress) onProgress(figTotal ? `図を読み込んでいます（0／${figTotal}）` : '取り込んでいます…', 0, figTotal);
  for (let ti = 0; ti < result.tracks.length; ti++) {
    const T = result.tracks[ti];
    if (onStep) onStep(ti + 1, result.tracks.length);
    let title = (trackName && String(trackName).trim()) || trackTitle(T.track) || `トラック${epTracks.length + ti + 1}`;
    // 同じ名前のトラックがあれば、そこに新しい稿として入れる（asNewTrack なら、別のトラックとして足す）
    let track = toTrack || (asNewTrack ? null : epTracks.find((t) => t.title === title));
    if (!toTrack && asNewTrack && epTracks.some((t) => t.title === title)) {
      let k = 2;
      while (epTracks.some((t) => t.title === `${title}（${k}）`)) k++;
      title = `${title}（${k}）`;
    }
    const ops = [];
    let trackId;
    let no = 1;
    if (track) {
      trackId = track.id;
      title = track.title || title;
      const into = toDraftId && (drafts || []).find((d) => d.id === toDraftId);
      no = into ? into.no || 1 : Math.max(0, ...(drafts || []).filter((d) => d.trackId === trackId).map((d) => d.no || 0)) + 1;
    } else {
      trackId = newId();
      ops.push({ op: 'set', path: P.doc(w, 'tracks', trackId), data: { episodeId: epId, title, order: ++order, createdAt: now() } });
      epTracks.push({ id: trackId, title });
    }
    const draftId = (track && toDraftId) || newId();
    const body = { script: T.script, zukaikko: T.zukaikko || '', theme: T.theme || '', importedFrom: T.title };
    let shift = 0;
    if (track && toDraftId && appendTo && String(appendTo.script || '').trim()) {
      const head = String(appendTo.script).replace(/\s+$/, '') + '\n\n';
      shift = head.length;
      body.script = head + (T.script || '');
      if (appendTo.zukaikko) body.zukaikko = appendTo.zukaikko;
      if (appendTo.theme) body.theme = appendTo.theme;
    }
    if (track && toDraftId && replace) {
      const [ob, og, oi] = await Promise.all(['blocks', 'diagrams', 'images'].map((c) => db.list(P.col(w, c), ['draftId', draftId])));
      for (const x of ob) ops.push({ op: 'remove', path: P.doc(w, 'blocks', x.id) });
      for (const x of og) ops.push({ op: 'remove', path: P.doc(w, 'diagrams', x.id) });
      for (const x of oi) ops.push({ op: 'remove', path: P.doc(w, 'images', x.id) });
      body.scriptMarks = [];
    }
    if (track && toDraftId) ops.push({ op: 'update', path: P.doc(w, 'drafts', draftId), data: { ...body, updatedAt: now(), updatedBy: user ? user.name : '' } });
    else ops.push({ op: 'set', path: P.doc(w, 'drafts', draftId), data: { ...emptyDraft(trackId, no, user), ...body } });
    const t0 = now();
    for (let bi = 0; bi < T.blocks.length; bi++) {
      const b = T.blocks[bi];
      const items = {};
      let k = 0;
      for (const it of b.items) {
        const iid = newId(8);
        if (it.kind === 'text') items[iid] = { order: ++k, kind: 'text', text: it.text };
        else if (it.kind === 'figure' && it.fig && it.fig.drawing) {
          // Googleの図形描画：SVG を取り出して、図に直す（だめなら写真）
          if (!driveToken) { failed.push(b.cue || ''); tick(); continue; }
          try {
            const svg = await drawingSvg(it.fig.drawing.id, driveToken);
            let d = null;
            if (vectorize) { try { d = await diagramFromSvg(svg, { cast: castList, roleList, chars, pdf: await drawingPdf(it.fig.drawing.id, driveToken) }); } catch (e) { console.warn('図に直せませんでした', e); } }
            if (d) {
              const gid = newId();
              ops.push({ op: 'set', path: P.doc(w, 'diagrams', gid), data: { draftId, shapes: d.shapes, roleVis: d.roleVis, createdAt: now() } });
              items[iid] = { order: ++k, kind: 'diagram', refId: gid, caption: '' };
            } else {
              const blob = await svgToPng(svg);
              if (!blob) { failed.push(b.cue || ''); tick(); continue; }
              const img = await compressImage(blob);
              const imgId = newId();
              ops.push({ op: 'set', path: P.doc(w, 'images', imgId), data: { draftId, ...img, createdAt: now() } });
              items[iid] = { order: ++k, kind: 'image', refId: imgId, caption: '', size: 'l' };
            }
          } catch (e) { console.warn(e); failed.push(b.cue || ''); }
          tick();
        }
        else if (it.kind === 'figure' && it.fig && (it.fig.render || it.fig.load || it.fig.pdf)) {
          // 図形描画（PDFの線・文字）→ 図解メーカーの図
          const src = it.fig.pdf || (it.fig.pdfPage ? { page: it.fig.pdfPage, fig: it.fig } : null);
          if (vectorize && src && isStageFig(src.fig)) {
            try {
              const d = await diagramFromPdf(src.page, src.fig, { cast: castList, roleList, chars });
              if (d) {
                const gid = newId();
                ops.push({ op: 'set', path: P.doc(w, 'diagrams', gid), data: { draftId, shapes: d.shapes, roleVis: d.roleVis, createdAt: now() } });
                items[iid] = { order: ++k, kind: 'diagram', refId: gid, caption: '' };
                tick();
                continue;
              }
            } catch (e) { console.warn('図に直せませんでした', e); }
          }
          if (!it.fig.render && !it.fig.load) { failed.push(b.cue || ''); tick(); continue; }
          try {
            const blob = await (it.fig.render || it.fig.load)();
            if (!blob) { failed.push(b.cue || ''); tick(); continue; }
            const img = await compressImage(blob);
            const imgId = newId();
            ops.push({ op: 'set', path: P.doc(w, 'images', imgId), data: { draftId, ...img, createdAt: now() } });
            items[iid] = { order: ++k, kind: 'image', refId: imgId, caption: '', size: 'l', ...(it.fig.pct ? { w: it.fig.pct } : {}), ...(it.beside ? { beside: true } : {}) };
          } catch (e) { failed.push(b.cue || ''); }
          tick();
        }
      }
      if (!k) items[newId(8)] = { order: 1, kind: 'text', text: '● ' };
      ops.push({ op: 'set', path: P.doc(w, 'blocks', newId()), data: { draftId, cue: b.cue || '', anchor: { offset: (b.offset || 0) + shift, text: b.anchorText || '' }, ...(b.cueEnd ? { cueEnd: b.cueEnd, anchorEnd: { offset: (b.endOffset != null ? b.endOffset : b.offset || 0) + shift, text: b.endText || '' } } : {}), newRow: true, createdAt: t0 + bi, items } });
    }
    await (replace && toDraftId ? db.batchUndoable(ops) : db.batch(ops));
    made.push({ trackId, draftId, title, no });
  }
  return { epId, made, failed, figTotal };
}
