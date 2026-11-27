// Node smoke test: loads the real model and scores the example pairs.
// Run with: npm test
//
// Uses the *web* build (WASM backend) on purpose: it's what the browser runs, and the
// native onnxruntime-node binary doesn't load on musl (Alpine) systems.
// The web build detects Node via process.release.name and then expects a file-system
// cache, so we hide that to make it follow the exact browser code path (fetch + WASM).
import { readFile } from 'node:fs/promises';
import { createScorer, toScore, describe, DEFAULT_SETTINGS } from '../js/similarity.js';
import { EXAMPLES } from '../js/examples.js';
import { createGame, setPlayers, submitRules, startGame, submitTask, advanceRound, transformationsOf } from '../js/game/game.js';
import { measureAll, applyScores } from '../js/game/scoring.js';
import { scoreGame } from '../js/game/score.js';

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

// P10: score a played 5-player game the way the host phone does (measureAll → applyScores → scoreGame).
// Each chain's interpretations drift a little further from its original sentence.
const CHAINS = [
  ['A dog is chasing a red ball in the park', 'A puppy runs after a ball on the grass', 'An animal plays with a toy outside'],
  ['The chef burned the birthday cake', 'A cook ruined a cake in the oven', 'Smoke comes out of a kitchen'],
  ['Two kids build a sandcastle at the beach', 'Children make a castle out of sand', 'A tower stands next to the sea'],
  ['An astronaut waves from the moon', 'A spaceman says hello on the moon', 'A man in a helmet on a grey rock'],
  ['My grandma rides a motorbike very fast', 'An old lady drives a fast motorcycle', 'A woman racing down the road'],
];
const names = ['Ana', 'Ben', 'Cy', 'Dot', 'Eve'];
const game = createGame({ seed: 'smoke-p10' });
setPlayers(game, names);
names.forEach((_, p) => submitRules(game, p, [
  { type: 'draw', text: `No circles (${p})` },
  { type: 'write', text: `Use the word "banana" (${p})` },
  { type: 'draw', text: `Draw with your eyes closed (${p})` },
]));
startGame(game);
for (let r = 0; r <= game.schedule.k; r++) {
  for (let p = 0; p < names.length; p++) {
    const c = game.schedule.rounds[r].indexOf(p);
    submitTask(game, p, r % 2 === 1 ? undefined : CHAINS[c][r / 2]);
  }
  advanceRound(game);
}
const transformations = transformationsOf(game);
const t1 = Date.now();
const measured = await measureAll(transformations, (a, b) => scorer.measure(a, b));
const scored = applyScores(transformations, measured, DEFAULT_SETTINGS);
console.log(`\nplayed game: ${scored.length} transformations scored in ${Date.now() - t1} ms`);
for (const t of scored) {
  if (!(t.similarity >= 0 && t.similarity <= 100)) throw new Error(`bad similarity ${t.similarity}`);
  console.log(`${t.similarity.toFixed(1).padStart(5)}  ${names[t.drawer]}→${names[t.interpreter]}  "${t.incoming}" | "${t.outgoing}"`);
}
const result = scoreGame(scored, names);
console.log(`preservers: ${result.leaderboards.preservers.map((e) => `${e.name} ${e.value.toFixed(1)}`).join(', ')}`);
console.log(`awards: ${result.awards.map((a) => `${a.title} → ${a.winners.map((w) => names[w]).join(' & ')}`).join(' · ')}`);
