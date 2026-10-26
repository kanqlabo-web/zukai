// 時刻を自動で合わせる（audio.js から使う）
// 音声を聞き取った文字（asr-worker.js）とテマ友を1文字ずつ照らし合わせ、テマ友の位置 → 音声の時刻 の対応を作る。
// 英語と日本語が交互に出てくるので、言語ごとに聞き取り、その言語の文字だけで照らし合わせてから合わせる。
const JA = /[぀-ヿ㐀-鿿豈-﫿々〆ー]/;
const EN = /[a-z0-9]/;
const classOf = (lang) => (lang === 'ja' ? JA : EN);

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

function scriptChars(text, re) {
  const out = [];
  for (let i = 0; i < text.length; i++) { const c = norm(text[i]); if (re.test(c)) out.push({ c, off: i }); }
  return out;
}
function heardChars(chunks, re) {
  const out = [];
  for (const ch of chunks) {
    const cs = [...(ch.text || '')].map(norm).filter((c) => re.test(c));
    cs.forEach((c, k) => out.push({ c, t: ch.s + (ch.e - ch.s) * k / Math.max(1, cs.length) }));
  }
  return out;
}

// 同じ文字の並び（英語は6文字、日本語は4文字）が、テマ友と聞き取った文字の両方にあるところを対応の候補にする。
// 聞き取りには、もう一方の言語を訳した文や聞き違いがたくさん混ざるので、全体を並べ合わせるより、この方が崩れにくい。
// テマ友の中で何度も出てくる並び（4回以上）は、どこのことか決められないので使わない
export function gramPoints(A, B, k) {
  if (A.length < k || B.length < k) return [];
  const at = new Map();
  for (let i = 0; i + k <= A.length; i++) {
    let g = ''; for (let x = 0; x < k; x++) g += A[i + x].c;
    const l = at.get(g);
    if (l) l.push(i); else at.set(g, [i]);
  }
  const out = [];
  for (let j = 0; j + k <= B.length; j++) {
    let g = ''; for (let x = 0; x < k; x++) g += B[j + x].c;
    const l = at.get(g);
    if (!l || l.length > 3) continue;
    for (const i of l) out.push({ off: A[i].off, t: B[j].t });
  }
  return out;
}

// 時刻が後戻りしない点だけを残す（いちばん長い増える並び。同じ位置からは1つだけ）
function monotone(points) {
  points.sort((a, b) => a.off - b.off || b.t - a.t);
  const tails = [], prevIx = new Int32Array(points.length), tailIx = [];
  points.forEach((p, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < p.t) lo = mid + 1; else hi = mid; }
    tails[lo] = p.t; tailIx[lo] = i; prevIx[i] = lo ? tailIx[lo - 1] : -1;
  });
  const out = [];
  for (let i = tailIx[tails.length - 1]; i != null && i >= 0; i = prevIx[i]) out.push(points[i]);
  return out.reverse();
}

// heard：{ en: [{ text, s, e }], ja: […] }、offs：タイミングのテマ友の位置
// 返す：{ secs: [秒 または null], found: 文字で見つかった数, points: 対応の数 }
export function matchTimes(text, heard, offs) {
  let points = [];
  for (const lang in heard) {
    const re = classOf(lang);
    points = points.concat(gramPoints(scriptChars(text, re), heardChars(heard[lang], re), lang === 'ja' ? 4 : 6));
  }
  points = monotone(points);
  if (points.length < 2) return { secs: offs.map(() => null), found: 0, points: points.length };
  const first = points[0], last = points[points.length - 1];
  const rate = (last.t - first.t) / Math.max(1, last.off - first.off); // 1文字あたりの秒（両端の外側用）
  let found = 0;
  const secs = offs.map((o) => {
    let k = 0;
    while (k < points.length && points[k].off < o) k++;
    const p1 = points[k], p0 = points[k - 1];
    if (p1 && p1.off - o <= 4) { found++; return p1.t; }
    if (p0 && p1) return p0.t + (p1.t - p0.t) * (o - p0.off) / (p1.off - p0.off);
    if (p1) return Math.max(0, p1.t - (p1.off - o) * rate);
    return p0.t + (o - p0.off) * rate;
  });
  return { secs, found, points: points.length };
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
