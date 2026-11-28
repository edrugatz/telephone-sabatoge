// Chain reveal (P12): one chain at a time, one beat per tap. Each phone steps on its own; the position
// comes from main.js (kept outside the DOM, see reveal-view.js), so live re-renders don't reset it.

import { h } from '../dom.js';
import { revealBeats, chainTitle, nextAction, nextLabel, stepForward, goToChain, showAll } from '../reveal-view.js';

function quote(text, cls = 'beat-sentence') {
  return h('p', { class: cls, text: `“${text}”` });
}

function scoreLine(score, prefix = '') {
  return h(
    'p',
    { class: 'score-value', style: `--score-color: ${score.color}` },
    prefix ? h('span', { class: 'hint', text: prefix }) : null,
    h('strong', { text: score.value }),
    h('span', { class: 'hint', text: ` · ${score.label}` }),
  );
}

function rules(list) {
  if (!list.length) return h('p', { class: 'hint beat-norule', text: '🍀 No rule' });
  return list.map((r) =>
    h(
      'div',
      { class: `reveal-rule${r.revenge ? ' is-revenge' : ''}` },
      h('p', { class: 'reveal-rule-title', text: r.title }),
      h('p', { class: 'reveal-rule-text', text: r.text }),
    ),
  );
}

function beatCard(beat, latest) {
  const body = [];
  if (beat.kind === 'original') body.push(quote(beat.sentence));
  if (beat.kind === 'draw') body.push(h('p', { class: 'hint', text: beat.hint }), rules(beat.rules));
  if (beat.kind === 'interpret') body.push(quote(beat.sentence), scoreLine(beat.score), rules(beat.rules));
  if (beat.kind === 'drift') {
    body.push(
      h('p', { class: 'hint', text: 'Started as' }),
      quote(beat.original),
      h('p', { class: 'hint', text: 'Ended as' }),
      quote(beat.final),
      scoreLine(beat.score, '📏 Start vs end: '),
    );
  }
  return h(
    'li',
    { class: `card stack beat is-${beat.kind}${latest ? ' is-latest' : ''}` },
    h('p', { class: 'beat-title' }, h('span', { class: 'beat-emoji', 'aria-hidden': 'true', text: beat.emoji }), h('span', { text: beat.title })),
    body,
  );
}

/**
 * @param {{ view, position: { chain, shown }, onMove: (position, { scroll }) => void, onBack }} props
 *   onMove gets the new position; scroll = bring the newest beat into view.
 */
export function revealScreen({ view, position, onMove, onBack }) {
  const reveal = view.reveal;
  const me = view.you?.name ?? null;
  const beats = revealBeats(reveal[position.chain], me).slice(0, position.shown);
  const action = nextAction(position, reveal);
  const last = reveal.length - 1;
  const move = (pos, scroll = false) => onMove(pos, { scroll });
  return h(
    'section',
    { class: 'screen stack' },
    h(
      'div',
      { class: 'row-between' },
      h('button', { class: 'btn btn-link reveal-back', type: 'button', text: '← Awards', on: { click: onBack } }),
      h('p', { class: 'section-title reveal-heading', text: '🎬 Chain reveal' }),
    ),
    h(
      'div',
      { class: 'card reveal-nav' },
      h('button', {
        class: 'btn btn-ghost reveal-arrow',
        type: 'button',
        text: '‹',
        'aria-label': 'Previous chain',
        disabled: position.chain === 0,
        on: { click: () => move(goToChain(position, reveal, position.chain - 1)) },
      }),
      h('p', { class: 'reveal-chain-title', text: chainTitle(reveal, position.chain, me) }),
      h('button', {
        class: 'btn btn-ghost reveal-arrow',
        type: 'button',
        text: '›',
        'aria-label': 'Next chain',
        disabled: position.chain === last,
        on: { click: () => move(goToChain(position, reveal, position.chain + 1)) },
      }),
    ),
    h('ol', { class: 'beats' }, beats.map((beat, i) => beatCard(beat, i === beats.length - 1 && position.shown > 1))),
    h(
      'div',
      { class: 'stack reveal-actions' },
      h('button', {
        class: 'btn btn-primary btn-block',
        type: 'button',
        text: nextLabel(action),
        on: {
          click: () => (action === 'done' ? onBack() : move(stepForward(position, reveal), action === 'beat')),
        },
      }),
      action === 'beat'
        ? h('button', { class: 'btn btn-link', type: 'button', text: 'Show the whole chain', on: { click: () => move(showAll(position, reveal)) } })
        : null,
    ),
  );
}
