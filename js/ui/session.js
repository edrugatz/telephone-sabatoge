// Session on this device (P6): which game this phone is in and as what. Pure ES module (no DOM), so the
// Node tests can use it with a storage stub. `storage` is anything with getItem / setItem / removeItem
// (localStorage in the browser).
//
//   session    { code, role: 'host' | 'player', uid, name, bots: [firebase app names] }
//   hostBackup the host's last saved state (Host onSave JSON), used by Host.resume when the database has none
//   name       the last name typed on the home screen
//   ruleDraft  { code, rules } the rules being typed in the rules stage (P7), so a reload keeps them
//   taskDraft  { code, round, text } the sentence being typed on the task screen (P8)

import { normalizeCode } from '../sync/transport.js';
import { normalizeDraft } from './rule-draft.js';

export const KEYS = { session: 'tps.session', backup: 'tps.hostBackup', name: 'tps.name', draft: 'tps.ruleDraft', taskDraft: 'tps.taskDraft' };
export const ROLES = ['host', 'player'];

/** A storage that only lives in memory (tests, or browsers that block localStorage). */
export function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/** The checked session, or null when it isn't one. */
export function checkSession(value) {
  if (!value || typeof value !== 'object') return null;
  const { code, role, uid, name, bots = [] } = value;
  if (normalizeCode(code) !== code || !ROLES.includes(role)) return null;
  if (typeof uid !== 'string' || !uid || typeof name !== 'string') return null;
  if (!Array.isArray(bots) || !bots.every((b) => typeof b === 'string' && b)) return null;
  return { code, role, uid, name, bots: [...bots] };
}

export function createSessionStore(storage = memoryStorage()) {
  const read = (key) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, value);
    } catch {
      // Storage full or blocked: the game still works, it just won't survive a reload.
    }
  };
  const drop = (key) => {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  };
  const parse = (json) => {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  };

  const store = {
    /**
     * The saved session for this signed-in user, or null. A broken session, or one saved by another uid
     * (the browser's data was cleared and Firebase gave a new anonymous user), is deleted.
     */
    load(uid) {
      const json = read(KEYS.session);
      if (json === null) return null;
      const session = checkSession(parse(json));
      if (!session || session.uid !== uid) {
        store.clear();
        return null;
      }
      return session;
    },

    save(session) {
      const clean = checkSession(session);
      if (!clean) throw new TypeError('Not a valid session');
      write(KEYS.session, JSON.stringify(clean));
      return clean;
    },

    /** Forget the game (session, host backup, drafts). The last name is kept. */
    clear() {
      drop(KEYS.session);
      drop(KEYS.backup);
      drop(KEYS.draft);
      drop(KEYS.taskDraft);
    },

    /** Keep the sentence being typed for this game's round. */
    saveTaskDraft(code, round, text) {
      if (typeof text === 'string' && Number.isInteger(round)) write(KEYS.taskDraft, JSON.stringify({ code, round, text }));
    },

    /** The typed sentence for this game and round, or '' (a draft of another round is ignored). */
    loadTaskDraft(code, round) {
      const json = read(KEYS.taskDraft);
      const saved = json === null ? null : parse(json);
      return saved?.code === code && saved.round === round && typeof saved.text === 'string' ? saved.text : '';
    },

    /** Keep the rules being typed for this game. */
    saveDraft(code, rules) {
      const clean = normalizeDraft(rules);
      if (clean) write(KEYS.draft, JSON.stringify({ code, rules: clean }));
    },

    /** The rule draft for this game code, or null. */
    loadDraft(code) {
      const json = read(KEYS.draft);
      const saved = json === null ? null : parse(json);
      return saved?.code === code ? normalizeDraft(saved.rules) : null;
    },

    /** Keep the host's state JSON (from Host onSave). */
    saveBackup(json) {
      if (typeof json === 'string') write(KEYS.backup, json);
    },

    /** The backup for this game code, or null. */
    loadBackup(code) {
      const json = read(KEYS.backup);
      return json !== null && parse(json)?.code === code ? json : null;
    },

    lastName() {
      return read(KEYS.name) ?? '';
    },

    rememberName(name) {
      if (typeof name === 'string' && name.trim()) write(KEYS.name, name.trim());
    },
  };
  return store;
}
