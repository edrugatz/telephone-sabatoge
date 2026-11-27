// Home screen (P6): host a game or join one with a code and a name.
// onHost(name) and onJoin(code, name) return promises; a rejection's message is shown under the form.

import { h } from '../dom.js';
import { cleanName, MAX_NAME_LENGTH } from '../../game/host.js';
import { normalizeCode, CODE_LENGTH } from '../../sync/transport.js';

export const OFFLINE_HINT_MS = 10000;

/** The checked name, or throws with a friendly message. */
function checkedName(input) {
  return cleanName(input.value);
}

export function homeScreen({ lastName = '', joinCode = '', notice = '', onHost, onJoin, onCancelJoin }) {
  let busy = false;

  // ---- Host card
  const hostName = h('input', { class: 'input', type: 'text', maxlength: MAX_NAME_LENGTH, autocomplete: 'nickname', placeholder: 'Your name', value: lastName, enterkeyhint: 'go' });
  const hostError = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const hostBtn = h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: '🎉 Create game' });
  const hostForm = h(
    'form',
    { class: 'card stack', autocomplete: 'off', on: { submit: (e) => (e.preventDefault(), host()) } },
    h('h2', { class: 'card-title', text: 'Host a game' }),
    h('p', { class: 'hint', text: 'You get a code to share. You play too.' }),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Your name' }), hostName),
    hostError,
    hostBtn,
  );

  // ---- Join card
  const code = h('input', { class: 'input input-code', type: 'text', maxlength: CODE_LENGTH + 2, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCDE', value: joinCode, enterkeyhint: 'next' });
  const joinName = h('input', { class: 'input', type: 'text', maxlength: MAX_NAME_LENGTH, autocomplete: 'nickname', placeholder: 'Your name', value: lastName, enterkeyhint: 'go' });
  const joinError = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const joinBtn = h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: '🚪 Join game' });
  const offlineHint = h('p', { class: 'hint hint-warn', hidden: true, text: "No answer yet: the host's phone seems to be offline. Still trying…" });
  const cancelBtn = h('button', { class: 'btn btn-ghost btn-block', type: 'button', hidden: true, text: 'Cancel', on: { click: () => onCancelJoin?.() } });
  const joinForm = h(
    'form',
    { class: 'card stack', autocomplete: 'off', on: { submit: (e) => (e.preventDefault(), join()) } },
    h('h2', { class: 'card-title', text: 'Join a game' }),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Game code' }), code),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Your name' }), joinName),
    joinError,
    joinBtn,
    offlineHint,
    cancelBtn,
  );
  code.addEventListener('input', () => {
    const upper = code.value.toUpperCase();
    if (upper !== code.value) code.value = upper;
  });
  joinName.addEventListener('input', () => (hostName.value = joinName.value));
  hostName.addEventListener('input', () => (joinName.value = hostName.value));

  const showError = (el, message) => {
    el.textContent = message ?? '';
    el.hidden = !message;
  };

  const setBusy = (on, button, label) => {
    busy = on;
    for (const el of [hostName, code, joinName, hostBtn, joinBtn]) el.disabled = on;
    if (on) button.textContent = label;
    else {
      hostBtn.textContent = '🎉 Create game';
      joinBtn.textContent = '🚪 Join game';
    }
  };

  async function host() {
    if (busy) return;
    showError(hostError, null);
    showError(joinError, null);
    let name;
    try {
      name = checkedName(hostName);
    } catch (error) {
      return showError(hostError, error.message);
    }
    setBusy(true, hostBtn, 'Creating…');
    try {
      await onHost(name);
    } catch (error) {
      setBusy(false);
      showError(hostError, error.message);
    }
  }

  async function join() {
    if (busy) return;
    showError(hostError, null);
    showError(joinError, null);
    const clean = normalizeCode(code.value);
    if (!clean) return showError(joinError, `A game code has ${CODE_LENGTH} letters, like ABCDE`);
    let name;
    try {
      name = checkedName(joinName);
    } catch (error) {
      return showError(joinError, error.message);
    }
    setBusy(true, joinBtn, 'Joining…');
    const timer = setTimeout(() => {
      offlineHint.hidden = false;
      cancelBtn.hidden = false;
    }, OFFLINE_HINT_MS);
    try {
      await onJoin(clean, name);
    } catch (error) {
      setBusy(false);
      if (error.reason !== 'cancelled') showError(joinError, error.message);
    } finally {
      clearTimeout(timer);
      offlineHint.hidden = true;
      cancelBtn.hidden = true;
    }
  }

  return h(
    'section',
    { class: 'screen stack' },
    h('div', { class: 'hero' }, h('div', { class: 'hero-emoji', 'aria-hidden': 'true', text: '✏️📞😈' }), h('p', { class: 'subtitle', text: 'Write it, draw it on paper, guess it, and sabotage your friends.' })),
    notice ? h('p', { class: 'notice', role: 'status', text: notice }) : null,
    joinCode ? [joinForm, hostForm] : [hostForm, joinForm],
  );
}
