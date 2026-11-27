The 💬 feedback button is built, but players can't send feedback yet: you first need to publish the updated database rules in Firebase (step 1 below).

**Checks so far:**
- All 161 logic tests pass, including 11 new feedback tests.
- The preview loads with no errors.
- `npm run feedback` signs in and reaches Firebase, then gets "Permission denied". That's expected until the rules are published.

## What players get
- 💬 A button in the header next to the game code, on every screen.
- 📝 It opens a sheet over the game. They pick 🐛 Bug / 😕 Confusing / 💡 Idea / ❤️ Like and type a comment (up to 1000 characters).
- 📍 The sheet shows where they are (e.g. "Task · round 3 · 🎨 drawing"). That's saved with the comment, along with the game code, their name, host or not, player count, phone/browser and the last 5 errors.
- 🔙 **Send** shows a "Thanks! 🙏" toast, the sheet closes, and they're back exactly where they were. The game keeps running underneath while the sheet is open, and their typed sentences are kept. If sending fails, their comment stays in the box so they can try again.

## The backlog
- 📥 Every comment is saved in Firebase under `feedback/`, outside the games, so it stays after a game is closed.
- 📋 `npm run feedback` lists the comments that aren't in `docs/BACKLOG.md` yet. In a session I run it, add them under 🆕 New, and we go through them together: ✅ accepted → 🔧 done, or ❌ rejected with a reason.

## Files
- `js/ui/feedback.js` (new): builds the report, checks it, keeps the error log and formats backlog entries
- `js/ui/feedback-sheet.js` (new): the sheet itself
- `js/ui/main.js`: wires up the button, records where the player is and catches errors
- `index.html`, `css/game.css`: the button and the sheet's styles
- `firebase/database.rules.json`: new rules for `feedback/`
- `scripts/feedback.mjs` (new), `package.json`: the `npm run feedback` command
- `docs/BACKLOG.md` (new): the backlog
- `tests/feedback.test.js` (new): the tests
- `docs/SPEC.md` (P11b ✅, new section and decision), `docs/firebase-setup.md`, `AGENTS.md`

## To make it work
1. In the Firebase console go to **Realtime Database → Rules**, paste the whole contents of `firebase/database.rules.json`, and tap **Publish**.
2. Approve the commit dialog, so the button goes live on GitHub Pages.
3. On a phone, open the game, tap 💬, and send a test comment.
4. Tell me when you've sent it. I'll run `npm run feedback` to check it arrives, and we can start going through the backlog.

## Possible next steps
- 📸 Attach an optional screenshot or photo to a comment.
- 🏁 A short "how was the game?" question on the finished screen.
- 🎬 P12, the chain reveal, is the next package.
