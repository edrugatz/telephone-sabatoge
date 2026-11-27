import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  FEEDBACK_PATH, MAX_FEEDBACK_LENGTH, checkFeedback, cleanContext, contextLabel, buildReport, sendFeedback,
  createErrorLog, backlogIds, newFeedback, formatEntry,
} from '../js/ui/feedback.js';
import { createMemoryBackend } from '../js/sync/memory-transport.js';

const TASK_CONTEXT = { screen: 'task', stage: 'playing', round: 3, task: 'draw', code: 'ABCDE', name: 'Ana', host: true, players: 8 };

test('text must be non-empty and at most 1000 characters', () => {
  assert.equal(checkFeedback(''), 'Write a few words first');
  assert.equal(checkFeedback('   '), 'Write a few words first');
  assert.equal(checkFeedback(undefined), 'Write a few words first');
  assert.equal(checkFeedback('x'.repeat(MAX_FEEDBACK_LENGTH)), null);
  assert.match(checkFeedback('x'.repeat(MAX_FEEDBACK_LENGTH + 1)), /at most 1000/);
});

test('the context label says where the player was', () => {
  assert.equal(contextLabel(TASK_CONTEXT), 'Task · round 3 · 🎨 drawing');
  assert.equal(contextLabel({ screen: 'home' }), 'Home');
  assert.equal(contextLabel({ screen: 'rules', stage: 'rules' }), 'Rules');
  assert.equal(contextLabel({ screen: 'finished', stage: 'finished', round: 6 }), 'Finished · round 6');
  assert.equal(contextLabel({}), 'unknown');
});

test('a report holds the text, kind, sender and context', () => {
  const built = buildReport({ kind: 'confusing', text: '  Who do I pass to?  ', context: TASK_CONTEXT, uid: 'u1', now: 1000, agent: 'Phone', page: '/' });
  assert.equal(built.ok, true);
  assert.deepEqual(built.report, {
    kind: 'confusing', text: 'Who do I pass to?', at: 1000, uid: 'u1',
    screen: 'task', stage: 'playing', round: 3, task: 'draw', code: 'ABCDE', name: 'Ana', host: true, players: 8,
    agent: 'Phone', page: '/',
  });
});

test('missing context is left out, never stored as undefined or null', () => {
  const { report } = buildReport({ kind: 'idea', text: 'More rounds', context: { screen: 'home' }, uid: 'u1', now: 5 });
  assert.deepEqual(report, { kind: 'idea', text: 'More rounds', at: 5, uid: 'u1', screen: 'home', host: false });
  assert.equal(Object.values(report).includes(undefined), false);
});

test('bad input is refused with a message', () => {
  assert.deepEqual(buildReport({ kind: 'bug', text: '', uid: 'u1' }), { ok: false, error: 'Write a few words first' });
  assert.equal(buildReport({ kind: 'rant', text: 'hi', uid: 'u1' }).ok, false);
  assert.equal(buildReport({ kind: 'bug', text: 'hi', uid: '' }).error, 'Not connected yet');
});

test('context fields are cleaned and clipped', () => {
  const c = cleanContext({ screen: 'x'.repeat(99), round: -1, players: 2.5, host: 'yes', name: '  Ben  ' });
  assert.equal(c.screen.length, 40);
  assert.equal(c.round, undefined);
  assert.equal(c.players, undefined);
  assert.equal(c.host, false);
  assert.equal(c.name, 'Ben');
});

test('the error log keeps the last 5 errors and they go into the report', () => {
  const log = createErrorLog();
  for (let i = 1; i <= 7; i++) log.add(`error ${i}`);
  log.add('');
  assert.deepEqual(log.list(), ['error 3', 'error 4', 'error 5', 'error 6', 'error 7']);
  const { report } = buildReport({ kind: 'bug', text: 'Broke', uid: 'u1', errors: log.list() });
  assert.equal(report.errors, 'error 3 | error 4 | error 5 | error 6 | error 7');
});

test('sendFeedback pushes the report under feedback/', async () => {
  const backend = createMemoryBackend();
  const transport = backend.connect('u1');
  const { report } = buildReport({ kind: 'like', text: 'Revenge is great', context: TASK_CONTEXT, uid: 'u1', now: 42 });
  const id = await sendFeedback(transport, report);
  assert.deepEqual(backend.dump()[FEEDBACK_PATH][id], report);
});

test('the backlog skips entries it already has, and lists the rest oldest first', () => {
  const all = {
    a1: { kind: 'bug', text: 'late', at: 300, uid: 'u', screen: 'home' },
    a2: { kind: 'idea', text: 'early', at: 100, uid: 'u', screen: 'home' },
    a3: { kind: 'like', text: 'known', at: 200, uid: 'u', screen: 'home' },
  };
  const backlog = '### FB-a3\n<!-- feedback-id: a3 -->\n';
  assert.deepEqual([...backlogIds(backlog)], ['a3']);
  assert.deepEqual(newFeedback(all, backlog).map((e) => e.id), ['a2', 'a1']);
  assert.deepEqual(newFeedback(null, ''), []);
});

test('a backlog entry has the kind, context, quote and id mark', () => {
  const { report } = buildReport({ kind: 'bug', text: 'Timer froze\nat 0', context: TASK_CONTEXT, uid: 'u1', now: Date.UTC(2026, 10, 27, 14, 3), errors: ['TypeError: x'] });
  const entry = formatEntry('-OAbcdefXYZ123', report);
  assert.match(entry, /^### FB-XYZ123 · 🐛 Bug · 🆕 new$/m);
  assert.match(entry, /\*\*When:\*\* 2026-11-27 14:03 UTC · \*\*Who:\*\* Ana \(host\) · \*\*Game:\*\* ABCDE, 8 players/);
  assert.match(entry, /\*\*Where:\*\* Task · round 3 · 🎨 drawing/);
  assert.match(entry, /\*\*Errors:\*\* `TypeError: x`/);
  assert.match(entry, /^> Timer froze\n> at 0$/m);
  assert.deepEqual([...backlogIds(entry)], ['-OAbcdefXYZ123']);
});

test('the database rules accept the fields a report can have', async () => {
  const rules = JSON.parse(await readFile(new URL('../firebase/database.rules.json', import.meta.url), 'utf8'));
  const node = rules.rules.feedback;
  assert.equal(node['.read'], 'auth != null');
  for (const field of ['kind', 'text', 'at', 'uid', 'screen']) assert.match(node.$id['.validate'], new RegExp(`'${field}'`));
  assert.match(node.$id['.write'], /!data\.exists\(\)/);
});
