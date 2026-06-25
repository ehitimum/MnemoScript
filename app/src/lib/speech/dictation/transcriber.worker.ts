/// <reference lib="webworker" />
/**
 * Whisper transcription worker (the "main model"). Runs transformers.js off the
 * UI thread. Receives 16 kHz mono Float32 speech segments (already gated by the
 * VAD) and returns recognized text.
 *
 * Offline-first: models are looked up locally (/models) before falling back to a
 * one-time cached download; onnxruntime-web wasm is loaded from our bundled /ort
 * copy in single-threaded mode (no SharedArrayBuffer / cross-origin isolation
 * needed under Tauri's custom protocol).
 */
import { pipeline, env } from '@huggingface/transformers';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Skip the local-model lookup: there is no bundled model yet, and a missing
// /models/* request can resolve to the SPA's index.html (HTTP 200) and wedge the
// loader. The model is fetched from the HF hub on first use and then cached.
env.allowLocalModels = false;
env.allowRemoteModels = true;
// IMPORTANT: do NOT point this at our /ort copy. transformers.js bundles its own
// onnxruntime-web build (a different version); its wasm is emitted by Vite and
// matched automatically. Overriding wasmPaths to a mismatched ORT version hangs
// model init. We only force single-threaded so no SharedArrayBuffer/COOP-COEP is
// needed. (The /ort copy is for @ricky0123/vad-web, which IS version-matched.)
const wasm = env.backends?.onnx?.wasm;
if (wasm) {
  wasm.numThreads = 1;
}

const MODEL_ID = 'onnx-community/whisper-tiny.en';

type AsrResult = { text?: string } | Array<{ text?: string }>;
type Asr = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<AsrResult>;

let asr: Asr | null = null;
let loading: Promise<Asr> | null = null;

async function ensureModel(): Promise<Asr> {
  if (asr) return asr;
  if (!loading) {
    loading = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: unknown) => ctx.postMessage({ type: 'progress', payload: p }),
    }).then((p) => {
      asr = p as unknown as Asr;
      return asr;
    });
  }
  return loading;
}

interface LoadMsg { type: 'load' }
interface TranscribeMsg { type: 'transcribe'; id: number; audio: Float32Array }
type InMsg = LoadMsg | TranscribeMsg;

ctx.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await ensureModel();
      ctx.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'transcribe') {
      const model = await ensureModel();
      const out = await model(msg.audio, { language: 'en', task: 'transcribe' });
      const text = Array.isArray(out)
        ? out.map((o) => o.text ?? '').join(' ')
        : (out.text ?? '');
      ctx.postMessage({ type: 'result', id: msg.id, text: text.trim() });
    }
  } catch (err) {
    const id = msg.type === 'transcribe' ? msg.id : undefined;
    ctx.postMessage({ type: 'error', id, error: String(err) });
  }
};
