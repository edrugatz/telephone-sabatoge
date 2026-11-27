import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { Host } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { MAX_RULE_LENGTH } from '../js/game/game.js';
import { createRng } from '../js/game/rng.js';
import { Bots, BOT_NAMES, BOT_RULES, botRules } from '../js/ui/bots.js';
import { emptyDraft, checkDraft, normalizeDraft, draftToRules } from '../js/ui/rule-draft.js';
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

const RULES = [
  { type: 'draw', text: 'No straight lines' },
  { type: 'write', text: 'Exactly seven words' },
  { type: 'draw', text: 'Include a tiny animal' },
];

// ---- Draft checks -------------------------------------------------------------------

test('checkDraft: a filled draft passes; empty, too long and one-type drafts fail', () => {
  const empty = emptyDraft();
  assert.deepEqual(empty.map((r) => r.type), ['draw', 'write', 'draw']);
  const blank = checkDraft(empty);
  assert.equal(blank.ok, false);
  assert.deepEqual(blank.errors, ['Write a rule here', 'Write a rule here', 'Write a rule here']);
  assert.equal(blank.message, null, 'the default types already have one of each');

  assert.deepEqual(checkDraft(RULES), { ok: true, errors: [null, null, null], message: null });
  assert.equal(checkDraft([...RULES.slice(0, 2), { type: 'draw', text: '   ' }]).errors[2], 'Write a rule here');

  const exact = 'x'.repeat(MAX_RULE_LENGTH);
  assert.equal(checkDraft([{ type: 'draw', text: `  ${exact}  ` }, ...RULES.slice(1)]).ok, true, 'spaces around do not count');
  const long = checkDraft([{ type: 'draw', text: `${exact}y` }, ...RULES.slice(1)]);
  assert.equal(long.ok, false);
  assert.match(long.errors[0], /At most 80 characters \(this one has 81\)/);

  const allDraw = checkDraft(RULES.map((r) => ({ ...r, type: 'draw' })));
  assert.equal(allDraw.ok, false);
  assert.deepEqual(allDraw.errors, [null, null, null]);
  assert.match(allDraw.message, /one drawing rule and one writing rule/);

  assert.equal(checkDraft(RULES.slice(0, 2)).ok, false);
  assert.equal(checkDraft(null).ok, false);
});

test('normalizeDraft and draftToRules', () => {
  assert.equal(normalizeDraft([{ type: 'paint', text: '' }, ...RULES.slice(1)]), null);
  assert.equal(normalizeDraft([{ type: 'draw' }, ...RULES.slice(1)]), null);
  assert.equal(normalizeDraft('nope'), null);
  assert.deepEqual(normalizeDraft(RULES.map((r) => ({ ...r, extra: 1 }))), RULES);
  assert.deepEqual(draftToRules([{ type: 'draw', text: '  hi  ' }, ...RULES.slice(1)])[0], { type: 'draw', text: 'hi' });
});

test('session keeps the rule draft per game code and clear() drops it', () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  assert.equal(store.loadDraft('ABCDE'), null);
  store.saveDraft('ABCDE', [{ type: 'write', text: 'half-typed ' }, ...RULES.slice(1)]);
  assert.equal(createSessionStore(storage).loadDraft('ABCDE')[0].text, 'half-typed ', 'survives a reload, untrimmed');
  assert.equal(store.loadDraft('ZZZZZ'), null, 'another game does not get it');
  storage.setItem(KEYS.draft, '{broken');
  assert.equal(store.loadDraft('ABCDE'), null);
  store.saveDraft('ABCDE', RULES);
  store.clear();
  assert.equal(store.loadDraft('ABCDE'), null);
});

test('botRules: 3 different valid rules with both types', () => {
  const rng = createRng('bot-rules');
  for (let i = 0; i < 300; i++) {
    const rules = botRules(rng.next);
    assert.equal(checkDraft(rules).ok, true);
    assert.equal(new Set(rules.map((r) => r.text)).size, 3);
  }
  for (const text of [...BOT_RULES.draw, ...BOT_RULES.write]) assert.ok(text.length <= MAX_RULE_LENGTH);
});

// ---- Rules stage through the sync layer -----------------------------------------------

test('8 players write rules: Start stays blocked until all are in, edits replace, bad rules are refused', async () => {
  const backend = createMemoryBackend();
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  const connect = botConnector(backend);
  const host = await Host.create({
    transport: backend.connect('uid-host'),
    hostName: 'Ana',
    random: createRng('rules-stage').next,
    onSave: (json) => store.saveBackup(json),
  });
  const ana = await Client.open({ transport: backend.connect('uid-host'), code: host.code });
  const human = await Client.join({ transport: backend.connect('uid-ben'), code: host.code, name: 'Ben' });
  const bots = new Bots({ connect, code: host.code, random: createRng('bots').next });
  for (let i = 0; i < 6; i++) await bots.add(host.state.seats);

  // Rules can't be sent in the lobby.
  assert.equal((await human.submitRules(RULES)).reason, 'phase');

  await host.openRules();
  await settle(backend, host);
  const everyone = ['Ana', 'Ben', ...BOT_NAMES.slice(0, 6)];
  assert.deepEqual(ana.view.rules, { mine: [], missing: everyone });
  await assert.rejects(host.start(), { reason: 'rules' });

  // Bad rule sets are refused by the host and change nothing.
  assert.equal((await human.submitRules(RULES.map((r) => ({ ...r, type: 'draw' })))).reason, 'rules');
  assert.equal((await human.submitRules([{ type: 'draw', text: '' }, ...RULES.slice(1)])).reason, 'text');
  const tooLong = await human.submitRules([{ type: 'draw', text: 'x'.repeat(MAX_RULE_LENGTH + 1) }, ...RULES.slice(1)]);
  assert.equal(tooLong.reason, 'text');
  assert.match(tooLong.message, /at most 80 characters/);
  await settle(backend, host);
  assert.deepEqual(human.view.rules.mine, []);

  // Ben sends, then edits: the new rules replace the old ones.
  assert.equal((await human.submitRules(draftToRules([{ type: 'write', text: '  No letter "E"  ' }, ...RULES.slice(1)]))).ok, true);
  await settle(backend, host);
  assert.equal(human.view.rules.mine[0].text, 'No letter "E"');
  const edited = [{ type: 'write', text: 'Make it rhyme' }, ...RULES.slice(1)];
  assert.equal((await human.submitRules(edited)).ok, true);
  await settle(backend, host);
  assert.deepEqual(human.view.rules.mine, edited);
  assert.equal(host.state.game.rules.filter((r) => r.author === 1).length, 3);
  assert.deepEqual(ana.view.rules.missing, everyone.filter((n) => n !== 'Ben'));
  assert.equal(JSON.stringify(ana.view).includes('Make it rhyme'), false, "other players' rules stay hidden");

  // Three bots write rules; Start is still blocked.
  const firstThree = BOT_NAMES.slice(0, 3);
  assert.equal(await bots.writeRules(host.state.seats, firstThree), 3);
  await settle(backend, host);
  assert.deepEqual(ana.view.rules.missing, ['Ana', ...BOT_NAMES.slice(3, 6)]);
  await assert.rejects(host.start(), { reason: 'rules' });

  // Host reload: the bots' clients are gone too, writeRules reopens them.
  host.stop();
  ana.close();
  bots.close();
  const resumed = await Host.resume({ transport: backend.connect('uid-host'), code: host.code, backup: store.loadBackup(host.code) });
  const ana2 = await Client.open({ transport: backend.connect('uid-host'), code: host.code });
  await settle(backend, resumed);
  assert.equal(resumed.state.stage, 'rules');
  assert.equal(ana2.view.rules.missing.length, 4);

  const bots2 = new Bots({ connect, code: host.code, apps: bots.apps, random: createRng('bots-2').next });
  assert.equal(await bots2.writeRules(resumed.state.seats, ana2.view.rules.missing), 3, 'only the bots that are missing');
  await settle(backend, resumed);
  assert.deepEqual(ana2.view.rules.missing, ['Ana']);
  await assert.rejects(resumed.start(), { reason: 'rules' });
  assert.equal(await bots2.writeRules(resumed.state.seats, ana2.view.rules.missing), 0);

  // The host writes theirs; now Start works and a late rules message is refused.
  assert.equal((await ana2.submitRules(RULES)).ok, true);
  await settle(backend, resumed);
  assert.deepEqual(ana2.view.rules.missing, []);
  assert.deepEqual(ana2.public.missingRules, []);
  await resumed.start();
  await settle(backend, resumed);
  assert.equal(ana2.view.stage, 'playing');
  assert.equal(human.view.stage, 'playing');
  assert.equal((await human.submitRules(RULES)).reason, 'phase');

  resumed.stop();
  bots2.close();
});

test('back to the lobby drops the rules written so far', async () => {
  const backend = createMemoryBackend();
  const connect = botConnector(backend);
  const host = await Host.create({ transport: backend.connect('uid-host'), hostName: 'Ana', random: createRng('back').next });
  const ana = await Client.open({ transport: backend.connect('uid-host'), code: host.code });
  const bots = new Bots({ connect, code: host.code, random: createRng('b').next });
  for (let i = 0; i < 4; i++) await bots.add(host.state.seats);
  await host.openRules();
  await settle(backend, host);
  await bots.writeRules(host.state.seats, ana.view.rules.missing);
  await settle(backend, host);
  assert.deepEqual(ana.view.rules.missing, ['Ana']);

  await host.backToLobby();
  await host.openRules();
  await settle(backend, host);
  assert.equal(ana.view.rules.missing.length, 5);
  host.stop();
  bots.close();
});
