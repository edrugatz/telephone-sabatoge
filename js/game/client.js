// Player side of the sync layer (SPEC §2, P5b). Pure ES module, shared by the browser and the tests.
//
// A client watches its own view (games/{CODE}/views/{uid}) and the public summary, and sends messages
// to the host's inbox. Each send resolves with the host's result for that message: { ok, message?, reason? }.
// The host phone uses a client too, for its own seat.
//
//   const client = await Client.join({ transport, code, name });
//   client.watch((view) => render(view));
//   const result = await client.submitTask('A cat on a bike');

import { GameError } from './game.js';
import { gamePaths, normalizeCode } from '../sync/transport.js';

const parse = (json) => (typeof json === 'string' ? JSON.parse(json) : null);

export class Client {
  constructor(transport, code) {
    this.transport = transport;
    this.uid = transport.uid;
    this.code = code;
    this.paths = gamePaths(code);
    this.view = null;
    this.public = null;
    this.viewListeners = new Set();
    this.publicListeners = new Set();
    this.waiting = new Map(); // message id → resolve
    this.offs = [
      transport.onValue(this.paths.view(this.uid), (json) => {
        this.view = parse(json);
        this.settle();
        for (const cb of this.viewListeners) cb(this.view);
      }),
      transport.onValue(this.paths.public, (json) => {
        this.public = parse(json);
        for (const cb of this.publicListeners) cb(this.public);
      }),
    ];
  }

  /** Open a game the player is already in (after a reload) or that they host. Checks the code exists. */
  static async open({ transport, code }) {
    const clean = normalizeCode(code);
    if (!clean) throw new GameError('That is not a game code', 'code');
    const meta = await transport.get(gamePaths(clean).meta);
    if (!meta) throw new GameError(`No game with code ${clean}`, 'no-game');
    return new Client(transport, clean);
  }

  /** Open a game and ask to join it. Throws GameError when the host refuses (name taken, started, full…). */
  static async join({ transport, code, name }) {
    const client = await Client.open({ transport, code });
    const result = await client.join(name);
    if (!result.ok) {
      client.close();
      throw new GameError(result.message, result.reason);
    }
    return client;
  }

  /** Call cb(view) on every change of this player's view (and now, if there is one). Returns an unsubscribe. */
  watch(cb) {
    this.viewListeners.add(cb);
    if (this.view) cb(this.view);
    return () => this.viewListeners.delete(cb);
  }

  watchPublic(cb) {
    this.publicListeners.add(cb);
    if (this.public) cb(this.public);
    return () => this.publicListeners.delete(cb);
  }

  /** Resolve sends whose result has arrived in the view. */
  settle() {
    for (const result of this.view?.results ?? []) {
      const resolve = this.waiting.get(result.id);
      if (resolve) {
        this.waiting.delete(result.id);
        resolve(result);
      }
    }
  }

  /** Send a message to the host; resolves with its result once the host has handled it. */
  async send(type, payload = {}) {
    const message = { from: this.uid, type, payload: JSON.stringify(payload), at: Date.now() };
    let resolve;
    const result = new Promise((r) => (resolve = r));
    const id = await this.transport.push(this.paths.inbox, message);
    this.waiting.set(id, resolve);
    this.settle();
    return result;
  }

  join(name) {
    return this.send('join', { name });
  }

  leave() {
    return this.send('leave');
  }

  /** rules: [{ type: 'draw' | 'write', text }] ×3 */
  submitRules(rules) {
    return this.send('rules', { rules });
  }

  /** Finish this round's task (text for writing and interpreting, nothing for drawing). */
  submitTask(text) {
    return this.send('submit', { round: this.view?.round ?? null, text: text ?? null });
  }

  /** target: only needed when the view offers more than one revenge option. */
  revenge(text, target) {
    return this.send('revenge', { round: this.view?.round ?? null, text, target });
  }

  close() {
    for (const off of this.offs) off();
    this.offs = [];
    this.viewListeners.clear();
    this.publicListeners.clear();
  }
}
