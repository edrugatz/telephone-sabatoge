// In-memory sync backend (P5b): same interface as the Firebase transport (see transport.js), for the Node
// tests and for bot players on one phone. Pure ES module.
//
//   const backend = createMemoryBackend();
//   const t = backend.connect('uid-1');   // one transport per simulated phone
//
// Like Firebase: null deletes, empty objects disappear, values are copied in and out (JSON), and listeners
// are called asynchronously (setTimeout 0), in the order the changes happened. `backend.pending` counts
// undelivered notifications, so tests can wait until everything has settled.

const copy = (value) => (value === undefined || value === null ? null : JSON.parse(JSON.stringify(value)));
const split = (path) => String(path).split('/').filter(Boolean);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Drop nulls and empty objects, recursively (Firebase stores nothing there). */
function prune(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const clean = prune(child);
    if (clean !== null) out[key] = clean;
  }
  return Object.keys(out).length ? out : null;
}

function readAt(node, keys) {
  for (const key of keys) {
    if (node === null || typeof node !== 'object') return null;
    node = node[key] ?? null;
  }
  return node;
}

function writeAt(node, keys, value) {
  if (!keys.length) return prune(value);
  const [key, ...rest] = keys;
  const obj = node !== null && typeof node === 'object' && !Array.isArray(node) ? { ...node } : {};
  const child = writeAt(obj[key] ?? null, rest, value);
  if (child === null) delete obj[key];
  else obj[key] = child;
  return Object.keys(obj).length ? obj : null;
}

export function createMemoryBackend() {
  let root = null;
  let pushCount = 0;
  const listeners = new Set();
  const queue = [];
  let flushing = false;

  const backend = {
    get pending() {
      return queue.length;
    },
    /** Raw copy of the whole tree (tests). */
    dump: () => copy(root),
    connect,
  };

  function deliverSoon(fn) {
    queue.push(fn);
    if (flushing) return;
    flushing = true;
    setTimeout(function flush() {
      const fn = queue.shift();
      if (fn) fn();
      if (queue.length) setTimeout(flush, 0);
      else flushing = false;
    }, 0);
  }

  /** After a write: tell every listener whose data changed. */
  function changed() {
    for (const l of listeners) {
      const value = readAt(root, l.keys);
      if (l.kind === 'value') {
        if (same(value, l.last)) continue;
        l.last = copy(value);
        const snapshot = copy(value);
        deliverSoon(() => listeners.has(l) && l.cb(snapshot));
      } else {
        const children = value !== null && typeof value === 'object' ? value : {};
        for (const key of [...l.known]) if (!(key in children)) l.known.delete(key);
        for (const key of Object.keys(children).sort()) {
          if (l.known.has(key)) continue;
          l.known.add(key);
          const snapshot = copy(children[key]);
          deliverSoon(() => listeners.has(l) && l.cb(key, snapshot));
        }
      }
    }
  }

  function listen(kind, path, cb) {
    const l = { kind, keys: split(path), cb, last: undefined, known: new Set() };
    listeners.add(l);
    changed();
    return () => listeners.delete(l);
  }

  function write(path, value) {
    root = writeAt(root, split(path), copy(value));
  }

  function connect(uid) {
    if (typeof uid !== 'string' || !uid) throw new TypeError('connect needs a uid');
    return {
      uid,
      async get(path) {
        return copy(readAt(root, split(path)));
      },
      async set(path, value) {
        write(path, value);
        changed();
      },
      async update(path, patch) {
        for (const [key, value] of Object.entries(patch)) write(`${path}/${key}`, value);
        changed();
      },
      async push(path, value) {
        const key = `m${String(++pushCount).padStart(9, '0')}`;
        write(`${path}/${key}`, value);
        changed();
        return key;
      },
      async remove(path) {
        write(path, null);
        changed();
      },
      async transaction(path, fn) {
        const next = fn(copy(readAt(root, split(path))));
        if (next === undefined) return { committed: false, value: copy(readAt(root, split(path))) };
        write(path, next);
        changed();
        return { committed: true, value: copy(next) };
      },
      onValue: (path, cb) => listen('value', path, cb),
      onChildAdded: (path, cb) => listen('child', path, cb),
    };
  }

  return backend;
}
