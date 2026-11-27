// Texts for the leaderboards and awards on the finished screen (P11). No DOM, so the tests can check them.
// Input: view.standings from host.js standings() (names, already ranked by score.js, ties share a rank).

const AWARD_EMOJI = { guardian: '🛡️', saboteur: '😈', chaos: '🌪️' };
const MEDALS = ['🥇', '🥈', '🥉'];

const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** "Ana", "Ana & Ben", "Ana, Ben & Cy". */
export function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

/** 🥇🥈🥉 for the podium, "4." after it. */
export const medal = (rank) => MEDALS[rank - 1] ?? `${rank}.`;

const awardValue = (id, value) => (id === 'saboteur' ? `${fmt(value)} damage` : `${fmt(value)} meaning lost`);

/**
 * One card per award that was given (score.js decides which ones).
 * @param {{ awards }} standings
 * @param {string|null} me   this phone's player name
 * @returns {{ id, emoji, title, winners, reason, value, mine }[]}
 */
export function awardCards(standings, me = null) {
  return (standings?.awards ?? []).map((a) => ({
    id: a.id,
    emoji: AWARD_EMOJI[a.id] ?? '🏅',
    title: a.title,
    winners: joinNames(a.winners),
    reason: a.description,
    value: awardValue(a.id, a.value),
    mine: me !== null && a.winners.includes(me),
  }));
}

/**
 * Rows of both leaderboards, in rank order.
 * @returns {{ preservers: Row[], saboteurs: Row[] }}  Row = { rank, medal, name, value, detail, mine }
 */
export function boardRows(standings, me = null) {
  const row = (e, value, detail) => ({ rank: e.rank, medal: medal(e.rank), name: e.name, value, detail, mine: e.name === me });
  return {
    preservers: (standings?.preservers ?? []).map((e) => row(e, `${fmt(e.value)} lost`, null)),
    saboteurs: (standings?.saboteurs ?? []).map((e) =>
      row(
        e,
        `${fmt(e.value)} damage`,
        e.uses ? `${e.uses} ${e.uses === 1 ? 'rule' : 'rules'} · ${fmt(e.perUse)} per rule` : 'no rules used',
      ),
    ),
  };
}
