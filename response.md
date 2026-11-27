✅ **P8 (Preparation + task screen) is built.** All 132 logic tests pass, including the new P8 test. I couldn't open the preview here because the app was in the background, so the screens haven't been seen on a phone yet; the changed files only passed a syntax check. The commit waits for your confirmation.

**Files**
- `js/ui/screens/task.js` *(new)*: the task screen. Built like the rules screen, so typing isn't interrupted when the view updates.
- `js/ui/timer.js` *(new)*: the advisory timer: 60 / 90 / 45 s, counted from the host's start time.
- `js/game/host.js`: records `roundStartedAt` on Start and on every Next round, and puts it in each player's view.
- `js/ui/screens/rules.js`: a spinner, "Preparing the game…", while the game is prepared. If it fails, an error card and **Try again**.
- `js/ui/main.js`: shows the task screen during the game; Done, Next round, and the bots' task button.
- `js/ui/bots.js`: `doTasks`: bots send a made-up sentence for the current round.
- `js/ui/session.js`: keeps the sentence you're typing (`tps.taskDraft`), one per game and round, so a reload doesn't lose it.
- `css/game.css`: round chip, timer, sentence card, rule cards (revenge in red).
- `tests/task-stage.test.js` *(new)*: an 8-player game. Each round-1 view shows exactly the rule the host assigned, or none. Ana's rules only show where they were assigned. Also covers the timer, the draft, a refused Start, and a host reload.
- `docs/SPEC.md`, `AGENTS.md`: §10 task screen, P8 ✅, P9 scope narrowed, timer (open question 4) moved to the Decision log.

**What you get**
- 🎬 Start → spinner → everyone sees their task
- 🎨 Round, task, sentence to draw, timer
- 😈 "Sabotage from X" / 🔥 "Revenge from X" / 🍀 "No rule this time"
- ✍️ Sentence box + Done; the host gets **Next round →** when everyone's done

**Try it**
1. Tap the preview (globe) button and host a game.
2. 🧪 Testing → **Fill to 8** → **Write rules**.
3. 🧪 **Bots write rules**, write your own rules, then **Start the game 🎬**.
4. Write your sentence, 🧪 **Bots do their tasks**, then **Next round →**. Round 1 shows your drawing task and its rule, or none.

**Next:** P9: "Pass your paper to X", the "done & passed" confirmation, and a full game played through the screens.
