// Lobby screen (P6): the game code to share, the live player list, and the next action.
// Host: remove players, open the rules stage (≥ MIN_PLAYERS), and a collapsed testing section with bots.
// Player: leave the game.

import { h } from '../dom.js';
import { MIN_PLAYERS } from '../../game/schedule.js';
import { MAX_PLAYERS } from '../../game/host.js';

export const BOT_TARGET = 8;

export function lobbyScreen({ view, isHost, seats = [], busy = false, onShare, onKick, onOpenRules, onLeave, onEndGame, testing }) {
  const count = view.players.length;
  const enough = count >= MIN_PLAYERS;
  const me = view.you?.player;

  const players = view.players.map((name, i) => {
    const seat = seats[i];
    const canKick = isHost && i !== me && seat;
    return h(
      'li',
      { class: `player${i === me ? ' is-you' : ''}` },
      h('span', { class: 'player-avatar', 'aria-hidden': 'true', text: i === 0 ? '👑' : name.trim()[0]?.toUpperCase() ?? '?' }),
      h('span', { class: 'player-name', text: name }),
      i === me ? h('span', { class: 'tag', text: 'you' }) : null,
      i === 0 && i !== me ? h('span', { class: 'tag', text: 'host' }) : null,
      canKick
        ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${name}`, disabled: busy, text: '✕', on: { click: () => onKick(seat.uid, name) } })
        : null,
    );
  });

  const status = enough
    ? `${count} joined · ready when everyone's in`
    : `${count} joined · ${MIN_PLAYERS - count} more needed (minimum ${MIN_PLAYERS})`;

  const hostActions = isHost
    ? [
        h('button', {
          class: 'btn btn-primary btn-block btn-big',
          type: 'button',
          disabled: !enough || busy,
          text: enough ? "Everyone's in → Write rules ✍️" : `Waiting for ${MIN_PLAYERS - count} more…`,
          on: { click: onOpenRules },
        }),
        testingSection({ count, busy, ...testing }),
        h('button', { class: 'btn btn-link', type: 'button', text: 'Close this game', on: { click: onEndGame } }),
      ]
    : [
        h('p', { class: 'waiting-note', text: '⏳ Waiting for the host to start…' }),
        h('button', { class: 'btn btn-ghost btn-block', type: 'button', disabled: busy, text: 'Leave game', on: { click: onLeave } }),
      ];

  return h(
    'section',
    { class: 'screen stack' },
    h(
      'div',
      { class: 'card code-card' },
      h('span', { class: 'field-label', text: 'Game code' }),
      h('div', { class: 'big-code', text: view.code }),
      h('button', { class: 'btn btn-ghost', type: 'button', text: '🔗 Share invite link', on: { click: onShare } }),
    ),
    h(
      'div',
      { class: 'card stack' },
      h('div', { class: 'row-between' }, h('h2', { class: 'card-title', text: 'Players' }), h('span', { class: 'count', text: `${count} / ${MAX_PLAYERS}` })),
      h('ul', { class: 'player-list', 'aria-live': 'polite' }, players),
      h('p', { class: `hint${enough ? ' hint-ok' : ''}`, text: status }),
    ),
    hostActions,
  );
}

function testingSection({ open = false, onToggle, busy, status, onAddBot, onFill, count }) {
  const details = h(
    'details',
    { class: 'card testing', open },
    h('summary', { text: '🧪 Testing' }),
    h('p', { class: 'hint', text: 'Bots are extra players run by this phone, so you can test a game alone.' }),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn btn-ghost', type: 'button', disabled: busy || count >= MAX_PLAYERS, text: '🤖 Add bot', on: { click: onAddBot } }),
      h('button', { class: 'btn btn-ghost', type: 'button', disabled: busy || count >= BOT_TARGET, text: `Fill to ${BOT_TARGET}`, on: { click: onFill } }),
    ),
    status ? h('p', { class: 'hint', role: 'status', text: status }) : null,
    h('a', { class: 'btn btn-link', href: 'tune.html', text: '🎛️ Similarity tuning page' }),
  );
  details.addEventListener('toggle', () => onToggle?.(details.open));
  return details;
}
