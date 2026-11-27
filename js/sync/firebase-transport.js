// Firebase Realtime Database transport (P5b): the transport interface from transport.js, backed by the
// Firebase JS SDK (loaded from the gstatic CDN, version pinned) with Anonymous Auth. Browser only.
//
//   import { firebaseConfig } from './firebase-config.js';
//   const transport = await connectFirebase(firebaseConfig);   // signs in (or restores the saved user)
//   const bot = await connectFirebase(firebaseConfig, { name: 'bot-1' });   // a second user on this page
//
// Each app name is its own Firebase app with its own anonymous user. The SDK keeps each app's login on
// this device, so a named app gets the same uid back after a reload (bot players, P6).

const SDK = 'https://www.gstatic.com/firebasejs/13.4.0';
const DEFAULT_APP = '[DEFAULT]';

const connecting = new Map(); // app name → Promise<transport>

/** Connect once per page and app name; later calls return the same transport. */
export function connectFirebase(config, { name = DEFAULT_APP } = {}) {
  if (!config || !config.apiKey || !config.databaseURL) {
    return Promise.reject(new Error('Firebase is not configured: fill in js/sync/firebase-config.js'));
  }
  if (!connecting.has(name)) {
    connecting.set(
      name,
      open(config, name).catch((error) => {
        connecting.delete(name);
        throw error;
      }),
    );
  }
  return connecting.get(name);
}

async function open(config, name) {
  const [app, auth, db] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-database.js`),
  ]);
  const firebaseApp = app.getApps().find((a) => a.name === name) ?? app.initializeApp(config, name);
  const authApi = auth.getAuth(firebaseApp);
  await authApi.authStateReady();
  if (!authApi.currentUser) await auth.signInAnonymously(authApi);
  const uid = authApi.currentUser.uid;

  const database = db.getDatabase(firebaseApp);
  const at = (path) => db.ref(database, path);
  const value = (snapshot) => (snapshot.exists() ? snapshot.val() : null);

  return {
    uid,
    async get(path) {
      return value(await db.get(at(path)));
    },
    set: (path, v) => db.set(at(path), v),
    update: (path, patch) => db.update(at(path), patch),
    async push(path, v) {
      return (await db.push(at(path), v)).key;
    },
    remove: (path) => db.remove(at(path)),
    async transaction(path, fn) {
      const result = await db.runTransaction(at(path), (current) => fn(current ?? null), { applyLocally: false });
      return { committed: result.committed, value: value(result.snapshot) };
    },
    onValue: (path, cb) => db.onValue(at(path), (snapshot) => cb(value(snapshot))),
    onChildAdded: (path, cb) => db.onChildAdded(at(path), (snapshot) => cb(snapshot.key, snapshot.val())),
  };
}
