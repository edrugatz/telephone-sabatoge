// Sabotage rule assignment (SPEC §4). Pure ES module (no DOM / Node APIs),
// shared by the browser and the tests.
//
// Rule pool:  [{ author: 2, type: 'draw' | 'write', text: 'No straight lines' }, …]
//             author = player index in schedule.players; a rule is referred to by its array index.
// Assignment: { seed, ruleRate, ruleAt: [[null, …], [3, null, …], …], warnings: [] }
//             ruleAt[r][c] = rule index on chain c in round r (same shape as schedule.rounds),
//             or null when that task has no rule; round 0 (original sentence) has none.
//
// Rule rate: each player gets a rule on exactly round(k × ruleRate) of their k tasks, split as
// evenly as possible between drawings and interpretations. Which tasks is random (no attempt to
// spread rules over transformations: a transformation may get 0, 1 or 2 rules).
//
// Transformation = drawer A (odd round r) + interpreter B (round r + 1) on the same chain.
// Hard rules (errors):
//   R1 drawing rounds get 'draw' rules, interpretation rounds get 'write' rules
//   R2 the rule's author is neither A nor B (covers "never your own rule")
//   R3 round 0 has no rule; each player has exactly round(k × ruleRate) ruled tasks
// Soft rules (warnings, only when unavoidable):
//   R4 the same player never gets the same rule twice
//   R5 A's and B's rules in one transformation have different authors
//   split: a player's ruled drawings and interpretations differ by at most 1
//   (plus: each author's rules are used about equally often)

import { createRng } from './rng.js';
import { taskType } from './schedule.js';

export const RULE_TYPES = ['draw', 'write'];
export const RULES_PER_PLAYER = 3;
export const DEFAULT_RULE_RATE = 0.5;

/** Number of ruled tasks per player for k tasks at this rate. */
export function ruledTasksPerPlayer(k, ruleRate = DEFAULT_RULE_RATE) {
  checkRate(ruleRate);
  return Math.round(k * ruleRate);
}

function checkRate(ruleRate) {
  if (typeof ruleRate !== 'number' || !(ruleRate >= 0 && ruleRate <= 1)) {
    throw new TypeError(`ruleRate must be a number from 0 to 1, got ${ruleRate}`);
  }
}

const TYPE_WORD = { draw: 'drawing', write: 'writing' };

/** Thrown when rules can't be assigned. `reason`: 'pool' (unusable rule pool) | 'invalid' (internal bug). */
export class RuleError extends Error {
  constructor(message, reason, details = {}) {
    super(message);
    this.name = 'RuleError';
    this.reason = reason;
    Object.assign(this, details);
  }
}

/** Rule type needed in round r (null for round 0). */
export function ruleTypeForRound(r) {
  const t = taskType(r);
  if (t === 'draw') return 'draw';
  if (t === 'interpret') return 'write';
  return null;
}

/** The transformation (drawer, interpreter) that task (r, c) belongs to. */
function transformation(rounds, r, c) {
  const first = r % 2 === 1 ? r : r - 1;
  return { drawer: rounds[first][c], interpreter: rounds[first + 1][c], partnerRound: r % 2 === 1 ? r + 1 : r - 1 };
}

/**
 * Check a rule pool as submitted in the lobby (P7): valid authors, types and text,
 * `perPlayer` rules each, and at least one drawing and one writing rule per player.
 * @returns {{ ok: boolean, errors: { player: number|null, message: string }[] }}
 */
export function validateRulePool(rules, players, { perPlayer = RULES_PER_PLAYER } = {}) {
  const errors = [];
  const fail = (player, message) => errors.push({ player, message });
  if (!Array.isArray(rules)) {
    fail(null, 'Rules must be an array');
    return { ok: false, errors };
  }
  const n = Array.isArray(players) ? players.length : 0;
  const name = (i) => String(players?.[i] ?? `Player ${i}`);
  const counts = Array.from({ length: n }, () => ({ total: 0, draw: 0, write: 0 }));

  rules.forEach((rule, i) => {
    if (!rule || typeof rule !== 'object') {
      fail(null, `Rule ${i + 1} is missing`);
      return;
    }
    const okAuthor = Number.isInteger(rule.author) && rule.author >= 0 && rule.author < n;
    if (!okAuthor) fail(null, `Rule ${i + 1} has an unknown author "${rule.author}"`);
    const who = okAuthor ? name(rule.author) : `Rule ${i + 1}`;
    const okType = RULE_TYPES.includes(rule.type);
    if (!okType) fail(okAuthor ? rule.author : null, `${who}: rule "${rule.text ?? ''}" needs a type (drawing or writing)`);
    if (typeof rule.text !== 'string' || !rule.text.trim()) {
      fail(okAuthor ? rule.author : null, `${who}: a rule is empty`);
    }
    if (okAuthor) {
      counts[rule.author].total++;
      if (okType) counts[rule.author][rule.type]++;
    }
  });

  counts.forEach((cnt, p) => {
    if (cnt.total !== perPlayer) fail(p, `${name(p)} has ${cnt.total} rules, needs ${perPlayer}`);
    if (cnt.draw === 0) fail(p, `${name(p)} needs at least one drawing rule`);
    if (cnt.write === 0) fail(p, `${name(p)} needs at least one writing rule`);
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Check an assignment against R1–R5 for a schedule and rule pool.
 * Uses `assignment.ruleRate` (default 0.5) for the R3 count.
 * @returns {{ ok: boolean, errors: { constraint, message }[], warnings: { constraint, message }[] }}
 */
export function validateAssignment(schedule, rules, assignment) {
  const errors = [];
  const warnings = [];
  const fail = (constraint, message) => errors.push({ constraint, message });
  const warn = (constraint, message) => warnings.push({ constraint, message });
  const done = () => ({ ok: errors.length === 0, errors, warnings });

  const { players, k, rounds } = schedule;
  const n = players.length;
  const ruleAt = assignment?.ruleAt;
  const ruleRate = assignment?.ruleRate ?? DEFAULT_RULE_RATE;
  const name = (i) => String(players[i] ?? `Player ${i}`);
  const chain = (c) => `${name(c)}'s chain`;
  const ruleName = (i) => `"${rules[i].text}" (${name(rules[i].author)})`;

  // ---- Shape ---------------------------------------------------------------
  if (!Array.isArray(ruleAt) || ruleAt.length !== k + 1) {
    fail('shape', `ruleAt must have ${k + 1} rounds`);
    return done();
  }
  let shapeOk = true;
  ruleAt.forEach((row, r) => {
    if (!Array.isArray(row) || row.length !== n) {
      fail('shape', `ruleAt round ${r} must have ${n} entries`);
      shapeOk = false;
      return;
    }
    row.forEach((i, c) => {
      if (i !== null && !(Number.isInteger(i) && i >= 0 && i < rules.length)) {
        fail('shape', `Round ${r}, ${chain(c)}: "${i}" is not a valid rule index`);
        shapeOk = false;
      }
    });
  });
  if (!shapeOk) return done();

  // ---- R3: round 0 empty --------------------------------------------------------
  ruleAt[0].forEach((i, c) => {
    if (i !== null) fail('R3', `Round 0, ${chain(c)}: the original sentence gets no rule`);
  });
  const seen = Array.from({ length: n }, () => new Map()); // player -> rule -> round
  const ruled = Array.from({ length: n }, () => ({ draw: 0, write: 0 }));

  for (let r = 1; r <= k; r++) {
    const type = ruleTypeForRound(r);
    for (let c = 0; c < n; c++) {
      const p = rounds[r][c];
      const i = ruleAt[r][c];
      if (i === null) continue;
      ruled[p][type]++;
      const rule = rules[i];
      // ---- R1: type --------------------------------------------------------------
      if (rule.type !== type) {
        fail('R1', `${name(p)} gets ${TYPE_WORD[rule.type] ?? rule.type} rule ${ruleName(i)} on a ${TYPE_WORD[type]} task in round ${r}`);
      }
      // ---- R2: author outside the transformation ---------------------------------
      const { drawer, interpreter, partnerRound } = transformation(rounds, r, c);
      if (rule.author === p) {
        fail('R2', `${name(p)} gets their own rule ${ruleName(i)} in round ${r}`);
      } else if (rule.author === drawer || rule.author === interpreter) {
        fail('R2', `${name(p)} gets ${ruleName(i)} in round ${r}, but ${name(rule.author)} is in that transformation`);
      }
      // ---- R4: no repeats for the same player -----------------------------------
      if (seen[p].has(i)) {
        warn('R4', `${name(p)} gets ${ruleName(i)} twice (rounds ${seen[p].get(i)} and ${r})`);
      } else {
        seen[p].set(i, r);
      }
      // ---- R5: different authors within one transformation (checked once) --------
      if (r % 2 === 1) {
        const j = ruleAt[partnerRound][c];
        if (j !== null && rules[j].author === rule.author) {
          warn('R5', `${chain(c)} rounds ${r}→${r + 1}: both rules are by ${name(rule.author)}`);
        }
      }
    }
  }

  // ---- R3: exact ruled count per player; split between drawing and writing -----
  const m = ruledTasksPerPlayer(k, ruleRate);
  ruled.forEach(({ draw, write }, p) => {
    const total = draw + write;
    if (total !== m) {
      fail('R3', `${name(p)} has ${total} ruled task${total === 1 ? '' : 's'}, needs ${m}`);
    }
    if (Math.abs(draw - write) > 1) {
      warn('split', `${name(p)} has ${draw} ruled drawing${draw === 1 ? '' : 's'} and ${write} ruled interpretation${write === 1 ? '' : 's'}`);
    }
  });
  return done();
}

/** How many tasks use each author's rules: array indexed by player. */
export function authorUses(schedule, rules, ruleAt) {
  const uses = new Array(schedule.players.length).fill(0);
  for (const row of ruleAt) for (const i of row) if (i !== null) uses[rules[i].author]++;
  return uses;
}

const spread = (arr) => Math.max(...arr) - Math.min(...arr);

/**
 * Pick the ruled tasks at random: each player gets m of them, ⌊m/2⌋ of one type and ⌈m/2⌉ of the
 * other. When m is odd, alternate players (in random order) get the extra drawing or interpretation.
 * @returns {{ r: number, c: number }[]}
 */
function chooseRuledTasks(schedule, m, rng) {
  const { players, k, rounds } = schedule;
  const drawRounds = [];
  const writeRounds = [];
  for (let r = 1; r <= k; r++) (r % 2 === 1 ? drawRounds : writeRounds).push(r);
  const flip = rng.int(2);
  const tasks = [];
  rng.shuffle(players.map((_, p) => p)).forEach((p, i) => {
    const draws = Math.floor(m / 2) + (m % 2 === 1 && (i + flip) % 2 === 0 ? 1 : 0);
    const pick = (list, count) => {
      for (const r of rng.shuffle(list).slice(0, count)) tasks.push({ r, c: rounds[r].indexOf(p) });
    };
    pick(drawRounds, draws);
    pick(writeRounds, m - draws);
  });
  return tasks;
}

/** One attempt: random ruled tasks, then greedy fill (hardest tasks first, cheapest rule each). */
function attemptAssign(schedule, rules, candidates, m, rng) {
  const { players, k, rounds } = schedule;
  const n = players.length;
  const ruleAt = Array.from({ length: k + 1 }, () => new Array(n).fill(null));
  const authorCount = new Array(n).fill(0);
  const ruleCount = new Array(rules.length).fill(0);
  const held = Array.from({ length: n }, () => new Array(rules.length).fill(0)); // player × rule

  const tasks = chooseRuledTasks(schedule, m, rng);
  const order = rng.shuffle(tasks).sort((a, b) => candidates[a.r][a.c].length - candidates[b.r][b.c].length);

  for (const { r, c } of order) {
    const p = rounds[r][c];
    const { partnerRound } = transformation(rounds, r, c);
    const partnerRule = ruleAt[partnerRound][c];
    const partnerAuthor = partnerRule === null ? -1 : rules[partnerRule].author;
    let best = -1;
    let bestCost = Infinity;
    for (const i of rng.shuffle(candidates[r][c])) {
      const a = rules[i].author;
      const cost =
        (held[p][i] ? 10_000 : 0) + // R4
        (a === partnerAuthor ? 1_000 : 0) + // R5
        authorCount[a] * 10 + // balance between authors
        ruleCount[i]; // then between an author's rules
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    ruleAt[r][c] = best;
    authorCount[rules[best].author]++;
    ruleCount[best]++;
    held[p][best]++;
  }

  // Repair: move tasks from over-used authors to authors with ≥ 2 fewer uses,
  // without creating a repeat (R4) or a same-author transformation (R5).
  // Each move lowers the sum of squared uses, so this terminates.
  let moved = true;
  while (moved) {
    moved = false;
    for (const { r, c } of order) {
      const p = rounds[r][c];
      const cur = ruleAt[r][c];
      const a = rules[cur].author;
      const partnerRule = ruleAt[transformation(rounds, r, c).partnerRound][c];
      const partnerAuthor = partnerRule === null ? -1 : rules[partnerRule].author;
      let best = -1;
      for (const i of candidates[r][c]) {
        const b = rules[i].author;
        if (authorCount[b] > authorCount[a] - 2 || held[p][i] || b === partnerAuthor) continue;
        if (best === -1 || authorCount[b] < authorCount[rules[best].author] ||
          (authorCount[b] === authorCount[rules[best].author] && ruleCount[i] < ruleCount[best])) best = i;
      }
      if (best === -1) continue;
      ruleAt[r][c] = best;
      authorCount[a]--;
      authorCount[rules[best].author]++;
      ruleCount[cur]--;
      ruleCount[best]++;
      held[p][cur]--;
      held[p][best]++;
      moved = true;
    }
  }
  return ruleAt;
}

/**
 * Assign sabotage rules to a schedule's tasks (R1–R5 above): each player gets a rule on
 * round(k × ruleRate) of their tasks; the other tasks are null.
 * The same schedule + rules + seed + rate always give the same assignment.
 * @param {{ players: string[], k: number, rounds: number[][] }} schedule
 * @param {{ author: number, type: 'draw'|'write', text: string }[]} rules
 * @param {number|string} seed game code
 * @param {{ ruleRate?: number, maxAttempts?: number }} [options]
 * @returns {{ seed, ruleRate: number, ruleAt: (number|null)[][], warnings: { constraint, message }[] }}
 */
export function assignRules(schedule, rules, seed, { ruleRate = DEFAULT_RULE_RATE, maxAttempts = 20 } = {}) {
  if (!schedule || !Array.isArray(schedule.rounds)) throw new TypeError('assignRules needs a schedule');
  if (!Array.isArray(rules)) throw new TypeError('rules must be an array');
  checkRate(ruleRate);
  const { players, k, rounds } = schedule;
  const m = ruledTasksPerPlayer(k, ruleRate);
  const n = players.length;
  const name = (i) => String(players[i] ?? `Player ${i}`);

  rules.forEach((rule, i) => {
    if (!rule || !Number.isInteger(rule.author) || rule.author < 0 || rule.author >= n || !RULE_TYPES.includes(rule.type)) {
      throw new RuleError(`Rule ${i + 1} needs a valid author and a type (drawing or writing)`, 'pool', { rule: i });
    }
  });
  for (const type of RULE_TYPES) {
    if (!rules.some((rule) => rule.type === type)) {
      throw new RuleError(
        `No ${TYPE_WORD[type]} rules: every player needs at least one drawing and one writing rule.`,
        'pool',
        { type },
      );
    }
  }

  // Candidate rules per task (R1 + R2); a task with none can't be solved.
  const candidates = [[]];
  for (let r = 1; r <= k; r++) {
    const type = ruleTypeForRound(r);
    candidates.push(
      rounds[r].map((p, c) => {
        const { drawer, interpreter } = transformation(rounds, r, c);
        const list = [];
        rules.forEach((rule, i) => {
          if (rule.type === type && rule.author !== drawer && rule.author !== interpreter) list.push(i);
        });
        if (!list.length) {
          throw new RuleError(
            `No ${TYPE_WORD[type]} rule fits ${name(p)}'s task in round ${r}: all ${TYPE_WORD[type]} rules are by ` +
              `${name(drawer)} or ${name(interpreter)}, who are in that transformation. ` +
              'Every player needs at least one drawing and one writing rule.',
            'pool',
            { round: r, chain: c, type },
          );
        }
        return list;
      }),
    );
  }

  let best = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRng(`${seed}#rules#${attempt}`);
    const ruleAt = attemptAssign(schedule, rules, candidates, m, rng);
    const check = validateAssignment(schedule, rules, { ruleRate, ruleAt });
    if (!check.ok) {
      throw new RuleError(
        `Internal error: rule assignment is invalid (${check.errors[0].message})`,
        'invalid',
        { errors: check.errors },
      );
    }
    const r4 = check.warnings.filter((w) => w.constraint === 'R4').length;
    const r5 = check.warnings.length - r4;
    const cost = r4 * 10_000 + r5 * 100 + spread(authorUses(schedule, rules, ruleAt));
    if (!best || cost < best.cost) best = { cost, ruleAt, warnings: check.warnings };
    if (cost <= 1) break; // no warnings and authors used evenly: can't do much better
  }
  return { seed, ruleRate, ruleAt: best.ruleAt, warnings: best.warnings };
}
