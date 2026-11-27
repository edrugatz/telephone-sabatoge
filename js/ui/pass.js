// Pass + round progression texts (P9). Pure ES module (no DOM), so the tests can check them.
//
// One paper per chain travels every round: after each task the player passes it to the chain's next
// holder (`task.passTo` from getTask), and after the last round it goes on the reveal pile.
// The texts only name the next holder and what they will do, never the chain.

import { taskType } from '../game/schedule.js';

export const TASK_NAMES = { write: '✍️ Writing', draw: '🎨 Drawing', interpret: '🔍 Interpreting' };

const NEXT_VERB = { draw: '🎨 draw', interpret: '🔍 interpret' };

/** "Round 0 · warm-up" / "Round r of k". */
export function roundLabel(round, lastRound) {
  return round === 0 ? 'Round 0 · warm-up' : `Round ${round} of ${lastRound}`;
}

/** Toast text when a new round starts: "Round 3 · 🎨 Drawing". */
export function roundTitle(round) {
  return `Round ${round} · ${TASK_NAMES[taskType(round)]}`;
}

/** What the next holder does with the paper you hand them. */
function nextHolderText(task) {
  const { name, task: next } = task.passTo;
  if (next === 'interpret') return `${name} will interpret your drawing.`;
  if (task.task === 'write') return `${name} will draw your sentence on it.`;
  return `${name} will draw the next picture. Fold the paper so your drawing is hidden.`;
}

/**
 * Pass instructions for a task (view.task).
 * @returns {{ reveal: boolean, to: string|null, title: string, detail: string, button: string, doneTitle: string }}
 */
export function passInfo(task) {
  const sends = task.task !== 'draw';
  if (task.passTo === 'reveal') {
    return {
      reveal: true,
      to: null,
      title: '📥 Then put your paper on the reveal pile',
      detail: 'This is your last task. The papers come out in the reveal.',
      button: sends ? 'Send & put on the pile ✅' : 'Done & put on the pile ✅',
      doneTitle: '✅ Done! Paper on the reveal pile',
    };
  }
  const { name } = task.passTo;
  return {
    reveal: false,
    to: name,
    title: `📄 Then pass your paper to ${name}`,
    detail: nextHolderText(task),
    button: sends ? `Send & pass to ${name} ✅` : `Done & passed to ${name} ✅`,
    doneTitle: `✅ Done & passed to ${name}`,
  };
}

/** The hint under "Done" while waiting for the others. */
export function waitingText(task) {
  if (task.round >= task.lastRound) return "That was the last round 🏁 Waiting for the others to finish.";
  const next = taskType(task.round + 1);
  return `Next you'll ${NEXT_VERB[next]}. When you get a paper, check your task here.`;
}

/**
 * Round progress from the view: { done, total, percent, players: [{ name, done }] }.
 * `waitingFor` = names still busy.
 */
export function roundProgress(players, waitingFor = []) {
  const busy = new Set(waitingFor.map((name) => name.toLowerCase()));
  const list = players.map((name) => ({ name, done: !busy.has(name.toLowerCase()) }));
  const done = list.filter((p) => p.done).length;
  return { done, total: players.length, percent: players.length ? Math.round((done / players.length) * 100) : 0, players: list };
}
