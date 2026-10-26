// 音声の聞き取り（audio.js の「時刻を自動で合わせる」用。画面が固まらないように Worker で動かす）
// Whisper（transformers.js）をブラウザの中で動かす。モデルは初回だけ Hugging Face から読み、ブラウザに控えが残る。
// 受け取る：{ audio: Float32Array（16kHz・モノラル）, langs: ['en', 'ja'], model, tjs, local, from（続きから始める30秒の番号）, prev（それまでに聞き取った分） }
// 返す：{ type: 'load', p } 読み込みの進み（0〜1） / { type: 'step', done, of } / { type: 'win', upto, out }（30秒ごと。途中までの分を保存して、止まっても続きから） / { type: 'done', out: { en: [{ text, s, e }], ja: […] } } / { type: 'error', msg }
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/transformers.min.js';
const MODEL = 'Xenova/whisper-base';
const SR = 16000, WIN = 30; // 30秒ずつ（Whisper が一度に聞ける長さ）
let pipe = null;

self.onmessage = async (e) => {
  const { audio, langs, model, tjs, local, from = 0, prev = null } = e.data;
  const post = (m) => self.postMessage(m);
  try {
    const T = await import(tjs || TJS);
    if (local) {
      // 手元の確認用（モデルとランタイムを同じサイトから読む）
      T.env.allowRemoteModels = false;
      T.env.allowLocalModels = true;
      T.env.localModelPath = local.models;
      T.env.backends.onnx.wasm.wasmPaths = local.wasm;
    }
    if (!pipe) {
      const files = {};
      pipe = await T.pipeline('automatic-speech-recognition', model || MODEL, {
        dtype: 'q8', device: 'wasm',
        progress_callback: (p) => {
          if (p.status !== 'progress' || !p.total) return;
          files[p.file] = [p.loaded, p.total];
          const v = Object.values(files);
          post({ type: 'load', p: v.reduce((a, x) => a + x[0], 0) / v.reduce((a, x) => a + x[1], 0) });
        },
      });
    }
    const n = Math.ceil(audio.length / (WIN * SR));
    const out = Object.fromEntries(langs.map((l) => [l, (prev && prev[l]) || []]));
    let done = from * langs.length;
    post({ type: 'step', done, of: n * langs.length });
    for (let i = from; i < n; i++) {
      const seg = audio.subarray(i * WIN * SR, Math.min(audio.length, (i + 1) * WIN * SR));
      const len = seg.length / SR;
      for (const lang of langs) {
        if (len >= 0.5) {
          const r = await pipe(seg, { language: lang, task: 'transcribe', return_timestamps: true });
          for (const c of r.chunks || []) {
            const [s, en] = c.timestamp || [];
            if (s == null) continue;
            out[lang].push({ text: c.text, s: i * WIN + s, e: i * WIN + Math.min(en == null ? len : en, len) });
          }
        }
        post({ type: 'step', done: ++done, of: n * langs.length });
      }
      post({ type: 'win', upto: i + 1, out });
    }
    post({ type: 'done', out });
  } catch (err) {
    post({ type: 'error', msg: String((err && err.message) || err) });
  }
};
