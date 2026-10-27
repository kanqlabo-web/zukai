// 歌や音楽のところの英語を文字にする（audio.js の「時刻を自動で合わせる」で、英日のテマ友のとき。2.52.0〜）
// 英日の判定（lid-worker.js）で、声と判定されなかった長いところ（歌、効果音のかかった叫び、大勢の声など）だけを3秒ずつ聞く。
// Moonshine base（英語専用。int8 で約60MB、MIT）を transformers.js で動かす。Whisper と違って30秒ぶん計算せず、音の長さのぶんだけなので速い。
// 日本語の声は意味のない英語になるが、テマ友の英語と照らし合わせるので目印には混ざらない
// 受け取る：{ batch: [{ s, e, pcm }], cfg（window.ZUKAI_ASR） }
// 返す：{ type: 'load', p } / { type: 'moon', out: [{ s, e, text }] } / { type: 'error', msg }
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/transformers.min.js';
const MODEL = 'onnx-community/moonshine-base-ONNX';
let pipe = null;

async function open(cfg, post) {
  if (pipe) return pipe;
  const T = await import(cfg.tjs || TJS);
  if (cfg.local) {
    // 手元の確認用（モデルとランタイムを同じサイトから読む）
    T.env.allowRemoteModels = false;
    T.env.allowLocalModels = true;
    T.env.localModelPath = cfg.local.models;
    T.env.backends.onnx.wasm.wasmPaths = cfg.local.wasm;
  }
  T.env.backends.onnx.wasm.numThreads = 1; // GitHub Pages では複数スレッドが使えない。そのかわり audio.js が Worker を並べる
  const files = {};
  pipe = await T.pipeline('automatic-speech-recognition', cfg.moonModel || MODEL, {
    dtype: 'q8', device: 'wasm',
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files[p.file] = [p.loaded, p.total];
      const v = Object.values(files);
      post({ type: 'load', p: v.reduce((a, x) => a + x[0], 0) / v.reduce((a, x) => a + x[1], 0) });
    },
  });
  return pipe;
}

self.onmessage = async (e) => {
  const post = (m) => self.postMessage(m);
  const cfg = e.data.cfg || {};
  try {
    const P = await open(cfg, post);
    const out = [];
    for (const g of e.data.batch) {
      // 1秒あたり7語ほどまで（歌の繰り返しで同じ語を言い続けないように）
      const r = await P(g.pcm, { max_new_tokens: Math.ceil((g.e - g.s) * 7) + 2 });
      out.push({ s: g.s, e: g.e, text: ((r && r.text) || '').trim() });
    }
    post({ type: 'moon', out });
  } catch (err) {
    post({ type: 'error', msg: String((err && err.message) || err) });
  }
};
