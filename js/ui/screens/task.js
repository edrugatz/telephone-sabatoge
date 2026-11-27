// Task screen (P8): the player's task for this round, with the round, the sentence to draw, the active
// sabotage rule(s) and their authors (or "No rule this time"), an advisory timer and a Done action.
// P9: a pass card ("Then pass your paper to X") and one "Done & passed to X" tap; once done, the task part
// becomes the waiting screen, and the live part shows the round's progress bar and player chips.
//
// Like the rules screen it is a component: the task part (and its text box) is built once per round and
// per done/not-done, and update() only redraws the live part (who is still busy, the host's Next round).
// The typed sentence lives outside the DOM (onDraftChange), so a reload or a view update keeps it.
//
//   const screen = createTaskScreen({ onDraftChange, onSubmit, onNextRound, onEndGame, testing });
//   screen.update({ view, isHost, draft, busy, testing: { open, status } });
//   router.show('task', screen.element);

import { h } from '../dom.js';
import { secondsLeft, formatSeconds } from '../timer.js';
import { passInfo, waitingText, roundLabel, roundProgress } from '../pass.js';

const TASKS = {
  write: {
    emoji: '✍️',
    title: 'Write a sentence',
    hint: 'Something fun to draw. It starts your chain.',
    placeholder: 'e.g. A cat rides a bicycle to the moon',
  },
  draw: {
    emoji: '🎨',
    title: 'Draw this',
    hint: 'Draw it on your paper. No words or letters!',
  },
  interpret: {
    emoji: '🔍',
    title: 'What does the drawing show?',
    hint: 'Look at the drawing you were handed and describe it in one sentence.',
    placeholder: 'e.g. A dragon is afraid of a tiny mouse',
  },
};

export function createTaskScreen(handlers) {
  const taskSlot = h('div', { class: 'stack' });
  const liveSlot = h('div', { class: 'stack' });
  const element = h('section', { class: 'screen stack' }, taskSlot, liveSlot);

  let key = null;
  let built = null; // { timer, submitButton, input }
  let latest = null;
  let interval = null;

  function tick() {
    if (!built?.timer) return;
    const { view } = latest;
    const left = secondsLeft(view.roundStartedAt, view.task.task, Date.now());
    built.timer.textContent = left > 0 ? `⏱️ ${formatSeconds(left)}` : "⏰ Time's up!";
    built.timer.classList.toggle('timer-low', left > 0 && left <= 10);
    built.timer.classList.toggle('timer-up', left === 0);
  }

  function startTicking() {
    if (interval) return;
    interval = setInterval(() => {
      // The router dropped this screen: stop the clock.
      if (!element.isConnected) {
        clearInterval(interval);
        interval = null;
        return;
      }
      tick();
    }, 1000);
  }

  function update(state) {
    latest = state;
    const { task } = state.view;
    const nextKey = `${task.round}:${task.done}`;
    if (nextKey !== key) {
      if (key !== null) window.scrollTo(0, 0);
      key = nextKey;
      built = buildTask(state, handlers);
      taskSlot.replaceChildren(built.element);
    }
    if (built.submitButton) built.submitButton.disabled = state.busy;
    tick();
    startTicking();
    liveSlot.replaceChildren(...liveSection(state, handlers));
  }

  return { element, update };
}

// ---- Task part ---------------------------------------------------------------------------

function buildTask(state, handlers) {
  const { view } = state;
  const { task } = view;
  const info = TASKS[task.task];
  const pass = passInfo(task);
  const timer = task.done ? null : h('span', { class: 'timer', role: 'timer', 'aria-live': 'off' });

  const header = h('div', { class: 'row-between' }, h('span', { class: 'round-chip', text: roundLabel(task.round, task.lastRound) }), timer);

  // Done: the waiting screen. The paper is passed, nothing left to read here.
  if (task.done) {
    return {
      element: h(
        'div',
        { class: 'stack' },
        header,
        h(
          'div',
          { class: 'card done-card' },
          h('div', { class: 'hero-emoji', 'aria-hidden': 'true', text: pass.reveal ? '📥' : '📄' }),
          h('p', { class: 'card-title', text: pass.doneTitle }),
          h('p', { class: 'hint', text: waitingText(task) }),
        ),
      ),
      timer,
    };
  }

  const hero = h(
    'div',
    { class: 'hero' },
    h('div', { class: 'hero-emoji', 'aria-hidden': 'true', text: info.emoji }),
    h('h2', { class: 'card-title', text: info.title }),
    h('p', { class: 'hint subtitle', text: info.hint }),
  );

  const sentence = task.task === 'draw' && task.sentence ? h('blockquote', { class: 'card sentence-card', text: task.sentence }) : null;
  const rules = task.round === 0 ? null : rulesSection(task.rules);
  const passCard = h(
    'div',
    { class: `card pass-card${pass.reveal ? ' is-reveal' : ''}` },
    h('p', { class: 'pass-title', text: pass.title }),
    h('p', { class: 'hint', text: pass.detail }),
  );

  if (task.task === 'draw') {
    const submitButton = h('button', {
      class: 'btn btn-primary btn-block btn-big',
      type: 'button',
      text: pass.button,
      on: { click: () => handlers.onSubmit(null) },
    });
    return { element: h('div', { class: 'stack' }, header, hero, sentence, rules, passCard, submitButton), timer, submitButton };
  }

  return { ...sentenceForm(state, handlers, { ...info, button: pass.button }, [header, hero, rules], passCard), timer };
}

function sentenceForm({ draft }, { onDraftChange, onSubmit }, info, top, bottom) {
  let text = draft ?? '';
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const input = h('textarea', {
    class: 'input textarea',
    rows: '3',
    autocomplete: 'off',
    enterkeyhint: 'send',
    placeholder: info.placeholder,
    'aria-label': info.title,
  });
  input.value = text;
  const submitButton = h('button', { class: 'btn btn-primary btn-block btn-big', type: 'submit', text: info.button });

  input.addEventListener('input', () => {
    text = input.value;
    if (text.trim()) {
      error.hidden = true;
      input.setAttribute('aria-invalid', 'false');
    }
    onDraftChange(text);
  });
  // Enter sends (one sentence, no line breaks).
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      element.requestSubmit();
    }
  });

  const element = h(
    'form',
    {
      class: 'stack',
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          if (!text.trim()) {
            error.textContent = 'Write your sentence first';
            error.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
          }
          onSubmit(text.trim());
        },
      },
    },
    top,
    h('div', { class: 'card stack' }, input, error),
    bottom,
    submitButton,
  );
  return { element, submitButton, input };
}

function rulesSection(rules) {
  if (!rules.length) {
    return h('div', { class: 'card rule-none' }, h('p', { class: 'card-title', text: '🍀 No rule this time' }), h('p', { class: 'hint', text: 'Lucky you. Just do your best!' }));
  }
  return h(
    'div',
    { class: 'stack' },
    rules.map((rule) =>
      h(
        'div',
        { class: `card rule-active${rule.revenge ? ' is-revenge' : ''}` },
        h('p', { class: 'rule-from', text: rule.revenge ? `🔥 Revenge from ${rule.authorName}` : `😈 Sabotage from ${rule.authorName}` }),
        h('p', { class: 'rule-text', text: rule.text }),
      ),
    ),
  );
}

// ---- Live part ----------------------------------------------------------------------------

function liveSection(state, handlers) {
  const { view, isHost, busy } = state;
  const waiting = view.waitingFor ?? [];
  const everyoneDone = waiting.length === 0;
  const last = view.round >= view.lastRound;
  const { done, total, percent, players } = roundProgress(view.players, waiting);
  const me = view.you?.name;

  const progress = h(
    'div',
    { class: 'card stack' },
    h('div', { class: 'row-between' }, h('h2', { class: 'card-title', text: 'Finished' }), h('span', { class: 'count', text: `${done} / ${total}` })),
    h(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) },
      h('div', { class: 'progress-fill', style: `transform: scaleX(${percent / 100})` }),
    ),
    h(
      'ul',
      { class: 'chip-list', 'aria-label': 'Players this round' },
      players.map((p) => h('li', { class: `chip ${p.done ? 'is-done' : 'is-busy'}${p.name === me ? ' is-you' : ''}`, text: `${p.done ? '✅' : '✍️'} ${p.name}` })),
    ),
    h('p', { class: 'hint', 'aria-live': 'polite', text: everyoneDone ? 'Everyone is done 🎉' : `Still busy: ${waiting.join(', ')}` }),
  );

  if (!isHost) {
    const note = everyoneDone ? (last ? '⏳ Waiting for the host to finish the game…' : '⏳ Waiting for the host to start the next round…') : null;
    return [progress, note ? h('p', { class: 'waiting-note', text: note }) : null];
  }

  return [
    progress,
    h('button', {
      class: 'btn btn-primary btn-block btn-big',
      type: 'button',
      disabled: busy || !everyoneDone,
      text: everyoneDone ? (last ? 'Finish the game 🏁' : 'Next round →') : `Waiting for ${waiting.length} more…`,
      on: { click: handlers.onNextRound },
    }),
    testingSection({ ...state.testing, ...handlers.testing, busy, waiting }),
    h('button', { class: 'btn btn-link', type: 'button', text: 'Close this game', on: { click: handlers.onEndGame } }),
  ];
}

function testingSection({ open = false, status, onToggle, onBotTasks, busy, waiting }) {
  const details = h(
    'details',
    { class: 'card testing', open },
    h('summary', { text: '🧪 Testing' }),
    h('p', { class: 'hint', text: 'Bots finish their task with a made-up sentence. Your own task you do yourself.' }),
    h('button', { class: 'btn btn-ghost', type: 'button', disabled: busy || waiting.length === 0, text: '🤖 Bots do their tasks', on: { click: onBotTasks } }),
    status ? h('p', { class: 'hint', role: 'status', text: status }) : null,
  );
  details.addEventListener('toggle', () => onToggle?.(details.open));
  return details;
}
