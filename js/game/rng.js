// Seeded, reproducible random numbers. Pure ES module (no DOM / Node APIs),
// so a game code typed on any device rebuilds the same schedule.

/** Hash a string to a 32-bit unsigned integer (FNV-1a with a final avalanche). */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Normalise a number or string seed to a 32-bit unsigned integer. */
export function seedToInt(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return hashString(String(seed));
  if (typeof seed === 'string') return hashString(seed);
  throw new TypeError('Seed must be a finite number or a string');
}

/**
 * Create a seeded random generator (mulberry32).
 * @param {number|string} seed
 */
export function createRng(seed) {
  let state = seedToInt(seed);

  /** Float in [0, 1). */
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, max). */
  function int(max) {
    if (!Number.isInteger(max) || max <= 0) throw new RangeError('int(max) needs a positive integer');
    return Math.floor(next() * max);
  }

  /** New array with the items of `arr` in random order (Fisher–Yates); input untouched. */
  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** One random item of `arr`. */
  function pick(arr) {
    if (!arr.length) throw new RangeError('pick() on an empty array');
    return arr[int(arr.length)];
  }

  return { next, int, shuffle, pick };
}
