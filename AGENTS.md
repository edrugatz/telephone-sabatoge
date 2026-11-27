# Sentence Similarity

**Game spec:** `docs/SPEC.md` (Telephone Pictionary Sabotage game built on top of this scorer). Read it at the start of every session. Update it in the same change whenever a design decision is made: edit the section, move answered open questions into its Decision log.

**Workflow: one work package per session.** At the start of a session, take the first package in SPEC §12 that isn't done. Before writing any code, discuss the detailed implementation with the user (files, API, edge cases, how it will be tested) and wait for their agreement. Then implement it, run its test, set it to ✅ in §12, and record any decisions in the spec. Stop there; the next package is for a new session.

**Commit as you go.** Whenever a change is completed (a work package, a fix, a doc/spec update), commit it right away with the polydev `git_commit` tool and a clear message; don't leave finished work uncommitted. `git_commit` also pushes to GitHub (github.com/edrugatz/telephone-sabatoge, `main`), and the user confirms each commit. Keep commit messages to one short line: long ones overflow the PolyDev confirm dialog and can't be approved.

Static site (no build step), meant for GitHub Pages. Scores two sentences 0–100 with the `cross-encoder/stsb-TinyBERT-L4` cross-encoder via Transformers.js (loaded from jsDelivr `/+esm`, version pinned in `js/app.js`).

- Preview: `npm start` (zero-dep static server on 127.0.0.1:8080). ES modules need http, not file://.
- Test: `npm test` scores known pairs with the real model. It loads the *web* build in Node because onnxruntime-node won't load on Alpine/musl; see the shims in `scripts/smoke-test.mjs`.
- Game logic tests: `npm run test:logic` (Node's built-in runner, `tests/*.test.js`, modules in `js/game/`).
- Pages: `index.html` = the game (`js/ui/main.js`, screens in `js/ui/screens/`, `css/game.css`); `tune.html` = scorer/tuning debug page (`js/app.js`). Test bots: host lobby → 🧪 Testing (each bot is a named Firebase app with its own anonymous uid); the rules and task screens have their own 🧪 buttons (bots write rules / do their tasks / take revenge).
- Every view update re-renders the screen: a screen with text inputs must be a component with `update()` that keeps its inputs, and must keep its draft outside the DOM (pattern: `js/ui/screens/rules.js`).
- Other phones can't open the local preview (127.0.0.1 is the phone itself): multi-phone tests need the site published (GitHub Pages); set its address in `js/ui/config.js` `PUBLIC_URL` for invite links. Published at https://edrugatz.github.io/telephone-sabatoge/ (repo github.com/edrugatz/telephone-sabatoge, Pages from `main` / root). Commits made with the polydev `git_commit` tool are pushed there automatically.
- Multi-phone sync: Firebase Realtime DB (host phone is the authority, `js/game/host.js` / `client.js`, transports in `js/sync/`). Tests use `memory-transport.js`; real config goes in `js/sync/firebase-config.js` (steps in `docs/firebase-setup.md`).
- The model's ONNX files have non-standard names: load them with `subfolder: 'onnx'`, `model_file_name: 'model_qint8_arm64'`, `dtype: 'fp32'`. Score = sigmoid(logit).
- Scoring is split: `measure()` runs the model (logits A→B and B→A in one batch), and `toScore()` applies the tuning curve `sigmoid((logit−offset)/temperature)` instantly. The debug panel (`js/tuning.js`) saves its settings in localStorage. The use case is a telephone word game: it rewards same meaning, not same words.
- `js/similarity.js` is shared by the browser and the test. Keep it free of DOM/Node APIs. It holds the pinned `TRANSFORMERS_URL` and the tune page's `TUNING_STORAGE_KEY`.
- Game scoring (P10): only the host phone loads the model (`js/ui/model.js`), `host.score()` fills `state.scoring`; tests fake `measure` (`tests/scoring-stage.test.js`).
- User preferences: English only, Compare button (no live scoring), TinyBERT only.
- Always overwrite `response.md` (repo root) with your full final reply each turn: the PolyDev UI sometimes swallows chat responses.
