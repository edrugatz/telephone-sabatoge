import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../js/game/schedule.js';
import { createRng } from '../js/game/rng.js';
import {
  assignRules,
  validateAssignment,
  validateRulePool,
  authorUses,
  ruleTypeForRound,
  ruledTasksPerPlayer,
  DEFAULT_RULE_RATE,
  RuleError,
} from '../js/game/rules.js';

const SEEDS = 200;
const MAX_SPREAD = 1; // max difference in uses between authors (measured: always 0 for n = 5…12)
const names = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

/** 3 rules per player, 1–2 of each type, in random order. */
function randomPool(n, seed) {
  const rng = createRng(`pool#${seed}`);
  const rules = [];
  for (let p = 0; p < n; p++) {
    const draws = 1 + rng.int(2);
    const types = rng.shuffle(['draw', 'write', draws === 2 ? 'draw' : 'write']);
    types.forEach((type, i) => rules.push({ author: p, type, text: `${type} rule ${i + 1} by P${p + 1}` }));
  }
  return rules;
}

const messages = (list) => list.map((e) => e.message).join('; ');

/** Ruled drawings / interpretations per player. */
function ruledSplit(schedule, ruleAt) {
  const split = schedule.players.map(() => ({ draw: 0, write: 0 }));
  for (let r = 1; r <= schedule.k; r++) {
    ruleAt[r].forEach((i, c) => {
      if (i !== null) split[schedule.rounds[r][c]][ruleTypeForRound(r)]++;
    });
  }
  return split;
}

// ruleRate 1 is the P3 behaviour (every task ruled); 0.5 is the game default (P3b).
for (const ruleRate of [1, 0.5]) {
  for (let n = 5; n <= 12; n++) {
    test(`rate ${ruleRate}, n=${n}: ${SEEDS} random pools validate, exact ruled counts, balanced authors`, (t) => {
      let worstSpread = 0;
      let r5 = 0;
      let total = 0;
      for (let s = 0; s < SEEDS; s++) {
        const schedule = generateSchedule(names(n), s);
        const rules = randomPool(n, s);
        assert.ok(validateRulePool(rules, schedule.players).ok);
        const t0 = performance.now();
        const a = assignRules(schedule, rules, s, { ruleRate });
        total += performance.now() - t0;
        assert.equal(a.ruleRate, ruleRate);

        const res = validateAssignment(schedule, rules, a);
        assert.ok(res.ok, `seed ${s}: ${messages(res.errors)}`);
        assert.deepEqual(res.warnings, a.warnings);
        assert.equal(res.warnings.filter((w) => w.constraint !== 'R5').length, 0, `seed ${s}: ${messages(res.warnings)}`);
        r5 += res.warnings.length;

        const m = ruledTasksPerPlayer(schedule.k, ruleRate);
        for (const { draw, write } of ruledSplit(schedule, a.ruleAt)) {
          assert.equal(draw + write, m, `seed ${s}: ruled count`);
          assert.ok(Math.abs(draw - write) <= 1, `seed ${s}: split ${draw}/${write}`);
        }
        const uses = authorUses(schedule, rules, a.ruleAt);
        assert.equal(uses.reduce((x, y) => x + y, 0), n * m);
        worstSpread = Math.max(worstSpread, Math.max(...uses) - Math.min(...uses));
      }
      t.diagnostic(`rate ${ruleRate}, n=${n}: avg ${(total / SEEDS).toFixed(2)} ms, worst author spread ${worstSpread}, R5 warnings ${r5}`);
      assert.ok(worstSpread <= MAX_SPREAD, `author uses differ by ${worstSpread} (max ${MAX_SPREAD})`);
      assert.equal(r5, 0, 'same-author transformations should be avoidable with full pools');
    });
  }
}

test('ruledTasksPerPlayer and the default rate', () => {
  assert.equal(DEFAULT_RULE_RATE, 0.5);
  assert.equal(ruledTasksPerPlayer(4), 2);
  assert.equal(ruledTasksPerPlayer(6), 3);
  assert.equal(ruledTasksPerPlayer(6, 1), 6);
  assert.equal(ruledTasksPerPlayer(6, 0), 0);
  const schedule = generateSchedule(names(8), 4);
  const a = assignRules(schedule, randomPool(8, 4), 4);
  assert.equal(a.ruleRate, 0.5);
  assert.equal(a.ruleAt.flat().filter((i) => i !== null).length, 8 * 3);
});

test('odd ruled count: extra task alternates between drawing and interpretation', () => {
  const schedule = generateSchedule(names(8), 5); // k = 6 → 3 ruled tasks each
  const split = ruledSplit(schedule, assignRules(schedule, randomPool(8, 5), 5).ruleAt);
  assert.equal(split.filter((x) => x.draw === 2).length, 4);
  assert.equal(split.filter((x) => x.write === 2).length, 4);
});

test('rate 0 gives no rules; invalid rates throw', () => {
  const schedule = generateSchedule(names(6), 6);
  const rules = randomPool(6, 6);
  const a = assignRules(schedule, rules, 6, { ruleRate: 0 });
  assert.ok(a.ruleAt.flat().every((i) => i === null));
  assert.ok(validateAssignment(schedule, rules, a).ok);
  for (const ruleRate of [1.2, -0.1, NaN, '0.5']) {
    assert.throws(() => assignRules(schedule, rules, 6, { ruleRate }), TypeError);
  }
});

test('same seed gives the same assignment; different seeds differ', () => {
  const schedule = generateSchedule(names(8), 'PARTY');
  const rules = randomPool(8, 1);
  const a = assignRules(schedule, rules, 'PARTY');
  const b = assignRules(schedule, rules, 'PARTY');
  assert.deepEqual(a, b);
  assert.equal(a.seed, 'PARTY');
  const c = assignRules(schedule, rules, 'OTHER');
  assert.notDeepEqual(a.ruleAt, c.ruleAt);
});

test('round 0 has no rules and types match the rounds', () => {
  const schedule = generateSchedule(names(6), 3);
  const rules = randomPool(6, 3);
  const { ruleAt } = assignRules(schedule, rules, 3);
  assert.ok(ruleAt[0].every((i) => i === null));
  for (let r = 1; r <= schedule.k; r++) {
    for (const i of ruleAt[r]) if (i !== null) assert.equal(rules[i].type, ruleTypeForRound(r));
  }
});

test('inputs are not mutated', () => {
  const schedule = generateSchedule(names(7), 9);
  const rules = randomPool(7, 9);
  const before = JSON.stringify({ schedule, rules });
  assignRules(schedule, rules, 9);
  assert.equal(JSON.stringify({ schedule, rules }), before);
});

// ---- Validator: each hard rule fails with the right message -------------------

function fixture() {
  const schedule = generateSchedule(names(6), 11);
  const rules = randomPool(6, 11);
  const assignment = assignRules(schedule, rules, 11, { ruleRate: 1 });
  return { schedule, rules, assignment, ruleAt: assignment.ruleAt.map((row) => row.slice()) };
}

const fails = (res, constraint, pattern) => {
  assert.equal(res.ok, false);
  const hit = res.errors.find((e) => e.constraint === constraint);
  assert.ok(hit, `expected a ${constraint} error, got: ${messages(res.errors)}`);
  assert.match(hit.message, pattern);
};

test('validator: wrong rule type (R1)', () => {
  const { schedule, rules, ruleAt } = fixture();
  const p = schedule.rounds[1][0];
  const { drawer, interpreter } = { drawer: schedule.rounds[1][0], interpreter: schedule.rounds[2][0] };
  ruleAt[1][0] = rules.findIndex((x) => x.type === 'write' && x.author !== drawer && x.author !== interpreter);
  fails(validateAssignment(schedule, rules, { ruleRate: 1, ruleAt }), 'R1', new RegExp(`P${p + 1} gets writing rule .* on a drawing task in round 1`));
});

test('validator: own rule (R2)', () => {
  const { schedule, rules, ruleAt } = fixture();
  const p = schedule.rounds[1][2];
  ruleAt[1][2] = rules.findIndex((x) => x.type === 'draw' && x.author === p);
  fails(validateAssignment(schedule, rules, { ruleRate: 1, ruleAt }), 'R2', new RegExp(`P${p + 1} gets their own rule`));
});

test('validator: author is the other player in the transformation (R2)', () => {
  const { schedule, rules, ruleAt } = fixture();
  const interpreter = schedule.rounds[2][1];
  ruleAt[1][1] = rules.findIndex((x) => x.type === 'draw' && x.author === interpreter);
  fails(
    validateAssignment(schedule, rules, { ruleRate: 1, ruleAt }),
    'R2',
    new RegExp(`but P${interpreter + 1} is in that transformation`),
  );
});

test('validator: wrong ruled count and rule in round 0 (R3)', () => {
  const { schedule, rules, ruleAt } = fixture();
  const p = schedule.rounds[2][3];
  ruleAt[2][3] = null;
  fails(validateAssignment(schedule, rules, { ruleRate: 1, ruleAt }), 'R3', new RegExp(`P${p + 1} has 3 ruled tasks, needs 4`));
  // At rate 0.5 the full assignment has 2 ruled tasks too many per player.
  fails(validateAssignment(schedule, rules, { ruleRate: 0.5, ruleAt: fixture().ruleAt }), 'R3', /has 4 ruled tasks, needs 2/);
  const { ruleAt: r0 } = fixture();
  r0[0][0] = r0[1][0];
  fails(validateAssignment(schedule, rules, { ruleRate: 1, ruleAt: r0 }), 'R3', /original sentence gets no rule/);
});

test('validator: uneven drawing/interpretation split is a warning', () => {
  const schedule = generateSchedule(names(6), 12); // k = 4 → 1 ruled drawing + 1 ruled interpretation each
  const rules = randomPool(6, 12);
  const ruleAt = assignRules(schedule, rules, 12).ruleAt.map((row) => row.slice());
  const p = 0;
  const wr = [2, 4].find((r) => ruleAt[r][schedule.rounds[r].indexOf(p)] !== null);
  const dr = [1, 3].find((r) => ruleAt[r][schedule.rounds[r].indexOf(p)] === null);
  ruleAt[wr][schedule.rounds[wr].indexOf(p)] = null;
  const c = schedule.rounds[dr].indexOf(p);
  const blocked = [schedule.rounds[dr][c], schedule.rounds[dr + 1][c]];
  ruleAt[dr][c] = rules.findIndex((x) => x.type === 'draw' && !blocked.includes(x.author));
  const res = validateAssignment(schedule, rules, { ruleRate: 0.5, ruleAt });
  assert.ok(res.ok, messages(res.errors));
  assert.ok(res.warnings.some((w) => w.constraint === 'split' && /P1 has 2 ruled drawings and 0 ruled interpretations/.test(w.message)));
});

test('validator: bad shape', () => {
  const { schedule, rules, ruleAt } = fixture();
  fails(validateAssignment(schedule, rules, { ruleRate: 1, ruleAt: ruleAt.slice(1) }), 'shape', /must have 5 rounds/);
  ruleAt[1][0] = 999;
  fails(validateAssignment(schedule, rules, { ruleRate: 1, ruleAt }), 'shape', /not a valid rule index/);
});

test('validator: repeat for the same player and same author in one transformation are warnings', () => {
  const { schedule, rules, ruleAt } = fixture();
  // Player of chain 0 in round 1 draws again in round 3: give them the same rule.
  const p = schedule.rounds[1][0];
  const c3 = schedule.rounds[3].indexOf(p);
  const i = ruleAt[1][0];
  const blocked = [schedule.rounds[3][c3], schedule.rounds[4][c3]];
  if (!blocked.includes(rules[i].author)) {
    ruleAt[3][c3] = i;
    const res = validateAssignment(schedule, rules, { ruleRate: 1, ruleAt });
    assert.ok(res.warnings.some((w) => w.constraint === 'R4' && /twice \(rounds 1 and 3\)/.test(w.message)));
  }
  // Same author on both tasks of chain 0's first transformation.
  const { ruleAt: r5 } = fixture();
  const author = rules[r5[1][0]].author;
  r5[2][0] = rules.findIndex((x) => x.type === 'write' && x.author === author);
  const res5 = validateAssignment(schedule, rules, { ruleRate: 1, ruleAt: r5 });
  assert.ok(res5.ok);
  assert.ok(res5.warnings.some((w) => w.constraint === 'R5' && new RegExp(`both rules are by P${author + 1}`).test(w.message)));
});

// ---- Pools with one type only, or a type from very few authors -----------------

test('one-type-only pool gives a clear RuleError', () => {
  const schedule = generateSchedule(names(6), 1);
  const drawOnly = names(6).flatMap((_, p) => [0, 1, 2].map((i) => ({ author: p, type: 'draw', text: `d${i}` })));
  assert.throws(
    () => assignRules(schedule, drawOnly, 1),
    (err) => {
      assert.ok(err instanceof RuleError);
      assert.equal(err.reason, 'pool');
      assert.match(err.message, /No writing rules: every player needs at least one drawing and one writing rule/);
      return true;
    },
  );
  const res = validateRulePool(drawOnly, schedule.players);
  assert.equal(res.ok, false);
  assert.equal(res.errors.filter((e) => /needs at least one writing rule/.test(e.message)).length, 6);
});

test('writing rules from only 2 authors: error names the transformation', () => {
  const schedule = generateSchedule(names(6), 2);
  const rules = names(6).flatMap((_, p) =>
    [0, 1, 2].map((i) => ({ author: p, type: p < 2 && i === 0 ? 'write' : 'draw', text: `r${p}${i}` })),
  );
  // Some transformation has P1 and P2 together (each pair occurs once at most, but
  // whether it occurs depends on the schedule); otherwise it solves with repeats allowed.
  const pairs = [];
  for (let r = 1; r < schedule.k; r += 2) {
    for (let c = 0; c < 6; c++) pairs.push([schedule.rounds[r][c], schedule.rounds[r + 1][c]].sort().join());
  }
  if (pairs.includes('0,1')) {
    assert.throws(() => assignRules(schedule, rules, 2), (err) => {
      assert.ok(err instanceof RuleError);
      assert.equal(err.reason, 'pool');
      assert.match(err.message, /No writing rule fits .* all writing rules are by P[12] or P[12]/);
      return true;
    });
  } else {
    const a = assignRules(schedule, rules, 2);
    assert.ok(validateAssignment(schedule, rules, a).ok);
  }
});

test('writing rules from only 3 authors always solve (with warnings if needed)', () => {
  for (let s = 0; s < 50; s++) {
    const schedule = generateSchedule(names(8), s);
    const rules = names(8).flatMap((_, p) =>
      [0, 1, 2].map((i) => ({ author: p, type: p < 3 && i === 0 ? 'write' : 'draw', text: `r${p}${i}` })),
    );
    const a = assignRules(schedule, rules, s);
    const res = validateAssignment(schedule, rules, a);
    assert.ok(res.ok, messages(res.errors));
    assert.deepEqual(res.warnings, a.warnings);
  }
});

test('validateRulePool: counts, empty text, unknown author', () => {
  const players = names(5);
  const good = randomPool(5, 0);
  assert.deepEqual(validateRulePool(good, players), { ok: true, errors: [] });
  const bad = good.slice(1).concat([{ author: 9, type: 'draw', text: 'x' }, { author: 1, type: 'paint', text: ' ' }]);
  const msgs = messages(validateRulePool(bad, players).errors);
  assert.match(msgs, /P1 has 2 rules, needs 3/);
  assert.match(msgs, /unknown author "9"/);
  assert.match(msgs, /P2: rule " " needs a type/);
  assert.match(msgs, /P2: a rule is empty/);
  assert.match(msgs, /P2 has 4 rules, needs 3/);
});

test('bad rule in assignRules input gives a pool error', () => {
  const schedule = generateSchedule(names(5), 1);
  const rules = randomPool(5, 1);
  rules[0] = { author: 7, type: 'draw', text: 'x' };
  assert.throws(() => assignRules(schedule, rules, 1), (err) => err instanceof RuleError && err.reason === 'pool');
});
