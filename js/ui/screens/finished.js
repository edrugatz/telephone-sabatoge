// Game over (P9, P10): the hand-off to the reveal pile, then the host phone scores every transformation.
// The scoring card shows the progress (model download on the host, then n / total) and, once done, a
// simple per-chain list of scores. Leaderboards (P11) and the chain reveal (P12) replace that list.

import { h } from '../dom.js';
import { scoringCard, chainScores } from '../scoring-view.js';

const scoreColor = (score) => `hsl(${Math.round(score * 1.2)}, 70%, 50%)`;

function progressBar(percent) {
  return h(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) },
    h('div', { class: 'progress-fill', style: `transform: scaleX(${percent / 100})` }),
  );
}

function scoreList(scores) {
  return chainScores(scores).map((chain) =>
    h(
      'div',
      { class: 'card stack score-chain' },
      h('p', { class: 'card-title', text: `📜 ${chain.creator}'s chain` }),
      h(
        'ol',
        { class: 'score-steps' },
        chain.steps.map((step) =>
          h(
            'li',
            { class: 'score-step' },
            h('p', { class: 'score-who', text: `🎨 ${step.drawer} → 🔍 ${step.interpreter}` }),
            h('p', { class: 'score-pair' }, h('span', { text: `“${step.incoming}”` }), h('span', { class: 'hint', text: ' became ' }), h('span', { text: `“${step.outgoing}”` })),
            h(
              'p',
              { class: 'score-value', style: `--score-color: ${scoreColor(step.similarity)}` },
              h('strong', { text: step.similarity.toFixed(1) }),
              h('span', { class: 'hint', text: ` · ${step.label}` }),
            ),
          ),
        ),
      ),
    ),
  );
}

export function finishedScreen({ view, isHost, download, onRetry, onEndGame }) {
  const n = view.players.length;
  const card = scoringCard(view.scoring, { isHost, download });
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
      { class: `card stack scoring-card is-${card.state}` },
      h(
        'div',
        { class: 'row-between' },
        h('p', { class: 'card-title', text: card.title }),
        card.percent === null && card.state === 'loading' ? h('div', { class: 'spinner spinner-small', 'aria-hidden': 'true' }) : null,
      ),
      h('p', { class: 'hint', text: card.detail }),
      card.percent !== null && card.state !== 'done' ? progressBar(card.percent) : null,
      card.retry ? h('button', { class: 'btn btn-primary btn-block', type: 'button', text: 'Try again 🔁', on: { click: onRetry } }) : null,
    ),
    card.state === 'done' ? scoreList(view.scores) : null,
    h('button', { class: 'btn btn-link', type: 'button', text: 'Close this game', on: { click: onEndGame } }),
  );
}
