// Game over (P9–P12): the hand-off to the reveal pile, then the host phone scores every transformation.
// The scoring card shows the progress (model download on the host, then n / total). Once done: the awards and
// the two leaderboards first, then a button that opens the step-by-step chain reveal (screens/reveal.js).

import { h } from '../dom.js';
import { scoringCard } from '../scoring-view.js';
import { awardCards, boardRows } from '../standings-view.js';

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

function results(view, { started, onOpenReveal }) {
  const me = view.you?.name ?? null;
  const rows = boardRows(view.standings, me);
  return [
    awards(view.standings, me),
    board('🛡️ Best Preservers', 'Least meaning lost in their own drawings and interpretations', rows.preservers),
    board('😈 Best Saboteurs', 'Most damage caused by their sabotage rules', rows.saboteurs),
    h(
      'div',
      { class: 'card stack reveal-cta' },
      h('p', { class: 'card-title', text: '🎬 Now the fun part' }),
      h('p', { class: 'hint', text: 'Walk through every chain: who drew what, which rules got in the way, and how far each sentence drifted. Lay the papers out as you go.' }),
      h('button', {
        class: 'btn btn-primary btn-block',
        type: 'button',
        text: started ? '🎬 Back to the chain reveal' : '🎬 Step through the chains',
        on: { click: onOpenReveal },
      }),
    ),
  ];
}

function progressBar(percent) {
  return h(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) },
    h('div', { class: 'progress-fill', style: `transform: scaleX(${percent / 100})` }),
  );
}

/**
 * @param {{ view, isHost, download, started: boolean, onOpenReveal, onRetry, onEndGame }} props
 *   started = this phone has already stepped into the reveal (the button says "Back to…")
 */
export function finishedScreen({ view, isHost, download, started = false, onOpenReveal, onRetry, onEndGame }) {
  const n = view.players.length;
  const card = scoringCard(view.scoring, { isHost, download });
  const ready = card.state === 'done' && view.standings && view.reveal;
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
    ready ? results(view, { started, onOpenReveal }) : null,
    h('button', { class: 'btn btn-link', type: 'button', text: 'Close this game', on: { click: onEndGame } }),
  );
}
