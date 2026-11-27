// Texts for the scoring card on the finished screen (P10). No DOM, so the tests can check them.

import { describe } from '../similarity.js';

const mb = (bytes) => (bytes / 1e6).toFixed(1);

/**
 * What the scoring card shows.
 * @param {{ status, done, total, error } | null} scoring   from the view
 * @param {{ isHost: boolean, download?: { loaded, total } }} options   download = host's model progress
 * @returns {{ state, title, detail, percent: number|null, retry: boolean }}
 *   percent null = no bar (spinner); retry = show the host's Retry button
 */
export function scoringCard(scoring, { isHost, download = null } = {}) {
  const status = scoring?.status ?? 'loading';
  if (status === 'done') {
    return { state: 'done', title: '✅ The scores are in', detail: 'Who kept the meaning, and who wrecked it:', percent: 100, retry: false };
  }
  if (status === 'error') {
    return isHost
      ? { state: 'error', title: "⚠️ Couldn't score the chains", detail: scoring.error || 'Something went wrong.', percent: null, retry: true }
      : { state: 'error', title: "⚠️ The host's phone is having trouble scoring", detail: 'Hang on, they can try again.', percent: null, retry: false };
  }
  if (status === 'scoring') {
    const { done = 0, total = 0 } = scoring;
    return {
      state: 'scoring',
      title: `🧠 Scoring the chains… ${done} / ${total}`,
      detail: isHost ? 'Keep this screen open until it\'s done.' : 'The host\'s phone is comparing every sentence.',
      percent: total ? Math.round((done / total) * 100) : 0,
      retry: false,
    };
  }
  // loading
  if (isHost && download?.total) {
    return {
      state: 'loading',
      title: '🧠 Loading the scorer…',
      detail: `${mb(download.loaded)} / ${mb(download.total)} MB · keep this screen open`,
      percent: Math.round((download.loaded / download.total) * 100),
      retry: false,
    };
  }
  return {
    state: 'loading',
    title: '🧠 Getting the scorer ready…',
    detail: isHost ? 'Starting the sentence model on this phone.' : "The host's phone is warming up the sentence model.",
    percent: null,
    retry: false,
  };
}

/**
 * Scores grouped per chain, for the simple list (P11/P12 replace it).
 * @param {{ chain, creator, round, drawer, interpreter, incoming, outgoing, similarity }[] | null} scores
 * @returns {{ chain, creator, steps: { drawer, interpreter, incoming, outgoing, similarity, label }[] }[]}
 */
export function chainScores(scores) {
  const chains = new Map();
  for (const s of scores ?? []) {
    if (!chains.has(s.chain)) chains.set(s.chain, { chain: s.chain, creator: s.creator, steps: [] });
    chains.get(s.chain).steps.push({
      round: s.round,
      drawer: s.drawer,
      interpreter: s.interpreter,
      incoming: s.incoming,
      outgoing: s.outgoing,
      similarity: s.similarity,
      label: describe(s.similarity),
    });
  }
  return [...chains.values()].sort((a, b) => a.chain - b.chain).map((c) => ({ ...c, steps: c.steps.sort((a, b) => a.round - b.round) }));
}
