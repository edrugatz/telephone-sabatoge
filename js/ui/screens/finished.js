// Game over (P9, P10, P11): the hand-off to the reveal pile, then the host phone scores every transformation.
// The scoring card shows the progress (model download on the host, then n / total). Once done: the awards,
// the two leaderboards, and the per-chain scores collapsed underneath (the chain reveal, P12, replaces those).

import { h } from '../dom.js';
import { scoringCard, chainScores } from '../scoring-view.js';
import { awardCards, boardRows } from '../standings-view.js';

// The screen is redrawn on every view update: remember whether the chain list was opened.
let chainsOpen = false;

function awards(standings, me) {
  const cards = awardCards(standings, me);
  if (!cards.length) return null;
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'section-title', text: '🏆 Awards' }),
    cards.map((a) =>
      h(
        'div',
        { class: `card award-card is-${a.id}${a.mine ? ' is-mine' : ''}` },
        h('div', { class: 'award-emoji', 'aria-hidden': 'true', text: a.emoji }),
        h(
          'div',
          { class: 'award-body' },
          h('p', { class: 'award-title', text: a.title }),
          h('p', { class: 'award-winner', text: a.winners }),
          h('p', { class: 'hint', text: `${a.reason} · ${a.value}` }),
          a.mine ? h('p', { class: 'award-mine', text: "🎉 That's you!" }) : null,
        ),
      ),
    ),
  );
}

function board(title, hint, rows) {
  return h(
    'div',
    { class: 'card stack' },
    h('p', { class: 'card-title', text: title }),
    h('p', { class: 'hint', text: hint }),
    h(
      'ol',
      { class: 'board' },
      rows.map((r) =>
        h(
          'li',
          { class: `board-row${r.mine ? ' is-you' : ''}` },
          h('span', { class: 'board-rank', text: r.medal }),
          h(
            'span',
            { class: 'board-name' },
            h('span', { text: r.mine ? `${r.name} (you)` : r.name }),
            r.detail ? h('span', { class: 'board-detail', text: r.detail }) : null,
          ),
          h('span', { class: 'board-value', text: r.value }),
        ),
      ),
    ),
  );
}

function results(view) {
  const me = view.you?.name ?? null;
  const rows = boardRows(view.standings, me);
  const details = h(
    'details',
    { class: 'card chain-scores', on: { toggle: () => (chainsOpen = details.open) } },
    h('summary', { text: '📜 Chain scores' }),
    h('div', { class: 'stack' }, scoreList(view.scores)),
  );
  details.open = chainsOpen;
  return [
    awards(view.standings, me),
    board('🛡️ Best Preservers', 'Least meaning lost in their own drawings and interpretations', rows.preservers),
    board('😈 Best Saboteurs', 'Most damage caused by their sabotage rules', rows.saboteurs),
    details,
  ];
}

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
    card.state === 'done' ? results(view) : null,
    h('button', { class: 'btn btn-link', type: 'button', text: 'Close this game', on: { click: onEndGame } }),
  );
}
