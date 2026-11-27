// `npm run feedback`: fetch playtest feedback from Firebase and print the entries that aren't in
// docs/BACKLOG.md yet, as ready-to-paste backlog entries. It only reads: triage happens in a chat session.
//
//   npm run feedback            new entries only
//   npm run feedback -- --all   every entry, even the ones already in the backlog
//
// Signs in as a fresh anonymous user (REST API), because the database rules need a signed-in reader.

import { readFile } from 'node:fs/promises';
import { firebaseConfig } from '../js/sync/firebase-config.js';
import { FEEDBACK_PATH, newFeedback, formatEntry } from '../js/ui/feedback.js';

const BACKLOG = new URL('../docs/BACKLOG.md', import.meta.url);
const showAll = process.argv.includes('--all');

async function signIn() {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Anonymous sign-in failed: ${body.error?.message ?? response.status}`);
  return body.idToken;
}

async function fetchFeedback(token) {
  const response = await fetch(`${firebaseConfig.databaseURL}/${FEEDBACK_PATH}.json?auth=${encodeURIComponent(token)}`);
  const body = await response.json();
  if (!response.ok) {
    const hint = response.status === 401 ? ' (are the database rules from firebase/database.rules.json published?)' : '';
    throw new Error(`Reading feedback failed: ${body.error ?? response.status}${hint}`);
  }
  return body ?? {};
}

async function main() {
  const backlog = await readFile(BACKLOG, 'utf8').catch(() => '');
  const all = await fetchFeedback(await signIn());
  const total = Object.keys(all).length;
  const entries = newFeedback(all, showAll ? '' : backlog);
  console.log(`${total} feedback entr${total === 1 ? 'y' : 'ies'} in Firebase, ${entries.length} ${showAll ? 'shown' : 'new'}.\n`);
  for (const { id, report } of entries) console.log(`${formatEntry(id, report)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
