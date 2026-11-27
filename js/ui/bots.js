// Bot players for testing on one phone (P6). Pure ES module (no DOM).
//
// The database rules only accept a message from its own signed-in user, so every bot is its own
// connection: in the browser a named Firebase app ('bot-1', 'bot-2', …) with its own anonymous login,
// in the tests a memory transport. `connect(app)` must return the same transport for the same app name.
// The app names are kept in the session, so after a reload the same bots (same uids) come back.
//
//   const bots = new Bots({ connect, code, apps: session.bots, onApps: (apps) => save(apps) });
//   await bots.add(host.state.seats);   // → { app, uid, name }
//   await bots.writeRules(host.state.seats, view.rules.missing);   // → number of bots that sent rules
//   await bots.doTasks(host.state.seats, view.waitingFor, view.round);   // → number of bots that finished
//   await bots.takeRevenge(host.state.seats, view.round, (p) => revengeOptions(game, p));   // → number that took revenge

import { Client } from '../game/client.js';
import { GameError } from '../game/game.js';
import { MAX_PLAYERS } from '../game/host.js';

export const BOT_NAMES = [
  'Bot Ada', 'Bot Bea', 'Bot Cy', 'Bot Dot', 'Bot Eli', 'Bot Flo', 'Bot Gil',
  'Bot Hux', 'Bot Ivo', 'Bot Jo', 'Bot Kit', 'Bot Lu', 'Bot Mo', 'Bot Nix',
];
export const BOT_APP_PREFIX = 'bot-';

export const BOT_RULES = {
  draw: [
    'No straight lines', 'Include a tiny animal', 'Draw with your other hand', 'Everything has a face',
    'Only circles', 'Hide a banana somewhere', 'Draw it upside down', 'At most 5 lines', 'Add some weather',
    'Eyes closed for the first line',
  ],
  write: [
    'Exactly seven words', 'No letter "E"', 'Make it rhyme', 'Start with "Once"', 'Mention a colour',
    'Ask it as a question', 'Use one very fancy word', 'No word longer than 6 letters', 'Write it as a headline',
    'Include a number',
  ],
};

export const BOT_SENTENCES = [
  'A cat rides a bicycle to the moon', 'Grandma wins the dance battle', 'The pizza is plotting revenge',
  'A shark sells ice cream at the beach', 'Two robots fall in love at a bus stop', 'The king lost his crown in the soup',
  'A dragon is afraid of a tiny mouse', 'My umbrella flew away with the birds', 'A snowman sunbathing on a hot day',
  'The teacher turned into a giant frog',
];

/** A random made-up sentence for a bot's writing or interpreting task. */
export function botSentence(random = Math.random) {
  return BOT_SENTENCES[Math.floor(random() * BOT_SENTENCES.length)];
}

/** 3 different random bot rules: one drawing, one writing, and one of either. */
export function botRules(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const rules = [{ type: 'draw', text: pick(BOT_RULES.draw) }, { type: 'write', text: pick(BOT_RULES.write) }];
  const type = random() < 0.5 ? 'draw' : 'write';
  const left = BOT_RULES[type].filter((text) => !rules.some((rule) => rule.text === text));
  rules.push({ type, text: pick(left) });
  return rules;
}

export class Bots {
  constructor({ connect, code, apps = [], onApps, random = Math.random }) {
    this.connect = connect;
    this.code = code;
    this.apps = [...apps];
    this.onApps = onApps;
    this.random = random;
    this.clients = new Map(); // app name → Client
  }

  /**
   * Every seated bot whose name is in `missing` sends 3 random rules. `seats` = the host's seats.
   * Works after a reload too (the bots' clients are reopened). Resolves with the number of bots that sent
   * rules; throws GameError when the host refuses them.
   */
  async writeRules(seats, missing) {
    return this.eachSeated(seats, missing, async (client, seat) => {
      const result = await client.submitRules(botRules(this.random));
      if (!result.ok) throw new GameError(`${seat.name}: ${result.message}`, result.reason);
    });
  }

  /**
   * Every seated bot whose name is in `waiting` finishes its task of `round` (P8). Bots always send a
   * random sentence; the host ignores it on drawing tasks. Resolves with the number of bots that finished.
   */
  async doTasks(seats, waiting, round) {
    return this.eachSeated(seats, waiting, async (client, seat) => {
      const result = await client.send('submit', { round, text: botSentence(this.random) });
      if (!result.ok) throw new GameError(`${seat.name}: ${result.message}`, result.reason);
    });
  }

  /**
   * Testing revenge (P9b): every seated bot that can take revenge in `round` writes a random rule of the
   * right type. `optionsOf(player)` = revengeOptions for that seat index (the host's game state), asked
   * again before each bot, so a target taken by an earlier bot is skipped. Resolves with the number of
   * bots that took revenge.
   */
  async takeRevenge(seats, round, optionsOf) {
    let count = 0;
    await this.eachSeated(seats, seats.map((seat) => seat.name), async (client, seat) => {
      const { reason, options } = optionsOf(seats.indexOf(seat));
      const option = reason ? null : options.find((o) => o.ok);
      if (!option) return;
      const list = BOT_RULES[option.type];
      const text = list[Math.floor(this.random() * list.length)];
      const result = await client.send('revenge', { round, text, target: option.target });
      if (result.ok) count++;
      else if (result.reason !== 'taken') throw new GameError(`${seat.name}: ${result.message}`, result.reason);
    });
    return count;
  }

  /** Run fn(client, seat) for each seated bot named in `names`, reopening clients after a reload. */
  async eachSeated(seats, names, fn) {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    let count = 0;
    for (const app of this.apps) {
      const transport = await this.connect(app);
      const seat = seats.find((s) => s.uid === transport.uid);
      if (!seat || !wanted.has(seat.name.toLowerCase())) continue;
      let client = this.clients.get(app);
      if (!client) {
        client = await Client.open({ transport, code: this.code });
        this.clients.set(app, client);
      }
      await fn(client, seat);
      count++;
    }
    return count;
  }

  /** A bot app that isn't seated yet: an existing one first, else a new one. */
  async freeApp(seated) {
    for (const app of this.apps) {
      const transport = await this.connect(app);
      if (!seated.has(transport.uid)) return { app, transport };
    }
    let i = 1;
    while (this.apps.includes(`${BOT_APP_PREFIX}${i}`)) i++;
    const app = `${BOT_APP_PREFIX}${i}`;
    const transport = await this.connect(app);
    this.apps.push(app);
    this.onApps?.([...this.apps]);
    return { app, transport };
  }

  /**
   * Seat one more bot. `seats` = the host's current seats [{ uid, name }].
   * Resolves with { app, uid, name }; throws GameError when the host refuses (full, started…).
   */
  async add(seats) {
    if (seats.length >= MAX_PLAYERS) throw new GameError(`This game is full (${MAX_PLAYERS} players)`, 'full');
    const seated = new Set(seats.map((seat) => seat.uid));
    const taken = new Set(seats.map((seat) => seat.name.toLowerCase()));
    const { app, transport } = await this.freeApp(seated);
    for (const name of BOT_NAMES) {
      if (taken.has(name.toLowerCase())) continue;
      try {
        const client = await Client.join({ transport, code: this.code, name });
        this.clients.get(app)?.close();
        this.clients.set(app, client);
        return { app, uid: transport.uid, name };
      } catch (error) {
        if (error.reason !== 'name-taken') throw error;
      }
    }
    throw new GameError('No bot names left', 'full');
  }

  close() {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }
}
