// 💬 Feedback sheet (P11b, browser only): a bottom sheet over the game. It lives outside #screen, so live
// game updates never redraw it, and the game underneath keeps running. The draft stays in memory until sent.
//
//   const sheet = createFeedbackSheet({ getContext, onSend });   // onSend(kind, text, context) → Promise
//   sheet.open();

import { h } from './dom.js';
import { FEEDBACK_KINDS, DEFAULT_KIND, MAX_FEEDBACK_LENGTH, checkFeedback, contextLabel } from './feedback.js';

export function createFeedbackSheet({ getContext, onSend }) {
  const draft = { kind: DEFAULT_KIND, text: '' };
  let context = {};
  let sending = false;
  let lastFocus = null;

  const where = h('p', { class: 'hint feedback-where' });
  const counter = h('span', { class: 'count' });
  const error = h('p', { class: 'form-error', hidden: true });
  const input = h('textarea', {
    class: 'input textarea',
    rows: 4,
    maxlength: String(MAX_FEEDBACK_LENGTH),
    placeholder: 'What happened? What did you expect?',
    'aria-label': 'Your feedback',
  });
  const kindButtons = Object.entries(FEEDBACK_KINDS).map(([kind, label]) =>
    h('button', {
      class: 'type-option',
      type: 'button',
      text: label,
      on: {
        click: () => {
          draft.kind = kind;
          refresh();
        },
      },
    }),
  );
  const sendButton = h('button', { class: 'btn btn-primary', type: 'button', text: 'Send feedback 📨', on: { click: send } });
  const cancelButton = h('button', { class: 'btn btn-ghost', type: 'button', text: 'Back to the game', on: { click: close } });

  const panel = h(
    'div',
    { class: 'feedback-panel card stack', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'feedback-title' },
    h('h2', { class: 'card-title', id: 'feedback-title', text: '💬 Feedback' }),
    where,
    h('div', { class: 'type-toggle feedback-kinds', role: 'group', 'aria-label': 'Kind of feedback' }, kindButtons),
    input,
    h('div', { class: 'row-between' }, error, counter),
    h('div', { class: 'row' }, cancelButton, sendButton),
  );
  const element = h('div', { class: 'feedback-sheet', hidden: true }, h('div', { class: 'feedback-backdrop', on: { click: close } }), panel);
  document.body.append(element);

  input.addEventListener('input', () => {
    draft.text = input.value;
    if (input.value.trim()) showError(null);
    refresh();
  });
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  function refresh() {
    kindButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(Object.keys(FEEDBACK_KINDS)[i] === draft.kind)));
    const length = draft.text.trim().length;
    counter.textContent = `${length}/${MAX_FEEDBACK_LENGTH}`;
    counter.classList.toggle('count-over', length > MAX_FEEDBACK_LENGTH);
    sendButton.disabled = sending;
    sendButton.textContent = sending ? 'Sending…' : 'Send feedback 📨';
    input.disabled = sending;
  }

  function showError(message) {
    error.textContent = message ?? '';
    error.hidden = !message;
    input.setAttribute('aria-invalid', String(!!message));
  }

  function open() {
    // The screen is noted when the sheet opens: that's the screen the player is talking about.
    context = getContext();
    where.textContent = `📍 ${contextLabel(context)} (sent with your note)`;
    showError(null);
    refresh();
    lastFocus = document.activeElement;
    element.hidden = false;
    requestAnimationFrame(() => element.classList.add('is-open'));
    input.focus();
  }

  function close() {
    if (sending) return;
    element.classList.remove('is-open');
    element.hidden = true;
    lastFocus?.focus?.();
  }

  async function send() {
    if (sending) return;
    const problem = checkFeedback(draft.text);
    if (problem) {
      showError(problem);
      input.focus();
      return;
    }
    sending = true;
    refresh();
    try {
      await onSend(draft.kind, draft.text, context);
      draft.text = '';
      draft.kind = DEFAULT_KIND;
      input.value = '';
      sending = false;
      close();
      return true;
    } catch (failure) {
      // Keep the text, so the player can try again.
      showError(`Couldn't send: ${failure.message}`);
    } finally {
      sending = false;
      refresh();
    }
  }

  refresh();
  return { open, close, get isOpen() { return !element.hidden; } };
}
