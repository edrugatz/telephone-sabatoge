// The scorer on the host phone (P10). Transformers.js is imported lazily the first time it's needed, so
// players' phones never download it. The download starts in the background during the game.

import { createScorer, cleanSettings, TRANSFORMERS_URL, TUNING_STORAGE_KEY } from '../similarity.js';

let loading = null; // Promise<scorer> while loading or loaded; reset after a failure so it can be retried
const files = new Map(); // file → { loaded, total }
let listener = null;

/** Download progress so far: { loaded, total } in bytes (total 0 until the first file reports). */
export function modelProgress() {
  let loaded = 0;
  let total = 0;
  for (const f of files.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  return { loaded, total };
}

/** Called (throttled by the caller) whenever download progress changes. */
export function onModelProgress(fn) {
  listener = fn;
}

function track(p) {
  if (p.status === 'progress' && p.total) {
    files.set(p.file, { loaded: p.loaded, total: p.total });
    listener?.(modelProgress());
  }
}

/** Load (once) and return the scorer. A failure rejects and lets the next call try again. */
export function loadScorer() {
  loading ??= (async () => {
    const lib = await import(TRANSFORMERS_URL);
    return createScorer(lib, { onProgress: track });
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** The tuning curve saved by tune.html on this phone, or the default one. */
export function savedTuning(storage = globalThis.localStorage) {
  try {
    return cleanSettings(JSON.parse(storage?.getItem(TUNING_STORAGE_KEY) ?? 'null'));
  } catch {
    return cleanSettings(null);
  }
}
