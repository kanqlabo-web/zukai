// 音声の聞き取り（audio.js の「時刻を自動で合わせる」用。画面が固まらないように Worker で動かす）
// Whisper（transformers.js、2.45.0〜 small）をブラウザの中で動かす。モデルは初回だけ Hugging Face から読み、ブラウザに控えが残る。
// 受け取る：{ audio: Float32Array（16kHz・モノラル）, langs: ['en', 'ja'], model, tjs, local, from（続きから始める30秒の番号）, prev（それまでに聞き取った分） }
// 返す：{ type: 'load', p } 読み込みの進み（0〜1） / { type: 'step', done, of } / { type: 'win', upto, out }（30秒ごと。途中までの分を保存して、止まっても続きから） / { type: 'done', out: { en: [{ text, s, e }], ja: […] } } / { type: 'error', msg }
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/transformers.min.js';
const MODEL = 'Xenova/whisper-small';
const SR = 16000, WIN = 30; // 30秒ずつ（Whisper が一度に聞ける長さ）
let pipe = null;

// 30秒を聞き取る。まず単語ごとの時刻で（文ごとより細かく合う）。
// 英日が混ざるところなどで単語の時刻が崩れる（ほとんど同じ時刻になる）ときは、文ごとの時刻に戻す
async function hear(seg, lang, len) {
  const clip = (v, d) => Math.min(v == null ? d : v, len);
  try {
    const r = await pipe(seg, { language: lang, task: 'transcribe', return_timestamps: 'word' });
    const ws = (r.chunks || []).filter((c) => c.timestamp && c.timestamp[0] != null);
    const starts = new Set(ws.map((c) => c.timestamp[0]));
    if (ws.length && (ws.length < 4 || starts.size >= ws.length * 0.5)) {
      return ws.map((c) => {
        const e = clip(c.timestamp[1], len), s0 = c.timestamp[0];
        // 前に間（音楽など）がある単語は、始まりがその間の頭になってしまうので、終わりから長さを見積もる
        const est = 0.25 + 0.07 * c.text.trim().length;
        return { text: c.text, s: e - s0 > 1.2 ? Math.max(s0, e - est) : s0, e };
      });
    }
  } catch (err) { /* 文ごとの時刻で聞き直す */ }
  const r = await pipe(seg, { language: lang, task: 'transcribe', return_timestamps: true });
  return (r.chunks || []).filter((c) => c.timestamp && c.timestamp[0] != null).map((c) => ({ text: c.text, s: c.timestamp[0], e: clip(c.timestamp[1], len) }));
}

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
        if (len >= 0.5) for (const c of await hear(seg, lang, len)) out[lang].push({ text: c.text, s: i * WIN + c.s, e: i * WIN + c.e });
        post({ type: 'step', done: ++done, of: n * langs.length });
      }
      post({ type: 'win', upto: i + 1, out });
    }
    post({ type: 'done', out });
  } catch (err) {
    post({ type: 'error', msg: String((err && err.message) || err) });
  }
};
