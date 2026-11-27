// Model scoring of a finished game (SPEC §7, P10). Pure ES module (no DOM / Node APIs), shared by the
// browser (host phone) and the tests.
//
// measureAll() runs the model (or a fake `measure` in tests) on every transformation that has no
// measurement yet, so a host reload continues where it stopped. applyScores() turns the raw
// measurements into similarities with the tuning curve (instant), ready for score.js scoreGame().

import { toScore, cleanSettings } from '../similarity.js';

/** A stored measurement: the two logits and whether the sentences are the same text. */
export function cleanMeasurement(m) {
  const ok = m && Number.isFinite(Number(m.logitAB)) && Number.isFinite(Number(m.logitBA));
  if (!ok) throw new TypeError('The scorer returned no usable numbers');
  return { logitAB: Number(m.logitAB), logitBA: Number(m.logitBA), exact: !!m.exact };
}

/**
 * Measure every transformation whose slot in `measured` is still empty.
 * @param {{ incoming: string, outgoing: string }[]} transformations
 * @param {(a: string, b: string) => Promise<object>} measure   scorer.measure from similarity.js
 * @param {{ measured?: (object|null)[], onMeasured?: (i, m, done) => Promise|void, shouldStop?: () => boolean }} [options]
 *   onMeasured runs after each one (awaited), with the count measured so far. shouldStop ends early.
 * @returns {Promise<(object|null)[]>} the measurements, same order as the transformations
 */
export async function measureAll(transformations, measure, { measured = [], onMeasured, shouldStop } = {}) {
  const out = transformations.map((_, i) => measured[i] ?? null);
  let done = out.filter(Boolean).length;
  for (const [i, t] of transformations.entries()) {
    if (out[i]) continue;
    if (shouldStop?.()) break;
    out[i] = cleanMeasurement(await measure(t.incoming, t.outgoing));
    done++;
    await onMeasured?.(i, out[i], done);
  }
  return out;
}

/** Transformations with `similarity` (0–100, tuned) and the raw `measurement` set. */
export function applyScores(transformations, measured, settings) {
  const tuning = cleanSettings(settings);
  return transformations.map((t, i) => {
    const m = measured[i];
    if (!m) throw new TypeError(`Transformation ${i + 1} has not been measured yet`);
    return { ...t, measurement: m, similarity: toScore(m, tuning).score };
  });
}
