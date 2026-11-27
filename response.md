P9b (revenge rule UI) is done: all 140 logic tests pass, including 5 new ones. I couldn't check it in the preview because the app was in the background.

**Files**
- `js/ui/revenge.js` (new): decides when to show the prompt and holds its texts and the 80-character check. Targets that aren't allowed are hidden without saying why, because the reason could give away who passes to whom.
- `js/ui/screens/task.js`: the 🔥 revenge card. It sits in its own slot below the Done button, and under the "Done & passed" card after Done, so live updates never wipe what you're typing.
- `js/ui/main.js`: sends the revenge, handles Skip, keeps the draft, and wires the new bot button.
- `js/ui/session.js`: a revenge draft (`tps.revengeDraft`), kept for its own round only, so a reload keeps it.
- `js/ui/bots.js`: `takeRevenge()`, used by the new 🧪 **Bots take revenge** button.
- `css/game.css`: styles for the revenge card and a red button.
- `tests/revenge-stage.test.js` (new), plus updates to `docs/SPEC.md` (§10 new section, P9b ✅, decision log) and `AGENTS.md`.

**What you get**
- 🔥 "Take revenge on X?" with **Skip** / **Write revenge ✍️**. The form says which kind of rule to write ("🎨 Drawing rule for X's next drawing"), has a counter, and offers name chips when two players gave you rules.
- 🙈 Skip only hides it for this round. Your revenge is kept for later.
- ✅ After sending: "Revenge sent to X" for the rest of that round. X sees "🔥 Revenge from you" on their next task.
- 🚫 There's no prompt in round 0, without a rule, after you've used it, in the last round, or when no target is allowed.

**Try it**
1. Bring PolyDev to the front and tap the preview (🌐) button.
2. Host a game, use 🧪 to fill with bots and have them write rules, then start.
3. Play until you get a rule. The 🔥 card appears: send a revenge. Next round, the target bot's task shows it.
4. To see a revenge on yourself: 🧪 → **Bots take revenge**, then Next round.

**Next**
- P10: run the model in the background and score every transformation at the end.
- Maybe: warn the host when someone is still typing a revenge, before Next round.
