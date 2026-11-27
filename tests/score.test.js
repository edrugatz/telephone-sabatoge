import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../js/game/schedule.js';
import { assignRules } from '../js/game/rules.js';
import { createRng } from '../js/game/rng.js';
import { buildTransformations, scoreGame } from '../js/game/score.js';

const names = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

/** Dummy sentences for the even rounds; odd rounds (drawings) are null. */
const dummySentences = ({ k, players }) =>
  Array.from({ length: k + 1 }, (_, r) => (r % 2 === 0 ? players.map((_, c) => `s${r}-${c}`) : players.map(() => null)));

const emptyRuleAt = ({ k, players }) => Array.from({ length: k + 1 }, () => players.map(() => null));

/** 5-player fixture: k = 4, 10 transformations, every similarity 100 unless set. */
function fixture() {
  const schedule = generateSchedule(names(5), 'fixture');
  const rules = schedule.players.flatMap((_, p) => [
    { author: p, type: 'draw', text: `draw by P${p + 1}` },
    { author: p, type: 'write', text: `write by P${p + 1}` },
  ]);
  const ruleAt = emptyRuleAt(schedule);
  const sentences = dummySentences(schedule);
  const ruleOf = (author, type) => rules.findIndex((r) => r.author === author && r.type === type);
  // Chain 0, round 1 → 2: the transformation the fixtures put damage on.
  const drawer = schedule.rounds[1][0];
  const interpreter = schedule.rounds[2][0];
  const outsiders = schedule.players.map((_, p) => p).filter((p) => p !== drawer && p !== interpreter);
  return { schedule, rules, ruleAt, sentences, ruleOf, drawer, interpreter, outsiders };
}

function score(f, { revenges = [], sims = {} } = {}) {
  const ts = buildTransformations({ ...f, revenges });
  for (const t of ts) t.similarity = sims[`${t.chain},${t.round}`] ?? 100;
  return scoreGame(ts, f.schedule.players);
}

test('lists every transformation with its sentences', () => {
  const f = fixture();
  const ts = buildTransformations(f);
  assert.equal(ts.length, 10);
  const t = ts.find((x) => x.chain === 0 && x.round === 1);
  assert.deepEqual(
    { drawer: t.drawer, interpreter: t.interpreter, incoming: t.incoming, outgoing: t.outgoing, rules: t.rules },
    { drawer: f.drawer, interpreter: f.interpreter, incoming: 's0-0', outgoing: 's2-0', rules: [] },
  );
  assert.equal(ts.find((x) => x.chain === 0 && x.round === 3).incoming, 's2-0');
});

test('40 damage → 20 to the drawer and 20 to the interpreter, none to the creator', () => {
  const f = fixture();
  const res = score(f, { sims: { '0,1': 60 } });
  close(res.transformations.find((t) => t.chain === 0 && t.round === 1).damage, 40);
  close(res.players[f.drawer].preservation, 20);
  close(res.players[f.interpreter].preservation, 20);
  for (const p of f.outsiders) close(res.players[p].preservation, 0); // incl. the creator, player 0
  assert.ok(res.players.every((s) => s.tasks === f.schedule.k));
});

test('no rule → no sabotage credit and no Master Saboteur', () => {
  const res = score(fixture(), { sims: { '0,1': 60 } });
  assert.ok(res.players.every((s) => s.sabotage === 0 && s.ruleUses === 0 && s.sabotagePerUse === null));
  assert.ok(!res.awards.some((a) => a.id === 'saboteur'));
});

test("a rule's author gets the full 40", () => {
  const f = fixture();
  const x = f.outsiders[0];
  f.ruleAt[1][0] = f.ruleOf(x, 'draw');
  const res = score(f, { sims: { '0,1': 60 } });
  close(res.players[x].sabotage, 40);
  assert.equal(res.players[x].ruleUses, 1);
  close(res.players[x].sabotagePerUse, 40);
  const award = res.awards.find((a) => a.id === 'saboteur');
  assert.deepEqual(award.winners, [x]);
  assert.equal(res.leaderboards.saboteurs[0].player, x);
});

test('scheduled + revenge rule on one transformation → both authors get 40', () => {
  const f = fixture();
  const [x, y] = f.outsiders;
  f.ruleAt[1][0] = f.ruleOf(x, 'draw');
  const revenges = [{ author: y, target: f.interpreter, round: 2, text: 'only questions' }];
  const res = score(f, { revenges, sims: { '0,1': 60 } });
  const t = res.transformations.find((tr) => tr.chain === 0 && tr.round === 1);
  assert.deepEqual(t.rules.map((r) => [r.author, r.task, r.revenge]), [[x, 'draw', false], [y, 'interpret', true]]);
  close(res.players[x].sabotage, 40);
  close(res.players[y].sabotage, 40);
});

test('the same author twice in one transformation is credited per rule', () => {
  const f = fixture();
  const x = f.outsiders[0];
  f.ruleAt[1][0] = f.ruleOf(x, 'draw');
  f.ruleAt[2][0] = f.ruleOf(x, 'write');
  const res = score(f, { sims: { '0,1': 60 } });
  close(res.players[x].sabotage, 80);
  assert.equal(res.players[x].ruleUses, 2);
  close(res.players[x].sabotagePerUse, 40);
});

test('per-use average divides by uses, including undamaged ones', () => {
  const f = fixture();
  const x = f.outsiders[0];
  f.ruleAt[1][0] = f.ruleOf(x, 'draw'); // 40 damage
  // A second use of x's rule on a transformation with no damage.
  const other = buildTransformations(f).find(
    (t) => t.chain !== 0 && t.drawer !== x && t.interpreter !== x,
  );
  f.ruleAt[other.round][other.chain] = f.ruleOf(x, 'draw');
  const res = score(f, { sims: { '0,1': 60 } });
  assert.equal(res.players[x].ruleUses, 2);
  close(res.players[x].sabotagePerUse, 20);
});

test('Guardian of Meaning and Agent of Chaos; ties share rank and award', () => {
  const f = fixture();
  // Second damaged transformation with players disjoint from chain 0's pair.
  const other = buildTransformations(f).find(
    (t) => ![f.drawer, f.interpreter].includes(t.drawer) && ![f.drawer, f.interpreter].includes(t.interpreter),
  );
  assert.ok(other, 'fixture needs a disjoint transformation');
  const res = score(f, { sims: { '0,1': 60, [`${other.chain},${other.round}`]: 60.01 } }); // 40 vs 39.99: a tie
  const chaos = res.awards.find((a) => a.id === 'chaos');
  assert.deepEqual([...chaos.winners].sort(), [f.drawer, f.interpreter, other.drawer, other.interpreter].sort());
  const guardian = res.awards.find((a) => a.id === 'guardian');
  const untouched = [0, 1, 2, 3, 4].filter((p) => !chaos.winners.includes(p));
  assert.deepEqual(guardian.winners, untouched);
  const ranks = res.leaderboards.preservers.map((e) => e.rank);
  assert.deepEqual(ranks, [1, 2, 2, 2, 2]);
  assert.equal(res.leaderboards.preservers[0].player, untouched[0]);
});

test('everyone tied → Guardian for all, no Agent of Chaos', () => {
  const res = score(fixture());
  assert.deepEqual(res.awards.map((a) => a.id), ['guardian']);
  assert.equal(res.awards[0].winners.length, 5);
});

test('bad input is rejected', () => {
  const f = fixture();
  const ts = buildTransformations(f);
  assert.throws(() => scoreGame(ts, f.schedule.players), /similarity must be 0–100, got null/);
  ts.forEach((t) => (t.similarity = 100));
  ts[0].similarity = 120;
  assert.throws(() => scoreGame(ts, f.schedule.players), /got 120/);

  const missing = dummySentences(f.schedule);
  missing[2][3] = null;
  assert.throws(() => buildTransformations({ ...f, sentences: missing }), /Missing sentence/);

  const revenge = (author, target, round) => ({ author, target, round, text: 'x' });
  assert.throws(
    () => buildTransformations({ ...f, revenges: [revenge(f.drawer, f.interpreter, 2)] }),
    /part of that transformation/,
  );
  const [x, y] = f.outsiders;
  assert.throws(
    () => buildTransformations({ ...f, revenges: [revenge(x, f.interpreter, 2), revenge(y, f.interpreter, 2)] }),
    /already has a revenge rule/,
  );
  assert.throws(() => buildTransformations({ ...f, revenges: [revenge(x, f.interpreter, 0)] }), /not a task round/);
});

for (let n = 5; n <= 12; n++) {
  test(`n=${n}: totals add up on 50 random games with revenge rules`, () => {
    for (let s = 0; s < 50; s++) {
      const schedule = generateSchedule(names(n), s);
      const rules = schedule.players.flatMap((_, p) => [
        { author: p, type: 'draw', text: 'd' },
        { author: p, type: 'write', text: 'w1' },
        { author: p, type: 'write', text: 'w2' },
      ]);
      const { ruleAt } = assignRules(schedule, rules, s);
      const rng = createRng(`score#${s}`);
      // A few valid revenge rules: one per task, author outside the transformation.
      const revenges = [];
      for (let r = 1; r <= schedule.k; r++) {
        const c = rng.int(n);
        const first = r % 2 === 1 ? r : r - 1;
        const inside = [schedule.rounds[first][c], schedule.rounds[first + 1][c]];
        const author = rng.shuffle(schedule.players.map((_, p) => p)).find((p) => !inside.includes(p));
        revenges.push({ author, target: schedule.rounds[r][c], round: r, text: 'rv' });
      }
      const ts = buildTransformations({ schedule, rules, ruleAt, revenges, sentences: dummySentences(schedule) });
      assert.equal(ts.length, (n * schedule.k) / 2);
      for (const t of ts) t.similarity = rng.next() * 100;
      const res = scoreGame(ts, schedule.players);

      const sum = (xs) => xs.reduce((a, b) => a + b, 0);
      const damage = sum(res.transformations.map((t) => t.damage));
      close(sum(res.players.map((p) => p.preservation)), damage);
      close(
        sum(res.players.map((p) => p.sabotage)),
        sum(res.transformations.map((t) => t.damage * t.rules.length)),
      );
      assert.equal(sum(res.players.map((p) => p.ruleUses)), sum(ts.map((t) => t.rules.length)));
      assert.equal(res.transformations.filter((t) => t.rules.some((r) => r.revenge)).length > 0, true);
      assert.ok(res.players.every((p) => p.tasks === schedule.k));
      assert.equal(res.leaderboards.preservers.length, n);
      assert.ok(res.awards.some((a) => a.id === 'saboteur'));
    }
  });
}
