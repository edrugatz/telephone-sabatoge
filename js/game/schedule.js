// Chain routing: schedule format, chain length and validation.
// Pure ES module (no DOM / Node APIs), shared by the browser and the tests.
//
// Schedule format:
//   {
//     players: ['Ana', 'Ben', …],   // index = player id
//     k: 4,                          // tasks per chain after the original (even)
//     rounds: [[…], …],              // rounds[r][c] = player holding chain c in round r
//   }
// Chain c is created by player c, so rounds[0][c] === c.
// Odd rounds are drawing tasks, even rounds > 0 are interpretations.

import { createRng } from './rng.js';

export const MIN_PLAYERS = 5;

/** Task type of round r: 'write' (round 0), 'draw' (odd) or 'interpret' (even > 0). */
export function taskType(r) {
  if (r === 0) return 'write';
  return r % 2 === 1 ? 'draw' : 'interpret';
}

/**
 * Tasks per chain after the original: the largest even k ≤ min(n − 1, maxTasks).
 * @param {number} n player count
 * @param {number} [maxTasks] optional cap for long games
 */
export function chainLength(n, maxTasks = Infinity) {
  if (!Number.isInteger(n)) throw new TypeError('Player count must be an integer');
  if (n < MIN_PLAYERS) throw new RangeError(`Need at least ${MIN_PLAYERS} players (got ${n})`);
  let k = Math.min(n - 1, maxTasks);
  if (k % 2 === 1) k -= 1;
  if (!(k >= 2)) throw new RangeError(`maxTasks must allow at least 2 tasks (got ${maxTasks})`);
  return k;
}

/**
 * Check a schedule against the routing constraints (SPEC §5).
 * Constraint 6 (randomised per game) is a property of the generator, not of one schedule.
 * @returns {{ ok: boolean, errors: { constraint: string, message: string }[] }}
 */
export function validateSchedule(schedule) {
  const errors = [];
  const fail = (constraint, message) => errors.push({ constraint, message });
  const done = () => ({ ok: errors.length === 0, errors });

  // ---- Shape ---------------------------------------------------------------
  if (!schedule || typeof schedule !== 'object') {
    fail('shape', 'Schedule is missing');
    return done();
  }
  const { players, k, rounds } = schedule;
  if (!Array.isArray(players)) {
    fail('shape', 'players must be an array of names');
    return done();
  }
  const n = players.length;
  if (n < MIN_PLAYERS) fail('players', `Need at least ${MIN_PLAYERS} players (got ${n})`);
  if (!Number.isInteger(k)) {
    fail('shape', 'k (tasks per chain) must be an integer');
    return done();
  }

  // ---- C7: chain length ------------------------------------------------------
  if (k < 2) fail('C7', `k=${k} is too short: chains need at least one drawing and one interpretation`);
  if (k % 2 !== 0) fail('C7', `k=${k} must be even so every chain ends on an interpretation`);
  if (n >= MIN_PLAYERS && k > n - 1) {
    fail('C7', `k=${k} is too long for ${n} players (max ${chainLength(n)})`);
  }

  if (!Array.isArray(rounds)) {
    fail('shape', 'rounds must be an array');
    return done();
  }
  if (rounds.length !== k + 1) {
    fail('shape', `Expected ${k + 1} rounds (original + ${k} tasks), got ${rounds.length}`);
  }
  let shapeOk = rounds.length === k + 1;
  rounds.forEach((row, r) => {
    if (!Array.isArray(row)) {
      fail('shape', `Round ${r} is not an array`);
      shapeOk = false;
      return;
    }
    if (row.length !== n) {
      fail('shape', `Round ${r} has ${row.length} entries, expected ${n}`);
      shapeOk = false;
    }
    row.forEach((p, c) => {
      if (!Number.isInteger(p) || p < 0 || p >= n) {
        fail('shape', `Round ${r}, chain ${c}: "${p}" is not a valid player id`);
        shapeOk = false;
      }
    });
  });
  if (!shapeOk) return done();

  const name = (i) => String(players[i] ?? `Player ${i}`);
  const chain = (c) => `${name(c)}'s chain`;

  rounds[0].forEach((p, c) => {
    if (p !== c) fail('shape', `Round 0: ${chain(c)} must start with ${name(c)}, not ${name(p)}`);
  });

  // ---- C1: exactly one task per player per round ----------------------------
  for (let r = 1; r <= k; r++) {
    const count = new Array(n).fill(0);
    for (const p of rounds[r]) count[p]++;
    count.forEach((cnt, p) => {
      if (cnt > 1) fail('C1', `${name(p)} has ${cnt} tasks in round ${r}`);
      if (cnt === 0) fail('C1', `${name(p)} has no task in round ${r}`);
    });
  }

  // ---- C3: nobody gets their own chain; C2/C4: each chain at most once per player
  for (let c = 0; c < n; c++) {
    const seenIn = new Map(); // player -> first round
    for (let r = 1; r <= k; r++) {
      const p = rounds[r][c];
      if (p === c) {
        fail('C3', `${name(p)} is assigned their own chain in round ${r}`);
        continue;
      }
      if (seenIn.has(p)) {
        fail('C2', `${name(p)} gets ${chain(c)} twice (rounds ${seenIn.get(p)} and ${r})`);
      } else {
        seenIn.set(p, r);
      }
    }
  }

  // ---- C5: each drawer–interpreter pair at most once (unordered) ------------
  const pairs = new Map(); // "a-b" -> description of first use
  for (let r = 1; r + 1 <= k; r += 2) {
    for (let c = 0; c < n; c++) {
      const a = rounds[r][c];
      const b = rounds[r + 1][c];
      if (a === b) continue; // already reported by C2
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const where = `${chain(c)} r${r}→${r + 1}`;
      if (pairs.has(key)) {
        fail('C5', `${name(a)} and ${name(b)} pair twice (${pairs.get(key)}, ${where})`);
      } else {
        pairs.set(key, where);
      }
    }
  }

  return done();
}

// ---- Solver -----------------------------------------------------------------

/** Thrown when no schedule can be generated. `reason`: 'unsolved' | 'invalid'. */
export class ScheduleError extends Error {
  constructor(message, reason, details = {}) {
    super(message);
    this.name = 'ScheduleError';
    this.reason = reason;
    Object.assign(this, details);
  }
}

/**
 * Pick k distinct non-zero shifts d_1..d_k in Z_n by backtracking, such that each
 * transformation block (d_{2j-1}, d_{2j}) has a difference in its own distance class
 * δ = min(|a−b|, n−|a−b|), with δ < n/2. Classes are chosen and ordered at random.
 * @returns {number[] | null} shifts, or null when the step budget runs out / no solution
 */
function findShifts(n, k, rng, stepBudget) {
  const allClasses = Array.from({ length: Math.floor((n - 1) / 2) }, (_, i) => i + 1);
  const classes = rng.shuffle(allClasses).slice(0, k / 2);
  const used = new Uint8Array(n);
  used[0] = 1; // shift 0 would hand a chain back to its creator
  const shifts = [];
  let steps = 0;

  const solve = (j) => {
    if (j === classes.length) return true;
    if (++steps > stepBudget) return false;
    const delta = classes[j];
    for (const x of rng.shuffle(Array.from({ length: n - 1 }, (_, i) => i + 1))) {
      const y = (x + delta) % n;
      if (used[x] || used[y]) continue;
      used[x] = used[y] = 1;
      if (rng.next() < 0.5) shifts.push(x, y);
      else shifts.push(y, x);
      if (solve(j + 1)) return true;
      shifts.length -= 2;
      used[x] = used[y] = 0;
      if (steps > stepBudget) return false;
    }
    return false;
  };

  return solve(0) ? shifts : null;
}

/**
 * One attempt: a cyclic construction, then a random relabelling of players.
 * Chain c in round r is held by player c + d_r (mod n), so every round is a
 * permutation and each chain meets distinct non-creator players (C1–C4). Block j
 * pairs players at distance class δ_j; each class holds every pair once, and the
 * classes are distinct, so no drawer–interpreter pair repeats (C5).
 * Relabelling π (player c ↔ chain c together) keeps all constraints and round 0.
 * @returns {number[][] | null}
 */
function solveAttempt(n, k, rng, stepBudget) {
  const shifts = findShifts(n, k, rng, stepBudget);
  if (!shifts) return null;
  const pi = rng.shuffle([...Array(n).keys()]);
  const rounds = [Array.from({ length: n }, (_, c) => c)];
  for (let r = 1; r <= k; r++) {
    const row = new Array(n);
    for (let c = 0; c < n; c++) row[pi[c]] = pi[(c + shifts[r - 1]) % n];
    rounds.push(row);
  }
  return rounds;
}

/**
 * Generate a random schedule satisfying constraints 1–7 (SPEC §5).
 * The same players + seed always give the same schedule.
 * @param {string[]} players names (index = player id)
 * @param {number|string} seed game code
 * @param {{ maxTasks?: number, maxAttempts?: number, stepBudget?: number }} [options]
 * @returns {{ players: string[], k: number, rounds: number[][], seed: number|string }}
 */
export function generateSchedule(players, seed, options = {}) {
  const { maxTasks = Infinity, maxAttempts = 30, stepBudget = 50_000 } = options;
  if (!Array.isArray(players)) throw new TypeError('players must be an array of names');
  const n = players.length;
  const k = chainLength(n, maxTasks); // throws a clear RangeError for < MIN_PLAYERS

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRng(`${seed}#${attempt}`);
    const rounds = solveAttempt(n, k, rng, stepBudget);
    if (!rounds) continue;
    const schedule = { players: players.slice(), k, rounds, seed };
    const check = validateSchedule(schedule);
    if (!check.ok) {
      throw new ScheduleError(
        `Internal error: generated schedule is invalid (${check.errors[0].message})`,
        'invalid',
        { errors: check.errors },
      );
    }
    return schedule;
  }
  throw new ScheduleError(
    `Couldn't find a routing for ${n} players with ${k} tasks per chain after ${maxAttempts} attempts. ` +
      'Try again with a new game code, or play with a shorter chain.',
    'unsolved',
    { attempts: maxAttempts },
  );
}
