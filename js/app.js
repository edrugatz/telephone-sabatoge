// UI wiring: loads the model, handles the form, renders results.
import * as transformers from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm';
import { createScorer, toScore, describe } from './similarity.js';
import { EXAMPLES } from './examples.js';
import { createTuning } from './tuning.js';

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'),
  statusText: $('status-text'),
  progressFill: $('progress-fill'),
  form: $('compare-form'),
  a: $('input-a'),
  b: $('input-b'),
  compareBtn: $('compare-btn'),
  clearBtn: $('clear-btn'),
  result: $('result'),
  score: $('score'),
  scoreLabel: $('score-label'),
  gaugeFill: $('gauge-fill'),
  meta: $('meta'),
  examples: $('examples'),
};

let scorer = null;
let busy = false;
let last = null; // { m: measurement, ms } of the latest Compare, re-scored when tuning changes

const tuning = createTuning({
  onChange: () => { if (last) render(last.m, last.ms, false); },
  getCurrentPair: () => ({ a: els.a.value.trim(), b: els.b.value.trim() }),
});

// ---- Model loading with combined download progress ----
const files = new Map(); // file -> { loaded, total }

function onProgress(p) {
  if (p.status === 'progress' && p.total) {
    files.set(p.file, { loaded: p.loaded, total: p.total });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    const mb = (n) => (n / 1e6).toFixed(1);
    els.statusText.textContent = `Downloading model… ${mb(loaded)} / ${mb(total)} MB`;
    els.progressFill.style.transform = `scaleX(${total ? loaded / total : 0})`;
  }
}

async function loadModel() {
  const t0 = performance.now();
  try {
    scorer = await createScorer(transformers, { onProgress });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    els.status.classList.add('is-ready');
    els.statusText.textContent = `✅ Model ready (${secs}s) — runs offline on your device`;
    tuning.setScorer(scorer);
    updateButton();
  } catch (err) {
    console.error(err);
    els.status.classList.add('is-error');
    els.statusText.textContent = `Could not load the model: ${err.message}. Check your connection and reload.`;
  }
}

// ---- Form ----
function updateButton() {
  els.compareBtn.disabled = !scorer || busy || !els.a.value.trim() || !els.b.value.trim();
}

function scoreColor(score) {
  // red (0) -> amber (50) -> green (100)
  return `hsl(${Math.round(score * 1.2)}, 75%, 55%)`;
}

// animate: replay the gauge from 0 (new Compare); false = just move it (slider tweak).
function render(m, ms, animate = true) {
  const { score, raw, logit, exact } = toScore(m, tuning.getSettings());
  els.result.hidden = false;
  els.result.style.setProperty('--score-color', scoreColor(score));
  els.score.textContent = score.toFixed(1);
  els.scoreLabel.textContent = describe(score);
  const setGauge = () => { els.gaugeFill.style.transform = `scaleX(${score / 100})`; };
  if (animate) {
    els.gaugeFill.style.transform = 'scaleX(0)';
    requestAnimationFrame(() => requestAnimationFrame(setGauge));
  } else {
    setGauge();
  }
  const prefix = exact ? 'Identical text · ' : '';
  els.meta.textContent = `${prefix}model ${(raw * 100).toFixed(1)} · logit ${logit.toFixed(2)} (A→B ${m.logitAB.toFixed(2)}, B→A ${m.logitBA.toFixed(2)}) · ${ms} ms`;
}

async function compare() {
  const a = els.a.value.trim();
  const b = els.b.value.trim();
  if (!scorer || busy || !a || !b) return;
  busy = true;
  updateButton();
  els.compareBtn.textContent = 'Comparing…';
  try {
    const t0 = performance.now();
    const m = await scorer.measure(a, b);
    last = { m, ms: Math.round(performance.now() - t0) };
    render(last.m, last.ms);
    tuning.remember(a, b, m);
    els.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    els.statusText.textContent = `Error while comparing: ${err.message}`;
  } finally {
    busy = false;
    els.compareBtn.textContent = 'Compare';
    updateButton();
  }
}

els.form.addEventListener('submit', (e) => { e.preventDefault(); compare(); });
els.a.addEventListener('input', updateButton);
els.b.addEventListener('input', updateButton);
for (const ta of [els.a, els.b]) {
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); compare(); }
  });
}
els.clearBtn.addEventListener('click', () => {
  els.a.value = '';
  els.b.value = '';
  els.result.hidden = true;
  last = null;
  updateButton();
  els.a.focus();
});

// ---- Examples ----
for (const ex of EXAMPLES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = ex.label;
  chip.addEventListener('click', () => {
    els.a.value = ex.a;
    els.b.value = ex.b;
    els.result.hidden = true;
    last = null;
    updateButton();
  });
  els.examples.append(chip);
}

loadModel();
