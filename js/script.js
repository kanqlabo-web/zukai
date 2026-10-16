// 台本テキストの解析：話者ラベル、字下げ、《タイミング》位置、段（行）分け。

// 行頭の「話者:」を見つける
// 英語：大文字で始まる語の並び（Dursoi A / MR BEAVER / PETER (MAUGRIM) など）。小文字の語（of, the…）が入ると話者名とみなさない
const EN_RE = /^(\s*)([A-Z][A-Za-z0-9'’.\-]*(?:\s+(?:&|[A-Z][A-Za-z0-9'’.\-]*))*(?:\s*[(（][^)）]{0,20}[)）])?)\s*[:：]/;
// 日本語：16文字以内の名前（ピーター、ドゥルソイ（A） など）
const JA_RE = /^(\s*)([^\s\x00-\x7f:：、。!！?？「」『』][^:：、。!！?？「」『』]{0,15}?)\s*[:：]/;
const NARRATOR_RE = /^(NARRATOR|NARRATION|語り|語り手|ナレ|ナレーター|ナレーション)$/i;

// fixes：手動で直した話者名の判定 [{ t: 行の文字, n: 話者名の文字数（0なら話者名なし） }]
export function parseLines(text, fixes) {
  const fixMap = new Map((fixes || []).map((f) => [f.t, f.n]));
  const lines = [];
  let pos = 0;
  let narrator = true;
  let prev = null; // 直前の空行でない行
  for (const raw of (text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    let label = null;
    let name = '';
    let fixed = false;
    if (fixMap.has(line)) {
      fixed = true;
      const n = Math.min(fixMap.get(line) || 0, line.length);
      if (n > 0) { label = { s: pos, e: pos + n }; name = line.slice(0, n).replace(/[:：\s]+$/, ''); }
    } else {
      let m = line.match(EN_RE);
      if (!m) {
        m = line.match(JA_RE);
        // 英語の行が話者名なしなら、その訳の日本語の行も話者名なしとみなす
        if (m && prev && /^[\x00-\x7f]/.test(prev.text.trim()) && !prev.label) m = null;
      }
      if (m && m[2].replace(/[()（）\s]/g, '')) {
        label = { s: pos + m[1].length, e: pos + m[0].length };
        name = m[2];
      }
    }
    if (label) narrator = NARRATOR_RE.test(name.trim().replace(/\s*[(（].*$/, ''));
    const blank = line.trim() === '';
    const L = { start: pos, end: pos + line.length, label, indent: !narrator, blank, fixed };
    lines.push(L);
    if (!blank) prev = { text: line, label };
    pos += raw.length + 1;
  }
  return lines;
}

// 台本が書き換えられても、タイミングの語句の位置を探し直す
export function resolveAnchor(text, anchor) {
  if (!anchor) return { offset: 0, ok: false };
  text = text || '';
  const t = anchor.text || '';
  const off = Math.max(0, Math.min(anchor.offset || 0, text.length));
  if (!t) return { offset: off, ok: true };
  if (text.substr(anchor.offset, t.length) === t) return { offset: anchor.offset, ok: true };
  let best = -1;
  let i = text.indexOf(t);
  while (i !== -1) {
    if (best === -1 || Math.abs(i - off) < Math.abs(best - off)) best = i;
    i = text.indexOf(t, i + 1);
  }
  if (best >= 0) return { offset: best, ok: true };
  return { offset: off, ok: false };
}

function lineStartOf(lines, offset) {
  let s = 0;
  for (const l of lines) {
    if (l.start <= offset) s = l.start;
    else break;
  }
  return s;
}

export function sortBlocks(text, blocks) {
  return blocks
    .map((b) => ({ b, r: resolveAnchor(text, b.anchor) }))
    .sort((x, y) => x.r.offset - y.r.offset || (x.b.createdAt || 0) - (y.b.createdAt || 0));
}

// 台本を《タイミング》ごとの段に分ける
export function buildRows(text, blocks, fixes) {
  text = text || '';
  const lines = parseLines(text, fixes);
  const sorted = sortBlocks(text, blocks);
  const rows = [{ start: 0, blocks: [] }];
  for (const { b, r } of sorted) {
    const ls = lineStartOf(lines, r.offset);
    const cur = rows[rows.length - 1];
    if (b.newRow !== false && ls > cur.start) rows.push({ start: ls, blocks: [{ b, r }] });
    else cur.blocks.push({ b, r });
  }
  rows.forEach((row, i) => {
    row.end = i + 1 < rows.length ? rows[i + 1].start : text.length;
    row.lines = lines.filter((l) => l.start >= row.start && l.start < row.end);
    // 段末の空行は表示しない
    while (row.lines.length > 1 && row.lines[row.lines.length - 1].blank) row.lines.pop();
  });
  if (rows.length > 1 && rows[0].blocks.length === 0 && rows[0].lines.every((l) => l.blank)) rows.shift();
  return rows;
}

// 1行を「ラベル」「本文」「タイミング強調」の区間に分ける
export function lineSegments(text, line, highlights) {
  const cuts = new Set([line.start, line.end]);
  if (line.label) { cuts.add(line.label.s); cuts.add(line.label.e); }
  for (const [a, b] of highlights) {
    if (b <= line.start || a >= line.end) continue;
    cuts.add(Math.max(a, line.start));
    cuts.add(Math.min(b, line.end));
  }
  const pts = [...cuts].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    if (e <= s) continue;
    const isLabel = line.label && s >= line.label.s && e <= line.label.e;
    const hl = highlights.some(([a, b]) => s >= a && e <= b);
    segs.push({ s, e, text: text.slice(s, e), label: isLabel, hl });
  }
  return segs;
}

export function highlightRanges(text, blocks) {
  const out = [];
  for (const b of blocks) {
    if (!b.cue || !b.anchor || !b.anchor.text) continue;
    const r = resolveAnchor(text, b.anchor);
    if (r.ok) out.push([r.offset, r.offset + b.anchor.text.length]);
  }
  return out;
}
