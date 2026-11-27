// Debug tuning panel: curve sliders, curve preview, and a calibration list of pairs
// that re-scores instantly as the sliders move (the model runs once per pair).
import { DEFAULT_SETTINGS, toScore, curve } from './similarity.js';
import { EXAMPLES } from './examples.js';

const SETTINGS_KEY = 'ss-tuning-settings-v1';
const PAIRS_KEY = 'ss-tuning-pairs-v1';
const LOGIT_MIN = -6;
const LOGIT_MAX = 5;

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/**
 * @param {object} opts
 * @param {(settings: object) => void} opts.onChange  Called whenever a setting changes.
 * @param {() => {a: string, b: string}} opts.getCurrentPair  The pair in the main inputs.
 */
export function createTuning({ onChange, getCurrentPair }) {
  const $ = (id) => document.getElementById(id);
  const els = {
    offset: $('t-offset'),
    offsetVal: $('t-offset-val'),
    temp: $('t-temp'),
    tempVal: $('t-temp-val'),
    sym: $('t-sym'),
    values: $('t-values'),
    reset: $('t-reset'),
    copy: $('t-copy'),
    curve: $('t-curve'),
    scoreAll: $('t-score-all'),
    addPair: $('t-add'),
    pairs: $('t-pairs'),
  };

  let settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) };
  let customPairs = load(PAIRS_KEY, []);
  const measures = new Map(); // "a\0b" -> measurement
  let scorer = null;
  let running = false;

  const keyOf = (a, b) => `${a}\u0000${b}`;
  const allPairs = () => [
    ...EXAMPLES.map((p) => ({ ...p, custom: false })),
    ...customPairs.map((p, i) => ({ ...p, custom: true, index: i })),
  ];

  // ---- Controls ----
  function valuesText() {
    return `offset=${settings.offset.toFixed(1)}, temperature=${settings.temperature.toFixed(1)}, symmetric=${settings.symmetric ? 'on' : 'off'}`;
  }

  function syncControls() {
    els.offset.value = settings.offset;
    els.temp.value = settings.temperature;
    els.sym.checked = settings.symmetric;
    els.offsetVal.textContent = settings.offset.toFixed(1);
    els.tempVal.textContent = settings.temperature.toFixed(1);
    els.values.textContent = valuesText();
  }

  function changed() {
    save(SETTINGS_KEY, settings);
    syncControls();
    drawCurve();
    renderPairs();
    onChange(settings);
  }

  els.offset.addEventListener('input', () => { settings.offset = parseFloat(els.offset.value); changed(); });
  els.temp.addEventListener('input', () => { settings.temperature = parseFloat(els.temp.value); changed(); });
  els.sym.addEventListener('change', () => { settings.symmetric = els.sym.checked; changed(); });
  els.reset.addEventListener('click', () => { settings = { ...DEFAULT_SETTINGS }; changed(); });
  els.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(valuesText());
      els.copy.textContent = 'Copied ✓';
    } catch {
      els.copy.textContent = 'Copy failed — read the values above';
    }
    setTimeout(() => { els.copy.textContent = 'Copy values'; }, 1500);
  });

  // ---- Curve preview (SVG): x = logit, y = score; dashed = model default ----
  const W = 300, H = 140, PAD = 8;
  const x = (logit) => PAD + ((logit - LOGIT_MIN) / (LOGIT_MAX - LOGIT_MIN)) * (W - 2 * PAD);
  const y = (p) => H - PAD - p * (H - 2 * PAD);

  function linePoints(params) {
    const pts = [];
    for (let l = LOGIT_MIN; l <= LOGIT_MAX + 1e-9; l += 0.25) pts.push(`${x(l).toFixed(1)},${y(curve(l, params)).toFixed(1)}`);
    return pts.join(' ');
  }

  function drawCurve() {
    const dots = [];
    for (const p of allPairs()) {
      const m = measures.get(keyOf(p.a, p.b));
      if (!m || m.exact) continue;
      const r = toScore(m, settings);
      const lx = Math.min(LOGIT_MAX, Math.max(LOGIT_MIN, r.logit));
      dots.push(`<circle cx="${x(lx).toFixed(1)}" cy="${y(r.score / 100).toFixed(1)}" r="3.5" class="curve-dot"/>`);
    }
    els.curve.innerHTML = `
      <line x1="${PAD}" y1="${y(0.5)}" x2="${W - PAD}" y2="${y(0.5)}" class="curve-grid"/>
      <line x1="${x(0)}" y1="${PAD}" x2="${x(0)}" y2="${H - PAD}" class="curve-grid"/>
      <polyline points="${linePoints(DEFAULT_SETTINGS)}" class="curve-default"/>
      <polyline points="${linePoints(settings)}" class="curve-tuned"/>
      ${dots.join('')}`;
  }

  // ---- Calibration list ----
  function renderPairs() {
    els.pairs.replaceChildren(...allPairs().map((p) => {
      const row = document.createElement('div');
      row.className = 'pair-row';

      const text = document.createElement('div');
      text.className = 'pair-text';
      const label = document.createElement('strong');
      label.textContent = p.label;
      const sentences = document.createElement('span');
      sentences.textContent = `${p.a} → ${p.b}`;
      text.append(label, sentences);

      const nums = document.createElement('div');
      nums.className = 'pair-nums';
      const m = measures.get(keyOf(p.a, p.b));
      if (m) {
        const base = toScore(m, { ...DEFAULT_SETTINGS, symmetric: settings.symmetric });
        const tuned = toScore(m, settings);
        nums.innerHTML = `<span class="pair-tuned">${tuned.score.toFixed(1)}</span>
          <span class="pair-sub">model ${base.score.toFixed(1)} · logit ${tuned.logit.toFixed(2)}</span>`;
      } else {
        nums.innerHTML = '<span class="pair-sub">not scored</span>';
      }

      row.append(text, nums);
      if (p.custom) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'pair-del';
        del.setAttribute('aria-label', 'Remove pair');
        del.textContent = '✕';
        del.addEventListener('click', () => {
          customPairs.splice(p.index, 1);
          save(PAIRS_KEY, customPairs);
          renderPairs();
          drawCurve();
        });
        row.append(del);
      }
      return row;
    }));
  }

  function updateButtons() {
    els.scoreAll.disabled = !scorer || running;
    els.addPair.disabled = !scorer || running;
  }

  async function scoreMissing() {
    if (!scorer || running) return;
    running = true;
    updateButtons();
    els.scoreAll.textContent = 'Scoring…';
    try {
      for (const p of allPairs()) {
        const k = keyOf(p.a, p.b);
        if (measures.has(k)) continue;
        measures.set(k, await scorer.measure(p.a, p.b));
        renderPairs();
        drawCurve();
      }
    } finally {
      running = false;
      els.scoreAll.textContent = 'Score all pairs';
      updateButtons();
    }
  }

  els.scoreAll.addEventListener('click', scoreMissing);
  els.addPair.addEventListener('click', () => {
    const { a, b } = getCurrentPair();
    if (!a || !b) {
      els.addPair.textContent = 'Type both sentences first';
      setTimeout(() => { els.addPair.textContent = 'Add current pair'; }, 1500);
      return;
    }
    if (!allPairs().some((p) => p.a === a && p.b === b)) {
      customPairs.push({ label: 'Custom', a, b });
      save(PAIRS_KEY, customPairs);
    }
    scoreMissing();
    renderPairs();
  });

  syncControls();
  drawCurve();
  renderPairs();
  updateButtons();

  return {
    getSettings: () => settings,
    setScorer(s) { scorer = s; updateButtons(); },
    /** Reuse a measurement from the main Compare so the list doesn't recompute it. */
    remember(a, b, m) { measures.set(keyOf(a, b), m); renderPairs(); drawCurve(); },
  };
}
