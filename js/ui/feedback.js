// Playtest feedback (P11b): builds the report a 💬 feedback sheet sends, and the backlog text the
// `npm run feedback` script prints. No DOM, no Node APIs: shared by the browser, the script and the tests.
//
// Reports go to Firebase `feedback/{pushId}` (outside the games, so they outlive them):
//   { kind, text, at, uid, screen, stage?, round?, task?, code?, name?, host, players?, errors?, agent?, page? }

export const FEEDBACK_PATH = 'feedback';
export const MAX_FEEDBACK_LENGTH = 1000;
export const MAX_ERRORS = 5;

export const FEEDBACK_KINDS = {
  bug: '🐛 Bug',
  confusing: '😕 Confusing',
  idea: '💡 Idea',
  like: '❤️ Like',
};
export const DEFAULT_KIND = 'bug';

const SCREEN_NAMES = {
  home: 'Home',
  loading: 'Loading',
  error: 'Error screen',
  lobby: 'Lobby',
  rules: 'Rules',
  task: 'Task',
  finished: 'Finished',
  stage: 'Waiting',
};
const TASK_NAMES = { write: '✍️ writing', draw: '🎨 drawing', interpret: '🔍 interpreting' };

const clip = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);
const whole = (value) => (Number.isInteger(value) && value >= 0 ? value : undefined);

/** Error message for the typed text, or null when it can be sent. */
export function checkFeedback(text) {
  const length = String(text ?? '').trim().length;
  if (!length) return 'Write a few words first';
  if (length > MAX_FEEDBACK_LENGTH) return `Too long: at most ${MAX_FEEDBACK_LENGTH} characters`;
  return null;
}

/** Keep only the context fields a report stores, cleaned. */
export function cleanContext(context = {}) {
  return {
    screen: clip(context.screen, 40) ?? 'unknown',
    stage: clip(context.stage, 40),
    round: whole(context.round),
    task: clip(context.task, 20),
    code: clip(context.code, 10),
    name: clip(context.name, 40),
    host: context.host === true,
    players: whole(context.players),
  };
}

/** Short "where was I" line, shown in the sheet and in the backlog: "Task · round 3 · 🎨 drawing". */
export function contextLabel(context = {}) {
  const c = cleanContext(context);
  const parts = [SCREEN_NAMES[c.screen] ?? c.screen];
  if (c.stage && c.stage !== c.screen && !(c.stage === 'playing' && c.screen === 'task')) parts.push(c.stage);
  if (c.round !== undefined) parts.push(`round ${c.round}`);
  if (c.task) parts.push(TASK_NAMES[c.task] ?? c.task);
  return parts.join(' · ');
}

/**
 * The record to push. Returns { ok: true, report } or { ok: false, error }.
 * Firebase drops undefined fields, so missing context simply isn't stored.
 */
export function buildReport({ kind, text, context, errors = [], uid, now = Date.now(), agent, page }) {
  const error = checkFeedback(text);
  if (error) return { ok: false, error };
  if (!(kind in FEEDBACK_KINDS)) return { ok: false, error: 'Pick what kind of feedback it is' };
  if (typeof uid !== 'string' || !uid) return { ok: false, error: 'Not connected yet' };
  const report = {
    kind,
    text: String(text).trim(),
    at: now,
    uid,
    ...cleanContext(context),
    errors: clip(errors.slice(-MAX_ERRORS).join(' | '), 1500),
    agent: clip(agent, 300),
    page: clip(page, 200),
  };
  for (const key of Object.keys(report)) if (report[key] === undefined) delete report[key];
  return { ok: true, report };
}

/** Push a built report; resolves with its id. */
export function sendFeedback(transport, report) {
  return transport.push(FEEDBACK_PATH, report);
}

/** The last few errors on this page (console.error, uncaught errors), for bug reports. */
export function createErrorLog(limit = MAX_ERRORS) {
  const entries = [];
  return {
    add(message) {
      const text = clip(String(message ?? ''), 300);
      if (!text) return;
      entries.push(text);
      if (entries.length > limit) entries.shift();
    },
    list: () => [...entries],
  };
}

// ---- Backlog (docs/BACKLOG.md, filled from `npm run feedback`) ---------------------------------------

const ID_MARK = /<!-- feedback-id: (\S+) -->/g;

/** Ids already in the backlog text. */
export function backlogIds(markdown) {
  return new Set([...String(markdown ?? '').matchAll(ID_MARK)].map((m) => m[1]));
}

/** Entries of the `feedback` node not in the backlog yet, oldest first: [{ id, report }]. */
export function newFeedback(all, markdown) {
  const known = backlogIds(markdown);
  return Object.entries(all ?? {})
    .filter(([id, report]) => !known.has(id) && report && typeof report === 'object')
    .map(([id, report]) => ({ id, report }))
    .sort((a, b) => (a.report.at ?? 0) - (b.report.at ?? 0) || a.id.localeCompare(b.id));
}

const pad = (n) => String(n).padStart(2, '0');
function formatTime(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return 'unknown time';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** One backlog entry, ready to paste under "## 🆕 New" in docs/BACKLOG.md. */
export function formatEntry(id, report) {
  const r = report ?? {};
  const who = [r.name ?? 'someone', r.host ? '(host)' : null].filter(Boolean).join(' ');
  const game = r.code ? `${r.code}${Number.isInteger(r.players) ? `, ${r.players} players` : ''}` : 'not in a game';
  const quote = String(r.text ?? '').split('\n').map((line) => `> ${line}`).join('\n');
  const lines = [
    `### FB-${String(id).slice(-6)} · ${FEEDBACK_KINDS[r.kind] ?? r.kind ?? '?'} · 🆕 new`,
    `- **When:** ${formatTime(r.at)} · **Who:** ${who} · **Game:** ${game}`,
    `- **Where:** ${contextLabel(r)}`,
    r.errors ? `- **Errors:** \`${r.errors.replaceAll('`', "'")}\`` : null,
    r.agent ? `- **Phone:** ${r.agent}` : null,
    '- **Decision:** _to discuss_',
    '',
    quote,
    `<!-- feedback-id: ${id} -->`,
  ];
  return lines.filter((line) => line !== null).join('\n');
}
