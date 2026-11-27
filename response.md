## P11 plan: Leaderboards + awards. I need your OK before I start

**Data (host, `js/game/host.js`)**
- New `standings(state)`: once scoring is `done`, it runs `scoreGame()` (P4) on the scored transformations and returns names instead of ids:
  - `awards: [{ id, title, description, winners: [names], value }]` (only the awards P4 actually gives)
  - `preservers: [{ name, value, rank }]`, where value is the meaning lost (lower is better)
  - `saboteurs: [{ name, value, rank, uses, perUse }]`
- Added to every finished view as `view.standings`, so every phone gets the same thing. Sabotage totals only. The rule texts stay hidden until the P12 reveal.

**Texts (`js/ui/standings-view.js`, no DOM so tests can check it)**
- `awardCards(standings, me)`: 🛡️ Guardian of Meaning, 😈 Master Saboteur, 🌪️ Agent of Chaos. Each card has the winner(s), a one-line reason, the value, and "🎉 That's you!" when you won.
- `boardRows(...)`: shows the rank with 🥇🥈🥉, the name and the value. Your own row is highlighted. Tied players share a rank.
  - Preservers row: "12.3 lost"
  - Saboteurs row: "84.0 damage · 3 rules · 28.0 per rule" (or "no rules used")

**Finished screen (`finished.js`, `css/game.css`)**
- Once the scores are in, the order is: 🏆 the 3 award cards, then a **Best Preservers** card, then a **Best Saboteurs** card. These are two stacked cards, not tabs, so it's simpler on a phone.
- The current per-chain score list moves into a collapsed "📜 Chain scores" section. P12 will replace it with the reveal.

**Edge cases**
- Ties share a rank and an award, as in P4 (equal to 0.1).
- No damage from any rule → no Master Saboteur.
- Everyone tied → no Agent of Chaos.
- No standings until scoring is done. A host reload rebuilds them from the saved measurements.

**Test: `tests/standings-stage.test.js` (memory transport + fake model)**
- Plays a full 8-player game, including one revenge, then compares every phone's `view.standings` to what `scoreGame()` (P4) gives on the same transformations.
- Checks a tie case and the case where all sentences are identical (no Master Saboteur, no Agent of Chaos).
- Checks the texts from `standings-view.js`.
- `npm run test:logic` and `npm test` must still pass.

Then I set P11 to ✅ in the spec, log the decisions and commit.

**Is this OK, or do you want changes?** For example: tabs instead of stacked cards, hiding the chain list completely, or other award emojis.
