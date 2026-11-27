I fixed the "null" text under the "Rules in" card (FB-xqnYGn). The fix is committed and pushed to GitHub Pages.

**Cause:** when there's no start error, the host's Rules screen passes an empty (`null`) slot into the browser's `replaceChildren()`. That function doesn't skip `null`, so it shows up on the page as the text "null". Our `h()` helper skips it, which is why only this spot broke.

**Fix:**
- `js/ui/dom.js`: new `setChildren(el, ...children)` that skips empty values the same way `h()` does.
- `js/ui/screens/rules.js`: uses it for the progress section.
- `js/ui/screens/task.js`: had the same hidden bug. Guests would have seen "null" under the progress card while other players were still finishing their task. It uses the new function too.
- `docs/BACKLOG.md`: the entry is under 🔧 Done with the cause and fix.

**Check:** all 161 logic tests pass and the preview loads with no errors. I haven't seen the fix on a real phone yet. To check it, open a game as host and look under the "Rules in" card on the Rules screen.
