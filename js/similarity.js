// Shared scoring logic: used by the browser app and the Node smoke test.
// The Transformers.js library is passed in so both environments run identical code.
//
// Pipeline:  model → logit (A,B) and logit (B,A)  →  measure()
//            logit → optional symmetric average → tuning curve → 0-100  →  toScore()
// measure() is the expensive part (runs the model); toScore() is instant, so the
// tuning sliders can re-score without touching the model.

export const MODEL_ID = 'cross-encoder/stsb-TinyBERT-L4';
// The repo ships quantized ONNX files with non-standard names (~15 MB).
export const MODEL_FILE = 'model_qint8_arm64';
// Transformers.js build used by the browser pages (tune.html and the game's host phone). Pinned.
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm';
// localStorage key of the tuning settings saved by tune.html (the game uses them on the host phone).
export const TUNING_STORAGE_KEY = 'ss-tuning-settings-v1';

/**
 * Tuning curve: score = sigmoid((logit - offset) / temperature) * 100.
 * offset < 0 raises scores overall; temperature > 1 flattens the curve (fewer 0s/100s).
 * symmetric: average the logits of (A,B) and (B,A) so argument order doesn't matter.
 */
export const DEFAULT_SETTINGS = Object.freeze({ offset: 0, temperature: 1, symmetric: true });

const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * Load tokenizer + model and return a scorer.
 * @param {object} lib  The Transformers.js module (AutoTokenizer, AutoModelForSequenceClassification).
 * @param {object} [opts]
 * @param {(p: object) => void} [opts.onProgress]  Download progress callback.
 */
export async function createScorer(lib, { onProgress } = {}) {
  const { AutoTokenizer, AutoModelForSequenceClassification, env } = lib;
  env.allowLocalModels = false; // always fetch from the Hugging Face Hub (cached by the browser)
  const shared = { progress_callback: onProgress };

  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID, shared),
    AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
      ...shared,
      subfolder: 'onnx',
      model_file_name: MODEL_FILE,
      dtype: 'fp32', // fp32 = no extra filename suffix; the file itself is int8-quantized
    }),
  ]);

  /**
   * Run the model on both orders of the pair in one batch.
   * @returns {Promise<{logitAB: number, logitBA: number, exact: boolean}>}
   */
  async function measure(a, b) {
    const inputs = tokenizer([a, b], { text_pair: [b, a], padding: true, truncation: true });
    const { logits } = await model(inputs);
    return {
      logitAB: logits.data[0],
      logitBA: logits.data[1],
      exact: normalize(a) === normalize(b),
    };
  }

  return { measure };
}

/**
 * Turn a measurement into a score using the tuning settings (instant, no model call).
 * @returns {{score: number, logit: number, raw: number, exact: boolean}}
 *   score: tuned 0-100 (one decimal), logit: the logit used, raw: untuned model probability 0-1.
 */
export function toScore(m, settings = DEFAULT_SETTINGS) {
  const { offset, temperature, symmetric } = { ...DEFAULT_SETTINGS, ...settings };
  const logit = symmetric ? (m.logitAB + m.logitBA) / 2 : m.logitAB;
  const raw = sigmoid(logit);
  const tuned = curve(logit, { offset, temperature });
  const score = m.exact ? 100 : Math.round(tuned * 1000) / 10;
  return { score, logit, raw, exact: m.exact };
}

/** Settings read from storage, with anything missing or invalid replaced by the default. */
export function cleanSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const temperature = finite(s.temperature, DEFAULT_SETTINGS.temperature);
  return {
    offset: finite(s.offset, DEFAULT_SETTINGS.offset),
    temperature: temperature > 0 ? temperature : DEFAULT_SETTINGS.temperature,
    symmetric: typeof s.symmetric === 'boolean' ? s.symmetric : DEFAULT_SETTINGS.symmetric,
  };
}

/** The tuning curve alone: logit -> 0-1. */
export function curve(logit, { offset = 0, temperature = 1 } = {}) {
  return sigmoid((logit - offset) / temperature);
}

/** Human-readable label for a 0-100 score. */
export function describe(score) {
  if (score >= 95) return 'Same meaning';
  if (score >= 75) return 'Very similar';
  if (score >= 50) return 'Somewhat similar';
  if (score >= 25) return 'Loosely related';
  return 'Different';
}
