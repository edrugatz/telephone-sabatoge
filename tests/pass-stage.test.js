import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { Host } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { createRng } from '../js/game/rng.js';
import { chainHistory } from '../js/game/game.js';
import { Bots } from '../js/ui/bots.js';
import { passInfo, waitingText, roundLabel, roundTitle, roundProgress } from '../js/ui/pass.js';

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

/** Host Ana + `botCount` bots, rules in, game started. */
async function startedGame(seed, botCount) {
  const backend = createMemoryBackend();
  const host = await Host.create({ transport: backend.connect('uid-host'), hostName: 'Ana', random: createRng(seed).next, now: () => 1_000 });
  const ana = await Client.open({ transport: backend.connect('uid-host'), code: host.code });
  const bots = new Bots({ connect: botConnector(backend), code: host.code, random: createRng(`${seed}-bots`).next });
  for (let i = 0; i < botCount; i++) await bots.add(host.state.seats);
  await host.openRules();
  await settle(backend, host);
  await bots.writeRules(host.state.seats, ana.view.rules.missing.filter((n) => n !== 'Ana'));
  assert.equal((await ana.submitRules(ANA_RULES)).ok, true);
  await settle(backend, host);
  await host.start();
  await settle(backend, host);
  const byUid = new Map([[ana.uid, ana], ...[...bots.clients.values()].map((c) => [c.uid, c])]);
  const clients = host.state.seats.map((seat) => byUid.get(seat.uid));
  return { backend, host, ana, bots, clients };
}

test('pass texts: next holder and what they do, reveal pile on the last round', () => {
  const base = { done: false, rules: [], sentence: null, lastRound: 6 };
  const write = passInfo({ ...base, round: 0, task: 'write', passTo: { player: 1, name: 'Ben', task: 'draw' } });
  assert.deepEqual(
    { to: write.to, reveal: write.reveal, title: write.title, detail: write.detail, button: write.button, doneTitle: write.doneTitle },
    {
      to: 'Ben',
      reveal: false,
      title: '📄 Then pass your paper to Ben',
      detail: 'Ben will draw your sentence on it.',
      button: 'Send & pass to Ben ✅',
      doneTitle: '✅ Done & passed to Ben',
    },
  );
  const draw = passInfo({ ...base, round: 1, task: 'draw', passTo: { player: 2, name: 'Cy', task: 'interpret' } });
  assert.equal(draw.detail, 'Cy will interpret your drawing.');
  assert.equal(draw.button, 'Done & passed to Cy ✅');
  const interpret = passInfo({ ...base, round: 2, task: 'interpret', passTo: { player: 3, name: 'Dot', task: 'draw' } });
  assert.match(interpret.detail, /^Dot will draw the next picture\. Fold/);
  assert.equal(interpret.button, 'Send & pass to Dot ✅');
  const last = passInfo({ ...base, round: 6, task: 'interpret', passTo: 'reveal' });
  assert.equal(last.reveal, true);
  assert.equal(last.to, null);
  assert.match(last.title, /reveal pile/);
  assert.equal(last.button, 'Send & put on the pile ✅');

  assert.equal(waitingText({ round: 0, lastRound: 6 }), "Next you'll 🎨 draw. When you get a paper, check your task here.");
  assert.equal(waitingText({ round: 1, lastRound: 6 }), "Next you'll 🔍 interpret. When you get a paper, check your task here.");
  assert.match(waitingText({ round: 6, lastRound: 6 }), /last round/);
  assert.equal(roundLabel(0, 6), 'Round 0 · warm-up');
  assert.equal(roundLabel(3, 6), 'Round 3 of 6');
  assert.equal(roundTitle(3), 'Round 3 · 🎨 Drawing');
  assert.equal(roundTitle(4), 'Round 4 · 🔍 Interpreting');

  assert.deepEqual(roundProgress(['Ana', 'Ben', 'Cy', 'Dot'], ['ben']), {
    done: 3,
    total: 4,
    percent: 75,
    players: [{ name: 'Ana', done: true }, { name: 'Ben', done: false }, { name: 'Cy', done: true }, { name: 'Dot', done: true }],
  });
  assert.equal(roundProgress([], []).percent, 0);
});

for (const [players, seed] of [[8, 'p9-eight'], [5, 'p9-five']]) {
  test(`${players}-player game played through the UI flow ends on interpretations`, async () => {
    const { backend, host, ana, bots, clients } = await startedGame(seed, players - 1);
    const g = () => host.state.game;
    const { k, rounds } = g().schedule;
    assert.equal(clients.length, players);
    assert.equal(k, players === 8 ? 6 : 4);

    for (let r = 0; r <= k; r++) {
      // Every phone: the pass card names the chain's next holder and their task; the last round goes to the pile.
      const seen = new Set();
      for (const [p, client] of clients.entries()) {
        const { task } = client.view;
        assert.equal(task.round, r);
        const c = rounds[r].indexOf(p);
        const pass = passInfo(task);
        if (r < k) {
          const next = rounds[r + 1][c];
          assert.equal(pass.to, g().players[next], `round ${r}: ${g().players[p]} passes to the next holder`);
          assert.notEqual(next, p, 'never pass to yourself');
          assert.equal(task.passTo.task, r % 2 === 0 ? 'draw' : 'interpret');
          assert.ok(pass.button.includes(pass.to));
          seen.add(next);
        } else {
          assert.equal(pass.reveal, true, 'last round: reveal pile');
          assert.equal(task.task, 'interpret');
        }
        assert.equal(JSON.stringify(client.view).includes('"rounds"'), false, 'no routing in a view');
      }
      if (r < k) assert.equal(seen.size, players, 'every player receives exactly one paper');

      // Ana plays her task like the UI does (text for write/interpret, none for drawings), bots do theirs.
      const mine = ana.view.task;
      const text = mine.task === 'draw' ? undefined : `Ana's sentence in round ${r}`;
      assert.equal((await ana.submitTask(text)).ok, true);
      await settle(backend, host);
      assert.equal(ana.view.task.done, true, 'Ana sees the waiting screen');
      const progress = roundProgress(ana.view.players, ana.view.waitingFor);
      assert.equal(progress.done, 1);
      assert.ok(progress.players.find((x) => x.name === 'Ana').done);
      assert.match(waitingText(ana.view.task), r < k ? /^Next you'll/ : /last round/);

      await assert.rejects(host.advance(), { reason: 'waiting' });
      assert.equal(await bots.doTasks(host.state.seats, ana.view.waitingFor, ana.view.round), players - 1);
      await settle(backend, host);
      assert.equal(roundProgress(ana.view.players, ana.view.waitingFor).percent, 100);

      await host.advance();
      await settle(backend, host);
    }

    // Hand-off to the reveal: every phone is on the finished stage, every chain ends on an interpretation.
    for (const client of clients) {
      assert.equal(client.view.stage, 'finished');
      assert.equal(client.view.task, undefined);
    }
    for (let c = 0; c < players; c++) {
      const history = chainHistory(g(), c);
      assert.equal(history.stages.length, k);
      assert.equal(history.stages.at(-1).task, 'interpret');
      assert.ok(history.stages.at(-1).sentence, 'the last interpretation has a sentence');
      assert.deepEqual(history.stages.map((s) => s.task), Array.from({ length: k }, (_, i) => (i % 2 === 0 ? 'draw' : 'interpret')));
    }
    host.stop();
    bots.close();
  });
}
