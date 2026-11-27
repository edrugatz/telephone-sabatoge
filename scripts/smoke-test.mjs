// Node smoke test: loads the real model and scores the example pairs.
// Run with: npm test
//
// Uses the *web* build (WASM backend) on purpose: it's what the browser runs, and the
// native onnxruntime-node binary doesn't load on musl (Alpine) systems.
// The web build detects Node via process.release.name and then expects a file-system
// cache, so we hide that to make it follow the exact browser code path (fetch + WASM).
import { readFile } from 'node:fs/promises';
import { createScorer, toScore, describe } from '../js/similarity.js';
import { EXAMPLES } from '../js/examples.js';

Object.defineProperty(process, 'release', { value: { name: 'browser-sim' } });
const lib = await import('../node_modules/@huggingface/transformers/dist/transformers.web.js');

// Browsers load the ORT WASM glue via a blob: URL, which Node can't import.
// Point ORT at the local files and hand it the binary directly instead.
const ortDist = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url);
lib.env.useWasmCache = false;
lib.env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('ort-wasm-simd-threaded.asyncify.mjs', ortDist).href,
  wasm: new URL('ort-wasm-simd-threaded.asyncify.wasm', ortDist).href,
};
lib.env.backends.onnx.wasm.wasmBinary = await readFile(new URL('ort-wasm-simd-threaded.asyncify.wasm', ortDist));
lib.env.backends.onnx.wasm.numThreads = 1;

const t0 = Date.now();
const scorer = await createScorer(lib);
console.log(`model loaded in ${Date.now() - t0} ms\n`);
console.log('score  logitAB logitBA  label            pair');

for (const { a, b } of EXAMPLES) {
  const m = await scorer.measure(a, b);
  const { score } = toScore(m);
  const f = (x) => x.toFixed(2).padStart(7);
  console.log(`${score.toFixed(1).padStart(5)}  ${f(m.logitAB)} ${f(m.logitBA)}  ${describe(score).padEnd(16)} "${a}" | "${b}"`);
}
