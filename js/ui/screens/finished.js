// Game over (P9): the hand-off to the reveal. Every paper goes on the reveal pile; the scored reveal,
// leaderboards and awards replace the "coming next" part in P10–P12.

import { h } from '../dom.js';

export function finishedScreen({ view, onEndGame }) {
  const n = view.players.length;
  return h(
    'section',
    { class: 'screen stack' },
    h(
      'div',
      { class: 'hero' },
      h('div', { class: 'hero-emoji', 'aria-hidden': 'true', text: '🏁' }),
      h('h2', { class: 'card-title', text: 'All chains are done!' }),
      h('p', { class: 'hint subtitle', text: `${n} players, ${n} chains, every one ending on an interpretation.` }),
    ),
    h(
      'div',
      { class: 'card pass-card is-reveal' },
      h('p', { class: 'pass-title', text: '📥 Bring every paper to the reveal pile' }),
      h('p', { class: 'hint', text: "Keep them face down. Don't peek!" }),
    ),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'card-title', text: '🎭 The reveal is coming' }),
      h('p', { class: 'hint', text: 'Scores, leaderboards and the chain-by-chain reveal arrive in a later update.' }),
    ),
    h('button', { class: 'btn btn-link', type: 'button', text: 'Close this game', on: { click: onEndGame } }),
  );
}
