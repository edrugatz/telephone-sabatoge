import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { Host, MAX_PLAYERS } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { createRng } from '../js/game/rng.js';
import { Bots, BOT_NAMES } from '../js/ui/bots.js';
import { createSessionStore, memoryStorage } from '../js/ui/session.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(backend, ...hosts) {
  for (let quiet = 0, i = 0; quiet < 3; i++) {
    if (i > 10000) throw new Error('did not settle');
    await tick();
    await Promise.all(hosts.map((h) => h.idle()));
    quiet = backend.pending === 0 ? quiet + 1 : 0;
  }
}

/** One transport per bot app name, like connectFirebase(config, { name }). */
function botConnector(backend) {
  const transports = new Map();
  return async (app) => {
    if (!transports.has(app)) transports.set(app, backend.connect(`uid-${app}`));
    return transports.get(app);
  };
}

/** The host phone: a session store, a host that saves its backup, the host's own client and bots. */
async function hostPhone(backend, storage) {
  const store = createSessionStore(storage);
  const transport = backend.connect('uid-host');
  const host = await Host.create({
    transport,
    hostName: 'Ana',
    random: createRng('bots').next,
    onSave: (json) => store.saveBackup(json),
  });
  store.save({ code: host.code, role: 'host', uid: transport.uid, name: 'Ana', bots: [] });
  const client = await Client.open({ transport, code: host.code });
  return { store, host, client };
}

test('host creates a game, 7 bots join, a host reload keeps the lobby', async () => {
  const backend = createMemoryBackend();
  const storage = memoryStorage();
  const connect = botConnector(backend);
  const { store, host, client } = await hostPhone(backend, storage);

  const bots = new Bots({
    connect,
    code: host.code,
    apps: [],
    onApps: (apps) => store.save({ ...store.load('uid-host'), bots: apps }),
  });
  for (let i = 0; i < 7; i++) await bots.add(host.state.seats);
  await settle(backend, host);

  const names = ['Ana', ...BOT_NAMES.slice(0, 7)];
  assert.deepEqual(client.view.players, names);
  assert.equal(client.view.you.host, true);
  assert.deepEqual(store.load('uid-host').bots, ['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5', 'bot-6', 'bot-7']);
  for (const bot of bots.clients.values()) assert.equal(bot.view.stage, 'lobby');

  // Reload: everything in memory is gone except storage and the database.
  host.stop();
  client.close();
  bots.close();
  const session = createSessionStore(storage).load('uid-host');
  assert.equal(session.code, host.code);
  const resumed = await Host.resume({ transport: backend.connect('uid-host'), code: session.code, backup: store.loadBackup(session.code) });
  const again = await Client.open({ transport: backend.connect('uid-host'), code: session.code });
  await settle(backend, resumed);
  assert.deepEqual(again.view.players, names);
  assert.equal(resumed.state.stage, 'lobby');

  // A player reload: the same uid reopens the game and is still seated.
  const reopened = await Client.open({ transport: await connect('bot-3'), code: session.code });
  await settle(backend, resumed);
  assert.equal(reopened.view.you.name, BOT_NAMES[2]);

  // Host resume works from the localStorage backup when the database has no host state.
  resumed.stop();
  await backend.connect('uid-host').remove(`games/${session.code}/hostState`);
  const fromBackup = await Host.resume({ transport: backend.connect('uid-host'), code: session.code, backup: store.loadBackup(session.code) });
  assert.equal(fromBackup.state.seats.length, 8);
  fromBackup.stop();
});

test('bots skip taken names, reuse a removed bot and stop at the player limit', async () => {
  const backend = createMemoryBackend();
  const connect = botConnector(backend);
  const { host } = await hostPhone(backend, memoryStorage());
  const human = await Client.join({ transport: backend.connect('uid-human'), code: host.code, name: 'bot ada' });
  assert.equal(human.view.you.name, 'bot ada');

  const bots = new Bots({ connect, code: host.code });
  const first = await bots.add(host.state.seats);
  assert.equal(first.name, 'Bot Bea');

  await host.kick(first.uid);
  const again = await bots.add(host.state.seats);
  assert.equal(again.app, first.app, 'the removed bot app is reused');
  assert.deepEqual(bots.apps, ['bot-1']);

  while (host.state.seats.length < MAX_PLAYERS) await bots.add(host.state.seats);
  await assert.rejects(bots.add(host.state.seats), { reason: 'full' });

  await host.openRules();
  await host.backToLobby(); // still in the lobby: one more kick, then a join after the lobby closes is refused
  await host.kick(again.uid);
  await host.openRules();
  await assert.rejects(bots.add(host.state.seats), { reason: 'started' });
  host.stop();
  bots.close();
});
