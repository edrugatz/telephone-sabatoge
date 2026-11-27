✅ **P7 (rule submission) is done.** All 127 logic tests pass, and the preview loads with no errors.

**Files**
- `js/ui/screens/rules.js` (new): the rules screen.
  - 3 cards, each with a 🎨/✍️ toggle, a text box and a 0/80 counter.
  - Send, then "Your rules are in" with an Edit button.
  - A live "Rules in n / N" list.
  - Host: Start, Back to lobby, and 🧪 Bots write rules.
- `js/ui/rule-draft.js` (new): checks the draft on the phone with the same limits the host uses.
- `js/ui/session.js`: the draft is saved in localStorage, so a reload keeps it.
- `js/ui/bots.js`: bots write 3 random playful rules each, and this works after a reload too.
- `js/game/game.js`: the host now refuses rules longer than 80 characters, revenge rules included.
- `js/ui/main.js`, `js/ui/screens/status.js`, `css/game.css`: the rules stage is wired in, the old placeholder is removed, and the styles are added.
- `tests/rules-stage.test.js` (new):
  - Start stays blocked until every player has sent rules.
  - Sending again replaces a player's rules.
  - Bad rules are refused.
  - After a host reload, the bots can still send their rules.
  - Players can't see each other's rules.
- `docs/SPEC.md`: P7 is marked ✅, with a new rules-screen section and a decision-log entry.
- `AGENTS.md`: a note for screens with inputs.

**Highlights**
- ✍️ When someone else sends their rules, the screen updates live but your typing and the keyboard stay put.
- ✏️ You can edit your rules until the host starts.
- 🤖 There's a one-tap button that has the bots write their rules.

**Try it**
1. Tap the preview (globe) button and host a game.
2. Open 🧪 Testing, tap Fill to 8, then "Everyone's in → Write rules".
3. Write your 3 rules and send them.
4. Tap 🧪 → Bots write rules. Start unlocks once everyone is in. Tapping it shows the P8 placeholder for now.

**Next:** P8, the preparation and task screen, in a new session. I'll commit now; you'll be asked to confirm.
