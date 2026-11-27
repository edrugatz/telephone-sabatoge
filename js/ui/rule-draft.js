// The rules a player is typing (P7), before they are sent. Pure ES module (no DOM), used by the rules
// screen, the session store and the tests.
//
//   draft = [{ type: 'draw' | 'write', text }] ×3   (text untrimmed, as typed)

import { RULE_TYPES, RULES_PER_PLAYER } from '../game/rules.js';
import { MAX_RULE_LENGTH } from '../game/game.js';

export const TYPE_LABEL = { draw: '🎨 Drawing', write: '✍️ Writing' };

/** A fresh draft: drawing, writing, drawing (so the "one of each" rule is already met). */
export function emptyDraft() {
  return [
    { type: 'draw', text: '' },
    { type: 'write', text: '' },
    { type: 'draw', text: '' },
  ];
}

/** A clean copy of `value` if it is a draft (e.g. read from storage), else null. */
export function normalizeDraft(value) {
  if (!Array.isArray(value) || value.length !== RULES_PER_PLAYER) return null;
  if (!value.every((rule) => rule && RULE_TYPES.includes(rule.type) && typeof rule.text === 'string')) return null;
  return value.map(({ type, text }) => ({ type, text }));
}

/**
 * Check a draft before sending, with the same limits the host applies.
 * @returns {{ ok: boolean, errors: (string|null)[], message: string|null }}
 *   errors[i] is the problem with rule i; message is a problem with the set (the types).
 */
export function checkDraft(draft) {
  const rules = normalizeDraft(draft);
  if (!rules) return { ok: false, errors: [], message: `Write exactly ${RULES_PER_PLAYER} rules` };
  const errors = rules.map(({ text }) => {
    const length = text.trim().length;
    if (!length) return 'Write a rule here';
    if (length > MAX_RULE_LENGTH) return `At most ${MAX_RULE_LENGTH} characters (this one has ${length})`;
    return null;
  });
  const missing = RULE_TYPES.filter((type) => !rules.some((rule) => rule.type === type));
  const message = missing.length ? 'You need at least one drawing rule and one writing rule' : null;
  return { ok: !message && errors.every((e) => e === null), errors, message };
}

/** The rules to send: trimmed text. */
export function draftToRules(draft) {
  return normalizeDraft(draft).map(({ type, text }) => ({ type, text: text.trim() }));
}
