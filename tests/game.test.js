import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  setPlayers,
  submitRules,
  playersMissingRules,
  startGame,
  getTask,
  submitTask,
  waitingFor,
  advanceRound,
  revengeOptions,
  submitRevenge,
  chainHistory,
  transformationsOf,
  saveGame,
  loadGame,
  GameError,
} from '../js/game/game.js';
import { ruledTasksPerPlayer } from '../js/game/rules.js';
import { scoreGame } from '../js/game/score.js';

const NAMES = ['Ana', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon'];

function newGame(n, seed) {
  const game = createGame({ seed });
  setPlayers(game, NAMES.slice(0, n));
  game.players.forEach((name, p) =>
    submitRules(game, p, [
      { type: 'draw', text: `${name} draw A` },
      { type: 'draw', text: `${name} draw B` },
      { type: 'write', text: `${name} write` },
    ]),
  );
  return startGame(game);
}

const textFor = (game, p) => `round ${game.round} by ${game.players[p]}`;

/** Everyone does their task with dummy text, then the round advances. */
function playRound(game) {
  game.players.forEach((_, p) => {
    if (!getTask(game, p).done) submitTask(game, p, getTask(game, p).task === 'draw' ? undefined : textFor(game, p));
  });
  return advanceRound(game);
}

/** Start of every round of games with seeds g0, g1, … (nothing submitted yet). */
function* roundStarts(n, seeds = 300) {
  for (let s = 0; s < seeds; s++) {
    const game = newGame(n, `g${s}`);
    while (game.phase === 'playing') {
      yield game;
      playRound(game);
    }
  }
}

/** First round state where pick(copy) returns a hit; pick may play on the copy it gets. */
function find(n, pick) {
  for (const game of roundStarts(n)) {
    const copy = structuredClone(game);
    const hit = pick(copy);
    if (hit) return { game: copy, ...hit };
  }
  assert.fail('No game with this situation found');
}

const okOptions = (game) =>
  game.players.flatMap((_, p) => revengeOptions(game, p).options.filter((o) => o.ok).map((o) => ({ player: p, ...o })));

const throwsReason = (fn, reason) =>
  assert.throws(fn, (e) => e instanceof GameError && e.reason === reason, `expected GameError "${reason}"`);

test('plays a full 8-player game: tasks, pass-to, chains and scoring', () => {
  const game = newGame(8, 'full');
  const { k, rounds } = game.schedule;
  assert.equal(k, 6);
  const ruled = game.players.map(() => 0);
  let handed = {}; // player → sentence passed to them last round

  while (game.phase === 'playing') {
    const r = game.round;
    const next = {};
    assert.deepEqual(waitingFor(game), [0, 1, 2, 3, 4, 5, 6, 7]);
    game.players.forEach((name, p) => {
      const task = getTask(game, p);
      assert.equal(task.round, r);
      assert.equal(task.task, r === 0 ? 'write' : r % 2 ? 'draw' : 'interpret');
      if (task.task === 'draw') assert.equal(task.sentence, handed[p]);
      else assert.equal(task.sentence, null);
      if (r === 0) assert.deepEqual(task.rules, []);
      ruled[p] += task.rules.filter((x) => !x.revenge).length;
      for (const rule of task.rules) assert.equal(rule.authorName, game.players[rule.author]);

      const c = rounds[r].indexOf(p);
      if (r === k) assert.equal(task.passTo, 'reveal');
      else assert.deepEqual(task.passTo, { player: rounds[r + 1][c], name: game.players[rounds[r + 1][c]], task: r % 2 ? 'interpret' : 'draw' });

      const text = task.task === 'draw' ? undefined : textFor(game, p);
      submitTask(game, p, text);
      assert.equal(getTask(game, p).done, true);
      if (text && r < k) next[task.passTo.player] = text;
    });
    handed = next;
    advanceRound(game);
  }

  assert.equal(game.phase, 'finished');
  assert.deepEqual(ruled, game.players.map(() => ruledTasksPerPlayer(k, 0.5)));

  game.players.forEach((name, c) => {
    const h = chainHistory(game, c);
    assert.equal(h.creatorName, name);
    assert.equal(h.original, `round 0 by ${name}`);
    assert.equal(h.stages.length, k);
    h.stages.forEach((s, i) => {
      assert.equal(s.round, i + 1);
      assert.equal(s.player, rounds[i + 1][c]);
      assert.equal(s.task, i % 2 ? 'interpret' : 'draw');
      assert.equal(s.sentence, s.task === 'draw' ? null : `round ${s.round} by ${s.name}`);
    });
    assert.equal(h.stages.at(-1).task, 'interpret');
    assert.equal(new Set([c, ...h.stages.map((s) => s.player)]).size, k + 1, 'chain visits different players');
  });

  const ts = transformationsOf(game);
  assert.equal(ts.length, (8 * k) / 2);
  for (const t of ts) t.similarity = 60;
  const result = scoreGame(ts, game.players);
  for (const s of result.players) assert.equal(s.preservation, (k * 40) / 2);
});

test('save/load round-trips mid-game, including a pending revenge', () => {
  const { game, player, target } = find(8, (g) => (g.round >= 1 ? okOptions(g)[0] : null));
  submitRevenge(game, player, 'Only use circles', target);
  game.players.forEach((_, p) => p % 2 && submitTask(game, p, getTask(game, p).task === 'draw' ? undefined : 'half done'));

  const loaded = loadGame(saveGame(game));
  assert.deepEqual(loaded, game);

  playRound(loaded);
  const rules = getTask(loaded, target).rules;
  const rv = rules.find((x) => x.revenge);
  assert.ok(rv, 'target sees the revenge rule next round');
  assert.deepEqual([rv.author, rv.authorName, rv.text], [player, loaded.players[player], 'Only use circles']);
  assert.ok(rules.length <= 2);
  while (loaded.phase === 'playing') playRound(loaded);
  const ts = transformationsOf(loaded);
  assert.equal(ts.flatMap((t) => t.rules).filter((x) => x.revenge).length, 1);
});

test('revenge can be used only once per game', () => {
  const { game, player } = find(8, (g) => {
    const hit = okOptions(g)[0];
    if (!hit) return null;
    submitRevenge(g, hit.player, 'revenge 1', hit.target);
    playRound(g);
    while (g.phase === 'playing' && g.round < g.schedule.k) {
      if (getTask(g, hit.player).rules.length) return { player: hit.player };
      playRound(g);
    }
    return null;
  });
  assert.equal(revengeOptions(game, player).reason, 'used');
  throwsReason(() => submitRevenge(game, player, 'revenge 2'), 'used');
  assert.equal(game.revenges.filter((rv) => rv.author === player).length, 1);
});

test('revenge is not offered on a conflict of interest', () => {
  const { game, player, option } = find(8, (g) => {
    for (const [p] of g.players.entries()) {
      const option = revengeOptions(g, p).options.find((o) => o.reason === 'conflict');
      if (option) return { player: p, option };
    }
    return null;
  });
  assert.equal(option.ok, false);
  // The conflict: the revenger would interpret the target's next drawing.
  const { rounds } = game.schedule;
  const tc = rounds[option.round].indexOf(option.target);
  assert.ok([rounds[option.round - (option.round % 2 ? 0 : 1)][tc], rounds[option.round + (option.round % 2)][tc]].includes(player));
  throwsReason(() => submitRevenge(game, player, 'nope', option.target), 'conflict');
  assert.equal(game.revenges.length, 0);
});

test('two revengers on one target: the second is refused and keeps their revenge', () => {
  const { game, second } = find(8, (g) => {
    const opts = okOptions(g);
    for (const a of opts) {
      const b = opts.find((o) => o.target === a.target && o.player !== a.player);
      if (!b) continue;
      const sim = structuredClone(g);
      submitRevenge(sim, a.player, 'first', a.target);
      if (revengeOptions(sim, b.player).options.find((o) => o.target === a.target)?.reason !== 'taken') continue;
      playRound(sim);
      while (sim.phase === 'playing') {
        if (revengeOptions(sim, b.player).options.some((o) => o.ok)) {
          submitRevenge(g, a.player, 'first', a.target);
          return { second: b };
        }
        playRound(sim);
      }
    }
    return null;
  });
  throwsReason(() => submitRevenge(game, second.player, 'second', second.target), 'taken');
  assert.equal(game.revenges.length, 1);
  playRound(game);
  while (!revengeOptions(game, second.player).options.some((o) => o.ok)) playRound(game);
  const later = revengeOptions(game, second.player).options.find((o) => o.ok);
  submitRevenge(game, second.player, 'second, later', later.target);
  assert.equal(game.revenges.filter((rv) => rv.author === second.player).length, 1);
});

test('revenge back: the target can take revenge on the revenger in r + 2', () => {
  const { game, v, x } = find(8, (g) => {
    for (const o of okOptions(g)) {
      const sim = structuredClone(g);
      submitRevenge(sim, o.player, 'revenge', o.target);
      playRound(sim);
      const back = revengeOptions(sim, o.target).options.find((b) => b.target === o.player && b.ok);
      if (back) {
        submitRevenge(g, o.player, 'revenge', o.target);
        return { v: o.player, x: o.target };
      }
    }
    return null;
  });
  const r = game.round;
  playRound(game);
  submitRevenge(game, x, 'revenge back', v);
  assert.deepEqual(
    game.revenges.map(({ author, target, round }) => ({ author, target, round })),
    [
      { author: v, target: x, round: r + 1 },
      { author: x, target: v, round: r + 2 },
    ],
  );
  playRound(game);
  assert.ok(getTask(game, v).rules.some((rule) => rule.revenge && rule.author === x));
  while (game.phase === 'playing') playRound(game);
  const revenge = transformationsOf(game).flatMap((t) => t.rules).filter((rule) => rule.revenge);
  assert.equal(revenge.length, 2);
});

test('no revenge in round 0 or in the last round', () => {
  const game = newGame(8, 'edges');
  for (const [p] of game.players.entries()) assert.equal(revengeOptions(game, p).reason, 'no-rule');
  throwsReason(() => submitRevenge(game, 0, 'x'), 'no-rule');
  while (game.round < game.schedule.k) playRound(game);
  const ruled = game.players.findIndex((_, p) => getTask(game, p).rules.length);
  assert.ok(ruled >= 0);
  assert.equal(revengeOptions(game, ruled).reason, 'last-round');
  throwsReason(() => submitRevenge(game, ruled, 'x'), 'last-round');
  playRound(game);
  assert.equal(revengeOptions(game, ruled).reason, 'not-playing');
});

test('rejects invalid calls', () => {
  assert.throws(() => createGame({}), TypeError);
  const game = createGame({ seed: 'errors' });
  throwsReason(() => setPlayers(game, ['a', 'b', 'c', 'd']), 'players');
  throwsReason(() => setPlayers(game, ['a', 'b', 'c', 'd', 'A']), 'players');
  throwsReason(() => setPlayers(game, ['a', 'b', ' ', 'd', 'e']), 'players');
  setPlayers(game, [' Ana ', 'Ben', 'Cat', 'Dan', 'Eve']);
  assert.equal(game.players[0], 'Ana');
  throwsReason(() => getTask(game, 0), 'phase');
  throwsReason(() => submitRules(game, 0, [{ type: 'draw', text: 'a' }, { type: 'draw', text: 'b' }, { type: 'draw', text: 'c' }]), 'rules');
  throwsReason(() => submitRules(game, 0, [{ type: 'draw', text: 'a' }, { type: 'write', text: '' }, { type: 'draw', text: 'c' }]), 'text');
  throwsReason(() => submitRules(game, 9, []), 'player');
  for (let p = 0; p < 4; p++) {
    submitRules(game, p, [{ type: 'draw', text: 'a' }, { type: 'write', text: 'b' }, { type: 'draw', text: 'c' }]);
  }
  assert.deepEqual(playersMissingRules(game), [4]);
  throwsReason(() => startGame(game), 'rules');
  submitRules(game, 4, [{ type: 'write', text: 'a' }, { type: 'write', text: 'b' }, { type: 'draw', text: 'c' }]);
  startGame(game);
  throwsReason(() => setPlayers(game, NAMES), 'phase');

  throwsReason(() => submitTask(game, 0, '   '), 'text');
  submitTask(game, 0, 'hello');
  throwsReason(() => submitTask(game, 0, 'again'), 'done');
  throwsReason(() => advanceRound(game), 'waiting');
  throwsReason(() => transformationsOf(game), 'phase');

  throwsReason(() => loadGame('not json'), 'load');
  throwsReason(() => loadGame(JSON.stringify({ ...game, version: 2 })), 'load');
  throwsReason(() => loadGame(JSON.stringify({ ...game, sentences: [] })), 'load');
  assert.deepEqual(loadGame(saveGame(game)), game);
});
