// 英日の判定（audio.js の「時刻を自動で合わせる」で、英日のテマ友のとき。2.48.0〜）
// onnxruntime-web（wasm）をブラウザの中で動かす。モデルはアプリのサイトの models/lid/ に置いてあり、初回だけ読んでブラウザ（Cache Storage）に控える。
// - 声のところを探す：Silero VAD（約2MB）。32ミリ秒ごとの声らしさ（0〜1）。歌や音楽のところはほぼ0になる
// - 英語か日本語か：SpeechBrain の VoxLingua107（ECAPA、int8 に変換したもの、約26MB。言語判定専用で、声の長さのぶんだけ計算する）
// 受け取る：{ vad: [{ s, pcm（その30秒の音。頭に前の0.5秒を足してある）, pre（足した秒） }] } または { batch: [{ s, e, cut, pcm }] }、どちらにも cfg（window.ZUKAI_ASR）
// 返す：{ type: 'load', p } / { type: 'vad', out: [{ s, p: [声らしさ…] }] } / { type: 'lid', out: [{ s, e, cut, d }] } / { type: 'error', msg }
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const MODELS = new URL('../models/lid/', import.meta.url).href;
const FILES = { vad: 'silero-vad.onnx', lid: 'lid-ecapa-voxlingua107.int8.onnx' };
const SR = 16000, EN = 20, JA = 45; // EN・JA：VoxLingua107 の出力の並び（models/lid/lid-labels.txt の行、0から）
// d の目盛り：VoxLingua107 の英日の差は Whisper（2.47 まで）の約3倍に出るので、0.3倍して autosync.js の基準（±2.5）に合わせる
const SCALE = 0.3;
let ort = null;
const sess = {};

// モデルを読む（控えがあればそれを。なければ読みながら進み具合を返す）
async function fetchModel(url, post) {
  let cache = null;
  try { cache = await caches.open('zukai-models'); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error('判定のしくみを読み込めませんでした（' + res.status + '）');
  const total = +res.headers.get('content-length') || 0, parts = [];
  let got = 0;
  const rd = res.body.getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (total) post({ type: 'load', p: got / total });
  }
  const buf = new Uint8Array(got);
  let k = 0;
  for (const x of parts) { buf.set(x, k); k += x.length; }
  if (cache) cache.put(url, new Response(buf)).catch(() => {});
  return buf;
}
async function open(kind, cfg, post) {
  if (sess[kind]) return sess[kind];
  if (!ort) {
    ort = await import((cfg.ort || ORT) + 'ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = cfg.ort || ORT;
    ort.env.wasm.numThreads = 1; // GitHub Pages では複数スレッドが使えない。そのかわり audio.js が Worker を並べる
  }
  const buf = await fetchModel((cfg.lidModels || MODELS) + FILES[kind], post);
  sess[kind] = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  return sess[kind];
}

// 声らしさ。30秒ずつ別々に（並べて速くするため）。続きの状態は前の0.5秒を聞かせて作り、その分は捨てる
async function vadBatch(batch, cfg, post) {
  const S = await open('vad', cfg, post), N = 512, CTX = 64;
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SR)]), []);
  const out = [];
  for (const g of batch) {
    let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
    const skip = Math.round(g.pre * SR / N), p = [];
    for (let i = 0, f = 0; i + N <= g.pcm.length; i += N, f++) {
      const x = new Float32Array(CTX + N);
      if (i >= CTX) x.set(g.pcm.subarray(i - CTX, i), 0);
      x.set(g.pcm.subarray(i, i + N), CTX);
      const r = await S.run({ input: new ort.Tensor('float32', x, [1, CTX + N]), state, sr });
      state = r.stateN;
      if (f >= skip) p.push(Math.round(r.output.data[0] * 1000) / 1000);
    }
    out.push({ s: g.s, p });
  }
  post({ type: 'vad', out });
}
async function lidBatch(batch, cfg, post) {
  const S = await open('lid', cfg, post);
  const out = [];
  for (const g of batch) {
    const r = await S.run({ wav: new ort.Tensor('float32', g.pcm, [1, g.pcm.length]) });
    const L = r.logp.data;
    out.push({ s: g.s, e: g.e, cut: g.cut, d: Math.round((L[EN] - L[JA]) * SCALE * 100) / 100 });
  }
  post({ type: 'lid', out });
}
self.onmessage = async (e) => {
  const post = (m) => self.postMessage(m);
  const cfg = e.data.cfg || {};
  try {
    if (e.data.vad) await vadBatch(e.data.vad, cfg, post);
    else await lidBatch(e.data.batch, cfg, post);
  } catch (err) {
    post({ type: 'error', msg: String((err && err.message) || err) });
  }
};
