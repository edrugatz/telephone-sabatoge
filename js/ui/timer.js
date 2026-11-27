// Task timer (P8). Pure ES module (no DOM), so the Node tests can check it.
//
// The timer is advisory: when it reaches 0 the screen says "Time's up!", but nothing is forced.
// Every phone counts from the host's `roundStartedAt` (host clock, in the player's view), so all phones
// agree and a reload doesn't restart it. A phone whose clock runs behind the host's would see more than
// the full time: that is clamped to the full time.

export const TASK_SECONDS = { write: 60, draw: 90, interpret: 45 };

/** Seconds a task of this type gets. */
export function taskSeconds(task) {
  return TASK_SECONDS[task] ?? TASK_SECONDS.write;
}

/**
 * Whole seconds left (0…total). With no start time (an old save) the full time is shown.
 * @param {number|null} startedAt host time in ms
 * @param {'write'|'draw'|'interpret'} task
 * @param {number} now this phone's time in ms
 */
export function secondsLeft(startedAt, task, now) {
  const total = taskSeconds(task);
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return total;
  const left = Math.ceil(total - (now - startedAt) / 1000);
  return Math.min(total, Math.max(0, left));
}

/** 75 → "1:15", 5 → "0:05". */
export function formatSeconds(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
