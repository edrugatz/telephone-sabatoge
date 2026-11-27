// Rules screen (P7): every player writes 3 sabotage rules, each tagged drawing or writing.
//
// The view changes every time someone sends their rules, so this screen is a small component instead
// of a plain function: the form is built once per mode ('edit' / 'sent') and update() only redraws the
// live part (who is done, the host's Start button). The inputs, the focus and the phone keyboard stay.
//
//   const screen = createRulesScreen({ onDraftChange, onSend, onEdit, onStart, onBackToLobby, onEndGame, testing });
//   screen.update({ view, isHost, draft, editing, busy, starting, startError, testing: { open, status } });
//   router.show('rules', screen.element);

import { h, setChildren } from '../dom.js';
import { MAX_RULE_LENGTH } from '../../game/game.js';
import { TYPE_LABEL, checkDraft } from '../rule-draft.js';

const PLACEHOLDERS = {
  draw: ['e.g. No straight lines', 'e.g. Include a tiny animal', 'e.g. Draw with your other hand'],
  write: ['e.g. Exactly seven words', 'e.g. No letter "E"', 'e.g. Make it rhyme'],
};

export function createRulesScreen(handlers) {
  const formSlot = h('div', { class: 'stack' });
  const liveSlot = h('div', { class: 'stack' });
  const element = h(
    'section',
    { class: 'screen stack' },
    h(
      'div',
      { class: 'hero' },
      h('div', { class: 'hero-emoji', 'aria-hidden': 'true', text: '😈' }),
      h('h2', { class: 'card-title', text: 'Write 3 sabotage rules' }),
      h('p', {
        class: 'hint subtitle',
        text: 'Other players get them on their tasks. Short, playful and doable, never about a person. At least one drawing rule and one writing rule.',
      }),
    ),
    formSlot,
    liveSlot,
  );

  let mode = null;
  let form = null; // { sendButton }

  function update(state) {
    const nextMode = state.editing ? 'edit' : 'sent';
    if (nextMode !== mode) {
      if (mode !== null) window.scrollTo(0, 0);
      mode = nextMode;
      form = null;
      if (mode === 'edit') {
        form = buildForm(state.draft, handlers);
        formSlot.replaceChildren(form.element);
      }
    }
    if (mode === 'sent') formSlot.replaceChildren(sentCard(state, handlers));
    if (form) form.sendButton.disabled = state.busy;
    setChildren(liveSlot, liveSection(state, handlers));
  }

  return { element, update };
}

// ---- Editing -----------------------------------------------------------------------

function buildForm(initial, { onDraftChange, onSend }) {
  const draft = initial.map((rule) => ({ ...rule }));
  const setMessage = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const cards = draft.map((rule, i) => ruleCard(draft, i, () => {
    setMessage.hidden = true;
    onDraftChange(draft.map((r) => ({ ...r })));
  }));

  const sendButton = h('button', {
    class: 'btn btn-primary btn-block btn-big',
    type: 'submit',
    text: 'Send my rules 📨',
  });

  const element = h(
    'form',
    {
      class: 'stack',
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          const check = checkDraft(draft);
          cards.forEach((card, i) => card.showError(check.errors[i]));
          setMessage.textContent = check.message ?? '';
          setMessage.hidden = !check.message;
          if (check.ok) onSend();
          else (cards.find((_, i) => check.errors[i])?.input ?? sendButton).focus();
        },
      },
    },
    cards.map((card) => card.element),
    setMessage,
    sendButton,
  );

  // Enter moves to the next rule; on the last one it sends.
  cards.forEach((card, i) => {
    card.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || i === cards.length - 1) return;
      event.preventDefault();
      cards[i + 1].input.focus();
    });
  });

  return { element, sendButton };
}

function ruleCard(draft, i, onChange) {
  const rule = draft[i];
  const counter = h('span', { class: 'count' });
  const error = h('p', { class: 'form-error', hidden: true });
  const input = h('input', {
    class: 'input',
    type: 'text',
    maxlength: String(MAX_RULE_LENGTH),
    autocomplete: 'off',
    enterkeyhint: i === draft.length - 1 ? 'send' : 'next',
    'aria-label': `Rule ${i + 1}`,
    value: rule.text,
  });

  const typeButtons = Object.entries(TYPE_LABEL).map(([type, label]) =>
    h('button', {
      class: 'type-option',
      type: 'button',
      text: label,
      on: {
        click: () => {
          rule.type = type;
          refresh();
          onChange();
        },
      },
    }),
  );

  function refresh() {
    typeButtons.forEach((button, j) => button.setAttribute('aria-pressed', String(Object.keys(TYPE_LABEL)[j] === rule.type)));
    input.placeholder = PLACEHOLDERS[rule.type][i % PLACEHOLDERS[rule.type].length];
    const length = rule.text.trim().length;
    counter.textContent = `${length}/${MAX_RULE_LENGTH}`;
    counter.classList.toggle('count-over', length > MAX_RULE_LENGTH);
  }

  function showError(message) {
    error.textContent = message ?? '';
    error.hidden = !message;
    input.setAttribute('aria-invalid', String(!!message));
  }

  input.addEventListener('input', () => {
    rule.text = input.value;
    if (input.value.trim()) showError(null);
    refresh();
    onChange();
  });

  refresh();
  const element = h(
    'div',
    { class: 'card stack rule-card' },
    h(
      'div',
      { class: 'row-between' },
      h('span', { class: 'field-label', text: `Rule ${i + 1}` }),
      h('div', { class: 'type-toggle', role: 'group', 'aria-label': `Rule ${i + 1} is for` }, typeButtons),
    ),
    input,
    h('div', { class: 'row-between' }, error, counter),
  );
  return { element, input, showError };
}

// ---- Sent --------------------------------------------------------------------------

function sentCard({ view, busy }, { onEdit }) {
  const mine = view.rules?.mine ?? [];
  return h(
    'div',
    { class: 'card stack' },
    h('h2', { class: 'card-title', text: '✅ Your rules are in' }),
    h(
      'ul',
      { class: 'rule-summary' },
      mine.map((rule) => h('li', {}, h('span', { class: 'tag', text: TYPE_LABEL[rule.type] }), h('span', { text: rule.text }))),
    ),
    h('button', { class: 'btn btn-ghost btn-block', type: 'button', disabled: busy, text: '✏️ Edit my rules', on: { click: onEdit } }),
  );
}

// ---- Live part: progress and next action --------------------------------------------

function liveSection(state, handlers) {
  const { view, isHost, busy } = state;
  const missing = view.rules?.missing ?? [];
  const missingSet = new Set(missing);
  const done = view.players.length - missing.length;
  const me = view.you?.player;

  const progress = h(
    'div',
    { class: 'card stack' },
    h(
      'div',
      { class: 'row-between' },
      h('h2', { class: 'card-title', text: 'Rules in' }),
      h('span', { class: 'count', text: `${done} / ${view.players.length}` }),
    ),
    h(
      'ul',
      { class: 'player-list', 'aria-live': 'polite' },
      view.players.map((name, i) => {
        const ready = !missingSet.has(name);
        return h(
          'li',
          { class: `player${i === me ? ' is-you' : ''}${ready ? ' is-ready' : ''}` },
          h('span', { class: 'player-avatar', 'aria-hidden': 'true', text: ready ? '✅' : '✍️' }),
          h('span', { class: 'player-name', text: name }),
          i === me ? h('span', { class: 'tag', text: 'you' }) : null,
          h('span', { class: 'hint', text: ready ? 'ready' : 'writing…' }),
        );
      }),
    ),
  );

  if (!isHost) {
    const note = missing.length ? `⏳ Waiting for ${missing.length} more…` : '⏳ Everyone is ready. Waiting for the host to start…';
    return [progress, h('p', { class: 'waiting-note', text: note })];
  }

  // Preparation (P8): Start builds the routing and deals the rules on the host phone.
  const { starting, startError } = state;
  const startButton = h(
    'button',
    {
      class: 'btn btn-primary btn-block btn-big',
      type: 'button',
      disabled: busy || missing.length > 0,
      'aria-busy': starting ? 'true' : null,
      on: { click: handlers.onStart },
    },
    starting ? h('span', { class: 'spinner spinner-small', 'aria-hidden': 'true' }) : null,
    starting ? 'Preparing the game…' : missing.length ? `Waiting for ${missing.length} more…` : startError ? 'Try again 🎬' : 'Start the game 🎬',
  );
  const errorCard = startError && !starting
    ? h(
      'div',
      { class: 'card notice-error stack', role: 'alert' },
      h('p', { class: 'card-title', text: "😵 Couldn't prepare the game" }),
      h('p', { class: 'hint', text: startError }),
      h('p', { class: 'hint', text: 'Nothing was lost: try again, or go back to the lobby to change the players.' }),
    )
    : null;

  return [
    progress,
    errorCard,
    startButton,
    h('button', { class: 'btn btn-ghost btn-block', type: 'button', disabled: busy, text: '← Back to lobby', on: { click: handlers.onBackToLobby } }),
    testingSection({ ...state.testing, ...handlers.testing, busy, missing }),
    h('button', { class: 'btn btn-link', type: 'button', text: 'Close this game', on: { click: handlers.onEndGame } }),
  ];
}

function testingSection({ open = false, status, onToggle, onBotRules, busy, missing }) {
  const details = h(
    'details',
    { class: 'card testing', open },
    h('summary', { text: '🧪 Testing' }),
    h('p', { class: 'hint', text: 'Bots write 3 random rules each. Your own rules you write yourself.' }),
    h('button', { class: 'btn btn-ghost', type: 'button', disabled: busy || missing.length === 0, text: '🤖 Bots write rules', on: { click: onBotRules } }),
    status ? h('p', { class: 'hint', role: 'status', text: status }) : null,
  );
  details.addEventListener('toggle', () => onToggle?.(details.open));
  return details;
}
