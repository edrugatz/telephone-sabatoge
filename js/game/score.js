// Scoring engine (SPEC §7, §9). Pure ES module (no DOM / Node APIs), shared by the browser and the tests.
//
// Step 1: buildTransformations() lists every drawing → interpretation with its sentences and active rules.
// Step 2: the caller sets t.similarity (0–100) on each one: the real model (P10) or fake numbers (tests).
// Step 3: scoreGame() turns them into per-player totals, two leaderboards and three awards.
//
// Transformation = drawer A (odd round r) draws incoming sentence S (round r − 1), interpreter B
// (round r + 1, same chain) writes S′.
//   damage       = 100 − similarity(S, S′)
//   preservation = damage / 2 to A and to B (lower is better); the chain's creator gets none
//   sabotage     = full damage to the author of every active rule, revenge rules included.
//                  Credit is per rule: an author with two rules in one transformation gets it twice.
// A transformation holds 0–4 rules: a scheduled + a revenge rule on each of its two tasks.

/** Values that round to the same tenth count as a tie. */
const tieKey = (v) => Math.round(v * 10);

const fail = (message) => {
  throw new TypeError(message);
};

/**
 * List the game's transformations, in chain order then round order.
 * @param {object} game
 * @param {{ players: string[], k: number, rounds: number[][] }} game.schedule
 * @param {{ author: number, type: string, text: string }[]} game.rules
 * @param {(number|null)[][]} game.ruleAt   from assignRules()
 * @param {{ author: number, target: number, round: number, text: string }[]} [game.revenges]
 *        round = the target's task round (r + 1 in SPEC §4)
 * @param {(string|null)[][]} game.sentences  sentences[r][c] for even rounds (0 = originals)
 * @returns {{ chain, round, drawer, interpreter, incoming, outgoing, rules: object[], similarity: null }[]}
 */
export function buildTransformations({ schedule, rules, ruleAt, revenges = [], sentences }) {
  if (!schedule || !Array.isArray(schedule.rounds)) fail('buildTransformations needs a schedule');
  const { players, k, rounds } = schedule;
  const n = players.length;
  if (!Array.isArray(ruleAt) || ruleAt.length !== k + 1) fail(`ruleAt must have ${k + 1} rounds`);
  if (!Array.isArray(sentences)) fail('sentences must be an array of rounds');
  if (!Array.isArray(revenges)) fail('revenges must be an array');

  const sentence = (r, c) => {
    const s = sentences[r]?.[c];
    if (typeof s !== 'string') fail(`Missing sentence for ${players[c]}'s chain in round ${r}`);
    return s;
  };

  // Revenge rules keyed by task "r,c"; at most one per task, never on round 0.
  const revengeAt = new Map();
  revenges.forEach((rv, i) => {
    const okPlayer = (p) => Number.isInteger(p) && p >= 0 && p < n;
    if (!rv || !okPlayer(rv.author) || !okPlayer(rv.target)) fail(`Revenge ${i + 1} needs a valid author and target`);
    if (!(Number.isInteger(rv.round) && rv.round >= 1 && rv.round <= k)) {
      fail(`Revenge ${i + 1}: round ${rv.round} is not a task round (1–${k})`);
    }
    const c = rounds[rv.round].indexOf(rv.target);
    const key = `${rv.round},${c}`;
    if (revengeAt.has(key)) fail(`Revenge ${i + 1}: ${players[rv.target]} already has a revenge rule in round ${rv.round}`);
    const first = rv.round % 2 === 1 ? rv.round : rv.round - 1;
    if (rv.author === rounds[first][c] || rv.author === rounds[first + 1][c]) {
      fail(`Revenge ${i + 1}: ${players[rv.author]} is part of that transformation`);
    }
    revengeAt.set(key, rv);
  });

  const activeRules = (r, c) => {
    const task = r % 2 === 1 ? 'draw' : 'interpret';
    const list = [];
    const i = ruleAt[r]?.[c] ?? null;
    if (i !== null) {
      const rule = rules[i];
      if (!rule) fail(`ruleAt round ${r}: "${i}" is not a valid rule index`);
      list.push({ rule: i, author: rule.author, task, revenge: false, text: rule.text });
    }
    const rv = revengeAt.get(`${r},${c}`);
    if (rv) list.push({ rule: null, author: rv.author, task, revenge: true, text: rv.text });
    return list;
  };

  const out = [];
  for (let c = 0; c < n; c++) {
    for (let r = 1; r < k; r += 2) {
      out.push({
        chain: c,
        round: r,
        drawer: rounds[r][c],
        interpreter: rounds[r + 1][c],
        incoming: sentence(r - 1, c),
        outgoing: sentence(r + 1, c),
        rules: [...activeRules(r, c), ...activeRules(r + 1, c)],
        similarity: null,
      });
    }
  }
  return out;
}

/** Sort players by value and give ties the same rank (1, 1, 3). */
function leaderboard(stats, key, direction) {
  const sorted = [...stats].sort((a, b) => direction * (tieKey(a[key]) - tieKey(b[key])) || a.player - b.player);
  let rank = 0;
  return sorted.map((s, i) => {
    if (i === 0 || tieKey(s[key]) !== tieKey(sorted[i - 1][key])) rank = i + 1;
    return { player: s.player, name: s.name, value: s[key], rank };
  });
}

/** Everyone tied for first place on a leaderboard. */
const leaders = (board) => board.filter((e) => e.rank === 1).map((e) => e.player);

/**
 * Score transformations whose `similarity` is set (0–100).
 * @param {object[]} transformations from buildTransformations()
 * @param {string[]} players names, index = player id
 * @returns {{ transformations, players, leaderboards: { preservers, saboteurs }, awards }}
 *   players[p] = { player, name, preservation, tasks, sabotage, ruleUses, sabotagePerUse (null if 0 uses) }
 *   leaderboard entry = { player, name, value, rank }
 *   award = { id, title, description, winners: number[], value }
 */
export function scoreGame(transformations, players) {
  if (!Array.isArray(transformations)) fail('scoreGame needs a list of transformations');
  if (!Array.isArray(players)) fail('scoreGame needs the player names');

  const stats = players.map((name, player) => ({
    player,
    name: String(name),
    preservation: 0,
    tasks: 0,
    sabotage: 0,
    ruleUses: 0,
    sabotagePerUse: null,
  }));
  const at = (p, what) => stats[p] ?? fail(`Unknown ${what} ${p}`);

  const scored = transformations.map((t) => {
    const sim = t.similarity;
    if (typeof sim !== 'number' || !(sim >= 0 && sim <= 100)) {
      fail(`${players[t.chain] ?? t.chain}'s chain, round ${t.round}: similarity must be 0–100, got ${sim}`);
    }
    const damage = 100 - sim;
    for (const p of [t.drawer, t.interpreter]) {
      const s = at(p, 'player');
      s.preservation += damage / 2;
      s.tasks++;
    }
    for (const rule of t.rules) {
      const s = at(rule.author, 'rule author');
      s.sabotage += damage;
      s.ruleUses++;
    }
    return { ...t, damage };
  });
  for (const s of stats) s.sabotagePerUse = s.ruleUses ? s.sabotage / s.ruleUses : null;

  const preservers = leaderboard(stats, 'preservation', 1);
  const saboteurs = leaderboard(stats, 'sabotage', -1);
  const worst = leaderboard(stats, 'preservation', -1);
  const awards = [];
  if (stats.length) {
    awards.push({
      id: 'guardian',
      title: 'Guardian of Meaning',
      description: 'Lost the least meaning in their drawings and interpretations',
      winners: leaders(preservers),
      value: preservers[0].value,
    });
    if (saboteurs[0].value > 0) {
      awards.push({
        id: 'saboteur',
        title: 'Master Saboteur',
        description: 'Their rules caused the most damage',
        winners: leaders(saboteurs),
        value: saboteurs[0].value,
      });
    }
    // Skip when everyone tied: the "worst" player would also be the Guardian.
    if (tieKey(worst[0].value) !== tieKey(preservers[0].value)) {
      awards.push({
        id: 'chaos',
        title: 'Agent of Chaos',
        description: 'Lost the most meaning in their own drawings and interpretations',
        winners: leaders(worst),
        value: worst[0].value,
      });
    }
  }
  return { transformations: scored, players: stats, leaderboards: { preservers, saboteurs }, awards };
}
