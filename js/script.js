// テーマ活動の友テキストの解析：話者ラベル、字下げ、《タイミング》位置、段（行）分け。

// 行頭の「話者:」を見つける
// 英語：大文字で始まる語の並び（Dursoi A / MR BEAVER / PETER (MAUGRIM) など）。小文字の語（of, the…）が入るとキャラクター名とみなさない
const EN_RE = /^(\s*)([A-Z][A-Za-z0-9'’.\-]*(?:\s+(?:&|[A-Z][A-Za-z0-9'’.\-]*))*(?:\s*[(（][^)）]{0,20}[)）])?)\s*[:：]/;
// 日本語：16文字以内の名前（ピーター、ドゥルソイ（A） など）
const JA_RE = /^(\s*)([^\s\x00-\x7f:：、。!！?？「」『』][^:：、。!！?？「」『』]{0,15}?)\s*[:：]/;
const NARRATOR_RE = /^(NARRATOR|NARRATION|語り|語り手|ナレ|ナレーター|ナレーション)$/i;

// テマ友の文章に書き込める印（画面・PDF・Wordには表示しない）
//   行頭の [字下げ]   … その行から次の空行まで字下げする（全角の［］でもよい）
//   行頭の [字下げなし] … その行から次の空行まで字下げしない
//   {  } で囲んだ部分 … 薄い文字（キャラ名）にする。行頭なら、その行のキャラ名になる（全角の｛｝でもよい）
//   行頭の {}        … この行にはキャラ名がない（自動で判定しない）
const IND_MARK = /^[\[［](字下げなし|字下げ)[\]］][ \t　]*/;
const GRAY_MARK = /[{｛]([^{｛}｝\n]*)[}｝]/g;

// fixes：行ごとに手で直した表示 [{ t: 行の文字, n: キャラクター名の文字数（0ならキャラクター名なし、なければ自動）, ind: 字下げする/しない（なければ自動） }]
// 字下げの自動判定：ナレーション以外のキャラクター名で始まる行から、次の空行までをセリフとして字下げする。
// 空行のあとでキャラクター名のない行はナレーション（字下げしない）。
export function parseLines(text, fixes) {
  const fixMap = new Map((fixes || []).map((f) => [f.t, f]));
  const lines = [];
  let pos = 0;
  let speech = false; // セリフの途中か
  let prev = null; // 直前の空行でない行
  for (const raw of (text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    let label = null;
    let name = '';
    const hide = [];
    const gray = [];
    const fx = fixMap.get(line);
    const fixed = !!fx;
    // 字下げの印
    const lead = line.match(/^[ \t]*/)[0].length;
    let body = lead;
    let indMark = null;
    const im = line.slice(lead).match(IND_MARK);
    if (im) { indMark = im[1] === '字下げ'; hide.push([pos + lead, pos + lead + im[0].length]); body = lead + im[0].length; }
    // { } の印
    let braceLabel = null; // 行頭の { }
    for (const m of line.matchAll(GRAY_MARK)) {
      const a = pos + m.index, e = a + m[0].length;
      hide.push([a, a + 1], [e - 1, e]);
      if (m.index === body) braceLabel = { s: a, e, name: m[1] };
      else if (m[1]) gray.push([a + 1, e - 1]);
    }
    if (fx && fx.n != null) {
      const n = Math.min(fx.n || 0, line.length);
      if (n > 0) {
        label = { s: pos + Math.min(Math.max(lead, body), n), e: pos + n };
        name = line.slice(0, n).replace(/[:：\s]+$/, '');
      }
    } else if (braceLabel) {
      if (braceLabel.name.trim()) { label = { s: braceLabel.s, e: braceLabel.e }; name = braceLabel.name.replace(/[:：\s]+$/, ''); }
    } else {
      const rest = line.slice(body);
      let m = rest.match(EN_RE);
      if (!m) {
        m = rest.match(JA_RE);
        // 英語の行がキャラクター名なしなら、その訳の日本語の行もキャラクター名なしとみなす
        if (m && prev && /^[\x00-\x7f]/.test(prev.text.trim()) && !prev.label) m = null;
      }
      if (m && m[2].replace(/[()（）\s{}｛｝]/g, '')) {
        label = { s: pos + body + m[1].length, e: pos + body + m[0].length };
        name = m[2];
      }
    }
    const blank = line.trim() === '';
    if (blank) speech = false;
    else if (indMark != null) speech = indMark;
    else if (label) speech = !NARRATOR_RE.test(name.trim().replace(/[{}｛｝]/g, '').replace(/\s*[(（].*$/, ''));
    const indent = blank ? false : fx && fx.ind != null ? !!fx.ind : speech;
    const L = { start: pos, end: pos + line.length, body: pos + body, label, indent, blank, fixed, hide, gray };
    lines.push(L);
    if (!blank) prev = { text: line, label };
    pos += raw.length + 1;
  }
  return lines;
}

// テーマ活動の友が書き換えられても、タイミングの語句の位置を探し直す
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

// テーマ活動の友を《タイミング》ごとの段に分ける
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
export function lineSegments(text, line, highlights, marks) {
  const cuts = new Set([line.start, line.end]);
  if (line.label) { cuts.add(line.label.s); cuts.add(line.label.e); }
  const hide = line.hide || [];
  const gray = line.gray || [];
  for (const [a, b] of [...hide, ...gray]) { cuts.add(a); cuts.add(b); }
  for (const [a, b] of highlights) {
    if (b <= line.start || a >= line.end) continue;
    cuts.add(Math.max(a, line.start));
    cuts.add(Math.min(b, line.end));
  }
  // 手で付けた色・塗り
  const ms = (marks || []).filter((m) => m.e > line.start && m.s < line.end);
  for (const m of ms) { cuts.add(Math.max(m.s, line.start)); cuts.add(Math.min(m.e, line.end)); }
  const pts = [...cuts].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    if (e <= s) continue;
    if (hide.some(([a, b]) => s >= a && e <= b)) continue; // 印は表示しない
    const isLabel = (line.label && s >= line.label.s && e <= line.label.e) || gray.some(([a, b]) => s >= a && e <= b);
    const hl = highlights.some(([a, b]) => s >= a && e <= b);
    let c = null, bg = null, b = null;
    for (const m of ms) if (s >= m.s && e <= m.e) { if (m.k === 'bg') bg = m.v; else if (m.k === 'b') b = m.v; else c = m.v; }
    segs.push({ s, e, text: text.slice(s, e), label: !!isLabel, hl, c, bg, b });
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

// 取り込み：《タイミング》の語句をテーマ活動の友の中から探す。
// 前のタイミングより前には戻らない。そのままで見つからなければ、記号・空白・大文字小文字の違いは無視して探す。
// 返す text は、テーマ活動の友に実際に書いてある文字（タイミングの位置の目印になる）
const normCh = (c) => c.normalize('NFKC').toLowerCase();
const WORD = /[\p{L}\p{N}]/u;
export function findCue(script, cue, { from = 0, near = 0, end = Infinity } = {}) {
  script = script || '';
  cue = String(cue || '').replace(/\s+/g, ' ').trim();
  if (!cue) return null;
  const pick = (hits) => {
    const ok = hits.filter((h) => h[0] >= from);
    return ok.find((h) => h[0] >= near - 1 && h[0] <= end + 400) || ok[0] || null;
  };
  const exact = [];
  for (let i = script.indexOf(cue); i >= 0; i = script.indexOf(cue, i + 1)) exact.push([i, i + cue.length]);
  let h = pick(exact);
  if (!h) {
    let ns = '';
    const map = [];
    for (let i = 0; i < script.length; i++) {
      const c = normCh(script[i]);
      if (!WORD.test(c)) continue;
      for (const x of c) { ns += x; map.push(i); }
    }
    const nc = [...cue].map(normCh).filter((c) => WORD.test(c)).join('');
    if (nc.length < 2) return null;
    const fz = [];
    for (let k = ns.indexOf(nc); k >= 0; k = ns.indexOf(nc, k + 1)) fz.push([map[k], map[k + nc.length - 1] + 1]);
    h = pick(fz);
  }
  return h ? { i: h[0], text: script.slice(h[0], h[1]) } : null;
}
