// Copies the offline speech-to-text runtime assets out of node_modules into
// app/public so they ship inside the bundle/APK and load with no network:
//   - Silero VAD worklet + ONNX model  (@ricky0123/vad-web)  -> public/vad/
//   - onnxruntime-web WASM + loaders                          -> public/ort/
//
// Run after `npm install` (or via `npm run setup:speech`). Idempotent.
//
// The main Whisper model (transformers.js) is downloaded + cached on first use
// by default; to make dictation fully offline on first run, drop a local copy
// under app/public/models/ (see docs/ARCHITECTURE.md → Voice-to-Text).

import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', 'app');
const nm = join(appDir, 'node_modules');
const publicDir = join(appDir, 'public');

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function copy(src, destDir, rename) {
  if (!existsSync(src)) {
    console.warn(`  ! missing (skipped): ${src}`);
    return false;
  }
  ensureDir(destDir);
  const dest = join(destDir, rename ?? src.split(/[\\/]/).pop());
  copyFileSync(src, dest);
  console.log(`  + ${dest.replace(appDir, 'app')}`);
  return true;
}

console.log('Setting up offline speech assets…');

// 1) Silero VAD (worklet + onnx models) → public/vad/
const vadDist = join(nm, '@ricky0123', 'vad-web', 'dist');
const vadOut = join(publicDir, 'vad');
copy(join(vadDist, 'vad.worklet.bundle.min.js'), vadOut);
copy(join(vadDist, 'silero_vad_v5.onnx'), vadOut);
copy(join(vadDist, 'silero_vad_legacy.onnx'), vadOut);

// 2) onnxruntime-web wasm + mjs loaders → public/ort/
const ortDist = join(nm, 'onnxruntime-web', 'dist');
const ortOut = join(publicDir, 'ort');
if (existsSync(ortDist)) {
  ensureDir(ortOut);
  for (const f of readdirSync(ortDist)) {
    if (f.endsWith('.wasm') || f.endsWith('.mjs')) {
      copy(join(ortDist, f), ortOut);
    }
  }
} else {
  console.warn('  ! onnxruntime-web dist not found');
}

console.log('Done. (Whisper model is fetched + cached on first dictation use.)');
