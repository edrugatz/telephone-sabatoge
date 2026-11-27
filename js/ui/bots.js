// Bot players for testing on one phone (P6). Pure ES module (no DOM).
//
// The database rules only accept a message from its own signed-in user, so every bot is its own
// connection: in the browser a named Firebase app ('bot-1', 'bot-2', …) with its own anonymous login,
// in the tests a memory transport. `connect(app)` must return the same transport for the same app name.
// The app names are kept in the session, so after a reload the same bots (same uids) come back.
//
//   const bots = new Bots({ connect, code, apps: session.bots, onApps: (apps) => save(apps) });
//   await bots.add(host.state.seats);   // → { app, uid, name }

import { Client } from '../game/client.js';
import { GameError } from '../game/game.js';
import { MAX_PLAYERS } from '../game/host.js';

export const BOT_NAMES = [
  'Bot Ada', 'Bot Bea', 'Bot Cy', 'Bot Dot', 'Bot Eli', 'Bot Flo', 'Bot Gil',
  'Bot Hux', 'Bot Ivo', 'Bot Jo', 'Bot Kit', 'Bot Lu', 'Bot Mo', 'Bot Nix',
];
export const BOT_APP_PREFIX = 'bot-';

export class Bots {
  constructor({ connect, code, apps = [], onApps }) {
    this.connect = connect;
    this.code = code;
    this.apps = [...apps];
    this.onApps = onApps;
    this.clients = new Map(); // app name → Client
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
