## Commit failed: the repo is still empty

I can't commit without your confirmation; the app always asks. This time you confirmed (I used a one-line message so the card is short), but GitHub refused the push: **"Git Repository is empty"**. The connection can't make the very first commit in a completely empty repo. Nothing was saved: all 48 files are still waiting.

### Fix (1 minute, on github.com)
1. Open **github.com/edrugatz/telephone-sabatoge**.
2. On the empty repo page, tap **"creating a new file"**. If you don't see that link, use **Add file → Create new file**.
3. Name it `.nojekyll`. Leave it empty, or type one space if GitHub insists on content.
4. Tap **Commit changes** on the `main` branch.

That also adds the `.nojekyll` file that was missing from the list. Then say "commit" again, and I'll retry the same commit.
