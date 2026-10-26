# 英日の判定のモデル（js/lid-worker.js が使う）

- `lid-ecapa-voxlingua107.int8.onnx`：SpeechBrain の言語判定 [speechbrain/lang-id-voxlingua107-ecapa](https://huggingface.co/speechbrain/lang-id-voxlingua107-ecapa) を int8 の ONNX にしたもの。[krut42/voice-lid-ecapa-voxlingua107](https://huggingface.co/krut42/voice-lid-ecapa-voxlingua107) から（SHA-256 3f1504000353f1da5015ae0df0bdae8d1fd7064680e45a8c9cb02740d78c4fa9）。Apache-2.0（LICENSE-voxlingua107）。入力 `wav` [1, 長さ]（16kHz）、出力 `logp` [1, 107]（並びは lid-labels.txt）。
- `silero-vad.onnx`：[Silero VAD](https://github.com/snakers4/silero-vad) v5。[onnx-community/silero-vad](https://huggingface.co/onnx-community/silero-vad) の onnx/model.onnx。MIT（LICENSE-silero-vad）。
