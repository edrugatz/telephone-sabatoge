// Game state model (SPEC §3–§6, §8). Pure ES module (no DOM / Node APIs), shared by the browser and the tests.
//
// The whole game is one plain JSON object. Functions change it in place and return it; bad calls throw
// GameError with a `reason`. Phases: 'setup' (players + rules) → 'playing' (rounds 0…k) → 'finished'.
//
//   {
//     version: 1, phase, seed, ruleRate, maxTasks (null = no cap),
//     players: ['Ana', …],               // index = player id
//     rules: [{ author, type, text }],   // sorted by author; rule index = array index
//     schedule, ruleAt, ruleWarnings,    // from generateSchedule() / assignRules(), null in setup
//     round,                             // current round 0…k
//     sentences[r][c],                   // text for even rounds (0 = originals), null otherwise / not yet
//     submitted[r][p],                   // player p finished their round-r task
//     revenges: [{ author, target, round, text }],  // round = the target's task round (r + 1)
//   }
//
// Players never see chain indices: getTask() only tells them what to do and who to pass the paper to.

import { generateSchedule, validateSchedule, taskType, MIN_PLAYERS } from './schedule.js';
import { assignRules, validateRulePool, ruleTypeForRound, RULE_TYPES, RULES_PER_PLAYER, DEFAULT_RULE_RATE } from './rules.js';
import { buildTransformations } from './score.js';

export const GAME_VERSION = 1;
const PHASES = ['setup', 'playing', 'finished'];

/**
 * Thrown on an invalid call. `reason`: 'phase' | 'player' | 'players' | 'rules' | 'text' | 'done' | 'waiting'
 * | 'load' | 'target' | a revenge reason ('used', 'no-rule', 'last-round', 'conflict', 'taken').
 */
export class GameError extends Error {
  constructor(message, reason, details = {}) {
    super(message);
    this.name = 'GameError';
    this.reason = reason;
    Object.assign(this, details);
  }
}

const fail = (message, reason, details) => {
  throw new GameError(message, reason, details);
};

function needPhase(game, phase) {
  if (!game || game.phase !== phase) fail(`This needs the game to be in the "${phase}" phase`, 'phase');
}

function needPlayer(game, p) {
  if (!(Number.isInteger(p) && p >= 0 && p < game.players.length)) fail(`Unknown player ${p}`, 'player');
}

const cleanText = (text, what) => {
  if (typeof text !== 'string' || !text.trim()) fail(`${what} can't be empty`, 'text');
  return text.trim();
};

const grid = (rows, cols, value) => Array.from({ length: rows }, () => Array(cols).fill(value));

/** The transformation (drawer, interpreter) that task (r, c) belongs to (r ≥ 1). */
function transformationOf(rounds, r, c) {
  const first = r % 2 === 1 ? r : r - 1;
  return { drawer: rounds[first][c], interpreter: rounds[first + 1][c] };
}

/** Active rules on task (r, c): the scheduled one, then a revenge one. */
function activeRules(game, r, c) {
  const { schedule, ruleAt, rules, revenges, players } = game;
  const list = [];
  const i = ruleAt[r][c];
  if (i !== null) {
    const rule = rules[i];
    list.push({ author: rule.author, authorName: players[rule.author], type: rule.type, text: rule.text, revenge: false });
  }
  const holder = schedule.rounds[r][c];
  const rv = revenges.find((x) => x.round === r && x.target === holder);
  if (rv) {
    list.push({ author: rv.author, authorName: players[rv.author], type: ruleTypeForRound(r), text: rv.text, revenge: true });
  }
  return list;
}

// ---- Setup ------------------------------------------------------------------

/**
 * New game in the setup phase.
 * @param {{ seed: string|number, ruleRate?: number, maxTasks?: number|null }} options
 */
export function createGame({ seed, ruleRate = DEFAULT_RULE_RATE, maxTasks = null } = {}) {
  if (!(typeof seed === 'string' ? seed.length > 0 : Number.isFinite(seed))) {
    throw new TypeError('createGame needs a seed (game code)');
  }
  if (typeof ruleRate !== 'number' || !(ruleRate >= 0 && ruleRate <= 1)) {
    throw new TypeError(`ruleRate must be a number from 0 to 1, got ${ruleRate}`);
  }
  if (maxTasks !== null && !(Number.isInteger(maxTasks) && maxTasks >= 2)) {
    throw new TypeError(`maxTasks must be null or an integer ≥ 2, got ${maxTasks}`);
  }
  return {
    version: GAME_VERSION,
    phase: 'setup',
    seed,
    ruleRate,
    maxTasks,
    players: [],
    rules: [],
    schedule: null,
    ruleAt: null,
    ruleWarnings: [],
    round: 0,
    sentences: null,
    submitted: null,
    revenges: [],
  };
}

/** Set the player names (trimmed, unique ignoring case, at least MIN_PLAYERS). Clears submitted rules. */
export function setPlayers(game, names) {
  needPhase(game, 'setup');
  if (!Array.isArray(names)) fail('Players must be a list of names', 'players');
  const clean = names.map((name) => (typeof name === 'string' ? name.trim() : ''));
  if (clean.some((name) => !name)) fail('Every player needs a name', 'players');
  const seen = new Set();
  for (const name of clean) {
    const key = name.toLowerCase();
    if (seen.has(key)) fail(`Two players are called "${name}"`, 'players');
    seen.add(key);
  }
  if (clean.length < MIN_PLAYERS) fail(`Need at least ${MIN_PLAYERS} players (got ${clean.length})`, 'players');
  game.players = clean;
  game.rules = [];
  return game;
}

/** Submit (or replace) a player's 3 rules: [{ type: 'draw' | 'write', text }], at least one of each type. */
export function submitRules(game, player, list) {
  needPhase(game, 'setup');
  needPlayer(game, player);
  const name = game.players[player];
  if (!Array.isArray(list) || list.length !== RULES_PER_PLAYER) {
    fail(`${name} needs exactly ${RULES_PER_PLAYER} rules`, 'rules');
  }
  const own = list.map((rule) => {
    if (!rule || !RULE_TYPES.includes(rule.type)) fail(`${name}: every rule needs a type (drawing or writing)`, 'rules');
    return { author: player, type: rule.type, text: cleanText(rule.text, 'A rule') };
  });
  for (const type of RULE_TYPES) {
    if (!own.some((r) => r.type === type)) {
      fail(`${name} needs at least one ${type === 'draw' ? 'drawing' : 'writing'} rule`, 'rules');
    }
  }
  game.rules = [...game.rules.filter((r) => r.author !== player), ...own].sort((a, b) => a.author - b.author);
  return game;
}

/** Players who still have to submit their rules. */
export function playersMissingRules(game) {
  return game.players.map((_, p) => p).filter((p) => !game.rules.some((r) => r.author === p));
}

/** Check the rule pool, generate the schedule and assign rules, then start round 0. */
export function startGame(game) {
  needPhase(game, 'setup');
  if (game.players.length < MIN_PLAYERS) fail(`Need at least ${MIN_PLAYERS} players`, 'players');
  const pool = validateRulePool(game.rules, game.players);
  if (!pool.ok) fail(pool.errors[0].message, 'rules', { errors: pool.errors });

  const schedule = generateSchedule(game.players, game.seed, { maxTasks: game.maxTasks ?? Infinity });
  const assignment = assignRules(schedule, game.rules, game.seed, { ruleRate: game.ruleRate });
  const n = game.players.length;
  Object.assign(game, {
    phase: 'playing',
    schedule,
    ruleAt: assignment.ruleAt,
    ruleWarnings: assignment.warnings,
    round: 0,
    sentences: grid(schedule.k + 1, n, null),
    submitted: grid(schedule.k + 1, n, false),
    revenges: [],
  });
  return game;
}

// ---- Rounds -----------------------------------------------------------------

/**
 * What player p does this round.
 * @returns {{ round, lastRound, task: 'write'|'draw'|'interpret', sentence: string|null, rules: object[],
 *   passTo: { player, name, task } | 'reveal', done: boolean }}
 *   sentence = the sentence to draw (drawing tasks only); rules = [] means "No rule this time".
 */
export function getTask(game, player) {
  needPhase(game, 'playing');
  needPlayer(game, player);
  const { schedule, round: r } = game;
  const c = schedule.rounds[r].indexOf(player);
  const task = taskType(r);
  let passTo = 'reveal';
  if (r < schedule.k) {
    const next = schedule.rounds[r + 1][c];
    passTo = { player: next, name: game.players[next], task: taskType(r + 1) };
  }
  return {
    round: r,
    lastRound: schedule.k,
    task,
    sentence: task === 'draw' ? game.sentences[r - 1][c] : null,
    rules: r === 0 ? [] : activeRules(game, r, c),
    passTo,
    done: game.submitted[r][player],
  };
}

/** Finish player p's task. Writing and interpreting need text; drawing takes none. */
export function submitTask(game, player, text) {
  needPhase(game, 'playing');
  needPlayer(game, player);
  const r = game.round;
  if (game.submitted[r][player]) fail(`${game.players[player]} already finished this round`, 'done');
  if (taskType(r) !== 'draw') {
    const c = game.schedule.rounds[r].indexOf(player);
    game.sentences[r][c] = cleanText(text, 'The sentence');
  }
  game.submitted[r][player] = true;
  return game;
}

/** Players who haven't finished the current round. */
export function waitingFor(game) {
  needPhase(game, 'playing');
  return game.players.map((_, p) => p).filter((p) => !game.submitted[game.round][p]);
}

/** Go to the next round once everyone is done; after the last round the game is finished. */
export function advanceRound(game) {
  const waiting = waitingFor(game);
  if (waiting.length) {
    fail(`Still waiting for ${waiting.map((p) => game.players[p]).join(', ')}`, 'waiting', { waiting });
  }
  if (game.round === game.schedule.k) game.phase = 'finished';
  else game.round++;
  return game;
}

// ---- Revenge (SPEC §4) --------------------------------------------------------

/**
 * Can player V take revenge now (round r) on someone whose rule they got in round r?
 * @returns {{ reason: string|null, options: { target, targetName, round, type, ok, reason }[] }}
 *   reason (whole revenge unavailable): 'not-playing' | 'used' | 'last-round' | 'no-rule'
 *   option reason (that target unavailable): 'conflict' | 'taken'
 */
export function revengeOptions(game, player) {
  if (!game || game.phase !== 'playing') return { reason: 'not-playing', options: [] };
  needPlayer(game, player);
  if (game.revenges.some((rv) => rv.author === player)) return { reason: 'used', options: [] };
  const { schedule, round: r } = game;
  if (r === schedule.k) return { reason: 'last-round', options: [] };
  if (r === 0) return { reason: 'no-rule', options: [] };

  const c = schedule.rounds[r].indexOf(player);
  const targets = [...new Set(activeRules(game, r, c).map((rule) => rule.author))];
  if (!targets.length) return { reason: 'no-rule', options: [] };

  const next = r + 1;
  const options = targets.map((target) => {
    const tc = schedule.rounds[next].indexOf(target);
    const { drawer, interpreter } = transformationOf(schedule.rounds, next, tc);
    let reason = null;
    if (player === drawer || player === interpreter) reason = 'conflict';
    else if (game.revenges.some((rv) => rv.round === next && rv.target === target)) reason = 'taken';
    return { target, targetName: game.players[target], round: next, type: ruleTypeForRound(next), ok: !reason, reason };
  });
  return { reason: null, options };
}

/** Write a revenge rule. `target` is needed only when there is more than one option. */
export function submitRevenge(game, player, text, target) {
  const { reason, options } = revengeOptions(game, player);
  const messages = {
    'not-playing': 'The game is not running',
    used: `${game?.players?.[player]} already used their revenge`,
    'last-round': 'No revenge in the last round',
    'no-rule': `${game?.players?.[player]} got no rule this round`,
  };
  if (reason) fail(messages[reason], reason);
  if (target === undefined) {
    if (options.length > 1) fail('Choose who to take revenge on', 'target');
    target = options[0].target;
  }
  const option = options.find((o) => o.target === target);
  if (!option) fail(`${game.players[target] ?? target} gave no rule to ${game.players[player]} this round`, 'target');
  if (option.reason === 'conflict') fail(`${game.players[player]} is part of ${option.targetName}'s next task`, 'conflict');
  if (option.reason === 'taken') fail(`Someone already took revenge on ${option.targetName} this round`, 'taken');
  game.revenges.push({ author: player, target, round: option.round, text: cleanText(text, 'The revenge rule') });
  return game;
}

// ---- Results ------------------------------------------------------------------

/**
 * Chain c as played so far: original sentence and every finished stage.
 * @returns {{ chain, creator, creatorName, original, stages: { round, task, player, name, sentence, rules }[] }}
 *   sentence = the interpretation (null for drawings); rules include revenge ones (revenge: true).
 */
export function chainHistory(game, c) {
  if (!game || game.phase === 'setup') fail('The game has not started', 'phase');
  const { schedule } = game;
  if (!(Number.isInteger(c) && c >= 0 && c < game.players.length)) fail(`Unknown chain ${c}`, 'player');
  const stages = [];
  for (let r = 1; r <= schedule.k; r++) {
    const player = schedule.rounds[r][c];
    if (!game.submitted[r][player]) break;
    stages.push({
      round: r,
      task: taskType(r),
      player,
      name: game.players[player],
      sentence: r % 2 === 0 ? game.sentences[r][c] : null,
      rules: activeRules(game, r, c),
    });
  }
  return { chain: c, creator: c, creatorName: game.players[c], original: game.sentences[0][c], stages };
}

/** Transformations of a finished game, ready for similarity scoring (score.js). */
export function transformationsOf(game) {
  needPhase(game, 'finished');
  return buildTransformations(game);
}

// ---- Save / load ----------------------------------------------------------------

export function saveGame(game) {
  return JSON.stringify(game);
}

/** Parse and check a saved game. Throws GameError('load') when it is not usable. */
export function loadGame(json) {
  let game;
  try {
    game = JSON.parse(json);
  } catch {
    fail('Saved game is not valid JSON', 'load');
  }
  const bad = (what) => fail(`Saved game is broken: ${what}`, 'load');
  if (!game || typeof game !== 'object') bad('not an object');
  if (game.version !== GAME_VERSION) bad(`unknown version ${game.version}`);
  if (!PHASES.includes(game.phase)) bad(`unknown phase "${game.phase}"`);
  if (!Array.isArray(game.players) || !Array.isArray(game.rules) || !Array.isArray(game.revenges)) {
    bad('players, rules or revenges missing');
  }
  if (game.phase !== 'setup') {
    const check = validateSchedule(game.schedule);
    if (!check.ok) bad(check.errors[0].message);
    const { k } = game.schedule;
    const n = game.players.length;
    const shaped = (g) => Array.isArray(g) && g.length === k + 1 && g.every((row) => Array.isArray(row) && row.length === n);
    if (!shaped(game.ruleAt) || !shaped(game.sentences) || !shaped(game.submitted)) bad('round data has the wrong shape');
    if (!(Number.isInteger(game.round) && game.round >= 0 && game.round <= k)) bad(`round ${game.round}`);
  }
  return game;
}
