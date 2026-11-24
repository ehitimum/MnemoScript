// Downloads the Whisper ASR model (the "main" dictation model) into
// app/public/models so Voice-to-Text works fully offline with no first-run
// network fetch. Bundles the q8 / "_quantized" ONNX variant (smallest that keeps
// good accuracy) plus all tokenizer/config files transformers.js needs.
//
// Run once after install: `npm run fetch:model` (from app/) or
// `node scripts/fetch_whisper_model.mjs` from the repo root. Idempotent: existing
// files are skipped unless --force is passed.

import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'onnx-community/whisper-tiny.en';
const BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const force = process.argv.includes('--force');

// dtype 'q8' in transformers.js maps to the "_quantized" file suffix.
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'added_tokens.json',
  'special_tokens_map.json',
  'normalizer.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

const here = dirname(fileURLToPath(import.meta.url));
const outRoot = join(here, '..', 'app', 'public', 'models', MODEL_ID);

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function download(rel) {
  const dest = join(outRoot, rel);
  if (!force && existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  = ${rel} (exists, skipped)`);
    return;
  }
  ensureDir(dirname(dest));
  const url = `${BASE}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  const mb = (buf.length / 1024 / 1024).toFixed(2);
  console.log(`  + ${rel} (${mb} MB)`);
}

console.log(`Fetching ${MODEL_ID} (q8) → app/public/models/${MODEL_ID}`);
let failed = 0;
for (const f of FILES) {
  try {
    await download(f);
  } catch (e) {
    failed++;
    console.error(`  ! ${f}: ${e.message}`);
  }
}
if (failed) {
  console.error(`\nDone with ${failed} failure(s). Re-run to retry.`);
  process.exit(1);
}
console.log('\nDone. Dictation will now load the model locally (offline).');
