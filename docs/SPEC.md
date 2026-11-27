# Telephone Pictionary Sabotage — Spec

> **Living document.** This is the source of truth for the game's design.
> Update it in the same change whenever a design decision is made or behaviour changes:
> edit the affected section, move answered items from *Open questions* to the *Decision log* (with date).
> Keep it describing the game as it is meant to be now, not a history of edits.

Status: **in progress (P1–P10 done: game logic, Firebase sync, app shell + home + lobby, rule submission, preparation + task
screen, pass + round progression, revenge UI, model scoring; P11 next).** Existing code: the
sentence-similarity scorer (`js/similarity.js`, TinyBERT cross-encoder, debug page `tune.html`) which the game will reuse
for scoring, the game logic modules in `js/game/`, the sync transports in `js/sync/`, and the game UI in `js/ui/`
(see §6, §10 and §12).

---

## 1. Overview

A browser-based party game companion for Telephone Pictionary with a sabotage mechanic.
Players write sentences, draw them **on paper**, and interpret drawings into new typed sentences.
Each player also receives secret sabotage rules authored by other players to make tasks harder.

The app coordinates the game (routing, timers, rules, sentence history, scoring, reveal); the physical
drawing and passing of paper stay central. Proof of concept: working and simple beats elaborate.

## 2. Technical constraints

- Static web app hosted on GitHub Pages. No server code, LLM API, or paid API.
- **Multi-phone sync: Firebase Realtime Database (free Spark plan) + Anonymous Auth**, used from the browser
  with the Firebase JS SDK. Every player uses their own phone. The **host phone is the authority**: it runs
  `game.js`, applies the messages players send, and publishes each player's own view. Phones need internet
  during the game.
- All game logic runs in the browser (on the host phone).
- Sentence similarity: local cross-encoder (`cross-encoder/stsb-TinyBERT-L4`, ~15 MB) via Transformers.js,
  through the existing `js/similarity.js` (`measure()` + `toScore()`).
- Modular code, easy to modify. Phone-first, clean, playful, modern UI.

## 3. Players, setup and lobby

The host creates a game and gets a short game code. Players join on their own phones with the code and
their name. The host sees the lobby / player list fill up live, and starts the game. The host also plays.
Group size: minimum 5, designed to shine at 8+.

## 4. Sabotage rules

- Before the game, every player submits **3 rules**, each tagged with a task type: **drawing** or **writing**.
- Rules: short (**at most 80 characters**, `MAX_RULE_LENGTH`, revenge rules too), followable during a task,
  playful, not offensive, not targeted at a player.
  Examples: *no straight lines* (drawing), *include a tiny animal* (drawing),
  *exactly seven words* (writing), *no letter "E"* (writing).
- Each rule stores its author and task type.
- Rules are randomly assigned to other players' tasks. A player **never** receives their own rule.
  Avoid giving the same rule to the same player twice in a game.
- **Rule rate: about 50 % of tasks get a rule** (`ruleRate`, default 0.5). Not a coin flip per task:
  every player gets a rule on exactly `round(k × ruleRate)` of their k tasks, split as evenly as possible
  between drawings and interpretations, so preservation scores stay comparable. The other tasks are
  played with no rule. Which tasks get the rules is fully random within that quota: a transformation
  may get 0, 1 or 2 scheduled rules (chaos is part of the game).
- On each task the player sees their active rule(s) and author(s), or "No rule this time".
  A rule applies to that one task only.
- Record the active rules for every transformation, for scoring.

### Revenge rule

Once per game, a player may write a new **revenge rule** against someone who just sabotaged them.
- **Trigger:** player V had a rule by X on their task in round *r*. V may then target X's task in
  round *r + 1*. There is no revenge on the last round's rules, because no round follows.
- **When:** V writes it during or right after their round-*r* task, before the round advances.
  X sees it on their round-*r + 1* task screen, marked as revenge, with V's name.
- **Type:** fixed by X's next task. If X draws in *r + 1*, it's a drawing rule; if X interprets, a writing
  rule. The app tells V which kind to write. Same content guidelines as normal rules.
- **Stacks:** it is added to any scheduled rule X already has, so a task holds at most 2 rules.
  At most one revenge rule per task: if two players want revenge on X in the same round, the first one
  wins and the other keeps their revenge for later.
- **No conflict of interest (R2 still holds):** revenge isn't offered if V is part of X's round-*r + 1*
  transformation (for example, V will interpret the drawing X makes).
- **Chains:** a revenge rule counts as "a rule from that person", so X can take revenge back on V in
  round *r + 2* if X hasn't used theirs yet.
- **Scoring:** a revenge rule is a normal active rule. Its author gets the full damage (§7), and it is
  stored with `revenge: true` for the reveal.
- It is optional and can be skipped. An unused revenge simply expires at the end of the game.

### Assignment (`js/game/rules.js`)

Rule pool: `[{ author, type: 'draw' | 'write', text }]`, `author` = player index; a rule is referred to by
its array index. `assignRules(schedule, rules, seed, { ruleRate = 0.5 })` → `{ seed, ruleRate, ruleAt, warnings }`,
where `ruleAt[r][c]` is the rule on chain *c* in round *r* (same shape as `rounds`), or `null` for a task
with no rule. `ruleRate` must be a number in [0, 1] (else `TypeError`); `ruledTasksPerPlayer(k, ruleRate)`
gives m = `round(k × ruleRate)`. A transformation = drawer A (odd round) + interpreter B (next round, same chain).
- Hard (errors): **R1** drawing rounds get `draw` rules, interpretation rounds `write` rules;
  **R2** the author is neither A nor B (covers "never your own rule"); **R3** at most one scheduled rule
  per task, round 0 (original sentence) has none, and each player has exactly m ruled tasks.
  `validateAssignment` takes the rate from `assignment.ruleRate` (default 0.5).
- Soft (warnings, only when unavoidable): **R4** no player gets the same rule twice; **R5** A's and B's
  rules have different authors; authors' rules are used equally often (m uses per author);
  **split** each player's ruled drawings and interpretations differ by at most 1 (when m is odd,
  alternate players in random order get the extra drawing or the extra interpretation).
- Per-rule odds are not uniform. Uses are balanced **per author**, so a player's only rule of a type is
  used more often than each of two rules of the same type from another author. This is deliberate:
  it keeps sabotage totals fair.
- Revenge rules (above) are not part of `ruleAt`. They are added during play by the game state (`game.js`, §6).
- Method: pick each player's m ruled tasks at random (within the split), then greedy fill of those tasks, most-constrained task first, picking the least-used author; then a repair pass
  moves tasks from over-used to under-used authors. Attempt *i* uses `createRng(seed + '#rules#' + i)`;
  the best attempt is kept and checked with `validateAssignment()` (`{ ok, errors, warnings }`).
- Bad pools are rejected, not played without a rule: `RuleError` (`reason: 'pool'`) when a type has no
  rules or a task has no eligible rule. `validateRulePool(rules, players)` (for the lobby, P7) requires
  3 rules per player with at least one of each type; with such pools assignment always succeeds.
- `authorUses(schedule, rules, ruleAt)` counts uses per author (for per-use averages, P4).

## 5. Chain routing

One chain per player (their original sentence). Each round, every player does exactly one task.

Chain shape: original sentence → drawing → interpretation → drawing → interpretation → …,
always **ending on a written interpretation**.

### Scheduler constraints

1. Every player has exactly one task per round.
2. Every player encounters each chain at most once.
3. Nobody is assigned their own chain.
4. Every chain visits different players.
5. A drawer–interpreter pair occurs at most once per game (A–B and B–A are the same pair).
6. Routing is randomized per game.
7. Task count is chosen so chains end on an interpretation without returning to the creator.

### Schedule format (`js/game/schedule.js`)

```js
{ players: ['Ana', 'Ben', …],  // index = player id
  k: 4,                         // tasks per chain after the original, chainLength(n)
  rounds: [[0,1,2,…], …] }      // rounds[r][c] = player holding chain c in round r
```
Chain *c* is created by player *c* (`rounds[0][c] === c`). Odd rounds are drawings, even rounds > 0
interpretations. `validateSchedule()` returns `{ ok, errors: [{ constraint, message }] }`, listing every
violation with player names (constraint 6 is a property of the generator, not of one schedule).
Randomness comes from `js/game/rng.js` `createRng(seed)`: a number or string seed (game code) always
gives the same sequence.

### Generator (`generateSchedule(players, seed, { maxTasks, maxAttempts = 30, stepBudget })`)

Returns `{ players, k, rounds, seed }`; same players + seed → same schedule. Cyclic construction:
chain *c* in round *r* goes to player `c + d_r (mod n)` with distinct non-zero shifts, so every round is a
permutation and no chain revisits anyone. Each drawing→interpretation block uses its own distance class
δ = |d_a − d_b| (δ < n/2); a class contains each pair of players once, so no pair repeats. A small seeded
backtracking search picks the classes, shifts and orientations; then players are relabelled by a random
permutation (player *c* and chain *c* together). Attempt *i* uses `createRng(seed + '#' + i)`. Every result is
checked with `validateSchedule()`; failure throws `ScheduleError` (`reason: 'unsolved' | 'invalid'`).
Fewer than 5 players throws the `chainLength()` RangeError.
(A plain cell-by-cell backtracking search was tried first: it could not solve n ≥ 9.)
**The scheduler must be tested independently, for a range of player counts, before the UI is built.**

### What players see

Players never see the schedule or which chain they hold. The app only tells them:
- who to pass their paper to, and when;
- (optionally) what the next person will do ("Sarah will interpret your drawing");
- "When you receive a paper, check your next task."

The app tracks every chain and its current location internally.

## 6. Rounds and task screen

Round 0: everyone writes an original sentence. Then rounds alternate drawing / interpretation.
Each task screen shows: current round, the task, the sentence to draw (drawing tasks), the active
sabotage rule(s) and author(s) or "No rule this time", a revenge rule marked as such, a timer, a
sentence input (interpretation tasks), who to pass the paper to, and a simple "done & passed"
confirmation. If the player's rule this round came from X and revenge is available (§4), the screen
offers "Take revenge on X?" with a rule input of the right type.

### Game state (`js/game/game.js`)

The whole game is one plain JSON object `{ version: 1, phase, seed, ruleRate, maxTasks, players, rules,
schedule, ruleAt, ruleWarnings, round, sentences[r][c], submitted[r][p], revenges }`. Phases: `setup → playing
→ finished`. Functions change it in place and return it. Invalid calls throw `GameError` with a `reason`.
- Setup: `createGame({ seed, ruleRate = 0.5, maxTasks = null })`, `setPlayers(game, names)` (≥ 5, trimmed,
  unique ignoring case; clears rules), `submitRules(game, p, [{ type, text } ×3])` (replaces that player's,
  ≥ 1 of each type), `playersMissingRules(game)`, `startGame(game)` (pool check → `generateSchedule` →
  `assignRules`, round 0).
- Play: `getTask(game, p)` → `{ round, lastRound, task, sentence (drawing only), rules: [{ author, authorName,
  type, text, revenge }], passTo: { player, name, task } | 'reveal', done }`. It never exposes the chain.
  `submitTask(game, p, text?)` (text required for write/interpret, once per round), `waitingFor(game)`,
  `advanceRound(game)`: only when everyone is done, **advanced by the host, not automatically**, which leaves a
  window for revenge. After round k the game is `finished`.
- Revenge: `revengeOptions(game, V)` → `{ reason, options: [{ target, targetName, round, type, ok, reason }] }`.
  Whole-revenge reasons: `not-playing`, `used`, `last-round`, `no-rule`. Per-target reasons: `conflict`, `taken`.
  Every author of a rule on V's current task is a candidate (scheduled or revenge), so there can be two.
  `submitRevenge(game, V, text, target?)`: the target is needed only when there are several options. It is
  allowed while the round is still r, before or after V submits their task.
- Results: `chainHistory(game, c)` → `{ chain, creator, creatorName, original, stages: [{ round, task, player,
  name, sentence, rules }] }` (finished stages only). `transformationsOf(game)` (finished games) feeds `score.js`.
- `saveGame(game)` → JSON; `loadGame(json)` checks the version, phase and shapes and re-runs `validateSchedule`.
  The schedule is stored in the save, not rebuilt from the seed.

### Sync (`js/sync/`, `js/game/host.js`, `js/game/client.js`)

- **Transport** (`transport.js`): `uid`, `get`, `set`, `update` (atomic multi-path), `push`, `remove`, `transaction`,
  `onValue`, `onChildAdded`. Two implementations: `firebase-transport.js` (SDK 13.4.0 from gstatic, Anonymous Auth,
  config in `firebase-config.js`) and `memory-transport.js` (tests, bot players).
- **Database** `games/{CODE}`: `meta { hostUid, createdAt, version }`; `public` (JSON string: stage, players, round,
  waitingFor, missingRules); `hostState` (JSON string, host only); `inbox/{id}` `{ from, type, payload (JSON), at }`
  (players write only, `from` must be their uid); `views/{uid}` (JSON string, readable only by that uid).
  Rules: `firebase/database.rules.json`. Setup steps: `docs/firebase-setup.md`.
- **Code**: 5 letters without I/O, claimed with a transaction (retries on a taken code). Game seed = `CODE-createdAt`.
- **Host** (`Host.create({ transport, hostName })`, `Host.resume({ transport, code, backup })`): stages `lobby → rules →
  playing → finished`. The host has seat 0 and plays through its own `Client`. It applies messages one at a time
  to a copy of the state, then writes the state, the changed views, the public summary and the deletion of the
  message in **one update**, so a refused message changes nothing. Results go to the sender's view
  (`results: [{ id, ok, message, reason }]`, last 10). Host-only methods: `openRules` (≥ 5 players), `backToLobby`,
  `start`, `advance`, `kick`. `onSave(json)` gives a backup copy for localStorage.
- **Messages**: `join { name }` (lobby only, unless the uid already has a seat: rejoin; names 1–20 chars, unique
  ignoring case, max 14 players), `leave` (lobby, not the host), `rules { rules }`, `submit { round, text }`,
  `revenge { round, text, target? }`. `submit` and `revenge` carry the round, and a stale one is refused (`stale`).
  Refusal reasons: game.js reasons plus `bad-message`, `not-joined`, `name-taken`, `started`, `full`, `host`, `phase`.
- **View** (`playerView`): `code, stage, you { player, name, host } | null, players, results`, plus `removed` (not
  seated), `rules { mine, missing }` (rules stage), `round, lastRound, roundStartedAt, task (getTask), revenge
  (revengeOptions), waitingFor` (playing), `myRevenge`, `scoring { status, done, total, error }` and `scores` (finished,
  see §10 Scoring). It never holds the schedule, or other players' rules; chains appear only as the finished `scores`.
- **Round timer**: the host state has `roundStartedAt` (host clock, ms), set by `start()` and every `advance()`
  (`Host` takes a `now` option for tests). It is in each player's view, so all phones count down together.
- **Client** (`Client.open`, `Client.join`): `view`, `public`, `watch(cb)`, `watchPublic(cb)`, and `send` / `join` /
  `leave` / `submitRules` / `submitTask` / `revenge`, each resolving with the host's result for that message.

## 7. Scoring

A **transformation** = player A draws incoming sentence S; player B interprets the drawing as S′.

- **Similarity**: cross-encoder score of S vs S′ (0–100). **Damage = 100 − similarity.**
- **Preservation** (lower is better): damage split equally between drawer and interpreter (40 → 20 + 20).
  The chain's creator gets none.
- **Sabotage** (higher is better): every rule active in that transformation gives its author the
  **full** damage (playful, not causal). That includes revenge rules. A transformation with no
  active rule gives no sabotage credit. Credit is **per rule**: an author with two rules in one
  transformation (possible via soft R5 or revenge) gets the damage twice.
- A transformation holds 0–4 rules: a scheduled and a revenge rule on each of its two tasks.
- **Per-use average** = sabotage ÷ rule uses (`null` with no uses), shown next to the total.
- Keep raw transformation data so the formulas can change later.

### Engine (`js/game/score.js`)

1. `buildTransformations({ schedule, rules, ruleAt, revenges, sentences })` → one entry per transformation:
   `{ chain, round, drawer, interpreter, incoming, outgoing, rules: [{ rule, author, task, revenge, text }], similarity: null }`.
   `sentences[r][c]` holds the even rounds' text. `revenges: [{ author, target, round, text }]`, where `round` is
   the target's task round. A revenge that conflicts (author is in that transformation) or duplicates one on the
   same task throws `TypeError`.
2. The caller sets `similarity` (0–100) on each one: the model (`js/game/scoring.js`, §10 Scoring), fake numbers in tests.
3. `scoreGame(transformations, players)` → `{ transformations (+ damage), players[p] = { preservation, tasks,
   sabotage, ruleUses, sabotagePerUse }, leaderboards: { preservers, saboteurs }, awards }`. Leaderboard entries
   are `{ player, name, value, rank }`, and ties (equal after rounding to 0.1) share a rank. Awards are
   `{ id, title, description, winners, value }`, and tied players share them. A missing or out-of-range
   similarity throws `TypeError`.

## 8. Data recorded per chain

Original sentence and creator; ordered stages; for each drawing the drawer; for each interpretation the
interpreter and the sentence; per transformation: incoming and outgoing sentence, similarity, damage,
active rules (0–4) with their authors and a `revenge` flag. Enough to rebuild the whole chain.
Per player: whether their revenge was used, and on whom and in which round.

## 9. End-of-game reveal

Per chain: original sentence, every drawing and interpretation in order, who did each, the active rules
per transformation (revenge rules highlighted: "V took revenge on X"), and how the sentence drifted
from start to end. Fun and laugh-inducing.

Leaderboards (every player on both):
- **Best Preservers**: lowest attributed damage from own drawing/interpretation tasks.
- **Best Saboteurs**: highest damage caused by own rules (total, plus per-use average).

Three awards:
- **Guardian of Meaning**: the preserver who did the least damage.
- **Master Saboteur**: the saboteur whose rules did the most damage (not given if no rule did any damage).
- **Agent of Chaos**: the humorous award for the player whose own drawings and interpretations did the most
  damage (not given if everyone tied).

## 10. Screens

1. Home (create / join) 2. Lobby 3. Rule submission 4. Game preparation (generate + validate routing)
5. Task (incl. the revenge prompt) 6. Pass 7. Interpretation submission 8. Round progression
9. Results / reveal.

### App shell (`index.html`, `js/ui/`, P6)

- `main.js` is the controller: connect Firebase → restore the session → show the screen for the view's `stage`
  (`lobby` → lobby; `rules` → rules screen; `playing` → task screen; `finished` → finished screen, P9). `router.js` is state-driven
  (`show(name, element)`), not URL-driven. Screens are functions returning an element (`screens/*.js`, `dom.js` `h()`).
- **Session** (`session.js`, localStorage, no DOM): `tps.session` `{ code, role: host|player, uid, name, bots }`,
  `tps.hostBackup` (last `onSave` JSON, used by `Host.resume` when the database has no host state), `tps.name`
  (last typed name). A session saved under another uid, or a broken one, is dropped.
- **Reload**: host → `Host.resume` + its own `Client.open`; player → `Client.open`. A seat that's gone (removed,
  or the game doesn't exist) → Home with a message. A network error → error screen with Retry.
- **Home**: Host (name) and Join (code + name), checked locally with `normalizeCode` / `cleanName`. `?join=CODE`
  fills in the code and puts the Join card first. After 10 s without the host's answer: "host seems offline" +
  Cancel (the message stays in the inbox).
- **Invite links** (`config.js` `inviteLink`): point to `PUBLIC_URL` when set (the published game, e.g. GitHub
  Pages), else to the page itself, but never to a local address (127.0.0.1 / localhost only works on that phone):
  then Share only shows the code and a hint. Other phones always need the game at a public address.
- **Lobby**: big code + Share invite link (Web Share, else clipboard), live player list (👑 host, "you"). Host:
  ✕ remove (confirm), "Everyone's in → Write rules" (≥ 5 players), "Close this game" (only forgets it on this
  phone; the other players are left in the lobby). Player: "Leave game".
- **Bots** (`bots.js`, testing on one phone): each bot is a named Firebase app (`bot-1`…) with its own anonymous
  user, because the database rules only accept messages from their own uid. App names are kept in the session,
  so bots keep their seats after a reload; a removed bot's app is reused. Host lobby → collapsed "🧪 Testing":
  Add bot / Fill to 8.

### Rule submission (`js/ui/screens/rules.js`, `js/ui/rule-draft.js`, P7)

- Every player (host too) fills 3 rule cards: a 🎨 Drawing / ✍️ Writing toggle (default draw / write / draw) and a
  text box with an 80-character counter. `checkDraft` checks on the phone (no empty rule, ≤ 80 characters, ≥ 1 of
  each type) with the same limits the host applies; errors show under each card.
- **Send my rules** → "✅ Your rules are in" + **Edit my rules**: a player can change their rules until the host
  starts (sending again replaces them).
- The typed draft lives in memory and in localStorage (`tps.ruleDraft` `{ code, rules }`), so a reload keeps it.
  The screen is a component (`createRulesScreen` → `{ element, update }`): live view updates only redraw the
  progress part, never the inputs, so typing isn't interrupted when someone else sends.
- Live "Rules in n / N" list (✅ ready / ✍️ writing…). Host: **Start the game 🎬** stays disabled until everyone
  is in, **← Back to lobby** (confirm: drops all rules), 🧪 Testing → **Bots write rules** (`bots.writeRules`:
  3 random rules from `BOT_RULES` for each bot still missing, reopening bot clients after a reload).
  Player: "Waiting for the host to start".

### Preparation + task screen (`js/ui/screens/task.js`, `js/ui/timer.js`, P8)

- **Preparation**: the host's **Start the game 🎬** runs `host.start()` (pool check → `generateSchedule` +
  `validateSchedule` → `assignRules`). Meanwhile the button shows a spinner, "Preparing the game…". If it fails, the rules
  screen shows an error card ("Couldn't prepare the game" + the reason) and the button becomes **Try again**. The
  other phones go straight to their task when the stage becomes `playing`.
- **Task screen** (component `createTaskScreen` → `{ element, update }`, like the rules screen): the round chip
  ("Round 0 · warm-up" / "Round r of k"), the timer, the task (✍️ Write a sentence / 🎨 Draw this / 🔍 What does the
  drawing show?), the sentence to draw (drawing tasks), and one card per active rule: "😈 Sabotage from X" or
  "🔥 Revenge from X" (revenge highlighted), or "🍀 No rule this time" (no rule card in round 0). Writing and
  interpreting have a text box (Enter sends, empty is refused) and **Send my sentence ✅**. Drawing has **I'm done
  drawing ✅**. After sending: "✅ Done!".
- The typed sentence is kept outside the DOM, in memory and in localStorage (`tps.taskDraft` `{ code, round, text }`).
  A draft from another round is ignored.
- **Timer** (advisory, `timer.js`, no DOM): write 60 s, draw 90 s, interpret 45 s (`TASK_SECONDS`), counted from the
  view's `roundStartedAt`. It turns orange in the last 10 s, and at 0 it shows "⏰ Time's up!". Nothing is forced. A
  phone clock behind the host's is clamped to the full time.
- Live part: "Finished n / N" + who is still busy. Host: **Next round →** (or **Finish the game 🏁** on the last round),
  enabled when everyone is done. 🧪 Testing → **Bots do their tasks** (`bots.doTasks`: each busy bot sends a random
  `BOT_SENTENCES` sentence for the current round; the host ignores it on drawing tasks). Player: "Waiting for the host to
  start the next round".

### Pass + round progression (`js/ui/pass.js`, `js/ui/screens/finished.js`, P9)

- **One paper per chain** travels every round (round 0 too). Before the task is done, the task screen shows a pass
  card: "📄 Then pass your paper to X" + what X will do ("will draw your sentence on it" / "will interpret your
  drawing" / "will draw the next picture. Fold the paper so your drawing is hidden."). On the last round: "📥 Then put
  your paper on the reveal pile".
- **One tap**: the Done button is the pass confirmation: "Done & passed to X ✅" (drawing) / "Send & pass to X ✅"
  (sentence) / "… put on the pile ✅" (last round). There is no separate "passed" message to the host.
- **Waiting screen** (task done): "✅ Done & passed to X" + "Next you'll 🎨 draw / 🔍 interpret. When you get a paper,
  check your task here." The live part shows a progress bar and a chip per player (✅ done / ✍️ busy, you outlined).
- **New round**: a toast "Round r · 🎨 Drawing" and a short vibration (where supported), not after a reload. The texts
  only name the next holder (already in `getTask`), never the chain.
- **Finished**: "🏁 All chains are done!" + "Bring every paper to the reveal pile" + a "reveal is coming" card
  (P10–P12) and Close this game. Toast + vibration when the game ends.

### Revenge prompt (`js/ui/revenge.js`, task screen, P9b)

- `revengePrompt(view)` (no DOM) → `null` or `{ round, type, targets: [{ target, name }] }` from `view.revenge` and
  `view.myRevenge`. No prompt in round 0, without a rule, after using it, in the last round, or when every target is
  in conflict / taken. Blocked targets are hidden **without a reason** (a conflict would reveal the routing).
- A 🔥 card in its own slot **under the task (below the Done button) and under the waiting card**, so it stays open
  until the host advances. Collapsed: "🔥 Take revenge on X?" + why + **Skip** / **Write revenge ✍️**. Open: name
  chips when there are two targets, "🎨 Drawing rule for X's next drawing" (or ✍️ writing rule / interpretation), a
  text box with an 80-character counter (`checkRevenge`), **Send revenge to X 🔥**, **Not now**. After sending:
  "🔥 Revenge sent to X" + the rule, for the rest of that round. The target sees "🔥 Revenge from V" (P8 rule card).
- **Skip** only hides it for this round; the revenge is kept. A host refusal (taken by someone first, round over)
  is a toast. The draft is outside the DOM (memory + localStorage `tps.revengeDraft` `{ code, round, text, target }`);
  a saved draft reopens the form after a reload.
- 🧪 Testing → **Bots take revenge** (`bots.takeRevenge`): every bot that can writes a random `BOT_RULES` rule of
  the right type, asking the host's `revengeOptions` again before each bot.

### Scoring (`js/game/scoring.js`, `js/ui/model.js`, finished screen, P10)

- **Only the host phone runs the model** and publishes the results, so every phone shows the same numbers and players'
  phones download nothing. `model.js` imports Transformers.js lazily (`TRANSFORMERS_URL` in `similarity.js`, also used
  by `tune.html`); the host starts the download in the background as soon as the stage is `playing` (again after a reload).
- **Tuning curve**: the host phone's `tune.html` settings (localStorage `TUNING_STORAGE_KEY`, cleaned by `cleanSettings`),
  else the default. They are fixed in the state the first time scoring starts.
- `measureAll(transformations, measure, { measured, onMeasured, shouldStop })` measures only the empty slots;
  `applyScores(transformations, measured, settings)` sets `similarity` (tuned) and the raw `measurement`
  `{ logitAB, logitBA, exact }`. Identical text scores 100.
- **Host state** `scoring { status: loading | scoring | done | error, total, measured[], settings, error }`, created when the
  game finishes. `host.score(measure, settings)` publishes progress at most every `SCORING_PUBLISH_MS` (750 ms) and on the
  last one; a reload keeps the saved measurements (status back to `loading`) and continues with the rest.
  `failScoring(message)` (model didn't load, or a measure failed) and `retryScoring()` (back to `loading`; the host phone
  then tries again). Done is final.
- **Views** (finished): `scoring { status, done, total, error }` and, once done, `scores: [{ chain, creator, round, drawer,
  interpreter, incoming, outgoing, similarity }]` (names), the same for everyone.
- **Finished screen**: a scoring card (`scoring-view.js` `scoringCard`). Host: "🧠 Loading the scorer… x / y MB" bar, then
  "Scoring the chains… n / N"; players: a spinner, then the same bar. Error: the host gets the reason + **Try again 🔁**,
  players "The host's phone is having trouble scoring". Done: toast "✅ The scores are in!" and a simple per-chain list
  (`chainScores`: 🎨 drawer → 🔍 interpreter, "S" became "S′", score + label), to be replaced by P11/P12.

## 11. Design philosophy

Party companion, not a productivity tool. Simple readable phone screens, obvious next action, minimal
phone time, physical drawing and social play central, playful language, no exposed schedule, no
excessive animation or complex navigation.

## 12. Work packages

Done one at a time, **one package per session**: agree the detailed implementation with the user first,
then build it. Each package ends with its test passing and its status updated here.
Status: ⬜ todo · 🔄 in progress · ✅ done.

Logic packages (P1–P5) are pure ES modules in `js/game/`: no DOM, shared by browser and Node, like
`js/similarity.js`. Tests use Node's built-in runner (`node --test`, no new dependencies) under `tests/`,
run with `npm run test:logic`.

**Phase A — game logic (no UI, no device decision needed)**

| # | Package | Deliverable | Test | Status |
|---|---------|-------------|------|--------|
| P1 | Seeded RNG + schedule validator | `rng.js` (seeded, reproducible shuffle); `schedule.js` `chainLength(n)` and `validateSchedule()`, which checks constraints 1–7 and returns readable errors | Hand-made valid schedule passes; broken ones (duplicate pair, own chain, two tasks in a round, odd length) each fail with the right message | ✅ |
| P2 | Scheduler solver | `generateSchedule(players, seed)` with backtracking and retries; clear error if impossible | n = 5…14, 200 seeds each: every result validates; same seed gives same schedule; different seeds differ; reports timing | ✅ |
| P3 | Sabotage rule assignment | `assignRules(schedule, rules, seed)`: matching type, never own rule, never in a transformation the author is part of, no repeats for the same player when avoidable; plus a validator | Random rule sets for n = 5…12 always validate; a one-type-only rule pool is handled or explained | ✅ |
| P3b | Rule rate | `assignRules(…, { ruleRate = 0.5 })`: each player gets exactly `round(k × ruleRate)` ruled tasks, split evenly between drawings and interpretations; unruled tasks are `null` in `ruleAt`; author uses stay balanced; validator R3 updated | n = 5…12 × 200 seeds: ruled count per player exact, draw/write split differs by ≤ 1, author spread ≤ 1, no R2/R4 errors; `ruleRate: 1` gives the P3 behaviour | ✅ |
| P4 | Scoring engine | `score.js`: damage = 100 − similarity, preservation split, sabotage credit (incl. revenge rules, 0–4 rules per transformation), per-use average, leaderboards, 3 awards; similarity is passed in so it can be faked | Hand-computed fixtures (e.g. 40 damage → 20/20; rule author gets 40; scheduled + revenge rule on one transformation → both authors get 40; no rule → no credit) | ✅ |
| P5 | Game state model | `game.js`: create → players → rules → start → per-round tasks and pass-to instructions → submit → advance → finished; JSON save/load. **Revenge:** `revengeOptions(game, player)` (target, round, rule type, or the reason it's unavailable) and `submitRevenge(game, player, text)`, with once per game, the R2 conflict check, one revenge per task, and none after the last round | Simulates a full 8-player game with dummy sentences; every chain reconstructs; save/load round-trips mid-game (including a pending revenge); revenge cases: used twice → refused, conflict → not offered, two revengers on one target → second refused and keeps theirs, revenge back in r + 2 works | ✅ |

Device model decided (2026-11-27): one phone per player, synced with Firebase, host phone is the authority (§2).

**Phase B — sync + screens (tested in the preview on a phone)**

| # | Package | Deliverable | Test | Status |
|---|---------|-------------|------|--------|
| P5b | Sync layer | Transport interface with a Firebase and an in-memory implementation; host loop (inbox → `game.js` → per-player views); join by game code; Firebase security rules file; setup steps for the user's Firebase project | Node, in-memory transport: 8 clients join, play a full game through messages; host reload mid-game resumes; duplicate/late/invalid messages handled; a view never holds another player's rules | ✅ |
| P6 | App shell + home + lobby | Move the current scorer page to `tune.html`; new `index.html` game shell with screen router, home (create / join with code + name) and live lobby; session (uid, code, role) in localStorage | Host creates a game, 7 more players join (bot button for testing on one phone), reload on either side and the lobby is still there; the tune page still works | ✅ |
| P7 | Rule submission | 3 rules per player with a type toggle; validation | Every player can enter rules; Start stays blocked until all are in | ✅ |
| P8 | Preparation + task screen | Generate and validate the schedule (with a spinner and error text); task screen with round, task, sentence, rule + author (or "No rule this time"), advisory timer; text input + Done for every task type, host's basic Next round, bots do their tasks | Start an 8-player game; each player's round-1 task shows the correct rule or none (`tests/task-stage.test.js`) | ✅ |
| P9 | Pass + round progression | "Pass your paper to X" (and what X will do), "done & passed" confirmation, a better waiting / round-progression screen, the last round handed to the reveal | Play a full game through the UI with dummy input; it ends on interpretations (`tests/pass-stage.test.js`) | ✅ |
| P9b | Revenge rule UI | "Take revenge on X?" prompt on the task/pass screen when `revengeOptions` allows it, with a rule input of the right type and a skip option; the target's next task shows the rule marked as revenge, with the author's name | In a played game, take revenge once: the target sees it next round, the prompt never appears again for that player, and an unavailable case shows no prompt (`tests/revenge-stage.test.js`) | ✅ |
| P10 | Model integration | Load the model in the background during the game; score all transformations at the end with progress shown | Finished game shows real similarity per transformation; `npm test` still passes (`tests/scoring-stage.test.js`; `npm test` also scores a played game with the real model) | ✅ |
| P11 | Leaderboards + awards | Best Preservers, Best Saboteurs, the 3 awards (Guardian of Meaning, Master Saboteur, Agent of Chaos) | Values match P4 for the played game | ⬜ |
| P12 | Chain reveal | Step-by-step reveal per chain: sentences, who drew/interpreted, active rules (revenge highlighted), drift from start to end | Walk through every chain of a played game on a phone screen | ⬜ |

---

## 13. Review notes (derived facts and problems in the brief)

**Scheduling math.** Let *n* = players, *k* = tasks per chain after the original (even, so the chain ends on an
interpretation). Every chain is in the same stage each round, so all players draw in the same
round and all interpret in the next.
- Constraint 2 (each chain at most once, never your own): k ≤ n − 1.
- Constraint 5: each transformation round uses n distinct pairs, k/2 rounds → n·k/2 ≤ n(n−1)/2 → k ≤ n − 1.
- So **k = largest even number ≤ n − 1**, optionally capped for game length:
  n=5/6 → k=4 (2 drawings; at n=5 the 10 transformations use all 10 possible pairs exactly once), n=7/8 → k=6 (3 drawings, as in the brief's example), n=10 → k=8.
  Upper bounds are tight for odd n, so the solver may need retries or a cap (e.g. max k = 6).
- Constraints 3 and 4 follow from 2 when the creator counts as having seen their own chain.

**Pass-to target after an interpretation.** The paper goes to the chain's next drawer. On the last
interpretation, the paper goes to a "reveal pile" (or back to the creator) instead.

**Sabotage assignment pitfalls** (resolved in P3, see §4).
- Rules must match the task type; every player must submit at least 1 drawing and 1 writing rule.
- Pool is 3n rules for about n·k/2 ruled tasks (rate 0.5), so rules repeat across players. That's fine; only repeats for the
  same player are avoided.
- Conflict of interest: a rule is never assigned to a task in a transformation its author is part of.
- Sabotage totals depend on how often each rule was used: the assigner balances uses per author
  (equal in practice); consider showing average damage per use too (P4).

**Preservation fairness.** Each player does k/2 drawings + k/2 interpretations = k transformations, so
totals are comparable. With the rule rate, each player also gets the same number of scheduled rules.
Revenge rules add a little unevenness on top, which is accepted as part of the fun.

---

## 14. Open questions

(Questions 1, 4 and 5 are answered, see the Decision log. Numbers are kept stable.)

2. **How drawings reach the reveal.** The app never sees the paper. Options: lay the papers out
   physically during the reveal, or take an optional photo per drawing (stored locally).
3. **Paper format.** One paper per chain travels every round (decided in P9). Still open: the exact folding / page layout.
6. **Max chain length** for long games with many players (cap k?).

## 15. Decision log

| Date | Decision |
|------|----------|
| 2026-11-26 | Spec added to the repo as `docs/SPEC.md`; kept up to date as the design evolves. |
| 2026-11-26 | Work split into packages P1–P12 (§12), done and tested one at a time. Pure logic first, using a seeded RNG so a game code can rebuild the same schedule on any device. |
| 2026-11-26 | Minimum group size lowered from 6 to 5 players (`MIN_PLAYERS = 5`; n=5 gives k=4). |
| 2026-11-26 | P1: schedule format `{ players, k, rounds[r][c] }` (§5); `chainLength(n, maxTasks = Infinity)` has an optional cap, off by default (open question 6 stays open); validator collects all errors with names; unique names are left to the lobby (P6). |
| 2026-11-26 | P2: `generateSchedule` uses a cyclic-shift construction + random relabelling (§5) instead of cell-by-cell backtracking, which failed for n ≥ 9. ~0.1 ms per schedule for n = 5…14. Schedules carry their `seed`. n=5 has only 48 valid schedules in total, so the "different seeds differ" test asks for ≥ 40 distinct there and ≥ 95 % for n ≥ 6. |
| 2026-11-26 | P3: `assignRules` in `js/game/rules.js` (§4). Round 0 gets no rule. Bad pools throw `RuleError('pool')` instead of playing tasks without a rule; the lobby requires 3 rules per player with ≥ 1 of each type. Added soft rule R5 (drawer and interpreter of one transformation get rules by different authors). Uses are balanced per author: n = 5…12 × 200 seeds give zero warnings and identical use counts per author, ~0.1–0.3 ms each. |
| 2026-11-27 | Rule rate: about 50 % of tasks get a rule (`ruleRate = 0.5`). Exact per player (`round(k × rate)` ruled tasks, split evenly between drawings and interpretations), not a coin flip per task. Implemented in new package P3b, before P4. Per-rule odds are deliberately not uniform: uses are balanced per author (§4). |
| 2026-11-27 | Revenge rule (§4): once per game, against the author of a rule you got in round r, applied to their round r + 1 task. The type follows the target's task, it stacks with a scheduled rule (max 2 rules per task, 1 revenge per task), it isn't offered on a conflict of interest, and it scores like a normal rule. Logic is in P5 (`revengeOptions`, `submitRevenge`), scoring in P4, UI in new package P9b, award in P11, highlight in P12. |
| 2026-11-27 | P3b: ruled tasks are picked fully at random within each player's quota, with no attempt to give each transformation exactly one rule (more chaos). `assignRules` takes `{ ruleRate = 0.5 }` and returns it; unruled tasks are `null`; R3 = exact count per player; uneven split is a `split` warning. n = 5…12 × 200 seeds at rates 1 and 0.5: author spread 0, no R4/R5 warnings, ≤ 0.4 ms. |
| 2026-11-27 | P4: `js/game/score.js` (§7). Scoring is two steps, `buildTransformations` then `scoreGame`, with similarity set in between so it can be faked. Outputs: two leaderboards and exactly **3 awards**: Guardian of Meaning (least damage), Master Saboteur (rules did most damage), Agent of Chaos (own tasks did most damage). *Sweet Revenge* is dropped; revenge rules still score and are highlighted in the reveal. Sabotage credit is per rule. Up to 4 rules per transformation. Ties within 0.1 share rank and award. |
| 2026-11-27 | P5: `js/game/game.js` (§6). The state is one JSON object changed in place, and errors are `GameError` with a `reason`. The host advances rounds explicitly, which leaves a revenge window. Revenge candidates are all authors of rules on the player's current task (scheduled or revenge), and the target is chosen when there are several. Saves store the full schedule. Tests use a fixed seed search to find each revenge situation. |
| 2026-11-27 | Open question 1 (devices): a backend is accepted. **Firebase Realtime Database (free Spark plan) + Anonymous Auth**, one phone per player, host phone is the authority and runs `game.js`. Chosen over a single passed-around phone (too many handoffs), shared game codes without sync (no live revenge, results merged by hand), Supabase (free projects pause when idle), Cloudflare Durable Objects (server code to maintain) and public WebRTC relays (no guarantees). New package P5b (sync layer) before P6. |
| 2026-11-27 | P5b: sync layer (§6 Sync). Host phone is the authority; messages go through an inbox and are applied to a copy of the state, then state + views + inbox deletion are written in one atomic update. Views, public summary and host state are stored as JSON strings (Firebase reshapes arrays). Security rules make each view private and the host state host-only, so secret rules really are hidden. `submit`/`revenge` messages carry the round, so a late duplicate can't count for the next round. The host plays through its own client. Max 14 players, names ≤ 20 chars. Firebase SDK 13.4.0 from gstatic. The rules themselves are checked by hand in the Rules Playground (`docs/firebase-setup.md`); the emulator needs Java. |
| 2026-11-27 | Open question 5: the sentence-similarity page stays as a debug/tuning page, moved to `tune.html` in P6. |
| 2026-11-27 | P6: app shell (§10 App shell). Scorer page moved to `tune.html` (still `js/app.js`); game is `index.html` + `js/ui/`. State-driven router, session in localStorage with a host backup. Test bots are real Firebase users (named apps `bot-N`), not an offline mode, so they exercise the real sync; the Testing section is always shown to the host, collapsed. `connectFirebase(config, { name })` supports several apps per page. Tests: `tests/session.test.js`, `tests/bots.test.js` (memory transport: 7 bots join, host and player reload). |
| 2026-11-27 | P7: rule submission screen (§10 Rule submission). Rules (and revenge rules) are at most 80 characters, enforced by game.js on the host and checked on the phone. Players can edit their rules until the host starts. The draft is kept outside the DOM (memory + localStorage) and live updates don't redraw the inputs. Bots write random built-in rules from the Testing section. Test: `tests/rules-stage.test.js`. |
| 2026-11-27 | P8: preparation + task screen (§10). Scope moved from P9 into P8, because round 1 can't be reached without it: the text input + Done for every task (incl. the round-0 original sentence) and the host's basic **Next round**. P9 keeps the pass step, "done & passed", the waiting screen and the hand-off to the reveal. A failed Start shows an error card on the rules screen instead of a toast. Test: `tests/task-stage.test.js`. |
| 2026-11-27 | P9: pass + round progression (§10). Partly answers open question 3: **one paper per chain** travels every round, folded so the previous drawing is hidden, and goes on a **reveal pile** after the last round (not back to the creator). **One-tap "Done & passed to X"**: no separate pass confirmation, the host only waits on Done. New round = toast + vibration. Test: `tests/pass-stage.test.js` (full 8- and 5-player games). |
| 2026-11-27 | P9b: revenge prompt (§10 Revenge prompt). Shown both during the task and on the waiting screen (most time before the host advances), in its own slot below the task. Unavailable targets are hidden silently, so the prompt never hints at the routing. Skip is per round, the revenge is kept. Bots can take revenge from 🧪 Testing. Test: `tests/revenge-stage.test.js`. |
| 2026-11-27 | P10: model scoring (§10 Scoring). Only the host phone loads TinyBERT (in the background during the game) and scores at the end; results and progress are published to every view. The curve comes from the host phone's `tune.html` settings (default if none) and is fixed when scoring starts. Raw logits are kept per transformation. Progress is throttled to one publish per 750 ms, and a host reload resumes without re-measuring. Tests: `tests/scoring-stage.test.js` (fake model), `npm test` (real model on a played 5-player game, ~25 ms per pair in Node). |
| 2026-11-27 | Open question 4 (timer): **advisory**, it never forces progression. Write 60 s, draw 90 s, interpret 45 s. All phones count from the host's `roundStartedAt` (in the view), so a reload doesn't restart it. |
| (earlier) | English only; TinyBERT cross-encoder only; scoring tuned for "same meaning, not same words". |
