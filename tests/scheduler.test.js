import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSchedule,
  validateSchedule,
  chainLength,
  ScheduleError,
} from '../js/game/schedule.js';

const SEEDS = 200;
const SLOW_MS = 50;
const names = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

for (let n = 5; n <= 14; n++) {
  test(`n=${n}: ${SEEDS} seeds all validate, mostly distinct`, (t) => {
    const players = names(n);
    const distinct = new Set();
    let total = 0;
    let max = 0;
    for (let s = 0; s < SEEDS; s++) {
      const t0 = performance.now();
      const sched = generateSchedule(players, s);
      const ms = performance.now() - t0;
      total += ms;
      max = Math.max(max, ms);

      assert.equal(sched.k, chainLength(n));
      const res = validateSchedule(sched);
      assert.ok(res.ok, `seed ${s}: ${res.errors.map((e) => e.message).join('; ')}`);
      distinct.add(JSON.stringify(sched.rounds));
    }
    const avg = total / SEEDS;
    t.diagnostic(`n=${n} k=${chainLength(n)}: avg ${avg.toFixed(2)} ms, max ${max.toFixed(1)} ms`);
    if (max > SLOW_MS) t.diagnostic(`SLOW: n=${n} max ${max.toFixed(1)} ms > ${SLOW_MS} ms`);
    // n=5 has only 48 valid schedules in total (brute-force count), so ask for
    // near-full coverage there; larger n have far more than 200.
    const want = n === 5 ? 40 : SEEDS * 0.95;
    t.diagnostic(`n=${n}: ${distinct.size}/${SEEDS} distinct`);
    assert.ok(distinct.size >= want, `only ${distinct.size}/${SEEDS} distinct schedules (want ${want})`);
  });
}

test('same seed gives the same schedule (number and string seeds)', () => {
  for (const n of [5, 8, 13]) {
    for (const seed of [42, 'PARTY-7']) {
      const a = generateSchedule(names(n), seed);
      const b = generateSchedule(names(n), seed);
      assert.deepEqual(a, b);
      assert.equal(a.seed, seed);
    }
  }
});

test('different seeds give different schedules', () => {
  const a = generateSchedule(names(8), 'ABC');
  const b = generateSchedule(names(8), 'ABD');
  assert.notDeepEqual(a.rounds, b.rounds);
});

test('maxTasks caps the chain length', () => {
  const sched = generateSchedule(names(12), 1, { maxTasks: 6 });
  assert.equal(sched.k, 6);
  assert.equal(sched.rounds.length, 7);
  assert.ok(validateSchedule(sched).ok);
});

test('input is not mutated and players are copied', () => {
  const players = names(6);
  const sched = generateSchedule(players, 3);
  assert.deepEqual(players, names(6));
  assert.notEqual(sched.players, players);
});

test('too few players gives a clear error', () => {
  assert.throws(() => generateSchedule(names(4), 1), /at least 5 players/);
});

test('players must be an array', () => {
  assert.throws(() => generateSchedule('Ana,Ben', 1), TypeError);
});

test('exhausted search gives a readable ScheduleError', () => {
  assert.throws(
    () => generateSchedule(names(9), 1, { stepBudget: 1, maxAttempts: 1 }),
    (err) => {
      assert.ok(err instanceof ScheduleError);
      assert.equal(err.reason, 'unsolved');
      assert.equal(err.attempts, 1);
      assert.match(err.message, /9 players with 8 tasks per chain after 1 attempts/);
      return true;
    },
  );
});
