import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from '../js/sync/memory-transport.js';
import { Host } from '../js/game/host.js';
import { Client } from '../js/game/client.js';
import { createRng } from '../js/game/rng.js';
import { revengeOptions, MAX_RULE_LENGTH } from '../js/game/game.js';
import { Bots } from '../js/ui/bots.js';
import { createSessionStore } from '../js/ui/session.js';
import { revengePrompt, revengeSent, revengeTexts, revengeSentTexts, checkRevenge } from '../js/ui/revenge.js';

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
async function startedGame(seed, botCount = 7) {
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

/** Everyone finishes the round (Ana with a sentence when needed), then the host advances. */
async function finishRound({ backend, host, ana, bots }) {
  if (!ana.view.task.done) {
    const text = ana.view.task.task === 'draw' ? undefined : `Ana in round ${ana.view.round}`;
    assert.equal((await ana.submitTask(text)).ok, true);
    await settle(backend, host);
  }
  await bots.doTasks(host.state.seats, ana.view.waitingFor, ana.view.round);
  await settle(backend, host);
  await host.advance();
  await settle(backend, host);
}

const option = (target, targetName, extra = {}) => ({ target, targetName, round: 3, type: 'draw', ok: true, reason: null, ...extra });
const playing = (revenge, extra = {}) => ({ stage: 'playing', round: 2, revenge, myRevenge: null, ...extra });

test('prompt: none when revenge is unavailable, only the open targets otherwise', () => {
  for (const reason of ['not-playing', 'used', 'last-round', 'no-rule']) {
    assert.equal(revengePrompt(playing({ reason, options: [] })), null, reason);
  }
  assert.equal(revengePrompt(null), null);
  assert.equal(revengePrompt({ stage: 'finished', round: 4 }), null);
  // Every target in conflict or taken: no prompt, and no hint about why (it would reveal the routing).
  const blocked = playing({ reason: null, options: [option(1, 'Ben', { ok: false, reason: 'conflict' }), option(2, 'Cy', { ok: false, reason: 'taken' })] });
  assert.equal(revengePrompt(blocked), null);
  // Already sent this game.
  assert.equal(revengePrompt(playing({ reason: null, options: [option(1, 'Ben')] }, { myRevenge: { target: 1, targetName: 'Ben', round: 3, text: 'x' } })), null);

  const one = revengePrompt(playing({ reason: null, options: [option(1, 'Ben'), option(2, 'Cy', { ok: false, reason: 'conflict' })] }));
  assert.deepEqual(one, { round: 2, type: 'draw', targets: [{ target: 1, name: 'Ben' }] });
  const two = revengePrompt(playing({ reason: null, options: [option(1, 'Ben', { type: 'write' }), option(2, 'Cy', { type: 'write' })] }));
  assert.deepEqual(two.targets.map((t) => t.name), ['Ben', 'Cy']);
  assert.equal(two.type, 'write');
});

test('prompt texts, sent card and phone-side checks', () => {
  const one = { round: 2, type: 'draw', targets: [{ target: 1, name: 'Ben' }] };
  const t = revengeTexts(one, 'Ben');
  assert.equal(t.title, '🔥 Take revenge on Ben?');
  assert.equal(t.why, 'Ben gave you a rule this round. Once per game you can write one back.');
  assert.match(t.ask, /^🎨 Drawing rule for Ben's next drawing\./);
  assert.equal(t.send, 'Send revenge to Ben 🔥');
  assert.equal(t.skip, 'Skip');
  const two = { round: 3, type: 'write', targets: [{ target: 1, name: 'Ben' }, { target: 2, name: 'Cy' }] };
  assert.equal(revengeTexts(two, 'Cy').title, '🔥 Take revenge on Ben or Cy?');
  assert.match(revengeTexts(two, 'Cy').why, /^Ben and Cy gave you rules/);
  assert.match(revengeTexts(two, 'Cy').ask, /^✍️ Writing rule for Cy's next interpretation\./);

  const sent = { target: 1, targetName: 'Ben', round: 3, text: 'Only circles' };
  assert.equal(revengeSent({ stage: 'playing', round: 2, myRevenge: sent }), sent, 'shown in the round it was sent');
  assert.equal(revengeSent({ stage: 'playing', round: 3, myRevenge: sent }), null, 'gone the next round');
  assert.equal(revengeSentTexts(sent).title, '🔥 Revenge sent to Ben');

  assert.equal(checkRevenge('   '), 'Write your revenge rule first');
  assert.match(checkRevenge('x'.repeat(MAX_RULE_LENGTH + 1)), /At most 80/);
  assert.equal(checkRevenge(' Only circles '), null);
});

test('revenge draft survives a reload, only for its game and round', () => {
  const store = createSessionStore();
  store.saveRevengeDraft('ABCDE', 2, 'Only circles', 3);
  assert.deepEqual(store.loadRevengeDraft('ABCDE', 2), { text: 'Only circles', target: 3 });
  assert.equal(store.loadRevengeDraft('ABCDE', 3), null);
  assert.equal(store.loadRevengeDraft('XYZWV', 2), null);
  store.forgetRevengeDraft();
  assert.equal(store.loadRevengeDraft('ABCDE', 2), null);
  store.saveRevengeDraft('ABCDE', 2, 'x');
  store.clear();
  assert.equal(store.loadRevengeDraft('ABCDE', 2), null);
});

test('played game: Ana takes revenge once, the target sees it next round, the prompt never comes back', async () => {
  // Find a seed where Ana gets a revenge chance before the last round.
  let game = null;
  let chance = null;
  for (let s = 0; s < 40 && !chance; s++) {
    const g = await startedGame(`p9b-${s}`);
    const { k } = g.host.state.game.schedule;
    for (let r = 0; r < k; r++) {
      // Every phone, every round: the prompt matches the host's options, and is never there in round 0.
      for (const [p, client] of g.clients.entries()) {
        const prompt = revengePrompt(client.view);
        const { reason, options } = revengeOptions(g.host.state.game, p);
        assert.equal(!!prompt, !reason && options.some((o) => o.ok), `round ${r}, player ${p}`);
        if (r === 0) assert.equal(prompt, null, 'no revenge in round 0');
      }
      if (revengePrompt(g.ana.view)) {
        chance = r;
        break;
      }
      await finishRound(g);
    }
    if (chance === null) {
      g.host.stop();
      g.bots.close();
    } else {
      game = g;
    }
  }
  assert.ok(game, 'some seed gives Ana a revenge chance');
  const { backend, host, ana, clients } = game;
  const { k } = host.state.game.schedule;

  const prompt = revengePrompt(ana.view);
  const target = prompt.targets[0];
  const expectedType = (chance + 1) % 2 === 1 ? 'draw' : 'write';
  assert.equal(prompt.type, expectedType, 'the rule type follows the target\'s next task');
  // The rule came from the target this round.
  assert.ok(ana.view.task.rules.some((rule) => rule.author === target.target));

  // Ana does her task first, then takes revenge from the waiting screen (allowed until the host advances).
  const text = ana.view.task.task === 'draw' ? undefined : 'Ana writes';
  assert.equal((await ana.submitTask(text)).ok, true);
  await settle(backend, host);
  assert.ok(revengePrompt(ana.view), 'still offered after Done');
  const result = await ana.revenge('Draw it with your elbow', target.target);
  assert.equal(result.ok, true, result.message);
  await settle(backend, host);
  assert.equal(revengePrompt(ana.view), null, 'no second prompt in the same round');
  assert.deepEqual(revengeSent(ana.view), { target: target.target, targetName: target.name, round: chance + 1, text: 'Draw it with your elbow' });
  // A second try is refused by the host too.
  assert.equal((await ana.revenge('Again', target.target)).ok, false);
  await settle(backend, host);

  await finishRound(game);
  // The target's next task shows it, marked as revenge, with Ana's name.
  const targetTask = clients[target.target].view.task;
  assert.equal(targetTask.round, chance + 1);
  const shown = targetTask.rules.find((rule) => rule.revenge);
  assert.deepEqual(
    { authorName: shown.authorName, text: shown.text, type: shown.type },
    { authorName: 'Ana', text: 'Draw it with your elbow', type: expectedType },
  );
  assert.ok(targetTask.rules.length <= 2);
  assert.equal(revengeSent(ana.view), null, 'the sent card is gone next round');

  // The prompt never appears again for Ana, through the last round.
  for (let r = chance + 1; r <= k; r++) {
    assert.equal(revengePrompt(ana.view), null, `round ${r}`);
    assert.equal(ana.view.revenge.reason, 'used');
    if (r === k) for (const client of clients) assert.equal(revengePrompt(client.view), null, 'no revenge in the last round');
    await finishRound(game);
  }
  assert.equal(ana.view.stage, 'finished');
  host.stop();
  game.bots.close();
});

test('bots take revenge: one per target, each bot at most once, the targets see it', async () => {
  const g = await startedGame('p9b-bots');
  const { backend, host, bots, clients } = g;
  const game = () => host.state.game;
  await finishRound(g); // round 0 has no rules
  const round = game().round;
  const took = await bots.takeRevenge(host.state.seats, round, (p) => revengeOptions(game(), p));
  await settle(backend, host);
  assert.ok(took > 0, 'some bot can take revenge in round 1');
  const revenges = game().revenges;
  assert.equal(revenges.length, took);
  assert.ok(revenges.every((rv) => rv.author !== 0), 'Ana (not a bot) took none');
  assert.equal(new Set(revenges.map((rv) => rv.target)).size, took, 'one revenge per target');
  // Asking again: nobody who already took it takes another.
  await bots.takeRevenge(host.state.seats, round, (p) => revengeOptions(game(), p));
  await settle(backend, host);
  for (const author of new Set(game().revenges.map((rv) => rv.author))) {
    assert.equal(game().revenges.filter((rv) => rv.author === author).length, 1);
  }
  await finishRound(g);
  for (const rv of game().revenges.filter((x) => x.round === round + 1)) {
    const rule = clients[rv.target].view.task.rules.find((x) => x.revenge);
    assert.equal(rule.authorName, game().players[rv.author]);
  }
  host.stop();
  bots.close();
});
