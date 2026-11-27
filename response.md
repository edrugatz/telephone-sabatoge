## P8 check

P8 is finished in the code. The screens exist, the spec marks it ✅, and all 132 logic tests pass, including `tests/task-stage.test.js`. It is **not committed**, though: you declined the commit, so 13 changed files are still uncommitted. You can commit them from Source Control.

## P9 plan: pass + round progression

You chose **one paper per chain** and **one tap: Done & passed**.

**Files**
- `js/ui/pass.js` (new, no DOM): builds the pass and waiting text from `view.task`, so Node can test it:
  - "📄 Pass your paper to Ben"
  - What Ben will do next: "Ben will draw your sentence" / "interpret your drawing" / "draw from your sentence"
  - The last round: "Put your paper on the reveal pile"
- `js/ui/screens/task.js`:
  - A pass card on the task screen from the start.
  - The button becomes "Done & passed to Ben ✅" for drawings and "Send & pass to Ben ✅" for sentences.
  - On the last round it becomes "Done → reveal pile".
- **Waiting screen** (after Done replaces the task part):
  - "✅ Done & passed to Ben", with a smaller pass reminder.
  - Progress bar n / N, with chips for ✅ done and ✍️ busy players.
  - "Next: you'll 🔍 interpret. When you get a paper, check your task."
  - The host keeps Next round / Finish 🏁 and the Testing section.
- **New round**:
  - Phones vibrate (`navigator.vibrate`, where the phone supports it) and show a toast "Round 3 · 🎨 Drawing".
  - The screen scrolls to the top.
- `js/ui/screens/finished.js` (new): the hand-off to the reveal. It replaces the `finished` placeholder:
  - "🏁 All chains are done! Bring every paper to the reveal pile."
  - k rounds, n chains, and "Results come next" (P10–P12).
  - Host: Close this game.
- `css/game.css`: pass card, progress bar, chips.

**Edge cases**
- The pass text never shows the chain. It only names the next holder, which `getTask` already exposes.
- A reload during the waiting screen comes back to the same waiting screen, because `done` comes from the host.
- The toast fires only when the round actually changes, not on the first render after a reload.

**Test** `tests/pass-stage.test.js`, memory transport:
- Full games with 8 and 5 players, played through Host, Clients and Bots with dummy input.
- Each round, every player's pass text names the next holder of their chain (checked against the schedule) and the right next task.
- The last round says "reveal pile".
- The stage ends `finished`, and every chain's last stage is `interpret`.
- Then a phone check in the preview with 🧪 bots.

**Spec**: §10 gets a new "Pass + round progression" part, and §15 gets the decisions (one paper per chain, one-tap Done & passed, reveal pile at the end).

Shall I go ahead?
