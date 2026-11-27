✅ **P10 (model scoring) is built and its tests pass.** When a game ends, the host phone scores every drawing → interpretation pair with TinyBERT and sends the scores to every phone. Your tuning choice wasn't stated, so it uses the curve saved on `tune.html` on the host phone, or the default curve if nothing is saved.

**Files**
- `js/game/scoring.js` (new): `measureAll()` measures only the pairs not scored yet; `applyScores()` applies the tuning curve and keeps the raw logits.
- `js/game/host.js`: scoring status (loading → scoring → done/error), `score()` / `failScoring()` / `retryScoring()`, progress sent at most every 0.75 s, picks up after a host reload. Views get `scoring` and `scores`.
- `js/ui/model.js` (new): loads the model lazily on the host phone only, tracks download progress, reads the tune page settings.
- `js/ui/scoring-view.js` (new): the scoring card texts and the per-chain grouping.
- `js/ui/screens/finished.js` + `css/game.css`: progress card, Try again, per-chain score list.
- `js/ui/main.js`: the model download starts in the background once the game is running; scoring starts or resumes when the game is finished.
- `js/similarity.js`, `js/app.js`, `js/tuning.js`: shared `TRANSFORMERS_URL` / `TUNING_STORAGE_KEY` / `cleanSettings`.
- `tests/scoring-stage.test.js` (new), `scripts/smoke-test.mjs`, `docs/SPEC.md` (P10 ✅), `AGENTS.md`.

**Features**
- 🧠 Host phone: "Loading the scorer… x / 15 MB", then "Scoring the chains… n / N"
- 📱 Players: the same progress, with no download on their phones
- 🔁 Errors show on every phone; the host gets **Try again**
- 📜 A per-chain list: drawer → interpreter, "S" became "S′", score + label
- 💾 A host reload continues scoring without measuring anything twice

**Tests**
- `npm run test:logic`: all 147 pass (7 new).
- `npm test`: the real model scored a played 5-player game, 10 pairs in 228 ms.
- The preview check found no errors on `index.html` or `tune.html`.

**How to check**
1. Tap the preview (globe) button and host a game.
2. Use 🧪 Testing to fill the game with bots and get through the rules and every round.
3. On the finished screen, watch the scorer load and the scores appear.

**Next:** P11 (leaderboards + awards) in a new session, which can build on `view.scores`. Later ideas: show the pairs with the lowest scores first, and photos of the drawings (open question 2).
