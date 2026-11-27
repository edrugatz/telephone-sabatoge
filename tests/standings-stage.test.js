// P11: leaderboards + awards. A played game's standings (every phone) must match the P4 engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { Host } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { createRng } from '../js/game/rng.js';
import { transformationsOf, revengeOptions } from '../js/game/game.js';
import { scoreGame } from '../js/game/score.js';
import { applyScores } from '../js/game/scoring.js';
import { Bots } from '../js/ui/bots.js';
import { awardCards, boardRows, joinNames, medal } from '../js/ui/standings-view.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(backend, ...hosts) {
  for (let quiet = 0, i = 0; quiet < 3; i++) {
    if (i > 10000) throw new Error('did not settle');
    await tick();
    await Promise.all(hosts.map((h) => h.idle()));
    quiet = backend.pending === 0 ? quiet + 1 : 0;
  }
}

function botConnector(backend) {
  const transports = new Map();
  return async (app) => {
    if (!transports.has(app)) transports.set(app, backend.connect(`uid-${app}`));
    return transports.get(app);
  };
}

const ANA_RULES = [
  { type: 'draw', text: 'Only zigzags' },
  { type: 'write', text: 'Start with "Oh no"' },
  { type: 'draw', text: 'Add a hat' },
];

/** Deterministic fake model from the sentences' lengths; `same` makes every pair identical. */
const fakeMeasure = ({ same = false } = {}) => async (a, b) => {
  await tick();
  return same ? { logitAB: 5, logitBA: 5, exact: true } : { logitAB: (a.length % 9) - 4, logitBA: (b.length % 7) - 3, exact: false };
};

/** Host Ana + bots play a whole game; the bots take revenge in round 1. */
async function playedGame(seed, players) {
  const backend = createMemoryBackend();
  const host = await Host.create({ transport: backend.connect('uid-host'), hostName: 'Ana', random: createRng(seed).next, now: () => 1_000 });
  const ana = await Client.open({ transport: backend.connect('uid-host'), code: host.code });
  const bots = new Bots({ connect: botConnector(backend), code: host.code, random: createRng(`${seed}-bots`).next });
  for (let i = 1; i < players; i++) await bots.add(host.state.seats);
  await host.openRules();
  await settle(backend, host);
  await bots.writeRules(host.state.seats, ana.view.rules.missing.filter((n) => n !== 'Ana'));
  assert.equal((await ana.submitRules(ANA_RULES)).ok, true);
  await settle(backend, host);
  await host.start();
  await settle(backend, host);
  const { k } = host.state.game.schedule;
  for (let r = 0; r <= k; r++) {
    const text = ana.view.task.task === 'draw' ? undefined : `Ana writes about a purple whale in round ${r}`;
    assert.equal((await ana.submitTask(text)).ok, true);
    await bots.doTasks(host.state.seats, ana.view.waitingFor.filter((n) => n !== 'Ana'), ana.view.round);
    if (r === 1) await bots.takeRevenge(host.state.seats, r, (p) => revengeOptions(host.state.game, p));
    await settle(backend, host);
    await host.advance();
    await settle(backend, host);
  }
  const byUid = new Map([[ana.uid, ana], ...[...bots.clients.values()].map((c) => [c.uid, c])]);
  const clients = host.state.seats.map((seat) => byUid.get(seat.uid));
  return { backend, host, ana, bots, clients };
}

/** What host.standings() should publish, computed straight from the P4 engine. */
function expectedStandings(state) {
  const { game } = state;
  const scored = applyScores(transformationsOf(game), state.scoring.measured, state.scoring.settings);
  const result = scoreGame(scored, game.players);
  return {
    result,
    standings: {
      awards: result.awards.map((a) => ({ id: a.id, title: a.title, description: a.description, winners: a.winners.map((p) => game.players[p]), value: a.value })),
      preservers: result.leaderboards.preservers.map(({ name, value, rank }) => ({ name, value, rank })),
      saboteurs: result.leaderboards.saboteurs.map((e) => ({
        name: e.name,
        value: e.value,
        rank: e.rank,
        uses: result.players[e.player].ruleUses,
        perUse: result.players[e.player].sabotagePerUse,
      })),
    },
  };
}

test('standings texts: names, medals, awards and rows', () => {
  assert.equal(joinNames(['Ana']), 'Ana');
  assert.equal(joinNames(['Ana', 'Ben']), 'Ana & Ben');
  assert.equal(joinNames(['Ana', 'Ben', 'Cy']), 'Ana, Ben & Cy');
  assert.deepEqual([1, 2, 3, 4].map(medal), ['🥇', '🥈', '🥉', '4.']);

  const standings = {
    awards: [
      { id: 'guardian', title: 'Guardian of Meaning', description: 'Lost the least', winners: ['Ana', 'Ben'], value: 12.34 },
      { id: 'saboteur', title: 'Master Saboteur', description: 'Rules did most', winners: ['Cy'], value: 80 },
    ],
    preservers: [
      { name: 'Ana', value: 12.34, rank: 1 },
      { name: 'Ben', value: 12.3, rank: 1 },
      { name: 'Cy', value: 40, rank: 3 },
    ],
    saboteurs: [
      { name: 'Cy', value: 80, rank: 1, uses: 2, perUse: 40 },
      { name: 'Ana', value: 15, rank: 2, uses: 1, perUse: 15 },
      { name: 'Ben', value: 0, rank: 3, uses: 0, perUse: null },
    ],
  };
  const cards = awardCards(standings, 'Ben');
  assert.deepEqual(cards.map((c) => [c.emoji, c.winners, c.value, c.mine]), [
    ['🛡️', 'Ana & Ben', '12.3 meaning lost', true],
    ['😈', 'Cy', '80.0 damage', false],
  ]);
  const rows = boardRows(standings, 'Cy');
  assert.deepEqual(rows.preservers.map((r) => `${r.medal} ${r.name} ${r.value}`), ['🥇 Ana 12.3 lost', '🥇 Ben 12.3 lost', '🥉 Cy 40.0 lost']);
  assert.deepEqual(rows.saboteurs.map((r) => r.detail), ['2 rules · 40.0 per rule', '1 rule · 15.0 per rule', 'no rules used']);
  assert.deepEqual(rows.saboteurs.map((r) => r.mine), [true, false, false]);
  assert.deepEqual(awardCards(null), []);
  assert.deepEqual(boardRows(null), { preservers: [], saboteurs: [] });
});

test('8-player game with revenge: every phone gets the P4 leaderboards and awards', async () => {
  const { backend, host, bots, clients } = await playedGame('p11-eight', 8);
  assert.ok(host.state.game.revenges.length >= 1, 'at least one revenge was taken');
  for (const client of clients) assert.equal(client.view.standings, null, 'nothing before scoring is done');

  await host.score(fakeMeasure(), { offset: -0.5, temperature: 1.5, symmetric: true });
  await settle(backend, host);

  const { result, standings } = expectedStandings(host.state);
  for (const client of clients) {
    assert.deepEqual(client.view.standings, standings);
    const text = JSON.stringify(client.view.standings);
    for (const rule of host.state.game.rules) assert.equal(text.includes(rule.text), false, 'no rule texts');
  }

  // The numbers add up: preservation is half the damage twice, sabotage is the damage per rule.
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const damage = result.transformations.map((t) => t.damage);
  const s = clients[0].view.standings;
  assert.equal(s.preservers.length, 8);
  assert.ok(Math.abs(sum(s.preservers.map((e) => e.value)) - sum(damage)) < 1e-9);
  const ruleDamage = sum(result.transformations.map((t) => t.damage * t.rules.length));
  assert.ok(Math.abs(sum(s.saboteurs.map((e) => e.value)) - ruleDamage) < 1e-9);
  assert.equal(sum(s.saboteurs.map((e) => e.uses)), sum(result.transformations.map((t) => t.rules.length)));
  assert.ok(result.transformations.some((t) => t.rules.some((r) => r.revenge)), 'revenge rules are counted');

  // Ranks are sorted and awards point at the leaders.
  const ranks = s.preservers.map((e) => e.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  const guardian = s.awards.find((a) => a.id === 'guardian');
  assert.deepEqual(guardian.winners, s.preservers.filter((e) => e.rank === 1).map((e) => e.name));
  const cards = awardCards(s, guardian.winners[0]);
  assert.equal(cards.find((c) => c.id === 'guardian').mine, true);

  // A host reload rebuilds the same standings from the saved measurements.
  host.stop();
  const again = await Host.resume({ transport: backend.connect('uid-host'), code: host.code, now: () => 2_000 });
  await settle(backend, again);
  assert.deepEqual(clients[2].view.standings, standings);
  again.stop();
  bots.close();
});

test('no meaning lost at all: everyone ties, no Master Saboteur and no Agent of Chaos', async () => {
  const { backend, host, bots, clients } = await playedGame('p11-same', 5);
  await host.score(fakeMeasure({ same: true }), null);
  await settle(backend, host);
  const s = clients[1].view.standings;
  assert.deepEqual(s, expectedStandings(host.state).standings);
  assert.deepEqual(s.awards.map((a) => a.id), ['guardian']);
  assert.equal(s.awards[0].winners.length, 5, 'everyone shares the Guardian award');
  assert.ok(s.preservers.every((e) => e.rank === 1 && e.value === 0));
  assert.ok(s.saboteurs.every((e) => e.rank === 1 && e.value === 0));
  host.stop();
  bots.close();
});
