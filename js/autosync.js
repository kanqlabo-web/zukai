// 時刻を自動で合わせる（audio.js から使う）
// 音声を聞き取った文字（asr-worker.js）とテマ友を1文字ずつ照らし合わせ、テマ友の位置 → 音声の時刻 の対応を作る。
// 英語と日本語が交互に出てくるので、言語ごとに聞き取り、その言語の文字だけで照らし合わせてから合わせる。
const JA = /[぀-ヿ㐀-鿿豈-﫿々〆ー]/;
const EN = /[a-z0-9]/;

function norm(c) {
  c = c.normalize('NFKC').toLowerCase();
  const k = c.charCodeAt(0);
  if (k >= 0x30a1 && k <= 0x30f6) return String.fromCharCode(k - 0x60); // カタカナ → ひらがな
  return c;
}

// テマ友に出てくる言語（文字の1割以上）
export function langsOf(text) {
  let ja = 0, en = 0;
  for (const ch of text || '') { const c = norm(ch); if (JA.test(c)) ja++; else if (EN.test(c)) en++; }
  const all = ja + en;
  const out = [];
  if (en >= 30 && en >= all * 0.1) out.push('en');
  if (ja >= 30 && ja >= all * 0.1) out.push('ja');
  return out.length ? out : [ja > en ? 'ja' : 'en'];
}

// 聞き取った文字。1秒より長い切れ目には「|」を入れる（切れ目をまたいで並べ合わせない）
// 同じ文が何度も続くのは聞き取りの空回り（音楽のところなど）なので、はじめの1つだけ使う
function heardChars(chunks, re) {
  const out = [];
  let last = '';
  for (const ch of chunks) {
    const tx = (ch.text || '').trim();
    if (tx.length > 10 && tx === last) continue;
    last = tx;
    const cs = [...tx].map(norm).filter((c) => re.test(c));
    if (out.length && ch.s - out[out.length - 1].e > 1) out.push({ c: '|', t: ch.s, e: ch.s });
    cs.forEach((c, k) => out.push({ c, t: ch.s + (ch.e - ch.s) * k / Math.max(1, cs.length), e: ch.s + (ch.e - ch.s) * (k + 1) / Math.max(1, cs.length) }));
  }
  return out;
}

const RATE = { en: 0.065, ja: 0.13 }; // 1文字を読むおよその秒
// 行の頭の話し手の名前（「NARRATOR:」「語り:」など。CD では読まれない）
const LABEL = /^[^\S\n]*[^\n:：。、.!?！？]{1,24}[:：][^\S\n]*/;

// テマ友を「同じ言語の文字が続くまとまり」に分ける（行の頭の話し手の名前は除く）
function unitsOf(text) {
  const units = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    const m = LABEL.exec(line);
    let cur = null;
    for (let i = m ? m[0].length : 0; i < line.length; i++) {
      const c = norm(line[i]);
      const lang = JA.test(c) ? 'ja' : EN.test(c) ? 'en' : null;
      if (!lang) continue;
      if (!cur || cur.lang !== lang) { cur = { off: pos + i, lang, cs: [], offs: [] }; units.push(cur); }
      cur.cs.push(c); cur.offs.push(pos + i);
    }
    pos += line.length + 1;
  }
  return units;
}

// まとまりの文字 A と、聞き取った文字 H[lo, hi) を1文字ずつ並べ合わせ、いちばん似ているところを探す（聞き違い・抜け・余分を許す）
// 返す：{ i: A の何文字目から, j: H のどこから, endi, endj, sc: 似ている度合い（0〜1。長い行は頭の cap 文字分で 1）}
function local(A, H, lo, hi, cap) {
  const n = A.length, m = hi - lo;
  let prev = new Float32Array(m + 1), cur = new Float32Array(m + 1);
  const st = new Int32Array((n + 1) * (m + 1)).fill(-1);
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= n; i++) {
    cur[0] = 0;
    for (let j = 1; j <= m; j++) {
      const hc = H[lo + j - 1].c, eq = A[i - 1] === hc, pen = hc === '|' ? 5 : 1;
      const d = prev[j - 1] + (eq ? 2 : -pen), u = prev[j] - 1, l = cur[j - 1] - pen;
      let v = 0, s0 = -1;
      if (d > v) { v = d; s0 = st[(i - 1) * (m + 1) + j - 1]; if (s0 < 0 && eq) s0 = (i - 1) * (m + 1) + j - 1; }
      if (u > v) { v = u; s0 = st[(i - 1) * (m + 1) + j]; }
      if (l > v) { v = l; s0 = st[i * (m + 1) + j - 1]; }
      cur[j] = v; st[i * (m + 1) + j] = v > 0 ? s0 : -1;
      if (v > best) { best = v; bi = i; bj = j; }
    }
    [prev, cur] = [cur, prev];
  }
  const s0 = st[bi * (m + 1) + bj];
  return s0 < 0 ? null : { i: Math.floor(s0 / (m + 1)), j: lo + (s0 % (m + 1)), endi: bi - 1, endj: lo + bj - 1, sc: Math.min(1, best / (2 * Math.min(n, cap))) };
}

// まとまりが読まれていそうなところの候補（3文字の並びが同じところを種にして、そのまわりを並べ合わせる）
function candidates(u, H) {
  const L = Math.min(u.cs.length, 60);
  if (L < 3) return [];
  const A = u.cs.slice(0, L);
  const first = new Map();
  for (let k = 0; k + 2 < L; k++) { const g = A[k] + A[k + 1] + A[k + 2]; if (!first.has(g)) first.set(g, k); }
  // 種の多いところ（3文字の並びがいくつも同じところ）から順に、多くても40か所だけ並べ合わせる
  const votes = new Map();
  for (const [g, k] of first) for (const j of H.tri.get(g) || []) { const b = (j - k) >> 3; votes.set(b, (votes.get(b) || 0) + 1); }
  const out = [];
  for (const [b] of [...votes].sort((x, y) => y[1] - x[1]).slice(0, 40)) {
    const at = b * 8 + 4;
    const r = local(A, H, Math.max(0, at - 14), Math.min(H.length, at + L + 14), u.lang === 'ja' ? 12 : 24);
    if (r && r.sc >= 0.3 && !out.some((o) => o.j === r.j)) {
      out.push({ j: r.j, sc: r.sc, lead: r.i, t: Math.max(0, H[r.j].t - r.i * RATE[u.lang]), end: H[r.endj].e + Math.max(0, u.cs.length - 1 - r.endi) * RATE[u.lang] });
    }
  }
  out.sort((a, b) => b.sc - a.sc);
  const keep = [];
  for (const c of out) { if (keep.length >= 12) break; if (keep.every((k) => Math.abs(k.t - c.t) > 1)) keep.push(c); }
  return keep;
}

// テマ友のまとまりごとに時刻を決める
// 1) まとまりごとに候補を出し、テマ友の順に時刻が戻らない組み合わせで、似ている度合いの合計がいちばん大きいものを選ぶ。
//    同じ言語どうしは前のまとまりを読む時間をあける。違う言語どうしは聞き取りの時刻が粗いので2秒まで戻ってよい
// 2) 見つからなかったまとまりは、前後の見つかったまとまりのあいだに置く（言語の順番は決めつけない）。
//    すぐ前のまとまりが別の言語で、その終わりから次の見つかったまとまりまでが短ければ、その終わりのすぐあと。
//    そうでなければ、前後のあいだを読む長さ（言語ごとの速さ×文字数）の割合で割り振る
function alignUnits(text, heard) {
  const units = unitsOf(text);
  const H = { en: heard.en ? heardChars(heard.en, EN) : [], ja: heard.ja ? heardChars(heard.ja, JA) : [] };
  for (const l in H) {
    // 3文字の並び → 聞き取った文字の位置
    const tri = new Map(), cs = H[l];
    for (let j = 0; j + 2 < cs.length; j++) { const g = cs[j].c + cs[j + 1].c + cs[j + 2].c; const a = tri.get(g); if (a) a.push(j); else tri.set(g, [j]); }
    cs.tri = tri;
  }
  units.forEach((u) => { u.cand = H[u.lang].length ? candidates(u, H[u.lang]) : []; u.dur = u.cs.length * RATE[u.lang]; });
  const states = [];
  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui], add = [];
    for (const c of u.cand) {
      let best = null;
      for (const s of states) if ((units[s.ui].lang === u.lang ? s.ready : s.c.t - 2) <= c.t && (!best || s.v > best.v)) best = s;
      add.push({ ui, c, ready: c.t + u.dur * 0.35, v: (best ? best.v : 0) + c.sc * Math.min(1, u.cs.length / 12), prev: best });
    }
    states.push(...add);
  }
  let top = null;
  for (const s of states) if (!top || s.v > top.v) top = s;
  for (let s = top; s; s = s.prev) Object.assign(units[s.ui], { t: s.c.t, end: s.c.end, hit: true });
  // 行の後ろのほうしか合わなかったまとまり（「…I am most grateful」の grateful だけなど）は、そこから頭を逆算すると
  // 歌や間のあるところで大きくずれるので、始まりは前後から見積もる。逆算した時刻はそれより遅くしない上限にだけ使う
  // 上限は、前の見つかったまとまりより後の候補のうちいちばん早いもの（長い歌詞の途中の語が先に合っていればそこから）
  let lastT = -Infinity;
  for (const u of units) {
    if (!u.hit) continue;
    const c = u.cand.find((x) => x.t === u.t);
    if (c && c.lead > 8) {
      u.ub = Math.min(...u.cand.filter((x) => x.t >= lastT - 2 && x.t <= u.t).map((x) => x.t));
      u.t = null; u.end = null; u.hit = false;
    } else lastT = u.t;
  }
  const span = (from, to) => { let d = 0; for (let k = from; k < to; k++) d += units[k].dur + 0.4; return d; };
  // 上限のあるまとまりを先に置き、それも決まった点として残りを置く
  const fill = (only) => {
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui];
      if (u.t != null || (only && u.ub == null)) continue;
      let a = ui - 1; while (a >= 0 && units[a].t == null) a--;
      let b = ui + 1; while (b < units.length && !units[b].hit && !units[b].fix) b++;
      const A = units[a], B = units[b];
      if (!A && !B) continue;
      if (u.ub == null && A && A.end != null && a === ui - 1 && A.lang !== u.lang && (!B || B.t - A.end <= u.dur * 2 + 3)) { u.t = Math.min(A.end + 0.4, B ? B.t - 0.3 : Infinity); u.t = Math.max(u.t, A.t); continue; }
      if (A && B) u.t = A.t + (B.t - A.t) * span(a, ui) / span(a, b);
      else if (A) u.t = A.t + span(a, ui);
      else u.t = Math.max(0, B.t - span(ui, b));
      if (u.ub != null) { u.t = Math.min(u.t, u.ub); u.fix = true; }
    }
  };
  fill(true);
  fill(false);
  // 時刻が戻らないように
  for (let ui = 1; ui < units.length; ui++) if (units[ui].t != null && units[ui - 1].t != null && units[ui].t < units[ui - 1].t) units[ui].t = units[ui - 1].t;
  return units;
}

// 同じテマ友・同じ聞き取りなら照らし合わせは1回で済ませる（歌詞の表示で何度も呼ばれる）
const memo = new WeakMap();
function unitsFor(text, heard) {
  let m = memo.get(heard);
  if (!m) { m = new Map(); memo.set(heard, m); }
  if (!m.has(text)) { if (m.size > 20) m.clear(); m.set(text, alignUnits(text, heard)); }
  return m.get(text);
}

// heard：{ en: [{ text, s, e }], ja: […] }、offs：タイミングのテマ友の位置
// 返す：{ secs: [秒 または null], found: 文字で見つかった数, points: 見つかったまとまりの数 }
// 文字が多少違っても（聞き違い・抜け・余分）、似ているところを探して当てはめる
export function matchTimes(text, heard, offs) {
  const units = unitsFor(text, heard);
  let found = 0;
  const secs = offs.map((o) => {
    let k = -1;
    for (let i = 0; i < units.length; i++) if (units[i].off <= o) k = i; else break;
    // 位置がまとまりの外（話し手の名前・空白・記号）なら、次のまとまり
    let u = units[k];
    if (!u || u.offs[u.offs.length - 1] < o) u = units[k + 1];
    if (!u || u.t == null) return null;
    if (u.hit) found++;
    const i = Math.max(0, u.offs.findIndex((x) => x >= o));
    return u.t + i * RATE[u.lang];
  });
  return { secs, found, points: units.filter((u) => u.hit).length };
}

// 音声を 16kHz・モノラルにする（Whisper の入力）
// 長い MP3（1話まるごとなど）は、一度に読むとメモリが足りなくなるので、4MB ずつ読んでつなげる（MP3 は途中からでも読める）
async function decode(buf) {
  const ab = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(buf);
  if (ab.numberOfChannels === 1) return ab.getChannelData(0);
  const out = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels; }
  return out;
}
const STEP = 4 * 1024 * 1024;
export async function toMono16k(blob, name = '') {
  const mp3 = /mpeg|mp3/.test(blob.type) || /\.mp3$/i.test(name);
  if (!mp3 || blob.size <= STEP * 3) return decode(await blob.arrayBuffer());
  try {
    const parts = [];
    for (let o = 0; o < blob.size; o += STEP) parts.push(await decode(await blob.slice(o, o + STEP).arrayBuffer()));
    const out = new Float32Array(parts.reduce((a, x) => a + x.length, 0));
    let k = 0;
    for (const x of parts) { out.set(x, k); k += x.length; }
    return out;
  } catch (e) {
    return decode(await blob.arrayBuffer());
  }
}
