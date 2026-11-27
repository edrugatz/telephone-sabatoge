// Simple full-screen states (P6): loading, error with a retry, and the placeholder for stages that
// get their screens in later packages (playing P8–P9, finished P10–P12).

import { h } from '../dom.js';

export function loadingScreen(message = 'Loading…') {
  return h('section', { class: 'screen center' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { class: 'hint', role: 'status', text: message }));
}

export function errorScreen({ title = 'Something went wrong', message, onRetry, onHome }) {
  return h(
    'section',
    { class: 'screen center stack' },
    h('div', { class: 'hero-emoji', 'aria-hidden': 'true', text: '😵' }),
    h('h2', { class: 'card-title', text: title }),
    message ? h('p', { class: 'hint', text: message }) : null,
    onRetry ? h('button', { class: 'btn btn-primary btn-block', type: 'button', text: 'Try again', on: { click: onRetry } }) : null,
    onHome ? h('button', { class: 'btn btn-ghost btn-block', type: 'button', text: 'Back to start', on: { click: onHome } }) : null,
  );
}

const STAGE_TEXT = {
  playing: ['🎨', 'The game is running', 'Task screens arrive in a later update (P8).'],
  finished: ['🏁', 'The game is over', 'Results arrive in a later update (P10–P12).'],
};

export function stageScreen({ view, isHost, onEndGame }) {
  const [emoji, title, text] = STAGE_TEXT[view.stage] ?? ['⏳', 'Please wait', ''];
  return h(
    'section',
    { class: 'screen center stack' },
    h('div', { class: 'hero-emoji', 'aria-hidden': 'true', text: emoji }),
    h('h2', { class: 'card-title', text: title }),
    h('p', { class: 'hint', text }),
    h('p', { class: 'hint', text: `${view.players.length} players: ${view.players.join(', ')}` }),
    isHost ? h('button', { class: 'btn btn-link', type: 'button', text: 'Close this game', on: { click: onEndGame } }) : null,
  );
}
