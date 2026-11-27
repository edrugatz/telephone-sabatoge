import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { Host } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { createRng } from '../js/game/rng.js';
import { Bots, BOT_SENTENCES, botSentence } from '../js/ui/bots.js';
import { TASK_SECONDS, taskSeconds, secondsLeft, formatSeconds } from '../js/ui/timer.js';
import { createSessionStore, memoryStorage, KEYS } from '../js/ui/session.js';

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

// The host's rules are unique, so we can see exactly which views show them.
const ANA_RULES = [
  { type: 'draw', text: 'Ana secret: draw only triangles' },
  { type: 'write', text: 'Ana secret: end with a question' },
  { type: 'draw', text: 'Ana secret: add a moustache' },
];

/** Host + 7 bots with their rules in, in the rules stage. */
async function setUp(seed) {
  const backend = createMemoryBackend();
  let clock = 1_000_000;
  const now = () => clock;
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  const host = await Host.create({
    transport: backend.connect('uid-host'),
    hostName: 'Ana',
    random: createRng(seed).next,
    now,
    onSave: (json) => store.saveBackup(json),
  });
  const ana = await Client.open({ transport: backend.connect('uid-host'), code: host.code });
  const bots = new Bots({ connect: botConnector(backend), code: host.code, random: createRng(`${seed}-bots`).next });
  for (let i = 0; i < 7; i++) await bots.add(host.state.seats);
  await host.openRules();
  await settle(backend, host);
  return { backend, host, ana, bots, store, setClock: (t) => (clock = t), now };
}

/** Every seated player's client, by seat index. */
function clientsBySeat(host, ana, bots) {
  const byUid = new Map([[ana.uid, ana], ...[...bots.clients.values()].map((c) => [c.uid, c])]);
  return host.state.seats.map((seat) => byUid.get(seat.uid));
}

test('timer: seconds left from the host start time, clamped, and formatted', () => {
  assert.deepEqual(TASK_SECONDS, { write: 60, draw: 90, interpret: 45 });
  assert.equal(taskSeconds('draw'), 90);
  assert.equal(taskSeconds('nope'), 60);
  const t0 = 5_000_000;
  assert.equal(secondsLeft(t0, 'draw', t0), 90);
  assert.equal(secondsLeft(t0, 'draw', t0 + 400), 90, 'rounds up: 89.6 s shows as 90');
  assert.equal(secondsLeft(t0, 'draw', t0 + 1000), 89);
  assert.equal(secondsLeft(t0, 'interpret', t0 + 44_001), 1);
  assert.equal(secondsLeft(t0, 'interpret', t0 + 45_000), 0);
  assert.equal(secondsLeft(t0, 'write', t0 + 10 * 60_000), 0, 'never negative');
  assert.equal(secondsLeft(t0, 'write', t0 - 30_000), 60, 'a phone clock behind the host shows the full time');
  assert.equal(secondsLeft(null, 'write', t0), 60, 'no start time: full time');
  assert.equal(formatSeconds(90), '1:30');
  assert.equal(formatSeconds(5), '0:05');
  assert.equal(formatSeconds(0), '0:00');
});

test('task draft: kept per game code and round, cleared with the session', () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  assert.equal(store.loadTaskDraft('ABCDE', 0), '');
  store.saveTaskDraft('ABCDE', 0, 'A cat on a bi');
  assert.equal(createSessionStore(storage).loadTaskDraft('ABCDE', 0), 'A cat on a bi', 'survives a reload');
  assert.equal(store.loadTaskDraft('ABCDE', 2), '', 'another round starts empty');
  assert.equal(store.loadTaskDraft('ZZZZZ', 0), '', 'another game starts empty');
  storage.setItem(KEYS.taskDraft, '{broken');
  assert.equal(store.loadTaskDraft('ABCDE', 0), '');
  store.saveTaskDraft('ABCDE', 0, 'x');
  store.clear();
  assert.equal(store.loadTaskDraft('ABCDE', 0), '');
});

test('botSentence picks from the list', () => {
  const rng = createRng('sentences');
  for (let i = 0; i < 50; i++) assert.ok(BOT_SENTENCES.includes(botSentence(rng.next)));
});

test('a refused start keeps the rules stage and says why', async () => {
  const { backend, host, ana, bots } = await setUp('refused');
  await bots.writeRules(host.state.seats, ana.view.rules.missing.filter((n) => n !== 'Ana'));
  await settle(backend, host);
  await assert.rejects(host.start(), (error) => error.reason === 'rules' && /Ana/.test(error.message));
  await settle(backend, host);
  assert.equal(ana.view.stage, 'rules');
  assert.equal(host.state.roundStartedAt ?? null, null);
  host.stop();
  bots.close();
});

test('8-player game: round 0 is writing with no rules, and each round-1 task shows the right rule or none', async () => {
  const { backend, host, ana, bots, store, setClock } = await setUp('p8-game');
  await bots.writeRules(host.state.seats, ana.view.rules.missing.filter((n) => n !== 'Ana'));
  assert.equal((await ana.submitRules(ANA_RULES)).ok, true);
  await settle(backend, host);

  setClock(2_000_000);
  await host.start();
  await settle(backend, host);
  const { game } = host.state;
  const clients = clientsBySeat(host, ana, bots);
  assert.equal(clients.length, 8);
  assert.equal(game.schedule.k, 6);

  // Round 0: everyone writes their original sentence, nobody has a rule, the timer starts together.
  for (const [p, client] of clients.entries()) {
    const { view } = client;
    assert.equal(view.stage, 'playing');
    assert.equal(view.you.player, p);
    assert.equal(view.round, 0);
    assert.equal(view.roundStartedAt, 2_000_000);
    assert.equal(view.task.task, 'write');
    assert.deepEqual(view.task.rules, []);
    assert.equal(view.task.sentence, null);
    assert.equal(view.task.done, false);
    assert.equal(view.waitingFor.length, 8);
    assert.equal('schedule' in view || 'ruleAt' in view, false, 'no routing in a view');
  }

  // Ana types, reloads (draft kept), sends. Empty sentences are refused; the bots finish.
  store.saveTaskDraft(host.code, 0, 'A penguin runs for president');
  assert.equal(store.loadTaskDraft(host.code, 0), 'A penguin runs for president');
  assert.equal((await ana.submitTask('   ')).reason, 'text');
  assert.equal((await ana.submitTask('A penguin runs for president')).ok, true);
  await assert.rejects(host.advance(), { reason: 'waiting' }, 'Next round needs everyone');
  assert.equal(await bots.doTasks(host.state.seats, ana.view.waitingFor, ana.view.round), 7);
  await settle(backend, host);
  assert.deepEqual(ana.view.waitingFor, []);
  assert.equal(ana.view.task.done, true);
  assert.equal(await bots.doTasks(host.state.seats, ana.view.waitingFor, ana.view.round), 0);

  // Next round: a new timer start.
  setClock(2_090_000);
  await host.advance();
  await settle(backend, host);
  assert.equal(host.state.game.round, 1);

  // Round 1: each drawer sees the incoming sentence and exactly the rule the host assigned (or none).
  const g = host.state.game;
  let ruled = 0;
  for (const [p, client] of clients.entries()) {
    const { view } = client;
    const c = g.schedule.rounds[1].indexOf(p);
    const i = g.ruleAt[1][c];
    const expected = i === null ? [] : [{
      author: g.rules[i].author,
      authorName: g.players[g.rules[i].author],
      type: 'draw',
      text: g.rules[i].text,
      revenge: false,
    }];
    if (i !== null) ruled++;
    assert.equal(view.round, 1);
    assert.equal(view.roundStartedAt, 2_090_000);
    assert.equal(view.task.task, 'draw');
    assert.equal(view.task.sentence, g.sentences[0][c], 'the sentence to draw is the chain creator\'s');
    assert.deepEqual(view.task.rules, expected, `${g.players[p]}'s round-1 rule`);
    if (i !== null) assert.notEqual(expected[0].author, p, 'never your own rule');

    // Ana's secret rules show up only where they are assigned.
    const json = JSON.stringify(view);
    for (const rule of ANA_RULES) {
      assert.equal(json.includes(rule.text), expected.some((r) => r.text === rule.text), `${g.players[p]} sees "${rule.text}"?`);
    }
  }
  assert.equal(ruled, g.ruleAt[1].filter((x) => x !== null).length);
  assert.ok(ruled > 0, 'some round-1 tasks have a rule with this seed');

  // Drawing tasks take no text: bots' sentences are ignored.
  assert.equal(await bots.doTasks(host.state.seats, ana.view.waitingFor, 1), 7);
  assert.equal((await ana.submitTask()).ok, true);
  await settle(backend, host);
  assert.deepEqual(host.state.game.sentences[1], Array(8).fill(null));
  assert.deepEqual(ana.view.waitingFor, []);

  // A stale bot message (round 0) is refused.
  assert.equal(await bots.doTasks(host.state.seats, ['Bot Ada'], 0).catch((e) => e.reason), 'stale');

  // Host reload mid-game keeps the round and its start time.
  host.stop();
  const resumed = await Host.resume({ transport: backend.connect('uid-host'), code: host.code, backup: store.loadBackup(host.code) });
  await settle(backend, resumed);
  assert.equal(resumed.state.roundStartedAt, 2_090_000);
  assert.equal(ana.view.roundStartedAt, 2_090_000);
  resumed.stop();
  bots.close();
});
