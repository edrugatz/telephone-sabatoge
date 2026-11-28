P12 is built and its tests pass, but it isn't committed: PolyDev isn't signed in to GitHub, so the commit was refused (401) and nothing was saved or pushed. I couldn't check it in the preview either, because the app was in the background.

As we agreed: the awards and leaderboards come first, then a button opens the chain reveal. Each phone steps through on its own, and every chain ends with a start-vs-end score.

**Files**
- `js/game/host.js`: scoring also measures one original-vs-final ("drift") pair per chain. New `revealOf()` → `view.reveal`, which replaces `view.scores`. A game scored before this change re-measures only the drift when the host phone reloads.
- `js/ui/reveal-view.js` (new, no DOM): the reveal texts, the revenge highlight, "(you)", and the Next / chain / Show-all stepping.
- `js/ui/screens/reveal.js` (new): the reveal screen.
- `js/ui/screens/finished.js`: awards + leaderboards, then a 🎬 button to open the reveal. The old 📜 Chain scores list is gone.
- `js/ui/main.js`: switches between the two screens and saves where you are, so updates and reloads keep your place.
- `js/ui/session.js`: saves the reveal position (`tps.reveal`).
- `js/ui/scoring-view.js`: the old `chainScores` list is removed.
- `css/game.css`: reveal styles.
- `tests/reveal-stage.test.js` (new) and an updated `tests/scoring-stage.test.js`.
- `docs/SPEC.md`: new section "§10 Chain reveal", P12 set to ✅, decision log entry.
- `AGENTS.md`: a P12 note.
- `js/ui/build.js`: `BUILD` set to `2026-11-28.1`.

**What you get**
- 🏆 Awards and leaderboards first, then **🎬 Step through the chains**.
- 📝 → 🎨 → 🔍 → … → 🏁: one beat per tap, with "📄 Show Ben's drawing" so the group can lay out the paper.
- 😈 Each rule shows its author. Revenge is highlighted in red: "🔥 Eva took revenge on Ben".
- 📏 Every chain ends with "Started as / Ended as" and a model score with its label.
- ‹ › arrows to switch chains, **Next ▶** → **Next chain →** → **🏆 Back to the awards**, and "Show the whole chain".

**Tests:** `npm run test:logic` passes all 165 tests, and `npm test` (real model) still passes.

**To finish**
1. Sign in to GitHub from Source Control, then ask me to commit. The message is ready: "P12: chain reveal after awards, drift score per chain".
2. To try it on your phone: tap the preview (globe) button, host a game, then 🧪 Testing → Fill to 8 and play to the end with the bot buttons. Wait for the scores, then tap 🎬 and walk through every chain.

**Possible next steps**
- Optional photo per drawing in the reveal (open question 2).
- A host-controlled "presenter" mode for big groups.
- Triage the playtest feedback (`npm run feedback`).
