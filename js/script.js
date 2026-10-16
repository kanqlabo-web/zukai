// 台本テキストの解析：話者ラベル、字下げ、《きっかけ》位置、段（行）分け。

// 行頭の「話者:」を見つける（英語の大文字名 / 短い日本語名）
const LABEL_RE = /^(\s*)((?:[A-Z][A-Z0-9 &'’.\-\/()（）]*?)|(?:[^\s:：、。!！?？「」『』]{1,16}?))\s*[:：]/;
const NARRATOR_RE = /^(NARRATOR|NARRATION|語り|語り手|ナレ|ナレーター|ナレーション)$/i;

export function parseLines(text) {
  const lines = [];
  let pos = 0;
  let narrator = true;
  for (const raw of (text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(LABEL_RE);
    let label = null;
    if (m) {
      const name = m[2].replace(/[()（）\s]/g, '');
      if (name) {
        label = { s: pos + m[1].length, e: pos + m[0].length };
        narrator = NARRATOR_RE.test(m[2].trim());
      }
    }
    lines.push({ start: pos, end: pos + line.length, label, indent: !narrator, blank: line.trim() === '' });
    pos += raw.length + 1;
  }
  return lines;
}

// 台本が書き換えられても、きっかけの語句の位置を探し直す
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

// 台本を《きっかけ》ごとの段に分ける
export function buildRows(text, blocks) {
  text = text || '';
  const lines = parseLines(text);
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

// 1行を「ラベル」「本文」「きっかけ強調」の区間に分ける
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
