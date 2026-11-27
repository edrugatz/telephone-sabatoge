import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { gamePaths, randomCode, normalizeCode, CODE_ALPHABET } from '../js/sync/transport.js';
import { Host, MAX_PLAYERS } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { chainHistory, transformationsOf, GameError } from '../js/game/game.js';
import { createRng } from '../js/game/rng.js';

const NAMES = ['Ana', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon', 'Kim', 'Lea', 'Max', 'Ned', 'Oli'];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Wait until every notification is delivered and the hosts have nothing left to do. */
async function settle(backend, ...hosts) {
  for (let quiet = 0, i = 0; quiet < 3; i++) {
    if (i > 10000) throw new Error('did not settle');
    await tick();
    await Promise.all(hosts.map((h) => h.idle()));
    quiet = backend.pending === 0 ? quiet + 1 : 0;
  }
}

/** Unique marker texts, so a leak of someone's rule into a view can be found by searching. */
const rulesFor = (p) => [
  { type: 'draw', text: `SECRET-${p}-0` },
  { type: 'draw', text: `SECRET-${p}-1` },
  { type: 'write', text: `SECRET-${p}-2` },
];

const sentence = (round, name) => `r${round} said ${name}`;

/** Host + n players (client 0 is the host's own seat). */
async function lobby(n, { seed = 'sync', backend = createMemoryBackend() } = {}) {
  const host = await Host.create({ transport: backend.connect('uid-0'), hostName: NAMES[0], random: createRng('codes').next, seed });
  const clients = [await Client.open({ transport: backend.connect('uid-0'), code: host.code })];
  for (let p = 1; p < n; p++) {
    clients.push(await Client.join({ transport: backend.connect(`uid-${p}`), code: host.code, name: NAMES[p] }));
  }
  await settle(backend, host);
  return { backend, host, clients };
}

async function started(n, options) {
  const setup = await lobby(n, options);
  const { backend, host, clients } = setup;
  await host.openRules();
  await settle(backend, host);
  for (const [p, client] of clients.entries()) assert.equal((await client.submitRules(rulesFor(p))).ok, true);
  await host.start();
  await settle(backend, host);
  return setup;
}

/** Everyone still to do this round does their task; then the host advances. */
async function playRound({ backend, host, clients }) {
  await settle(backend, host);
  for (const client of clients) {
    const { task, round, you } = client.view;
    if (task.done) continue;
    const result = await client.submitTask(task.task === 'draw' ? undefined : sentence(round, you.name));
    assert.equal(result.ok, true, result.message);
  }
  await host.advance();
  await settle(backend, host);
}

/** Send a raw message (bypassing Client), wait, and return its result from the sender's view. */
async function sendRaw(backend, host, uid, message) {
  const t = backend.connect(uid);
  const id = await t.push(gamePaths(host.code).inbox, { from: uid, at: 1, ...message });
  await settle(backend, host);
  return JSON.parse(await t.get(gamePaths(host.code).view(uid))).results.find((r) => r.id === id);
}

test('memory backend: set/update/push/remove, listeners and transactions', async () => {
  const backend = createMemoryBackend();
  const a = backend.connect('a');
  const seen = [];
  const added = [];
  a.onValue('x/y', (v) => seen.push(v));
  a.onChildAdded('box', (key, v) => added.push([key, v]));
  await a.set('x/y', { n: 1 });
  await a.update('x', { 'y/n': 2, z: 'q' });
  const k1 = await a.push('box', 'first');
  const k2 = await a.push('box', 'second');
  await settle(backend);
  assert.deepEqual(seen, [null, { n: 1 }, { n: 2 }]);
  assert.deepEqual(added, [[k1, 'first'], [k2, 'second']]);
  assert.ok(k1 < k2, 'push keys sort in creation order');
  await a.update('', { 'x/y': null });
  assert.equal(await a.get('x/y'), null);
  assert.deepEqual(await a.get('x'), { z: 'q' });
  await a.remove('x');
  assert.equal(backend.dump().x, undefined, 'empty parents disappear');
  assert.deepEqual(await a.transaction('t', (cur) => (cur === null ? 1 : undefined)), { committed: true, value: 1 });
  assert.deepEqual(await a.transaction('t', (cur) => (cur === null ? 2 : undefined)), { committed: false, value: 1 });
});

test('game codes: alphabet, normalising, and a taken code is skipped', async () => {
  const code = randomCode(createRng(1).next);
  assert.match(code, /^[A-HJ-NP-Z]{5}$/);
  assert.ok(![...CODE_ALPHABET].includes('O') && ![...CODE_ALPHABET].includes('I'));
  assert.equal(normalizeCode(' ab cde '), 'ABCDE');
  assert.equal(normalizeCode('ABCD0'), null);
  assert.equal(normalizeCode('ABCDEF'), null);

  const backend = createMemoryBackend();
  const rng = createRng('codes');
  const first = randomCode(rng.next);
  const second = randomCode(rng.next);
  await backend.connect('someone').set(gamePaths(first).meta, { hostUid: 'someone', createdAt: 1, version: 1 });
  const host = await Host.create({ transport: backend.connect('h'), hostName: 'Ana', random: createRng('codes').next });
  assert.equal(host.code, second);
  await assert.rejects(Client.open({ transport: backend.connect('x'), code: 'ZZZZZ' }), (e) => e.reason === 'no-game');
  await assert.rejects(Client.open({ transport: backend.connect('x'), code: '12' }), (e) => e.reason === 'code');
});

test('8 phones play a full game through messages; chains rebuild and no view leaks secrets', async () => {
  const setup = await lobby(8);
  const { backend, host, clients } = setup;
  const views = clients.map(() => []);
  clients.forEach((client, p) => client.watch((view) => views[p].push(JSON.stringify(view))));
  const publics = [];
  clients[3].watchPublic((pub) => publics.push(JSON.stringify(pub)));

  assert.deepEqual(clients[5].public.players, NAMES.slice(0, 8));
  assert.deepEqual(clients[5].view.you, { player: 5, name: 'Fay', host: false });
  assert.equal(clients[0].view.you.host, true);

  await host.openRules();
  await settle(backend, host);
  assert.equal(clients[2].view.stage, 'rules');
  assert.equal(clients[2].view.rules.missing.length, 8);
  for (const [p, client] of clients.entries()) assert.equal((await client.submitRules(rulesFor(p))).ok, true);
  await settle(backend, host);
  assert.deepEqual(clients[2].view.rules.mine, rulesFor(2).map(({ type, text }) => ({ type, text })));
  assert.deepEqual(clients[2].public.missingRules, []);
  await host.start();
  await settle(backend, host);

  const k = host.state.game.schedule.k;
  assert.equal(k, 6);
  while (host.state.stage === 'playing') {
    const { game } = host.state;
    const r = game.round;
    for (const [p, client] of clients.entries()) {
      const { task } = client.view;
      assert.equal(client.view.round, r);
      assert.equal(task.task, r === 0 ? 'write' : r % 2 ? 'draw' : 'interpret');
      if (task.task === 'draw') {
        // The sentence to draw is the one the previous holder of this chain wrote.
        const c = game.schedule.rounds[r].indexOf(p);
        const before = game.schedule.rounds[r - 1][c];
        assert.equal(task.sentence, sentence(r - 1, NAMES[before]));
      }
      if (r < k) {
        const c = game.schedule.rounds[r].indexOf(p);
        assert.equal(task.passTo.name, NAMES[game.schedule.rounds[r + 1][c]]);
      } else assert.equal(task.passTo, 'reveal');
    }
    await playRound(setup);
  }

  assert.equal(clients[4].view.stage, 'finished');
  const { game } = host.state;
  for (let c = 0; c < 8; c++) {
    const chain = chainHistory(game, c);
    assert.equal(chain.original, sentence(0, NAMES[c]));
    assert.equal(chain.stages.length, k);
    for (const stage of chain.stages) {
      assert.equal(stage.sentence, stage.task === 'interpret' ? sentence(stage.round, stage.name) : null);
    }
  }
  assert.equal(transformationsOf(game).length, (8 * k) / 2);

  // Privacy: a player's view only ever holds their own rules and the rules on their own current task.
  let ruleSightings = 0;
  views.forEach((list, p) => {
    for (const json of list) {
      assert.doesNotMatch(json, /"(schedule|ruleAt|rounds|sentences|hostState|seats)"/);
      const view = JSON.parse(json);
      const allowed = new Set([...rulesFor(p).map((r) => r.text), ...(view.task?.rules ?? []).map((r) => r.text)]);
      for (const marker of json.match(/SECRET-\d+-\d/g) ?? []) {
        assert.ok(allowed.has(marker), `${NAMES[p]} saw ${marker}`);
        if (!marker.startsWith(`SECRET-${p}-`)) ruleSightings++;
      }
    }
  });
  assert.ok(ruleSightings > 0, 'players did see the rules on their own tasks');
  for (const json of publics) assert.doesNotMatch(json, /SECRET|schedule|ruleAt/);
  // And the stored views match (nothing else is written under views/).
  const stored = backend.dump().games[host.code].views;
  assert.deepEqual(Object.keys(stored).sort(), clients.map((c) => c.uid).sort());
});

test('host reload mid-game: messages sent while it was away are applied, a pending revenge survives', async () => {
  const setup = await started(8, { seed: 'reload' });
  const { backend, clients } = setup;
  let { host } = setup;

  // Play until somebody can take revenge, and take it.
  let avenger = null;
  while (!avenger) {
    await playRound({ backend, host, clients });
    avenger = clients.find((c) => c.view.revenge.options.some((o) => o.ok));
    assert.ok(host.state.game.round < host.state.game.schedule.k, 'some round offers revenge');
  }
  const option = avenger.view.revenge.options.find((o) => o.ok);
  const several = avenger.view.revenge.options.length > 1;
  assert.equal((await avenger.revenge('REVENGE-TEXT', several ? option.target : undefined)).ok, true);
  await settle(backend, host);
  assert.equal(avenger.view.myRevenge.targetName, option.targetName);
  const round = host.state.game.round;

  // The host phone goes away; everyone keeps playing.
  host.stop();
  const sends = clients.map((c) => c.submitTask(c.view.task.task === 'draw' ? undefined : sentence(round, c.view.you.name)));
  await settle(backend);
  assert.equal(Object.keys(backend.dump().games[host.code].inbox).length, 8, 'messages wait in the inbox');

  host = await Host.resume({ transport: backend.connect('uid-0'), code: host.code });
  for (const result of await Promise.all(sends)) assert.equal(result.ok, true);
  await settle(backend, host);
  assert.equal(backend.dump().games[host.code].inbox, undefined, 'inbox emptied');
  assert.deepEqual(clients[1].public.waitingFor, []);

  // A second revenge by the same player is refused.
  const again = await avenger.revenge('MORE');
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'used');

  await host.advance();
  await settle(backend, host);
  const target = clients[option.target];
  const rule = target.view.task.rules.find((r) => r.revenge);
  assert.deepEqual(
    { text: rule.text, authorName: rule.authorName, type: rule.type },
    { text: 'REVENGE-TEXT', authorName: avenger.view.you.name, type: option.type },
  );

  while (host.state.stage === 'playing') await playRound({ backend, host, clients });
  assert.equal(clients[7].view.stage, 'finished');
});

test('host resume: from the backup, and refused for other phones or unknown codes', async () => {
  const backend = createMemoryBackend();
  let backup = null;
  const host = await Host.create({ transport: backend.connect('uid-0'), hostName: 'Ana', onSave: (json) => (backup = json) });
  for (let p = 1; p < 5; p++) await Client.join({ transport: backend.connect(`uid-${p}`), code: host.code, name: NAMES[p] });
  await settle(backend, host);
  host.stop();
  await backend.connect('uid-0').remove(gamePaths(host.code).hostState);

  const again = await Host.resume({ transport: backend.connect('uid-0'), code: host.code, backup });
  assert.deepEqual(again.state.seats.map((s) => s.name), NAMES.slice(0, 5));
  await assert.rejects(Host.resume({ transport: backend.connect('uid-1'), code: host.code }), (e) => e.reason === 'not-host');
  await assert.rejects(Host.resume({ transport: backend.connect('uid-0'), code: 'ZZZZZ' }), (e) => e.reason === 'no-game');
});

test('lobby edge cases: names, rejoin, leave, kick, full, late join, wrong phase', async () => {
  const { backend, host, clients } = await lobby(4);
  const code = host.code;
  const reason = (fn) => fn.then(
    () => null,
    (e) => e.reason,
  );

  assert.equal(await reason(Client.join({ transport: backend.connect('dup'), code, name: '  ben ' })), 'name-taken');
  assert.equal(await reason(Client.join({ transport: backend.connect('blank'), code, name: '   ' })), 'text');
  assert.equal(await reason(Client.join({ transport: backend.connect('long'), code, name: 'x'.repeat(21) })), 'text');

  // Rejoin with the same uid: same seat, new name allowed in the lobby.
  const ben = clients[1];
  assert.equal((await ben.join('Benny')).ok, true);
  await settle(backend, host);
  assert.deepEqual(ben.view.you, { player: 1, name: 'Benny', host: false });
  assert.equal(host.state.seats.length, 4);

  // Too few players to open the rules; nothing changes.
  await assert.rejects(host.openRules(), (e) => e instanceof GameError && e.reason === 'players');
  assert.equal(host.state.stage, 'lobby');

  // Wrong phase.
  assert.equal((await ben.submitRules(rulesFor(1))).reason, 'phase');
  assert.equal((await ben.submitTask('hi')).reason, 'phase');

  // Leave, and kick.
  assert.equal((await clients[0].leave()).reason, 'host');
  assert.equal((await clients[3].leave()).ok, true);
  await settle(backend, host);
  assert.equal(clients[3].view.you, null);
  assert.equal(clients[3].view.removed, false);
  await host.kick('uid-2');
  await settle(backend, host);
  assert.equal(clients[2].view.you, null);
  assert.equal(clients[2].view.removed, true);
  await assert.rejects(host.kick('uid-0'), (e) => e.reason === 'host');
  assert.deepEqual(clients[0].public.players, ['Ana', 'Benny']);

  // Fill up to the maximum.
  for (let p = 2; p < MAX_PLAYERS; p++) await Client.join({ transport: backend.connect(`more-${p}`), code, name: NAMES[p] });
  assert.equal(await reason(Client.join({ transport: backend.connect('one-too-many'), code, name: 'Zed' })), 'full');
  assert.equal(host.state.seats.length, MAX_PLAYERS);

  // Start writing rules: no more joining, but known players can reopen their view.
  await host.openRules();
  assert.equal(await reason(Client.join({ transport: backend.connect('late'), code, name: 'Late' })), 'started');
  assert.equal((await ben.join('Benjamin')).ok, true, 'rejoin after the lobby is fine');
  assert.equal(host.state.seats[1].name, 'Benny', 'but the name stays');
  assert.equal((await clients[3].leave()).reason, 'not-joined');
  await assert.rejects(host.start(), (e) => e.reason === 'rules');
});

test('message edge cases: duplicates, stale rounds, outsiders and garbage change nothing', async () => {
  const setup = await started(5, { seed: 'edges' });
  const { backend, host, clients } = setup;
  const before = () => JSON.stringify(host.state.game);

  const first = await clients[1].submitTask('first try');
  assert.equal(first.ok, true);
  let snapshot = before();
  const duplicate = await clients[1].submitTask('second try');
  assert.equal(duplicate.reason, 'done');
  assert.equal(before(), snapshot, 'a refused message changes nothing');
  assert.equal(host.state.game.sentences[0][host.state.game.schedule.rounds[0].indexOf(1)], 'first try');

  await assert.rejects(host.advance(), (e) => e.reason === 'waiting');
  await playRound(setup);
  assert.equal(host.state.game.round, 1);

  // A late duplicate from round 0 must not count for round 1.
  snapshot = before();
  const stale = await clients[2].send('submit', { round: 0, text: 'old' });
  assert.equal(stale.reason, 'stale');
  assert.equal(host.state.game.submitted[1][2], false);
  assert.equal(before(), snapshot);

  // Someone who isn't in the game.
  const outsider = await Client.open({ transport: backend.connect('outsider'), code: host.code });
  assert.equal((await outsider.submitTask()).reason, 'not-joined');
  await settle(backend, host);
  assert.equal(outsider.view.you, null);

  // Garbage.
  assert.equal((await sendRaw(backend, host, 'uid-1', { type: 'dance', payload: '{}' })).reason, 'bad-message');
  assert.equal((await sendRaw(backend, host, 'uid-1', { type: 'submit', payload: '{nope' })).reason, 'bad-message');
  assert.equal((await sendRaw(backend, host, 'uid-1', { type: 'submit', payload: '[1]' })).reason, 'bad-message');
  assert.equal(before(), snapshot);
  assert.equal(backend.dump().games[host.code].inbox, undefined, 'handled messages are deleted');
});
