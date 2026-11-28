// Chain reveal (P12): texts and stepping for the finished screen. No DOM, so the tests can check them.
//
// Each phone steps on its own. The finished screen has two modes: 'results' (awards + leaderboards, first)
// and 'reveal' (one chain at a time, one beat per tap). The position lives outside the DOM:
//   { code, mode: 'results' | 'reveal', chain: index in view.reveal, shown: beats shown (≥ 1) }

import { describe } from '../similarity.js';

const you = (name, me) => (name === me ? `${name} (you)` : name);

/** Hue for a 0–100 score: red (0) → green (100). */
export const scoreColor = (score) => `hsl(${Math.round(score * 1.2)}, 70%, 50%)`;

function scoreChip(similarity) {
  return { value: similarity.toFixed(1), label: describe(similarity), color: scoreColor(similarity) };
}

/** A rule as the reveal shows it. Revenge is highlighted: "🔥 Eva took revenge on Ben". */
export function ruleLine(rule, me) {
  return {
    revenge: rule.revenge,
    title: rule.revenge ? `🔥 ${you(rule.author, me)} took revenge on ${you(rule.target, me)}` : `😈 ${you(rule.author, me)}'s rule`,
    text: rule.text,
    mine: rule.author === me,
  };
}

/**
 * One chain as a list of beats, in reveal order:
 *   original 📝 → for each step: draw 🎨 (+ rules on the drawing), interpret 🔍 (+ score, rules) → drift 🏁.
 * @returns {{ kind, emoji, title, sentence?, hint?, score?, rules?, original?, final? }[]}  length = 2 · steps + 2
 */
export function revealBeats(chain, me = null) {
  const beats = [{ kind: 'original', emoji: '📝', title: `${you(chain.creator, me)} wrote`, sentence: chain.original }];
  for (const step of chain.steps) {
    const rules = (task) => step.rules.filter((r) => r.task === task).map((r) => ruleLine(r, me));
    beats.push({
      kind: 'draw',
      emoji: '🎨',
      title: `${you(step.drawer, me)} drew it`,
      hint: `📄 Show ${step.drawer === me ? 'your' : `${step.drawer}'s`} drawing`,
      rules: rules('draw'),
    });
    beats.push({
      kind: 'interpret',
      emoji: '🔍',
      title: `${you(step.interpreter, me)} read it as`,
      sentence: step.outgoing,
      score: scoreChip(step.similarity),
      rules: rules('interpret'),
    });
  }
  beats.push({
    kind: 'drift',
    emoji: '🏁',
    title: 'From start to end',
    original: chain.original,
    final: chain.final,
    score: scoreChip(chain.drift),
  });
  return beats;
}

/** "Chain 2 / 8 · Ana's chain" */
export function chainTitle(reveal, index, me = null) {
  const chain = reveal[index];
  const owner = chain.creator === me ? 'Your chain' : `${chain.creator}'s chain`;
  return `Chain ${index + 1} / ${reveal.length} · ${owner}`;
}

export function startPosition(code) {
  return { code, mode: 'results', chain: 0, shown: 1 };
}

/** A saved position checked against this reveal (another game's, or a broken one, starts over). */
export function cleanPosition(saved, code, reveal) {
  if (!saved || saved.code !== code || !reveal?.length) return startPosition(code);
  const chain = Number.isInteger(saved.chain) ? Math.min(Math.max(saved.chain, 0), reveal.length - 1) : 0;
  const total = revealBeats(reveal[chain]).length;
  const shown = Number.isInteger(saved.shown) ? Math.min(Math.max(saved.shown, 1), total) : 1;
  return { code, mode: saved.mode === 'reveal' ? 'reveal' : 'results', chain, shown };
}

/**
 * What the big button does from here: 'beat' (show the next beat), 'chain' (start the next chain) or
 * 'done' (back to the awards, after the last chain).
 */
export function nextAction(pos, reveal) {
  if (pos.shown < revealBeats(reveal[pos.chain]).length) return 'beat';
  return pos.chain < reveal.length - 1 ? 'chain' : 'done';
}

export function nextLabel(action) {
  return { beat: 'Next ▶', chain: 'Next chain →', done: '🏆 Back to the awards' }[action];
}

/** The position after a tap on the big button. */
export function stepForward(pos, reveal) {
  const action = nextAction(pos, reveal);
  if (action === 'beat') return { ...pos, shown: pos.shown + 1 };
  if (action === 'chain') return { ...pos, chain: pos.chain + 1, shown: 1 };
  return { ...pos, mode: 'results' };
}

/** Jump to a chain (‹ › arrows), starting at its first beat. */
export function goToChain(pos, reveal, chain) {
  return { ...pos, mode: 'reveal', chain: Math.min(Math.max(chain, 0), reveal.length - 1), shown: 1 };
}

/** Show every beat of the current chain. */
export function showAll(pos, reveal) {
  return { ...pos, shown: revealBeats(reveal[pos.chain]).length };
}
