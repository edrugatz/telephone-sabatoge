import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainLength, validateSchedule, taskType, MIN_PLAYERS } from '../js/game/schedule.js';

const NAMES = ['Ana', 'Ben', 'Cleo', 'Dan', 'Eve', 'Finn'];

// Hand-made valid 6-player schedule: chain c is held by (c + offset) mod 6,
// offsets 1, 2, 3, 5. Transformations have differences 1 and 2, so no pair repeats.
const valid6 = () => ({
  players: NAMES.slice(),
  k: 4,
  rounds: [
    [0, 1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5, 0], // draw
    [2, 3, 4, 5, 0, 1], // interpret
    [3, 4, 5, 0, 1, 2], // draw
    [5, 0, 1, 2, 3, 4], // interpret
  ],
});

// Hand-made valid 5-player schedule (offsets 1, 4, 2, 3): uses all 10 pairs exactly once.
const valid5 = () => ({
  players: NAMES.slice(0, 5),
  k: 4,
  rounds: [
    [0, 1, 2, 3, 4],
    [1, 2, 3, 4, 0],
    [4, 0, 1, 2, 3],
    [2, 3, 4, 0, 1],
    [3, 4, 0, 1, 2],
  ],
});

const messages = (result, constraint) =>
  result.errors.filter((e) => e.constraint === constraint).map((e) => e.message);

// ---- chainLength -----------------------------------------------------------

test('chainLength picks the largest even k ≤ n − 1', () => {
  assert.equal(MIN_PLAYERS, 5);
  assert.equal(chainLength(5), 4);
  assert.equal(chainLength(6), 4);
  assert.equal(chainLength(7), 6);
  assert.equal(chainLength(8), 6);
  assert.equal(chainLength(9), 8);
  assert.equal(chainLength(10), 8);
  assert.equal(chainLength(14), 12);
});

test('chainLength respects an optional cap', () => {
  assert.equal(chainLength(10, 6), 6);
  assert.equal(chainLength(10, 5), 4);
  assert.equal(chainLength(6, 100), 4);
  assert.throws(() => chainLength(10, 1), RangeError);
});

test('chainLength rejects too few players', () => {
  assert.throws(() => chainLength(4), /at least 5 players/);
  assert.throws(() => chainLength(5.5), TypeError);
});

test('taskType alternates draw / interpret after the original', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(taskType), ['write', 'draw', 'interpret', 'draw', 'interpret']);
});

// ---- valid schedules -------------------------------------------------------

test('hand-made 6-player schedule passes', () => {
  assert.deepEqual(validateSchedule(valid6()), { ok: true, errors: [] });
});

test('hand-made 5-player schedule passes', () => {
  assert.deepEqual(validateSchedule(valid5()), { ok: true, errors: [] });
});

// ---- broken schedules ------------------------------------------------------

test('duplicate drawer–interpreter pair fails C5', () => {
  const s = valid6();
  s.rounds[4] = [4, 5, 0, 1, 2, 3]; // offsets 1,2,3,4: both transformations have difference 1
  const res = validateSchedule(s);
  assert.equal(res.ok, false);
  assert.ok(res.errors.every((e) => e.constraint === 'C5'), JSON.stringify(res.errors));
  assert.ok(messages(res, 'C5').includes("Ben and Cleo pair twice (Ana's chain r1→2, Eve's chain r3→4)"));
});

test('pair order does not matter (A–B equals B–A)', () => {
  // Finn's chain r1→2 is Ana draws → Ben interprets; make Cleo's chain r3→4 Ben → Ana.
  const s = valid6();
  s.rounds[3] = [3, 4, 1, 0, 5, 2]; // chain 2 drawn by Ben
  s.rounds[4] = [5, 2, 0, 1, 3, 4]; // chain 2 interpreted by Ana
  const res = validateSchedule(s);
  assert.ok(messages(res, 'C5').some((m) => m.startsWith('Ben and Ana pair twice') || m.startsWith('Ana and Ben pair twice')),
    JSON.stringify(res.errors));
});

test('own chain fails C3', () => {
  const s = valid6();
  s.rounds[2] = [0, 3, 4, 5, 2, 1]; // Ana holds her own chain in round 2
  const res = validateSchedule(s);
  assert.equal(res.ok, false);
  assert.ok(messages(res, 'C3').includes('Ana is assigned their own chain in round 2'));
});

test('two tasks in one round fails C1', () => {
  const s = valid6();
  s.rounds[3][0] = 4; // Eve twice, Dan never
  const res = validateSchedule(s);
  assert.equal(res.ok, false);
  const c1 = messages(res, 'C1');
  assert.ok(c1.includes('Eve has 2 tasks in round 3'));
  assert.ok(c1.includes('Dan has no task in round 3'));
});

test('same chain twice for a player fails C2', () => {
  const s = valid6();
  s.rounds[3] = s.rounds[1].slice(); // every chain revisits its round-1 drawer
  const res = validateSchedule(s);
  assert.equal(res.ok, false);
  assert.ok(messages(res, 'C2').includes("Ben gets Ana's chain twice (rounds 1 and 3)"));
});

test('odd chain length fails C7', () => {
  const s = valid6();
  s.k = 3;
  s.rounds = s.rounds.slice(0, 4);
  const res = validateSchedule(s);
  assert.equal(res.ok, false);
  assert.deepEqual(messages(res, 'C7'), ['k=3 must be even so every chain ends on an interpretation']);
});

test('too-long chain fails C7', () => {
  const s = valid6();
  s.k = 6;
  const res = validateSchedule(s);
  assert.equal(res.ok, false);
  assert.ok(messages(res, 'C7').includes('k=6 is too long for 6 players (max 4)'));
});

test('too few players fails', () => {
  const s = valid5();
  s.players = s.players.slice(0, 4);
  const res = validateSchedule(s);
  assert.equal(res.ok, false);
  assert.ok(messages(res, 'players').includes('Need at least 5 players (got 4)'));
});

test('bad shapes fail without throwing', () => {
  assert.deepEqual(validateSchedule(null).errors, [{ constraint: 'shape', message: 'Schedule is missing' }]);
  assert.equal(validateSchedule({}).ok, false);
  assert.equal(validateSchedule({ players: NAMES, k: 'x', rounds: [] }).ok, false);

  const short = valid6();
  short.rounds[2] = [2, 3, 4, 5, 0];
  assert.ok(messages(validateSchedule(short), 'shape').includes('Round 2 has 5 entries, expected 6'));

  const badId = valid6();
  badId.rounds[1][3] = 1.5;
  assert.ok(messages(validateSchedule(badId), 'shape').includes('Round 1, chain 3: "1.5" is not a valid player id'));

  const outOfRange = valid6();
  outOfRange.rounds[1][0] = 6;
  assert.equal(validateSchedule(outOfRange).ok, false);

  const missingRound = valid6();
  missingRound.rounds.pop();
  assert.ok(messages(validateSchedule(missingRound), 'shape').includes('Expected 5 rounds (original + 4 tasks), got 4'));

  const wrongStart = valid6();
  wrongStart.rounds[0] = [1, 0, 2, 3, 4, 5];
  assert.ok(messages(validateSchedule(wrongStart), 'shape').includes("Round 0: Ana's chain must start with Ana, not Ben"));
});

test('validator does not mutate the schedule', () => {
  const s = valid6();
  const before = JSON.stringify(s);
  validateSchedule(s);
  assert.equal(JSON.stringify(s), before);
});
