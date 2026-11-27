# Firebase setup (one time, ~5 minutes)

The game syncs phones through a free Firebase Realtime Database (Spark plan, no credit card).
See SPEC §2.

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** (any name, e.g. `telephone-sabotage`). Google Analytics is not needed.

## 2. Turn on Anonymous sign-in

**Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**

## 3. Create the database

1. **Build → Realtime Database → Create database.**
2. Pick a location (e.g. `europe-west1`) and start in **locked mode**.
3. Open the **Rules** tab, replace everything with the contents of `firebase/database.rules.json`, and click **Publish**.

## 4. Register the web app and copy the config

1. **Project settings (gear) → General → Your apps → Web (`</>`)**. Give it a nickname. Hosting is not needed.
2. Copy the `firebaseConfig` values into `js/sync/firebase-config.js`:
   `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`.
   If `databaseURL` is missing, take it from the top of the Realtime Database page (`https://….firebasedatabase.app`).

These values are public by design. The security rules protect the data.

## 5. Allow your site's domain

**Authentication → Settings → Authorized domains**: `localhost` is there by default. Add your GitHub Pages
domain (`<user>.github.io`) before playing online.

## 6. Check the rules (Rules Playground)

Realtime Database → Rules → **Rules Playground**. Use `games/ABCDE/...` paths, tick *Authenticated*,
and set the UID as shown. Expected results:

| Simulation | Path | UID | Expected |
|---|---|---|---|
| Write `{"hostUid":"h1","createdAt":1,"version":1}` | `games/ABCDE/meta` | `h1` | allowed (new game) |
| Write the same with `"hostUid":"h1"` | `games/ABCDE/meta` | `p1` | denied |
| Read | `games/ABCDE/hostState` | `p1` | denied |
| Read | `games/ABCDE/views/p2` | `p1` | denied |
| Read | `games/ABCDE/views/p1` | `p1` | allowed |
| Read | `games/ABCDE/inbox` | `p1` | denied |
| Write `{"from":"p1","type":"join","payload":"{}","at":1}` | `games/ABCDE/inbox/x1` | `p1` | allowed |
| Write `{"from":"p2","type":"join","payload":"{}","at":1}` | `games/ABCDE/inbox/x1` | `p1` | denied (spoofed sender) |
| Read | `games` | `p1` | denied (no listing games) |

Rows 2–9 need the meta from row 1 to exist. In the playground, the simplest way is to first create it for real:
write row 1's value to `games/ABCDE/meta` in the **Data** tab.

The automated tests (`npm run test:logic`) use an in-memory database and don't check these rules.
