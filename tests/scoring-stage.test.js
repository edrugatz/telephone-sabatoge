import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { Host } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { createRng } from '../js/game/rng.js';
import { transformationsOf } from '../js/game/game.js';
import { scoreGame } from '../js/game/score.js';
import { measureAll, applyScores } from '../js/game/scoring.js';
import { toScore, cleanSettings, DEFAULT_SETTINGS, TUNING_STORAGE_KEY } from '../js/similarity.js';
import { Bots } from '../js/ui/bots.js';
import { scoringCard } from '../js/ui/scoring-view.js';
import { savedTuning } from '../js/ui/model.js';
import { memoryStorage } from '../js/ui/session.js';

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

/** A fake model: logits from the sentences' lengths, so results are deterministic. Counts its calls. */
function fakeMeasure({ failAt = null, onCall } = {}) {
  const fake = async (a, b) => {
    fake.calls++;
    onCall?.(fake.calls);
    if (fake.calls === failAt) throw new Error('model crashed');
    await tick();
    return { logitAB: (a.length % 9) - 4, logitBA: (b.length % 7) - 3, exact: a.trim().toLowerCase() === b.trim().toLowerCase() };
  };
  fake.calls = 0;
  return fake;
}

/** Host Ana + bots, a whole game played to the finished stage. `clock` drives the host's now(). */
async function finishedGame(seed, players, clock = { t: 1_000, step: 0 }) {
  const backend = createMemoryBackend();
  const now = () => (clock.t += clock.step);
  const host = await Host.create({ transport: backend.connect('uid-host'), hostName: 'Ana', random: createRng(seed).next, now });
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
    await settle(backend, host);
    await host.advance();
    await settle(backend, host);
  }
  const byUid = new Map([[ana.uid, ana], ...[...bots.clients.values()].map((c) => [c.uid, c])]);
  const clients = host.state.seats.map((seat) => byUid.get(seat.uid));
  return { backend, host, ana, bots, clients, now };
}

test('scoring card texts', () => {
  assert.equal(scoringCard(null, { isHost: false }).state, 'loading');
  const hostLoading = scoringCard({ status: 'loading', done: 0, total: 24 }, { isHost: true, download: { loaded: 7.5e6, total: 15e6 } });
  assert.equal(hostLoading.title, '🧠 Loading the scorer…');
  assert.match(hostLoading.detail, /^7\.5 \/ 15\.0 MB/);
  assert.equal(hostLoading.percent, 50);
  assert.equal(scoringCard({ status: 'loading', done: 0, total: 24 }, { isHost: false, download: { loaded: 1, total: 2 } }).percent, null, 'players get a spinner');
  const scoring = scoringCard({ status: 'scoring', done: 6, total: 24 }, { isHost: false });
  assert.equal(scoring.title, '🧠 Scoring the chains… 6 / 24');
  assert.equal(scoring.percent, 25);
  const hostError = scoringCard({ status: 'error', done: 2, total: 24, error: 'No network' }, { isHost: true });
  assert.deepEqual([hostError.retry, hostError.detail], [true, 'No network']);
  const playerError = scoringCard({ status: 'error', done: 2, total: 24, error: 'No network' }, { isHost: false });
  assert.equal(playerError.retry, false);
  assert.match(playerError.title, /host's phone is having trouble/);
  assert.equal(scoringCard({ status: 'done', done: 24, total: 24 }, { isHost: false }).state, 'done');
});

test('tuning settings: tune.html values are used, broken ones fall back to the default', () => {
  const storage = memoryStorage();
  assert.deepEqual(savedTuning(storage), { ...DEFAULT_SETTINGS });
  storage.setItem(TUNING_STORAGE_KEY, JSON.stringify({ offset: -1.5, temperature: 2, symmetric: false }));
  assert.deepEqual(savedTuning(storage), { offset: -1.5, temperature: 2, symmetric: false });
  storage.setItem(TUNING_STORAGE_KEY, '{not json');
  assert.deepEqual(savedTuning(storage), { ...DEFAULT_SETTINGS });
  assert.deepEqual(cleanSettings({ offset: 'x', temperature: -1, symmetric: 1 }), { ...DEFAULT_SETTINGS });
  assert.deepEqual(savedTuning(null), { ...DEFAULT_SETTINGS });
});

test('measureAll skips measured ones, stops on request, refuses bad numbers', async () => {
  const ts = [1, 2, 3, 4].map((i) => ({ incoming: `in ${i}`, outgoing: `out ${i}` }));
  const measure = fakeMeasure();
  const seen = [];
  const out = await measureAll(ts, measure, { measured: [null, { logitAB: 1, logitBA: 2, exact: false }], onMeasured: (i, m, done) => seen.push([i, done]) });
  assert.equal(measure.calls, 3);
  assert.deepEqual(seen, [[0, 2], [2, 3], [3, 4]]);
  assert.deepEqual(out[1], { logitAB: 1, logitBA: 2, exact: false });

  let stop = false;
  const stopping = fakeMeasure({ onCall: (n) => (stop = n === 2) });
  const partial = await measureAll(ts, stopping, { shouldStop: () => stop });
  assert.equal(stopping.calls, 2);
  assert.deepEqual(partial.map(Boolean), [true, true, false, false]);

  await assert.rejects(measureAll(ts, async () => ({ logitAB: NaN, logitBA: 0 })), TypeError);
  assert.throws(() => applyScores(ts, partial, DEFAULT_SETTINGS), /not been measured/);

  const scored = applyScores(ts, out, { offset: -1, temperature: 2, symmetric: true });
  for (const [i, t] of scored.entries()) {
    assert.equal(t.similarity, toScore(out[i], { offset: -1, temperature: 2, symmetric: true }).score);
    assert.deepEqual(t.measurement, out[i]);
  }
  assert.equal(applyScores([ts[0]], [{ logitAB: -9, logitBA: -9, exact: true }]).at(0).similarity, 100, 'same text → 100');
});

test('8-player game: the host scores every transformation, every phone sees the progress and the scores', async () => {
  const clock = { t: 1_000, step: 0 };
  const { backend, host, ana, bots, clients } = await finishedGame('p10-eight', 8, clock);
  const { k } = host.state.game.schedule;
  const transformations = 8 * (k / 2);
  const total = transformations + 8; // + one drift pair (original vs final) per chain
  for (const client of clients) {
    assert.equal(client.view.stage, 'finished');
    assert.deepEqual(client.view.scoring, { status: 'loading', done: 0, total, error: null });
    assert.equal(client.view.reveal, null);
  }

  // Each measurement takes 1 s of host time, so progress is published after every one.
  clock.step = 1_000;
  const progress = [];
  clients[3].watch((view) => progress.push(`${view.scoring.status} ${view.scoring.done}`));
  const settings = { offset: -0.5, temperature: 1.5, symmetric: true };
  const measure = fakeMeasure();
  await host.score(measure, settings);
  await settle(backend, host);

  assert.equal(measure.calls, total);
  const done = [...new Set(progress)];
  assert.equal(done[0], 'loading 0');
  assert.equal(done.at(-1), `done ${total}`);
  assert.ok(done.includes(`scoring ${total - 1}`), 'progress counts up one by one');

  const expected = applyScores(transformationsOf(host.state.game), host.state.scoring.measured, settings);
  for (const client of clients) {
    const { reveal, scoring } = client.view;
    assert.equal(scoring.status, 'done');
    const scores = reveal.flatMap((chain) => chain.steps);
    assert.equal(scores.length, transformations);
    for (const [i, s] of scores.entries()) {
      assert.ok(s.similarity >= 0 && s.similarity <= 100);
      assert.equal(s.similarity, expected[i].similarity, 'the host tuning curve is applied');
      assert.equal(s.drawer, host.state.game.players[expected[i].drawer]);
      assert.equal(s.incoming, expected[i].incoming);
    }
    assert.equal(JSON.stringify(client.view).includes('"rounds"'), false, 'still no routing in a view');
  }
  assert.deepEqual(host.state.scoring.settings, settings);
  assert.equal(ana.view.reveal.length, 8);

  // The scores feed the P4 engine.
  const result = scoreGame(expected, host.state.game.players);
  assert.equal(result.transformations.length, transformations);
  assert.equal(result.leaderboards.preservers.length, 8);

  // Done is final: scoring again measures nothing, and a late submit is refused.
  await host.score(fakeMeasure(), settings);
  assert.equal((await ana.submitTask('too late')).ok, false);
  host.stop();
  bots.close();
});

test('few publishes while scoring: with a fast model only the first and the last result go out', async () => {
  const { backend, host, ana, bots } = await finishedGame('p10-throttle', 5);
  const seen = [];
  ana.watch((view) => seen.push(view.scoring.done));
  await host.score(fakeMeasure(), DEFAULT_SETTINGS);
  await settle(backend, host);
  assert.deepEqual([...new Set(seen)], [0, 1, host.state.scoring.total]);
  host.stop();
  bots.close();
});

test('host reload mid-scoring continues without measuring anything twice', async () => {
  const clock = { t: 1_000, step: 1_000 };
  const { backend, host, ana, bots } = await finishedGame('p10-reload', 6, clock);
  const total = host.state.scoring.total;
  const first = fakeMeasure({ onCall: (n) => n === 5 && host.stop() });
  await host.score(first, DEFAULT_SETTINGS);
  await settle(backend, host);
  assert.equal(first.calls, 5);
  assert.equal(ana.view.scoring.done, 5);

  const again = await Host.resume({ transport: backend.connect('uid-host'), code: host.code, now: () => (clock.t += 1_000) });
  await settle(backend, again);
  assert.equal(again.state.scoring.status, 'loading', 'waiting for the model again after the reload');
  assert.equal(ana.view.scoring.done, 5);
  const second = fakeMeasure();
  await again.score(second, { offset: 3 });
  await settle(backend, again);
  assert.equal(second.calls, total - 5);
  assert.equal(ana.view.scoring.status, 'done');
  assert.deepEqual(again.state.scoring.settings, DEFAULT_SETTINGS, 'the first settings are kept');
  again.stop();
  bots.close();
});

test('a failure shows on every phone, and Try again finishes the rest', async () => {
  const clock = { t: 1_000, step: 1_000 };
  const { backend, host, clients, bots } = await finishedGame('p10-error', 5, clock);
  const failing = fakeMeasure({ failAt: 3 });
  await assert.rejects(host.score(failing, DEFAULT_SETTINGS), /model crashed/);
  await settle(backend, host);
  for (const client of clients) assert.deepEqual(client.view.scoring, { status: 'error', done: 2, total: host.state.scoring.total, error: 'model crashed' });

  // The model didn't load at all: failScoring says so too.
  await host.retryScoring();
  await settle(backend, host);
  assert.equal(clients[1].view.scoring.status, 'loading');
  await host.failScoring('Failed to fetch');
  await settle(backend, host);
  assert.equal(clients[1].view.scoring.error, 'Failed to fetch');

  await host.retryScoring();
  const rest = fakeMeasure();
  await host.score(rest, DEFAULT_SETTINGS);
  await settle(backend, host);
  assert.equal(rest.calls, host.state.scoring.total - 2);
  for (const client of clients) assert.equal(client.view.scoring.status, 'done');
  await host.failScoring('too late');
  assert.equal(host.state.scoring.status, 'done', 'a finished scoring stays done');
  host.stop();
  bots.close();
});
