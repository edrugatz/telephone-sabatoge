// Sync transport interface (SPEC §2, P5b). Pure ES module, shared by the browser and the tests.
//
// A transport is one signed-in connection to a small JSON tree (Firebase Realtime Database in the browser,
// js/sync/memory-transport.js in tests and for bot players). Paths are '/'-separated strings. Writing null
// deletes. All methods are async; listeners return an unsubscribe function.
//
//   transport.uid                           this connection's user id (anonymous auth uid)
//   get(path)               → value | null
//   set(path, value)
//   update(path, patch)     patch keys may be sub-paths ('views/abc'); one atomic write
//   push(path, value)       → new child key (keys sort in creation order)
//   remove(path)
//   transaction(path, fn)   fn(current) → new value, or undefined to abort → { committed, value }
//   onValue(path, cb)       cb(value) now and on every change
//   onChildAdded(path, cb)  cb(key, value) for every existing child, then for each new one
//
// The game is stored under games/{CODE} (see gamePaths). Everything below `meta` holds strings or plain
// objects: views, the public summary and the host state are JSON strings, so Firebase never reshapes
// arrays. Who may read or write what is enforced by firebase/database.rules.json.

/** Database paths of one game. */
export function gamePaths(code) {
  const root = `games/${code}`;
  return {
    root,
    meta: `${root}/meta`, // { hostUid, createdAt, version }; written once by the host
    public: `${root}/public`, // JSON string: stage, round, player names, who we're waiting for
    hostState: `${root}/hostState`, // JSON string: the host's full state (only the host can read it)
    inbox: `${root}/inbox`, // player → host messages { from, type, payload (JSON string) }
    views: `${root}/views`, // views/{uid}: JSON string, that player's own screen data
    view: (uid) => `${root}/views/${uid}`,
  };
}

/** Letters for game codes: no I or O (they look like 1 and 0). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 5;

/** Random game code from `random()` (a function returning [0, 1), e.g. Math.random). */
export function randomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** Normalise a typed code (case, spaces) or return null when it can't be a game code. */
export function normalizeCode(text) {
  if (typeof text !== 'string') return null;
  const code = text.replace(/\s+/g, '').toUpperCase();
  const ok = code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
  return ok ? code : null;
}
