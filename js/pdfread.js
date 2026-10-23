// PDFから文字と位置を読み取る（外部ライブラリなし）。
// Googleドキュメントなどで書き出した図解PDFを取り込むために使う。
// 返り値：pages = [{ width, height, glyphs: [{ x, y, w, size, text, color: [r,g,b], bold }] }]（y は上から下）

const td = new TextDecoder('latin1');

// ---------- 字句の読み取り ----------
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

class Lexer {
  constructor(bytes, pos = 0) { this.b = bytes; this.p = pos; }
  skip() {
    const b = this.b;
    for (;;) {
      while (this.p < b.length && WS.has(b[this.p])) this.p++;
      if (b[this.p] === 37) { while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p++; continue; }
      break;
    }
  }
  // 値を1つ読む（{ref} / 数 / 名前 / 文字列 / 配列 / 辞書 / 演算子）
  next() {
    this.skip();
    const b = this.b;
    if (this.p >= b.length) return { eof: true };
    const c = b[this.p];
    if (c === 47) { // /Name
      let s = '';
      this.p++;
      while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) {
        if (b[this.p] === 35) { s += String.fromCharCode(parseInt(td.decode(b.subarray(this.p + 1, this.p + 3)), 16)); this.p += 3; } else s += String.fromCharCode(b[this.p++]);
      }
      return { name: s };
    }
    if (c === 40) return { str: this.litString() };
    if (c === 60) {
      if (b[this.p + 1] === 60) { this.p += 2; return { dictStart: true }; }
      return { str: this.hexString() };
    }
    if (c === 62 && b[this.p + 1] === 62) { this.p += 2; return { dictEnd: true }; }
    if (c === 91) { this.p++; return { arrStart: true }; }
    if (c === 93) { this.p++; return { arrEnd: true }; }
    if (c === 123 || c === 125) { this.p++; return { op: String.fromCharCode(c) }; }
    let s = '';
    while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) s += String.fromCharCode(b[this.p++]);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { num: parseFloat(s) };
    if (!s) { this.p++; return { op: '?' }; }
    return { op: s };
  }
  litString() {
    const b = this.b;
    this.p++;
    const out = [];
    let depth = 1;
    while (this.p < b.length) {
      const c = b[this.p++];
      if (c === 92) {
        const n = b[this.p++];
        const map = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
        if (n in map) out.push(map[n]);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k++) v = v * 8 + (b[this.p++] - 48);
          out.push(v & 255);
        } else if (n === 13) { if (b[this.p] === 10) this.p++; } else if (n !== 10) out.push(n);
      } else if (c === 40) { depth++; out.push(c); } else if (c === 41) { if (--depth === 0) break; out.push(c); } else out.push(c);
    }
    return Uint8Array.from(out);
  }
  hexString() {
    const b = this.b;
    this.p++;
    let s = '';
    while (this.p < b.length && b[this.p] !== 62) { const ch = String.fromCharCode(b[this.p++]); if (/[0-9a-fA-F]/.test(ch)) s += ch; }
    this.p++;
    if (s.length % 2) s += '0';
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
}

// トークンから値を組み立てる
function readValue(lx, tok) {
  tok = tok || lx.next();
  if (tok.arrStart) {
    const arr = [];
    for (;;) {
      const t = lx.next();
      if (t.arrEnd || t.eof) break;
      arr.push(readValue(lx, t));
      fixRef(arr);
    }
    return arr;
  }
  if (tok.dictStart) {
    const d = {};
    for (;;) {
      const k = lx.next();
      if (k.dictEnd || k.eof) break;
      if (!k.name) continue;
      const vals = [readValue(lx)];
      // 「1 0 R」
      const save = lx.p;
      const t2 = lx.next();
      if (typeof vals[0] === 'number' && t2.num != null) {
        const save2 = lx.p;
        const t3 = lx.next();
        if (t3.op === 'R') { d[k.name] = { ref: vals[0] }; continue; }
        lx.p = save2;
      }
      lx.p = save;
      d[k.name] = vals[0];
    }
    return d;
  }
  if (tok.num != null) return tok.num;
  if (tok.name != null) return { n: tok.name };
  if (tok.str) return { s: tok.str };
  if (tok.op === 'true') return true;
  if (tok.op === 'false') return false;
  if (tok.op === 'null') return null;
  return { op: tok.op };
}
// 配列の中の「n g R」を参照にまとめる
function fixRef(arr) {
  const n = arr.length;
  if (n >= 3 && arr[n - 1] && arr[n - 1].op === 'R' && typeof arr[n - 2] === 'number' && typeof arr[n - 3] === 'number') {
    arr.splice(n - 3, 3, { ref: arr[n - 3] });
  }
}

// ---------- 圧縮の展開 ----------
async function inflate(bytes) {
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const ds = new DecompressionStream(fmt);
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(out);
    } catch (e) { /* 次の形式を試す */ }
  }
  // 末尾が壊れている場合など：少しずつ読んで、読めたところまで使う
  try {
    const ds = new DecompressionStream('deflate');
    const w = ds.writable.getWriter();
    w.write(bytes).catch(() => {}); w.close().catch(() => {});
    const r = ds.readable.getReader();
    const chunks = [];
    for (;;) { let x; try { x = await r.read(); } catch (e) { break; } if (x.done) break; chunks.push(x.value); }
    const len = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(len); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  } catch (e) { return new Uint8Array(0); }
}

// ---------- PDF全体 ----------
class Doc {
  constructor(bytes) {
    this.b = bytes;
    this.offsets = new Map();
    this.cache = new Map();
    // 「n g obj」を全部探す（相互参照表に頼らない）
    const s = td.decode(bytes);
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) this.offsets.set(+m[1], m.index + m[0].length);
  }
  async obj(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    const off = this.offsets.get(num);
    if (off == null) { const v = await this.fromObjStm(num); this.cache.set(num, v); return v; }
    const lx = new Lexer(this.b, off);
    const v = readValue(lx);
    let out = v;
    // 「stream」
    lx.skip();
    const save = lx.p;
    const t = lx.next();
    if (t.op === 'stream' && v && typeof v === 'object' && !Array.isArray(v)) {
      let p = lx.p;
      if (this.b[p] === 13) p++;
      if (this.b[p] === 10) p++;
      let len = v.Length;
      if (len && len.ref != null) len = await this.obj(len.ref);
      let end = typeof len === 'number' ? p + len : -1;
      if (end < 0 || end > this.b.length) {
        const s = td.decode(this.b.subarray(p, Math.min(this.b.length, p + 50000000)));
        end = p + s.indexOf('endstream');
      }
      out = { dict: v, raw: this.b.subarray(p, end) };
    } else lx.p = save;
    this.cache.set(num, out);
    return out;
  }
  async get(v) { return v && v.ref != null ? this.obj(v.ref) : v; }
  async data(stream) {
    if (!stream || !stream.raw) return new Uint8Array(0);
    let f = await this.get(stream.dict.Filter);
    f = Array.isArray(f) ? f : f ? [f] : [];
    let d = stream.raw;
    for (const x of f) {
      const n = x.n || x;
      if (n === 'FlateDecode' || n === 'Fl') d = await inflate(d);
      else if (n === 'DCTDecode') return d;
      else return new Uint8Array(0);
    }
    return d;
  }
  // オブジェクトストリームの中のオブジェクト
  async fromObjStm(num) {
    if (!this.objStms) {
      this.objStms = new Map();
      for (const [n] of this.offsets) {
        const o = await this.obj(n).catch(() => null);
        if (!o || !o.dict || !o.dict.Type || o.dict.Type.n !== 'ObjStm') continue;
        const data = await this.data(o);
        const N = o.dict.N, first = o.dict.First;
        const lx = new Lexer(data, 0);
        const pairs = [];
        for (let i = 0; i < N; i++) { const a = lx.next().num, b = lx.next().num; pairs.push([a, b]); }
        for (const [on, ooff] of pairs) this.objStms.set(on, readValue(new Lexer(data, first + ooff)));
      }
    }
    return this.objStms.has(num) ? this.objStms.get(num) : null;
  }
  async catalog() {
    for (const [n] of this.offsets) {
      const o = await this.obj(n).catch(() => null);
      if (o && !o.raw && o.Type && o.Type.n === 'Catalog') return o;
    }
    await this.fromObjStm(-1);
    for (const [, o] of this.objStms) if (o && o.Type && o.Type.n === 'Catalog') return o;
    return null;
  }
  async pages() {
    const cat = await this.catalog();
    const out = [];
    const walk = async (node, inherit) => {
      node = await this.get(node);
      if (!node) return;
      const inh = { ...inherit };
      for (const k of ['Resources', 'MediaBox']) if (node[k]) inh[k] = node[k];
      if (node.Type && node.Type.n === 'Pages') { for (const kid of (await this.get(node.Kids)) || []) await walk(kid, inh); } else out.push({ node, inherit: inh });
    };
    if (cat) await walk(cat.Pages, {});
    return out;
  }
}

// ---------- フォント ----------
async function parseCMap(doc, stream) {
  const map = new Map();
  let bytes = 1;
  if (!stream) return { map, bytes: 2 };
  const data = td.decode(await doc.data(await doc.get(stream)));
  const hex = (s) => s.replace(/[<>\s]/g, '');
  const uni = (h) => {
    let s = '';
    for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.substr(i, 4), 16));
    return s;
  };
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(data);
  if (cs) { const m = /<([0-9a-fA-F]+)>/.exec(cs[1]); if (m) bytes = m[1].length / 2; }
  for (const blk of data.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const m of blk.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), uni(hex(m[2])));
  }
  for (const blk of data.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const m of blk.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
      if (m[3][0] === '[') {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]);
        for (let c = a; c <= b; c++) map.set(c, uni(items[c - a] || ''));
      } else {
        const base = hex(m[3]);
        const head = base.slice(0, -4), last = parseInt(base.slice(-4), 16);
        for (let c = a; c <= b; c++) map.set(c, uni(head + (last + c - a).toString(16).padStart(4, '0')));
      }
    }
  }
  return { map, bytes };
}

async function loadFont(doc, ref) {
  const f = await doc.get(ref);
  if (!f) return null;
  if (f._font) return f._font;
  const sub = f.Subtype && f.Subtype.n;
  const tu = await parseCMap(doc, f.ToUnicode);
  const font = { sub, map: tu.map, bytes: sub === 'Type0' ? 2 : 1, widths: new Map(), dw: 1000, scale: 0.001, bold: false };
  const baseName = (f.BaseFont && f.BaseFont.n) || (f.Name && f.Name.n) || '';
  font.bold = /Bold|Heavy|Black|W[6-9]/i.test(baseName);
  if (sub === 'Type0') {
    const desc = await doc.get(((await doc.get(f.DescendantFonts)) || [])[0]);
    if (desc) {
      if (desc.DW != null) font.dw = desc.DW;
      const W = (await doc.get(desc.W)) || [];
      for (let i = 0; i < W.length;) {
        const a = W[i];
        const nxt = await doc.get(W[i + 1]);
        if (Array.isArray(nxt)) { nxt.forEach((w, k) => font.widths.set(a + k, w)); i += 2; } else { const b = nxt, w = W[i + 2]; for (let c = a; c <= b; c++) font.widths.set(c, w); i += 3; }
      }
      const fd = await doc.get(desc.FontDescriptor);
      if (fd && fd.FontName && /Bold/i.test(fd.FontName.n)) font.bold = true;
    }
  } else {
    const first = f.FirstChar || 0;
    const ws = (await doc.get(f.Widths)) || [];
    ws.forEach((w, k) => font.widths.set(first + k, w));
    if (sub === 'Type3') {
      const fm = (await doc.get(f.FontMatrix)) || [0.001];
      font.scale = fm[0];
    }
    if (!tu.map.size) {
      // ToUnicode がない単純なフォント：そのまま文字として読む
      for (let c = 32; c < 256; c++) font.map.set(c, String.fromCharCode(c));
    }
  }
  f._font = font;
  return font;
}

// ---------- ページの中身を読む ----------
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

// 図形（線・塗り）の記録。図を写真として取り込むときに、同じように描き直すため
let SEQ = 0;
let PATHS = [];

async function runContent(doc, data, resources, ctm0, out, depth = 0, figs = []) {
  const res = (await doc.get(resources)) || {};
  const fonts = (await doc.get(res.Font)) || {};
  const xobjs = (await doc.get(res.XObject)) || {};
  const lx = new Lexer(data, 0);
  const st = [];
  let gs = { ctm: ctm0, fill: [0, 0, 0], stroke: [0, 0, 0], lw: 1, dash: [], fa: 1, sa: 1 };
  const egs = (await doc.get(res.ExtGState)) || {};
  let path = [];
  let cp = [0, 0], sp = [0, 0];
  const tp = (x, y) => [x * gs.ctm[0] + y * gs.ctm[2] + gs.ctm[4], x * gs.ctm[1] + y * gs.ctm[3] + gs.ctm[5]];
  const scl = () => Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) || 1;
  const paint = (fill, stroke, eo) => { if (path.length && (fill || stroke)) PATHS.push({ seq: SEQ++, path, fill, stroke, eo, fa: gs.fa, sa: gs.sa, fc: gs.fill.slice(), sc: gs.stroke.slice(), lw: gs.lw * scl(), dash: (gs.dash || []).map((d) => d * scl()) }); path = []; };
  const color = (A) => (A.length >= 4 ? [1 - Math.min(1, A[0] + A[3]), 1 - Math.min(1, A[1] + A[3]), 1 - Math.min(1, A[2] + A[3])] : A.length >= 3 ? A.slice(0, 3) : [A[0], A[0], A[0]]);
  let ts = { font: null, size: 0, tm: [1, 0, 0, 1, 0, 0], lm: [1, 0, 0, 1, 0, 0], tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  let args = [];
  const show = (bytesStr) => {
    const f = ts.font;
    if (!f) return;
    const b = bytesStr;
    for (let i = 0; i < b.length;) {
      let code = 0;
      for (let k = 0; k < f.bytes && i < b.length; k++) code = (code << 8) | b[i++];
      const w = (f.widths.has(code) ? f.widths.get(code) : f.dw) * f.scale;
      const text = f.map.get(code) ?? '';
      const m = mul(mul([ts.size * ts.th, 0, 0, ts.size, 0, ts.rise], ts.tm), gs.ctm);
      const size = Math.hypot(m[2], m[3]);
      const adv = w * ts.size + ts.tc + (code === 32 && f.bytes === 1 ? ts.tw : 0);
      if (text && text !== '\u0000') out.push({ x: m[4], y: m[5], w: w * size, size, text, color: gs.fill.slice(), bold: f.bold, seq: SEQ++ });
      ts.tm = mul([1, 0, 0, 1, adv * ts.th, 0], ts.tm);
    }
  };
  for (;;) {
    const t = lx.next();
    if (t.eof) break;
    if (t.op == null || t.op === '{' || t.op === '}') {
      lx.p = lx.p; // 値として読み直す
      if (t.arrStart || t.dictStart) args.push(readValue(lx, t));
      else if (t.num != null) args.push(t.num);
      else if (t.name != null) args.push({ n: t.name });
      else if (t.str) args.push({ s: t.str });
      continue;
    }
    const op = t.op;
    const A = args;
    args = [];
    switch (op) {
      case 'q': st.push({ gs: { ...gs, fill: gs.fill.slice(), stroke: gs.stroke.slice() } }); break;
      case 'Q': if (st.length) gs = st.pop().gs; break;
      case 'cm': gs.ctm = mul(A.slice(0, 6), gs.ctm); break;
      case 'BT': ts.tm = [1, 0, 0, 1, 0, 0]; ts.lm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': ts.font = await loadFont(doc, fonts[A[0] && A[0].n]); ts.size = A[1]; break;
      case 'Tm': ts.tm = A.slice(0, 6); ts.lm = A.slice(0, 6); break;
      case 'Td': ts.lm = mul([1, 0, 0, 1, A[0], A[1]], ts.lm); ts.tm = ts.lm.slice(); break;
      case 'TD': ts.tl = -A[1]; ts.lm = mul([1, 0, 0, 1, A[0], A[1]], ts.lm); ts.tm = ts.lm.slice(); break;
      case 'T*': ts.lm = mul([1, 0, 0, 1, 0, -ts.tl], ts.lm); ts.tm = ts.lm.slice(); break;
      case 'TL': ts.tl = A[0]; break;
      case 'Tc': ts.tc = A[0]; break;
      case 'Tw': ts.tw = A[0]; break;
      case 'Tz': ts.th = A[0] / 100; break;
      case 'Ts': ts.rise = A[0]; break;
      case 'Tj': if (A[0] && A[0].s) show(A[0].s); break;
      case "'": ts.lm = mul([1, 0, 0, 1, 0, -ts.tl], ts.lm); ts.tm = ts.lm.slice(); if (A[0] && A[0].s) show(A[0].s); break;
      case '"': ts.tw = A[0]; ts.tc = A[1]; ts.lm = mul([1, 0, 0, 1, 0, -ts.tl], ts.lm); ts.tm = ts.lm.slice(); if (A[2] && A[2].s) show(A[2].s); break;
      case 'TJ':
        for (const x of A[0] || []) {
          if (typeof x === 'number') ts.tm = mul([1, 0, 0, 1, (-x / 1000) * ts.size * ts.th, 0], ts.tm);
          else if (x && x.s) show(x.s);
        }
        break;
      case 'g': gs.fill = [A[0], A[0], A[0]]; break;
      case 'G': gs.stroke = [A[0], A[0], A[0]]; break;
      case 'RG': gs.stroke = A.slice(0, 3); break;
      case 'K': gs.stroke = color(A); break;
      case 'SC': case 'SCN': if (A.every((v) => typeof v === 'number') && A.length) gs.stroke = color(A); break;
      case 'w': gs.lw = A[0]; break;
      case 'gs': {
        // 透明度（塗りの ca・線の CA）
        const e = await doc.get(egs[A[0] && A[0].n]);
        if (e && typeof e.ca === 'number') gs.fa = e.ca;
        if (e && typeof e.CA === 'number') gs.sa = e.CA;
        break;
      }
      case 'd': gs.dash = Array.isArray(A[0]) ? A[0] : []; break;
      case 'm': cp = sp = [A[0], A[1]]; path.push(['M', ...tp(A[0], A[1])]); break;
      case 'l': cp = [A[0], A[1]]; path.push(['L', ...tp(A[0], A[1])]); break;
      case 'c': path.push(['C', ...tp(A[0], A[1]), ...tp(A[2], A[3]), ...tp(A[4], A[5])]); cp = [A[4], A[5]]; break;
      case 'v': path.push(['C', ...tp(cp[0], cp[1]), ...tp(A[0], A[1]), ...tp(A[2], A[3])]); cp = [A[2], A[3]]; break;
      case 'y': path.push(['C', ...tp(A[0], A[1]), ...tp(A[2], A[3]), ...tp(A[2], A[3])]); cp = [A[2], A[3]]; break;
      case 'h': path.push(['Z']); cp = sp; break;
      case 're': {
        const [x, y, w2, h2] = A;
        path.push(['M', ...tp(x, y)], ['L', ...tp(x + w2, y)], ['L', ...tp(x + w2, y + h2)], ['L', ...tp(x, y + h2)], ['Z']);
        cp = sp = [x, y];
        break;
      }
      case 'S': paint(false, true); break;
      case 's': path.push(['Z']); paint(false, true); break;
      case 'f': case 'F': paint(true, false); break;
      case 'f*': paint(true, false, true); break;
      case 'B': paint(true, true); break;
      case 'B*': paint(true, true, true); break;
      case 'b': path.push(['Z']); paint(true, true); break;
      case 'b*': path.push(['Z']); paint(true, true, true); break;
      case 'n': path = []; break;
      case 'rg': gs.fill = A.slice(0, 3); break;
      case 'k': gs.fill = color(A); break;
      case 'sc': case 'scn': if (A.length && A.every((v) => typeof v === 'number')) gs.fill = color(A); break;
      case 'Do': {
        if (depth > 6) break;
        const xo = await doc.get(xobjs[A[0] && A[0].n]);
        const box = (pts) => {
          const xs = pts.map(([x, y]) => x * gs.ctm[0] + y * gs.ctm[2] + gs.ctm[4]);
          const ys = pts.map(([x, y]) => x * gs.ctm[1] + y * gs.ctm[3] + gs.ctm[5]);
          return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
        };
        if (xo && xo.dict && xo.dict.Subtype && xo.dict.Subtype.n === 'Form') {
          const mtx = (await doc.get(xo.dict.Matrix)) || [1, 0, 0, 1, 0, 0];
          const bb = (await doc.get(xo.dict.BBox)) || [0, 0, 0, 0];
          const m2 = mul(mtx, gs.ctm);
          const save = gs.ctm; gs.ctm = m2;
          figs.push({ kind: 'form', ...box([[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) });
          gs.ctm = save;
          await runContent(doc, await doc.data(xo), xo.dict.Resources || resources, m2, out, depth + 1, figs);
        } else if (xo && xo.dict && xo.dict.Subtype && xo.dict.Subtype.n === 'Image') {
          figs.push({ kind: 'image', ...box([[0, 0], [1, 0], [0, 1], [1, 1]]), load: () => imageBlob(doc, xo), seq: SEQ++ });
        }
        break;
      }
      case 'BI': { // 埋め込み画像は飛ばす
        const s = td.decode(data.subarray(lx.p, Math.min(data.length, lx.p + 10000000)));
        const e = s.search(/\sEI(\s|$)/);
        lx.p += e < 0 ? s.length : e + 3;
        break;
      }
      default: break;
    }
  }
}

// ---------- 画像を取り出す（ブラウザ用） ----------
function unpredict(data, cols, colors, bpc, pred) {
  if (!pred || pred < 10) return data;
  const bpp = Math.max(1, (colors * bpc) >> 3), rowLen = Math.ceil((cols * colors * bpc) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)], src = r * (rowLen + 1) + 1, dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = r ? out[dst - rowLen + i] : 0, c = r && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v = data[src + i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + i] = v & 255;
    }
  }
  return out;
}
async function rawPixels(doc, xo) {
  const d = xo.dict;
  const W = d.Width, H = d.Height, bpc = d.BitsPerComponent || 8;
  let cs = await doc.get(d.ColorSpace);
  let n = 3;
  if (cs && cs.n === 'DeviceGray') n = 1;
  else if (cs && cs.n === 'DeviceCMYK') n = 4;
  else if (Array.isArray(cs) && cs[0] && cs[0].n === 'ICCBased') { const st = await doc.get(cs[1]); n = (st && st.dict && st.dict.N) || 3; }
  else if (Array.isArray(cs)) return null; // 色の一覧を使う画像などは読まない
  if (bpc !== 8) return null;
  const parms = (await doc.get(d.DecodeParms)) || {};
  const data = unpredict(await doc.data(xo), W, n, bpc, (Array.isArray(parms) ? parms[0] : parms || {}).Predictor);
  return { W, H, n, data };
}
async function imageBlob(doc, xo) {
  let f = await doc.get(xo.dict.Filter);
  f = Array.isArray(f) ? f.map((x) => x.n) : f ? [f.n] : [];
  if (f[f.length - 1] === 'DCTDecode') {
    const bytes = f.length > 1 ? await doc.data({ dict: { ...xo.dict, Filter: { n: f[0] } }, raw: xo.raw }) : xo.raw;
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  if (typeof document === 'undefined') return null;
  const px = await rawPixels(doc, xo);
  if (!px) return null;
  const mask = xo.dict.SMask ? await rawPixels(doc, await doc.get(xo.dict.SMask)).catch(() => null) : null;
  const cv = document.createElement('canvas');
  cv.width = px.W; cv.height = px.H;
  const ctx = cv.getContext('2d');
  const im = ctx.createImageData(px.W, px.H);
  for (let i = 0, j = 0; i < px.W * px.H; i++, j += px.n) {
    let r, g, b;
    if (px.n === 1) r = g = b = px.data[j];
    else if (px.n === 4) { const k = px.data[j + 3]; r = 255 - Math.min(255, px.data[j] + k); g = 255 - Math.min(255, px.data[j + 1] + k); b = 255 - Math.min(255, px.data[j + 2] + k); }
    else { r = px.data[j]; g = px.data[j + 1]; b = px.data[j + 2]; }
    const a = mask && mask.n === 1 ? mask.data[i] / 255 : 1;
    im.data[i * 4] = r * a + 255 * (1 - a); im.data[i * 4 + 1] = g * a + 255 * (1 - a); im.data[i * 4 + 2] = b * a + 255 * (1 - a); im.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return new Promise((r) => cv.toBlob(r, 'image/png'));
}

// ページの一部（図のまわり）を、画像・図形・文字を重ねて描き直す（ブラウザ用）
export async function renderRegion(page, f, k = 4) {
  if (typeof document === 'undefined') return null;
  const pad = 4;
  const r = { x0: f.x0 - pad, y0: f.y0 - pad, x1: f.x1 + pad, y1: f.y1 + pad };
  const hit = (a) => a.x1 >= r.x0 && a.x0 <= r.x1 && a.y1 >= r.y0 && a.y0 <= r.y1;
  const items = [
    ...page.figs.filter((x) => x.kind === 'image' && hit(x)).map((x) => ({ t: 'img', seq: x.seq, x })),
    ...page.paths.filter((x) => hit(x) && (x.x1 - x.x0) < (r.x1 - r.x0) * 1.5).map((x) => ({ t: 'path', seq: x.seq, x })),
    ...page.glyphs.filter((g) => g.x >= r.x0 && g.x <= r.x1 && g.y >= r.y0 && g.y <= r.y1 + 2).map((g) => ({ t: 'text', seq: g.seq, x: g })),
  ].sort((a, b) => a.seq - b.seq);
  const cv = document.createElement('canvas');
  cv.width = Math.round((r.x1 - r.x0) * k);
  cv.height = Math.round((r.y1 - r.y0) * k);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(k, 0, 0, k, -r.x0 * k, -r.y0 * k);
  const rgb = (c) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})`;
  for (const it of items) {
    const x = it.x;
    if (it.t === 'img') {
      const blob = await x.load().catch(() => null);
      if (!blob) continue;
      const bmp = await createImageBitmap(blob).catch(() => null);
      if (bmp) ctx.drawImage(bmp, x.x0, x.y0, x.x1 - x.x0, x.y1 - x.y0);
    } else if (it.t === 'path') {
      const p = new Path2D();
      for (const c of x.path) {
        if (c[0] === 'M') p.moveTo(c[1], c[2]);
        else if (c[0] === 'L') p.lineTo(c[1], c[2]);
        else if (c[0] === 'C') p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
        else p.closePath();
      }
      if (x.fill && (x.fa ?? 1) > 0.01) { ctx.globalAlpha = x.fa ?? 1; ctx.fillStyle = rgb(x.fc); ctx.fill(p, x.eo ? 'evenodd' : 'nonzero'); ctx.globalAlpha = 1; }
      if (x.stroke && (x.sa ?? 1) > 0.01) { ctx.strokeStyle = rgb(x.sc); ctx.lineWidth = Math.max(0.3, x.lw); ctx.setLineDash(x.dash || []); ctx.stroke(p); ctx.setLineDash([]); }
    } else {
      ctx.fillStyle = rgb(x.color);
      ctx.font = `${x.bold ? 'bold ' : ''}${x.size}px Arial, "Noto Sans JP", sans-serif`;
      ctx.fillText(x.text, x.x, x.y);
    }
  }
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

export async function readPdf(bytes, onProgress) {
  const doc = new Doc(bytes);
  const list = await doc.pages();
  const pages = [];
  for (let i = 0; i < list.length; i++) {
    const { node, inherit } = list[i];
    const box = (await doc.get(inherit.MediaBox)) || [0, 0, 595, 842];
    const H = box[3] - box[1], W = box[2] - box[0];
    let contents = await doc.get(node.Contents);
    contents = Array.isArray(contents) ? contents : contents ? [contents] : [];
    const parts = [];
    for (const c of contents) parts.push(await doc.data(await doc.get(c)));
    const len = parts.reduce((a, p) => a + p.length + 1, 0);
    const data = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { data.set(p, o); o += p.length; data[o++] = 10; }
    const glyphs = [];
    const figs = [];
    SEQ = 0;
    PATHS = [];
    await runContent(doc, data, inherit.Resources, [1, 0, 0, 1, -box[0], -box[1]], glyphs, 0, figs);
    for (const g of glyphs) g.y = H - g.y; // 上から下へ
    // 図（画像・図形のまとまり）の範囲。上から下の座標にする
    const boxes = figs.map((f) => ({ kind: f.kind, load: f.load, seq: f.seq, x0: f.x0, x1: f.x1, y0: H - f.y1, y1: H - f.y0 }));
    // 図形も上から下の座標にして、範囲を付ける
    const paths = PATHS.map((p) => {
      const path = p.path.map((c) => c.map((v, k) => (k === 0 ? v : k % 2 === 0 ? H - v : v)));
      const xs = [], ys = [];
      for (const c of path) for (let k = 1; k < c.length; k += 2) { xs.push(c[k]); ys.push(c[k + 1]); }
      return { ...p, path, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }).filter((p) => isFinite(p.x0));
    const page = { width: W, height: H, glyphs, figs: boxes, paths };
    for (const f of boxes) if (f.kind === 'image') f.render = () => renderRegion(page, f);
    pages.push(page);
    if (onProgress) onProgress(i + 1, list.length);
  }
  return pages;
}
