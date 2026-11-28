// P12: chain reveal. A played game's reveal (every phone) must rebuild every chain with its rules and drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { gamePaths } from '../js/sync/transport.js';
import { Host, revealOf } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { createRng } from '../js/game/rng.js';
import { transformationsOf, revengeOptions } from '../js/game/game.js';
import { applyScores } from '../js/game/scoring.js';
import { Bots } from '../js/ui/bots.js';
import { createSessionStore, memoryStorage } from '../js/ui/session.js';
import {
  revealBeats,
  ruleLine,
  chainTitle,
  startPosition,
  cleanPosition,
  nextAction,
  nextLabel,
  stepForward,
  goToChain,
  showAll,
} from '../js/ui/reveal-view.js';

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

/** Deterministic fake model; counts its calls. */
function fakeMeasure() {
  const fake = async (a, b) => {
    fake.calls++;
    await tick();
    return { logitAB: (a.length % 9) - 4, logitBA: (b.length % 7) - 3, exact: a.trim().toLowerCase() === b.trim().toLowerCase() };
  };
  fake.calls = 0;
  return fake;
}

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

const CHAIN = {
  chain: 0,
  creator: 'Ana',
  original: 'A cat on a bike',
  final: 'A dog in space',
  drift: 12.34,
  steps: [
    {
      round: 1,
      drawer: 'Ben',
      interpreter: 'Cy',
      incoming: 'A cat on a bike',
      outgoing: 'A tiger cycling',
      similarity: 80,
      rules: [
        { author: 'Dot', target: 'Ben', task: 'draw', text: 'No straight lines', revenge: false },
        { author: 'Eva', target: 'Cy', task: 'interpret', text: 'Exactly three words', revenge: true },
      ],
    },
    { round: 3, drawer: 'Dot', interpreter: 'Eva', incoming: 'A tiger cycling', outgoing: 'A dog in space', similarity: 15, rules: [] },
  ],
};

test('reveal texts: beats, rule lines, revenge highlight, (you)', () => {
  const beats = revealBeats(CHAIN, 'Ben');
  assert.deepEqual(beats.map((b) => b.kind), ['original', 'draw', 'interpret', 'draw', 'interpret', 'drift']);
  assert.equal(beats[0].title, 'Ana wrote');
  assert.equal(beats[0].sentence, 'A cat on a bike');
  assert.equal(beats[1].title, 'Ben (you) drew it');
  assert.equal(beats[1].hint, '📄 Show your drawing');
  assert.deepEqual(beats[1].rules.map((r) => r.title), ["😈 Dot's rule"]);
  assert.equal(beats[2].sentence, 'A tiger cycling');
  assert.deepEqual([beats[2].score.value, beats[2].score.label], ['80.0', 'Very similar']);
  assert.deepEqual(beats[2].rules, [{ revenge: true, title: '🔥 Eva took revenge on Cy', text: 'Exactly three words', mine: false }]);
  assert.equal(beats[3].hint, "📄 Show Dot's drawing");
  assert.deepEqual([beats[3].rules, beats[4].rules], [[], []]);
  assert.deepEqual([beats[5].original, beats[5].final, beats[5].score.value], ['A cat on a bike', 'A dog in space', '12.3']);
  assert.equal(ruleLine(CHAIN.steps[0].rules[1], 'Eva').title, '🔥 Eva (you) took revenge on Cy');
  assert.equal(ruleLine(CHAIN.steps[0].rules[1], 'Eva').mine, true);
  assert.equal(chainTitle([CHAIN, CHAIN], 1, 'Zed'), "Chain 2 / 2 · Ana's chain");
  assert.equal(chainTitle([CHAIN], 0, 'Ana'), 'Chain 1 / 1 · Your chain');
});

test('reveal stepping: next beat, next chain, back to the awards; saved positions are checked', () => {
  const reveal = [CHAIN, { ...CHAIN, chain: 1, creator: 'Ben', steps: [CHAIN.steps[0]] }];
  let pos = { ...startPosition('ABCDE'), mode: 'reveal' };
  const actions = [];
  while (pos.mode === 'reveal') {
    actions.push(nextAction(pos, reveal));
    pos = stepForward(pos, reveal);
  }
  // chain 0: 6 beats (5 taps), next chain; chain 1: 4 beats (3 taps), done.
  assert.deepEqual(actions, ['beat', 'beat', 'beat', 'beat', 'beat', 'chain', 'beat', 'beat', 'beat', 'done']);
  assert.deepEqual(['beat', 'chain', 'done'].map(nextLabel), ['Next ▶', 'Next chain →', '🏆 Back to the awards']);
  assert.deepEqual(pos, { code: 'ABCDE', mode: 'results', chain: 1, shown: 4 }, 'back to the awards keeps the place');

  assert.deepEqual(goToChain(pos, reveal, 5), { code: 'ABCDE', mode: 'reveal', chain: 1, shown: 1 });
  assert.equal(showAll({ ...pos, chain: 0 }, reveal).shown, 6);
  assert.deepEqual(cleanPosition({ code: 'ABCDE', mode: 'reveal', chain: 9, shown: 99 }, 'ABCDE', reveal), { code: 'ABCDE', mode: 'reveal', chain: 1, shown: 4 });
  assert.deepEqual(cleanPosition({ code: 'OTHER', mode: 'reveal', chain: 1, shown: 2 }, 'ABCDE', reveal), startPosition('ABCDE'));
  assert.deepEqual(cleanPosition({ code: 'ABCDE', mode: 'x', chain: 'a' }, 'ABCDE', reveal), startPosition('ABCDE'));
  assert.deepEqual(cleanPosition(null, 'ABCDE', null), startPosition('ABCDE'));

  const store = createSessionStore(memoryStorage());
  store.saveReveal({ code: 'ABCDE', mode: 'reveal', chain: 1, shown: 2 });
  assert.deepEqual(store.loadReveal(), { code: 'ABCDE', mode: 'reveal', chain: 1, shown: 2 });
  store.clear();
  assert.equal(store.loadReveal(), null);
});

test('8-player game with revenge: every phone gets the same reveal, every chain rebuilds with rules and drift', async () => {
  const { backend, host, bots, clients } = await playedGame('p12-eight', 8);
  const { game } = host.state;
  const { k } = game.schedule;
  assert.ok(game.revenges.length >= 1, 'at least one revenge was taken');
  for (const client of clients) assert.equal(client.view.reveal, null, 'nothing before scoring is done');

  const settings = { offset: -0.5, temperature: 1.5, symmetric: true };
  const measure = fakeMeasure();
  await host.score(measure, settings);
  await settle(backend, host);
  const transformations = transformationsOf(game);
  assert.equal(measure.calls, transformations.length + 8, 'the transformations + one drift pair per chain');

  const reveal = clients[0].view.reveal;
  for (const client of clients) assert.deepEqual(client.view.reveal, reveal);
  assert.equal(reveal.length, 8);

  const tuned = applyScores(transformations, host.state.scoring.measured, settings);
  const drifts = applyScores(
    game.players.map((_, c) => ({ incoming: game.sentences[0][c], outgoing: game.sentences[k][c] })),
    host.state.scoring.measured.slice(transformations.length),
    settings,
  );
  const name = (p) => game.players[p];
  for (const [c, chain] of reveal.entries()) {
    assert.equal(chain.chain, c);
    assert.equal(chain.creator, name(c));
    assert.equal(chain.original, game.sentences[0][c]);
    assert.equal(chain.final, game.sentences[k][c]);
    assert.equal(chain.drift, drifts[c].similarity);
    assert.equal(chain.steps.length, k / 2);
    assert.equal(chain.steps[0].incoming, chain.original);
    assert.equal(chain.steps.at(-1).outgoing, chain.final);
    for (const step of chain.steps) {
      const t = tuned.find((x) => x.chain === c && x.round === step.round);
      assert.deepEqual([step.drawer, step.interpreter, step.incoming, step.outgoing, step.similarity], [name(t.drawer), name(t.interpreter), t.incoming, t.outgoing, t.similarity]);
      assert.deepEqual(
        step.rules,
        t.rules.map((r) => ({ author: name(r.author), target: name(r.task === 'draw' ? t.drawer : t.interpreter), task: r.task, text: r.text, revenge: r.revenge })),
      );
    }
    assert.equal(revealBeats(chain).length, k + 2);
  }

  // Every revenge shows up once, highlighted, with its author and target.
  const shown = reveal.flatMap((chain) => chain.steps.flatMap((s) => s.rules)).filter((r) => r.revenge);
  assert.deepEqual(
    shown.map((r) => `${r.author}>${r.target}:${r.text}`).sort(),
    game.revenges.map((rv) => `${name(rv.author)}>${name(rv.target)}:${rv.text}`).sort(),
  );
  const line = ruleLine(shown[0]);
  assert.equal(line.title, `🔥 ${shown[0].author} took revenge on ${shown[0].target}`);

  // Walking every chain from the start ends back on the awards.
  let pos = { ...startPosition(host.code), mode: 'reveal' };
  let taps = 0;
  while (pos.mode === 'reveal') {
    pos = stepForward(pos, reveal);
    taps++;
  }
  assert.equal(taps, 8 * (k + 2));
  host.stop();
  bots.close();
});

test('a game scored before P12 (no drift) resumes and measures only the drift pairs', async () => {
  const { backend, host, bots, clients } = await playedGame('p12-old', 5);
  await host.score(fakeMeasure(), null);
  await settle(backend, host);
  host.stop();

  // Rewrite the saved host state as P10/P11 left it: only the transformations measured.
  const old = structuredClone(host.state);
  const count = transformationsOf(old.game).length;
  old.scoring.measured = old.scoring.measured.slice(0, count);
  old.scoring.total = count;
  const transport = backend.connect('uid-host');
  await transport.set(gamePaths(host.code).hostState, JSON.stringify(old));

  const again = await Host.resume({ transport, code: host.code, now: () => 2_000 });
  await settle(backend, again);
  assert.equal(again.state.scoring.status, 'loading');
  assert.deepEqual(clients[1].view.scoring, { status: 'loading', done: count, total: count + 5, error: null });
  const rest = fakeMeasure();
  await again.score(rest, null);
  await settle(backend, again);
  assert.equal(rest.calls, 5, 'only the drift pairs');
  assert.deepEqual(clients[1].view.reveal, revealOf(host.state), 'same reveal as the fully scored game');
  again.stop();
  bots.close();
});
