// Host loop (SPEC §2, P5b). Pure ES module (no DOM / Node APIs), shared by the browser and the tests.
//
// The host phone is the authority. It holds the whole state, reads player messages from the inbox,
// applies them through game.js, and publishes one private view per player plus a public summary.
// Each message is applied to a copy of the state, so a rejected message changes nothing. The new state,
// the changed views and the deletion of the message go out in one atomic update.
//
// Host state (stored as a JSON string in games/{CODE}/hostState, readable only by the host):
//   { version, code, hostUid, stage: 'lobby' | 'rules' | 'playing' | 'finished',
//     seats: [{ uid, name }],            // index = player id once the rules stage opens
//     game,                              // the game.js state object
//     results: { [uid]: [{ id, ok, message?, reason? }] },   // last results of that uid's messages
//     removed: [uid],                    // players the host removed from the lobby
//     roundStartedAt }                   // host clock (ms) when the current round began, for the timers
//
// Messages (inbox, written by clients): { from: uid, type, payload: JSON string, at }
//   join { name } · leave {} · rules { rules: [{ type, text } ×3] } · submit { round, text? }
//   · revenge { round, text, target? }
// Host-only actions are methods: openRules, backToLobby, start, advance, kick.

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
  loadGame,
  GameError,
} from './game.js';
import { gamePaths, randomCode } from '../sync/transport.js';

export const HOST_VERSION = 1;
export const MAX_PLAYERS = 14;
export const MAX_NAME_LENGTH = 20;
export const MESSAGE_TYPES = ['join', 'leave', 'rules', 'submit', 'revenge'];
const RESULTS_KEPT = 10;
const CODE_TRIES = 10;

const fail = (message, reason, details) => {
  throw new GameError(message, reason, details);
};

/** Trimmed name with single spaces, 1…MAX_NAME_LENGTH characters. */
export function cleanName(name) {
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!clean) fail('Please enter a name', 'text');
  if (clean.length > MAX_NAME_LENGTH) fail(`Names can have at most ${MAX_NAME_LENGTH} characters`, 'text');
  return clean;
}

const names = (state) => state.seats.map((seat) => seat.name);
const seatOf = (state, uid) => state.seats.findIndex((seat) => seat.uid === uid);
const nameKey = (name) => name.toLowerCase();

function needStage(state, stage, message) {
  if (state.stage !== stage) fail(message, 'phase');
}

function needSeat(state, uid) {
  const p = seatOf(state, uid);
  if (p < 0) fail('You are not in this game', 'not-joined');
  return p;
}

function needRound(game, round) {
  if (round !== game.round) fail('That was for a round that is already over', 'stale');
}

// ---- Views ------------------------------------------------------------------

/** What everyone in the game may see. */
export function publicView(state) {
  const { game, stage } = state;
  const playing = stage === 'playing';
  return {
    code: state.code,
    stage,
    players: names(state),
    round: game.phase === 'setup' ? null : game.round,
    lastRound: game.schedule?.k ?? null,
    waitingFor: playing ? waitingFor(game).map((p) => game.players[p]) : [],
    missingRules: stage === 'rules' ? playersMissingRules(game).map((p) => game.players[p]) : [],
  };
}

/** One player's private screen data. Never holds the schedule, the chains or other players' rules. */
export function playerView(state, uid) {
  const { game, stage } = state;
  const p = seatOf(state, uid);
  const view = {
    code: state.code,
    stage,
    you: p < 0 ? null : { player: p, name: state.seats[p].name, host: uid === state.hostUid },
    players: names(state),
    results: state.results[uid] ?? [],
  };
  if (p < 0) {
    view.removed = state.removed.includes(uid);
    return view;
  }
  if (stage === 'rules') {
    view.rules = {
      mine: game.rules.filter((rule) => rule.author === p).map(({ type, text }) => ({ type, text })),
      missing: playersMissingRules(game).map((i) => game.players[i]),
    };
  }
  if (stage === 'playing') {
    view.round = game.round;
    view.lastRound = game.schedule.k;
    view.roundStartedAt = state.roundStartedAt ?? null;
    view.task = getTask(game, p);
    view.revenge = revengeOptions(game, p);
    view.waitingFor = waitingFor(game).map((i) => game.players[i]);
  }
  if (stage === 'playing' || stage === 'finished') {
    const own = game.revenges.find((rv) => rv.author === p);
    view.myRevenge = own ? { target: own.target, targetName: game.players[own.target], round: own.round, text: own.text } : null;
  }
  return view;
}

/** uids that get a view: players, plus anyone who sent a message or was removed. */
function audience(state) {
  return [...new Set([...state.seats.map((seat) => seat.uid), ...Object.keys(state.results), ...state.removed])];
}

// ---- State changes (pure, on a copy) -----------------------------------------------

function join(state, uid, rawName) {
  const name = cleanName(rawName);
  const p = seatOf(state, uid);
  const taken = state.seats.some((seat, i) => i !== p && nameKey(seat.name) === nameKey(name));
  if (p >= 0) {
    // Rejoining (e.g. after a reload). In the lobby the name may change; later it stays.
    if (state.stage !== 'lobby') return;
    if (taken) fail(`Someone is already called "${name}"`, 'name-taken');
    state.seats[p].name = name;
    return;
  }
  if (state.stage !== 'lobby') fail('This game has already started', 'started');
  if (taken) fail(`Someone is already called "${name}"`, 'name-taken');
  if (state.seats.length >= MAX_PLAYERS) fail(`This game is full (${MAX_PLAYERS} players)`, 'full');
  state.seats.push({ uid, name });
  state.removed = state.removed.filter((x) => x !== uid);
}

function leave(state, uid) {
  needSeat(state, uid);
  if (uid === state.hostUid) fail("The host can't leave the game", 'host');
  needStage(state, 'lobby', "You can't leave once the game has started");
  state.seats = state.seats.filter((seat) => seat.uid !== uid);
}

/** Apply one inbox message to the state (throws GameError when it is refused). */
export function applyMessage(state, message) {
  if (!message || typeof message !== 'object' || typeof message.from !== 'string' || !MESSAGE_TYPES.includes(message.type)) {
    fail('Unknown message', 'bad-message');
  }
  let payload;
  try {
    payload = message.payload == null ? {} : JSON.parse(message.payload);
  } catch {
    fail('Unreadable message', 'bad-message');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Unreadable message', 'bad-message');

  const uid = message.from;
  const { game } = state;
  switch (message.type) {
    case 'join':
      return join(state, uid, payload.name);
    case 'leave':
      return leave(state, uid);
    case 'rules': {
      const p = needSeat(state, uid);
      needStage(state, 'rules', 'Rules can only be sent while everyone is writing rules');
      submitRules(game, p, payload.rules);
      return;
    }
    case 'submit': {
      const p = needSeat(state, uid);
      needStage(state, 'playing', 'The game is not running');
      needRound(game, payload.round);
      submitTask(game, p, payload.text);
      return;
    }
    case 'revenge': {
      const p = needSeat(state, uid);
      needStage(state, 'playing', 'The game is not running');
      needRound(game, payload.round);
      submitRevenge(game, p, payload.text, payload.target);
    }
  }
}

function parseState(json) {
  let state;
  try {
    state = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    fail('Saved host state is not valid JSON', 'load');
  }
  if (!state || state.version !== HOST_VERSION || !Array.isArray(state.seats) || !state.game) {
    fail('Saved host state is broken', 'load');
  }
  state.game = loadGame(JSON.stringify(state.game));
  state.results ??= {};
  state.removed ??= [];
  state.roundStartedAt ??= null;
  return state;
}

// ---- Host -----------------------------------------------------------------------

export class Host {
  constructor(transport, state, { onSave, onError, now = Date.now } = {}) {
    this.transport = transport;
    this.state = state;
    this.now = now;
    this.paths = gamePaths(state.code);
    this.onSave = onSave;
    this.onError = onError;
    this.published = {};
    this.queue = Promise.resolve();
    this.offInbox = null;
  }

  get code() {
    return this.state.code;
  }

  /**
   * Create a game: claim a free code, seat the host and publish the lobby.
   * @param {{ transport, hostName: string, random?: () => number, seed?: string|number, ruleRate?: number,
   *   maxTasks?: number|null, now?: () => number, onSave?: (json) => void, onError?: (error) => void }} options
   */
  static async create({ transport, hostName, random = Math.random, seed, ruleRate, maxTasks, now = Date.now, ...hooks }) {
    const name = cleanName(hostName);
    const createdAt = now();
    let code = null;
    for (let i = 0; i < CODE_TRIES && !code; i++) {
      const candidate = randomCode(random);
      const meta = { hostUid: transport.uid, createdAt, version: HOST_VERSION };
      const { committed } = await transport.transaction(gamePaths(candidate).meta, (current) => (current === null ? meta : undefined));
      if (committed) code = candidate;
    }
    if (!code) throw new Error('Could not find a free game code, please try again');

    const state = {
      version: HOST_VERSION,
      code,
      hostUid: transport.uid,
      stage: 'lobby',
      seats: [{ uid: transport.uid, name }],
      game: createGame({ seed: seed ?? `${code}-${createdAt}`, ruleRate, maxTasks }),
      results: {},
      removed: [],
    };
    const host = new Host(transport, state, { now, ...hooks });
    await host.publish();
    host.listen();
    return host;
  }

  /**
   * Take an existing game back after a reload. The state comes from the database, or from `backup`
   * (the last JSON passed to onSave) when the database has none.
   */
  static async resume({ transport, code, backup = null, ...hooks }) {
    const paths = gamePaths(code);
    const meta = await transport.get(paths.meta);
    if (!meta) fail(`No game with code ${code}`, 'no-game');
    if (meta.hostUid !== transport.uid) fail('Only the host can resume this game', 'not-host');
    const json = (await transport.get(paths.hostState)) ?? backup;
    if (!json) fail('The saved game is missing', 'load');
    const host = new Host(transport, parseState(json), hooks);
    if (host.state.code !== code) fail('The saved game belongs to another code', 'load');
    await host.publish();
    host.listen();
    return host;
  }

  /** Run state changes one at a time. The returned promise rejects with the action's error. */
  run(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  /** Resolves when every queued message and action has been handled. */
  idle() {
    return this.queue;
  }

  listen() {
    this.offInbox ??= this.transport.onChildAdded(this.paths.inbox, (key, message) => {
      this.run(() => this.handle(key, message)).catch((error) => this.onError?.(error));
    });
  }

  /** Stop reading the inbox (the game stays in the database). */
  stop() {
    this.offInbox?.();
    this.offInbox = null;
  }

  async handle(key, message) {
    const next = structuredClone(this.state);
    let result;
    try {
      applyMessage(next, message);
      result = { id: key, ok: true };
    } catch (error) {
      result = { id: key, ok: false, message: error.message, reason: error.reason ?? 'error' };
    }
    const state = result.ok ? next : structuredClone(this.state);
    const uid = typeof message?.from === 'string' ? message.from : null;
    if (uid) state.results[uid] = [...(state.results[uid] ?? []), result].slice(-RESULTS_KEPT);
    await this.commit(state, { [`inbox/${key}`]: null });
  }

  /** A host action: change a copy, then publish it. Throws (and changes nothing) when refused. */
  action(change) {
    return this.run(async () => {
      const next = structuredClone(this.state);
      change(next);
      await this.commit(next);
    });
  }

  async commit(state, extra = {}) {
    await this.publish(extra, state);
    this.state = state;
  }

  /** Write the state, the public summary and every view that changed, in one update. */
  async publish(extra = {}, state = this.state) {
    const json = JSON.stringify(state);
    const patch = { ...extra, hostState: json };
    const wanted = { public: JSON.stringify(publicView(state)) };
    for (const uid of audience(state)) wanted[uid] = JSON.stringify(playerView(state, uid));
    for (const [key, value] of Object.entries(wanted)) {
      if (this.published[key] !== value) patch[key === 'public' ? 'public' : `views/${key}`] = value;
    }
    await this.transport.update(this.paths.root, patch);
    Object.assign(this.published, wanted);
    this.onSave?.(json);
  }

  // Host-only actions.

  /** Close the lobby and let everyone write their rules (needs at least 5 players). */
  openRules() {
    return this.action((state) => {
      needStage(state, 'lobby', 'The lobby is already closed');
      setPlayers(state.game, names(state));
      state.stage = 'rules';
    });
  }

  /** Reopen the lobby (rules written so far are dropped). */
  backToLobby() {
    return this.action((state) => {
      needStage(state, 'rules', 'The game has already started');
      state.game.players = [];
      state.game.rules = [];
      state.stage = 'lobby';
    });
  }

  /** Generate the schedule and rules and start round 0 (everyone needs their rules in). */
  start() {
    return this.action((state) => {
      needStage(state, 'rules', 'The game can only start after the rules');
      startGame(state.game);
      state.stage = 'playing';
      state.roundStartedAt = this.now();
    });
  }

  /** Next round, once everyone is done. After the last round the game is finished. */
  advance() {
    return this.action((state) => {
      needStage(state, 'playing', 'The game is not running');
      advanceRound(state.game);
      state.roundStartedAt = this.now();
      if (state.game.phase === 'finished') state.stage = 'finished';
    });
  }

  /** Remove a player from the lobby. */
  kick(uid) {
    return this.action((state) => {
      needStage(state, 'lobby', 'Players can only be removed in the lobby');
      needSeat(state, uid);
      if (uid === state.hostUid) fail("The host can't be removed", 'host');
      state.seats = state.seats.filter((seat) => seat.uid !== uid);
      state.removed = [...new Set([...state.removed, uid])];
    });
  }
}
