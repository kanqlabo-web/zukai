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
function candidates(u, H, on) {
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
    // 頭の数文字だけが長い切れ目の前にあるとき（「There｜is rustling…」）は、その数文字の時刻が外れていることが多いので、切れ目のあとから逆算する。
    // ただし声の出だしが分かっていて、切れ目のあとに新しく声が始まっていなければ（言いかけて間をあけただけ）、そのまま
    if (r) for (let x = r.j; x < Math.min(r.endj, r.j + 7); x++) if (H[x].c === '|') {
      const t1 = H[x + 1].t;
      if (!on || on.some((o) => Math.abs(o - t1) < 0.6)) { r.i += x - r.j; r.j = x + 1; }
      break;
    }
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
  if (heard.lid) return lidUnits(text, heard.lid);
  const units = unitsOf(text);
  const H = { en: heard.en ? heardChars(heard.en, EN) : [], ja: heard.ja ? heardChars(heard.ja, JA) : [] };
  for (const l in H) {
    // 3文字の並び → 聞き取った文字の位置
    const tri = new Map(), cs = H[l];
    for (let j = 0; j + 2 < cs.length; j++) { const g = cs[j].c + cs[j + 1].c + cs[j + 2].c; const a = tri.get(g); if (a) a.push(j); else tri.set(g, [j]); }
    cs.tri = tri;
  }
  units.forEach((u) => { u.cand = H[u.lang].length ? candidates(u, H[u.lang], heard.on) : []; u.dur = u.cs.length * RATE[u.lang]; });
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
  if (heard.on && heard.on.length) snapToOnsets(units, heard.on);
  // 時刻が戻らないように
  for (let ui = 1; ui < units.length; ui++) if (units[ui].t != null && units[ui - 1].t != null && units[ui].t < units[ui - 1].t) units[ui].t = units[ui - 1].t;
  return units;
}

// 文字で見つからなかったまとまりを、声の出だし（onsetsOf で見つけた、間のあとに声が始まる時刻）に寄せる。
// 前後の見つかったまとまりのあいだにある出だしを、テマ友の順に、見積もりにいちばん近いもの（3秒以内）に当てる
function snapToOnsets(units, on) {
  let last = -Infinity, k = 0;
  for (const u of units) {
    if (u.t == null) continue;
    if (u.hit) { last = u.t; continue; }
    let b = units.indexOf(u) + 1; while (b < units.length && !units[b].hit) b++;
    const hi = b < units.length ? units[b].t - 0.3 : Infinity;
    while (k < on.length && on[k] <= last + 0.3) k++;
    let best = null;
    for (let j = k; j < on.length && on[j] < hi; j++) if (Math.abs(on[j] - u.t) <= 3 && (best == null || Math.abs(on[j] - u.t) < Math.abs(on[best] - u.t))) best = j;
    if (best != null) { u.t = on[best]; u.snap = true; k = best + 1; }
    u.t = Math.max(u.t, last);
    last = u.t;
  }
}

// 音声（16kHz・モノラル）から、声の間を探す：まわり3秒の大きめの音より12dB以上小さいところが0.2秒以上続くところ。返す：[[始まり, 終わり]（秒）]
export function pausesOf(audio) {
  const F = 160, n = Math.floor(audio.length / F), db = new Float32Array(n), sm = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < F; k++) { const x = audio[i * F + k]; s += x * x; } db[i] = 10 * Math.log10(s / F + 1e-10); }
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) { s += db[k]; c++; } sm[i] = s / c; }
  const out = [];
  let thr = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i % 50 === 0) { const w = Array.from(sm.subarray(Math.max(0, i - 150), i + 150)).sort((x, y) => x - y); thr = w[Math.floor(w.length * 0.8)] - 12; }
    if (sm[i] < thr) { let j = i; while (j < n && sm[j] < thr) j++; if (j - i >= 20 && j < n) out.push([i / 100, j / 100]); i = j; }
  }
  return out;
}
// 声の出だし（間のあとに声が始まる時刻）
export const onsetsOf = (audio) => pausesOf(audio).map((p) => p[1]);

// 言語を判定する区切り：間と間のあいだ。6秒より長いところは3秒ずつに分ける（途中で英日が切り替わることがあるので）
export function segmentsOf(pauses, len) {
  const out = [];
  const add = (s, e) => {
    if (e - s < 0.3) return;
    if (e - s <= 6) { out.push({ s, e }); return; }
    const k = Math.round((e - s) / 3);
    for (let i = 0; i < k; i++) out.push({ s: s + (e - s) * i / k, e: s + (e - s) * (i + 1) / k, cut: i > 0 });
  };
  let t = 0;
  for (const [a, b] of pauses) { add(t, a); t = b; }
  add(t, len);
  return out;
}

// 言語を判定する区切り（2.48.0〜）：Silero VAD の声らしさ（32ミリ秒ごと）から声のところを取る。
// 0.3 を超えたら始まり、0.2 を下回るところが0.2秒より長く続いたら終わり（音の大きさで決めるより、BGM のあるところでも細かく切れる）。
// 6秒より長いところは segmentsOf と同じく3秒ずつに分ける
export function vadSegments(p) {
  const F = 512 / 16000, runs = [];
  let cur = null;
  p.forEach((v, i) => {
    const t = i * F;
    if (!cur) { if (v >= 0.3) cur = [t, t + F]; }
    else if (v >= 0.2) cur[1] = t + F;
    else if (t - cur[1] > 0.2) { runs.push(cur); cur = null; }
  });
  if (cur) runs.push(cur);
  const r2 = (x) => Math.round(x * 100) / 100, out = [];
  for (const [s, e] of runs) {
    if (e - s < 0.3) continue;
    if (e - s <= 6) { out.push({ s: r2(s), e: r2(e) }); continue; }
    const k = Math.round((e - s) / 3);
    for (let i = 0; i < k; i++) out.push({ s: r2(s + (e - s) * i / k), e: r2(s + (e - s) * (i + 1) / k), cut: i > 0 });
  }
  return out;
}

// 言語の判定だけで合わせる（英日のテマ友用。文字にしない）
// lid：[{ s, e, d }]（d = 英語らしさ − 日本語らしさ。2.5より大きければ英語、-2.5より小さければ日本語（曲や効果音はそのあいだになりやすい）、あいだは分からない）
// テマ友の「同じ言語が続く行のまとまり」と、音声の「同じ言語が続くところ」を、順番どおり・長さが近くなるように対応させ、
// まとまりの最初の行をそこの始まりに、残りの行を文字数の割合で、近い声の出だしに置く
function lidUnits(text, lid) {
  const units = unitsOf(text).filter((u) => u.cs.length >= 2);
  units.forEach((u) => { u.dur = u.cs.length * RATE[u.lang]; });
  const runs = [];
  for (const u of units) { const r = runs[runs.length - 1]; if (r && r.lang === u.lang) { r.units.push(u); r.dur += u.dur; } else runs.push({ lang: u.lang, units: [u], dur: u.dur }); }
  const lab = (d) => (d > 2.5 ? 'en' : d < -2.5 ? 'ja' : '?');
  const blocks = [];
  for (const g of lid) {
    const l = lab(g.d), b = blocks[blocks.length - 1];
    if (b && b.lang === l && g.s - b.e < 1.5) { b.e = g.e; b.segs.push(g); b.sp += g.e - g.s; } else blocks.push({ lang: l, s: g.s, e: g.e, segs: [g], sp: g.e - g.s });
  }
  const totSp = blocks.filter((b) => b.lang !== '?').reduce((a, b) => a + b.sp, 0), totDur = runs.reduce((a, r) => a + r.dur, 0);
  const k = totSp / Math.max(1, totDur); // 読む速さ（文字数からの見積もりに対する実際の長さ）
  const p = runs.length, q = blocks.length, INF = 1e9, SPAN = 4;
  const D = Array.from({ length: p + 1 }, () => new Float64Array(q + 1).fill(INF)), BK = Array.from({ length: p + 1 }, () => new Array(q + 1));
  D[0][0] = 0;
  for (let i = 0; i <= p; i++) for (let j = 0; j <= q; j++) {
    const v = D[i][j];
    if (v >= INF) continue;
    // 音声のところを飛ばす（曲・効果音・テマ友にないところ）
    if (j < q) { const c = v + (blocks[j].lang === '?' ? 0.2 : 1) + 0.1 * blocks[j].sp; if (c < D[i][j + 1]) { D[i][j + 1] = c; BK[i][j + 1] = [i, j, 0]; } }
    // テマ友のまとまりを飛ばす（読まれていない）
    if (i < p) { const c = v + 3 + runs[i].dur * 0.3; if (c < D[i + 1][j]) { D[i + 1][j] = c; BK[i + 1][j] = [i, j, 0]; } }
    // まとまり i を、音声の j から続くいくつかのところに対応させる（言語が違うところはまたがない）
    if (i < p) {
      let sp = 0, conf = 0;
      for (let j2 = j; j2 < Math.min(q, j + SPAN); j2++) {
        const b = blocks[j2];
        if (b.lang !== '?' && b.lang !== runs[i].lang) break;
        sp += b.sp; if (b.lang !== '?') conf++;
        if (!conf) continue;
        const c = v + 2 * Math.abs(Math.log((sp + 0.3) / (runs[i].dur * k + 0.3))) + (j2 - j) * 0.3;
        if (c < D[i + 1][j2 + 1]) { D[i + 1][j2 + 1] = c; BK[i + 1][j2 + 1] = [i, j, 1]; }
      }
    }
  }
  for (let i = p, j = q; i || j;) {
    const [pi, pj, m] = BK[i][j];
    if (m) {
      const r = runs[pi], segs = blocks.slice(pj, j).flatMap((b) => b.segs), s0 = segs[0].s, e0 = segs[segs.length - 1].e;
      let cum = 0;
      for (const u of r.units) {
        const want = s0 + (e0 - s0) * cum / r.dur;
        cum += u.dur;
        let best = s0;
        for (const g of segs) if (!g.cut && Math.abs(g.s - want) < Math.abs(best - want)) best = g.s;
        if (u === r.units[0]) { u.t = s0; u.hit = true; } else u.t = Math.abs(best - want) < 2 ? best : want;
      }
    }
    i = pi; j = pj;
  }
  // 対応しなかったまとまりは前後から
  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui];
    if (u.t != null) continue;
    const A = units.slice(0, ui).reverse().find((x) => x.t != null), B = units.slice(ui + 1).find((x) => x.t != null);
    u.t = A && B ? (A.t + B.t) / 2 : A ? A.t + A.dur : B ? Math.max(0, B.t - u.dur) : null;
  }
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
