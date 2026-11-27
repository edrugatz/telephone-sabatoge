import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/game/rng.js';

const take = (rng, count) => Array.from({ length: count }, () => rng.next());

test('same seed gives the same sequence', () => {
  assert.deepEqual(take(createRng(42), 20), take(createRng(42), 20));
  assert.deepEqual(take(createRng('PIZZA42'), 20), take(createRng('PIZZA42'), 20));
});

test('different seeds give different sequences', () => {
  assert.notDeepEqual(take(createRng(1), 10), take(createRng(2), 10));
  assert.notDeepEqual(take(createRng('PIZZA42'), 10), take(createRng('PIZZA43'), 10));
});

test('next() is in [0, 1) and int(max) stays in range', () => {
  const rng = createRng('range');
  for (let i = 0; i < 5000; i++) {
    const x = rng.next();
    assert.ok(x >= 0 && x < 1);
    const n = rng.int(7);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 7);
  }
  assert.throws(() => rng.int(0), RangeError);
  assert.throws(() => rng.int(2.5), RangeError);
});

test('int() covers every value roughly evenly', () => {
  const rng = createRng(7);
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 6000; i++) counts[rng.int(6)]++;
  for (const c of counts) assert.ok(c > 800 && c < 1200, `uneven counts ${counts}`);
});

test('shuffle keeps the same items and does not touch the input', () => {
  const input = [0, 1, 2, 3, 4, 5, 6, 7];
  const copy = input.slice();
  const out = createRng('shuffle').shuffle(input);
  assert.deepEqual(input, copy);
  assert.notEqual(out, input);
  assert.deepEqual(out.slice().sort((a, b) => a - b), copy);
});

test('shuffle is reproducible per seed and varies across seeds', () => {
  const items = Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual(createRng('s').shuffle(items), createRng('s').shuffle(items));
  const orders = new Set();
  for (let seed = 0; seed < 50; seed++) orders.add(createRng(seed).shuffle(items).join(','));
  assert.ok(orders.size > 45, `only ${orders.size} distinct orders out of 50`);
});

test('pick returns an item and rejects empty arrays', () => {
  const rng = createRng(3);
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(items.includes(rng.pick(items)));
  assert.throws(() => rng.pick([]), RangeError);
});

test('invalid seeds are rejected', () => {
  assert.throws(() => createRng(undefined), TypeError);
  assert.throws(() => createRng(NaN), TypeError);
  assert.throws(() => createRng({}), TypeError);
});
