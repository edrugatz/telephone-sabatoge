// Revenge prompt (P9b, SPEC §4). Pure ES module (no DOM), so the tests can check it.
//
// The host already puts revengeOptions() in each view (`view.revenge`) and the player's own revenge
// (`view.myRevenge`). This module decides whether the task screen offers "Take revenge on X?" and holds
// the texts. Targets with a conflict or already taken are hidden without a reason: explaining a conflict
// would reveal the routing.

import { MAX_RULE_LENGTH } from '../game/game.js';

const KIND = {
  draw: { label: '🎨 Drawing rule', task: 'drawing', placeholder: 'e.g. Draw it with your eyes closed' },
  write: { label: '✍️ Writing rule', task: 'interpretation', placeholder: 'e.g. Every word starts with S' },
};

/** "Ana", "Ana or Ben", "Ana, Ben or Cy". */
function names(list, joiner) {
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${joiner} ${list.at(-1)}`;
}

/**
 * The revenge prompt for this view, or null when there is none (round 0, no rule, used, last round,
 * every target in conflict or taken).
 * @returns {{ round: number, type: 'draw'|'write', targets: { target: number, name: string }[] } | null}
 */
export function revengePrompt(view) {
  if (view?.stage !== 'playing' || !view.revenge || view.revenge.reason || view.myRevenge) return null;
  const open = (view.revenge.options ?? []).filter((option) => option.ok);
  if (!open.length) return null;
  return { round: view.round, type: open[0].type, targets: open.map((option) => ({ target: option.target, name: option.targetName })) };
}

/** The revenge this player sent in the current round (for the "sent" card), or null. */
export function revengeSent(view) {
  const mine = view?.myRevenge;
  return mine && view.stage === 'playing' && mine.round === view.round + 1 ? mine : null;
}

/** Texts for the prompt. `chosen` = the selected target's name. */
export function revengeTexts(prompt, chosen) {
  const kind = KIND[prompt.type];
  const all = prompt.targets.map((t) => t.name);
  const several = all.length > 1;
  return {
    title: `🔥 Take revenge on ${names(all, 'or')}?`,
    why: `${names(all, 'and')} ${several ? 'gave you rules' : 'gave you a rule'} this round. Once per game you can write one back.`,
    kind: kind.label,
    ask: `${kind.label} for ${chosen}'s next ${kind.task}. It's added to any rule they already have.`,
    placeholder: kind.placeholder,
    open: 'Write revenge ✍️',
    skip: 'Skip',
    send: `Send revenge to ${chosen} 🔥`,
  };
}

/** Texts for the card shown after sending. */
export function revengeSentTexts(sent) {
  return {
    title: `🔥 Revenge sent to ${sent.targetName}`,
    hint: `${sent.targetName} will see it on their next task, signed by you.`,
  };
}

/** Error text for a revenge rule typed on the phone, or null (same limits as the host). */
export function checkRevenge(text) {
  const length = (text ?? '').trim().length;
  if (!length) return 'Write your revenge rule first';
  if (length > MAX_RULE_LENGTH) return `At most ${MAX_RULE_LENGTH} characters (this one has ${length})`;
  return null;
}
