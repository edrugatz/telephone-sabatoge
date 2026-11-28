// Game app controller (P6): connects to Firebase, restores this phone's session, and shows the screen
// that fits the player's view (home → lobby → later stages). The host phone also runs the Host and
// the testing bots.

import { firebaseConfig } from '../sync/firebase-config.js';
import { connectFirebase } from '../sync/firebase-transport.js';
import { normalizeCode } from '../sync/transport.js';
import { Host } from '../game/host.js';
import { Client } from '../game/client.js';
import { GameError, revengeOptions } from '../game/game.js';
import { createSessionStore, memoryStorage } from './session.js';
import { Bots } from './bots.js';
import { createRouter } from './router.js';
import { toast } from './dom.js';
import { inviteLink } from './config.js';
import { homeScreen } from './screens/home.js';
import { lobbyScreen, BOT_TARGET } from './screens/lobby.js';
import { createRulesScreen } from './screens/rules.js';
import { createTaskScreen } from './screens/task.js';
import { finishedScreen } from './screens/finished.js';
import { revealScreen } from './screens/reveal.js';
import { cleanPosition } from './reveal-view.js';
import { roundTitle } from './pass.js';
import { emptyDraft, draftToRules } from './rule-draft.js';
import { loadingScreen, errorScreen, stageScreen } from './screens/status.js';
import { loadScorer, onModelProgress, modelProgress, savedTuning } from './model.js';
import { buildReport, sendFeedback, createErrorLog } from './feedback.js';
import { createFeedbackSheet } from './feedback-sheet.js';
import { BUILD } from './build.js';

const buildId = document.getElementById('build-id');
if (buildId) buildId.textContent = `build ${BUILD}`;

const router = createRouter(document.getElementById('screen'));
const codeChip = document.getElementById('code-chip');
const store = createSessionStore(safeStorage());

// ---- Playtest feedback (P11b) -------------------------------------------------------------
// Recent errors go into bug reports. console.error is where main.js reports every caught failure.
const errorLog = createErrorLog();
const consoleError = console.error.bind(console);
console.error = (...args) => {
  errorLog.add(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
  consoleError(...args);
};
window.addEventListener('error', (event) => errorLog.add(`Uncaught: ${event.message}`));
window.addEventListener('unhandledrejection', (event) => errorLog.add(`Unhandled: ${event.reason?.message ?? event.reason}`));

const feedbackSheet = createFeedbackSheet({
  getContext: feedbackContext,
  async onSend(kind, text, context) {
    if (!app.transport) throw new Error('not connected to the internet');
    const built = buildReport({
      kind,
      text,
      context,
      errors: errorLog.list(),
      uid: app.transport.uid,
      agent: navigator.userAgent,
      page: location.pathname,
      build: BUILD,
    });
    if (!built.ok) throw new Error(built.error);
    await sendFeedback(app.transport, built.report);
    toast('Thanks! Feedback sent 🙏');
  },
});
document.getElementById('feedback-btn').addEventListener('click', () => feedbackSheet.open());

/** Where this phone is right now: screen, stage, round, task, game and player. */
function feedbackContext() {
  const { view } = app;
  return {
    screen: router.current ?? 'loading',
    stage: view?.stage,
    round: view?.task?.round ?? view?.round,
    task: view?.stage === 'playing' ? view?.task?.task : undefined,
    code: app.client?.code ?? app.session?.code,
    name: view?.you?.name ?? app.session?.name ?? store.lastName(),
    host: !!app.host,
    players: view?.players?.length,
  };
}

const app = {
  transport: null,
  session: null,
  host: null, // Host, on the host phone only
  client: null,
  bots: null,
  view: null,
  busy: false,
  leaving: false,
  cancelJoin: null,
  testing: { open: false, status: '' },
  // Rules stage (P7)
  rulesScreen: null,
  ruleDraft: null,
  rulesEditing: false,
  // Preparation + task stage (P8)
  starting: false,
  startError: null,
  taskScreen: null,
  taskDraft: null, // { round, text }
  // Round progression (P9): the round this phone last showed (null after a load, so no toast then).
  shownRound: null,
  // Revenge (P9b): this round's prompt state { round, open, skipped, text, target }.
  revenge: null,
  // Scoring (P10, host phone): the model download started in the background during the game.
  modelPreloaded: false,
  scoringStarting: false,
  // Chain reveal (P12): this phone's position { code, mode, chain, shown } (reveal-view.js).
  reveal: null,
};

function safeStorage() {
  try {
    const storage = window.localStorage;
    storage.setItem('tps.check', '1');
    storage.removeItem('tps.check');
    return storage;
  } catch {
    return memoryStorage();
  }
}

// ---- Start-up ----------------------------------------------------------------------

async function boot() {
  router.show('loading', loadingScreen('Connecting…'));
  try {
    app.transport = await connectFirebase(firebaseConfig);
  } catch (error) {
    console.error(error);
    router.show('error', errorScreen({ title: "Can't connect", message: `${error.message}. Check your internet connection.`, onRetry: boot }));
    return;
  }
  const session = store.load(app.transport.uid);
  if (session) await resume(session);
  else showHome();
}

const joinCodeFromUrl = () => normalizeCode(new URLSearchParams(location.search).get('join') ?? '') ?? '';

function clearUrl() {
  if (location.search) history.replaceState(null, '', location.pathname);
}

function showHome(notice = '') {
  codeChip.hidden = true;
  router.show('home', homeScreen({ lastName: store.lastName(), joinCode: joinCodeFromUrl(), notice, onHost: createGame, onJoin: joinGame, onCancelJoin: () => app.cancelJoin?.() }));
}

const hostHooks = {
  onSave: (json) => store.saveBackup(json),
  onError: (error) => {
    console.error(error);
    toast(`Host problem: ${error.message}`);
  },
};

async function createGame(name) {
  store.rememberName(name);
  const { transport } = app;
  const host = await Host.create({ transport, hostName: name, ...hostHooks });
  app.host = host;
  app.session = store.save({ code: host.code, role: 'host', uid: transport.uid, name, bots: [] });
  attach(await Client.open({ transport, code: host.code }));
  clearUrl();
}

async function joinGame(code, name) {
  store.rememberName(name);
  const { transport } = app;
  const client = await Client.open({ transport, code });
  const cancelled = new Promise((resolve) => (app.cancelJoin = () => resolve({ ok: false, reason: 'cancelled', message: 'Cancelled' })));
  const result = await Promise.race([client.join(name), cancelled]);
  app.cancelJoin = null;
  if (!result.ok) {
    client.close();
    throw new GameError(result.message, result.reason);
  }
  app.session = store.save({ code, role: 'player', uid: transport.uid, name, bots: [] });
  attach(client);
  clearUrl();
}

async function resume(session) {
  const { code } = session;
  router.show('loading', loadingScreen(`Reconnecting to game ${code}…`));
  try {
    if (session.role === 'host') {
      app.host = await Host.resume({ transport: app.transport, code, backup: store.loadBackup(code), ...hostHooks });
    }
    app.session = session;
    attach(await Client.open({ transport: app.transport, code }));
  } catch (error) {
    console.error(error);
    detach();
    if (error instanceof GameError) {
      store.clear();
      showHome(`Couldn't get back into game ${code}: ${error.message}`);
    } else {
      router.show('error', errorScreen({
        title: "Can't reconnect",
        message: error.message,
        onRetry: () => resume(session),
        onHome: () => {
          store.clear();
          showHome();
        },
      }));
    }
  }
}

// ---- In a game ----------------------------------------------------------------------

function attach(client) {
  app.client = client;
  app.view = null;
  if (app.session.role === 'host') {
    app.bots = new Bots({
      connect: (name) => connectFirebase(firebaseConfig, { name }),
      code: client.code,
      apps: app.session.bots,
      onApps: (apps) => (app.session = store.save({ ...app.session, bots: apps })),
    });
  }
  codeChip.textContent = client.code;
  codeChip.hidden = false;
  router.show('loading', loadingScreen('Opening the lobby…'));
  client.watch((view) => {
    app.view = view;
    render();
    // The host's seat list is updated just after the views are written: render again once it's settled.
    app.host?.idle().then(() => app.view === view && render());
  });
}

function detach() {
  app.client?.close();
  app.host?.stop();
  app.bots?.close();
  Object.assign(app, {
    session: null, host: null, client: null, bots: null, view: null, busy: false, leaving: false, testing: { open: false, status: '' },
    rulesScreen: null, ruleDraft: null, rulesEditing: false,
    starting: false, startError: null, taskScreen: null, taskDraft: null, shownRound: null, revenge: null, modelPreloaded: false, scoringStarting: false,
  });
}

function leaveToHome(notice) {
  detach();
  store.clear();
  showHome(notice);
}

function render() {
  const { view } = app;
  if (!app.client) return;
  if (!view || !view.you) {
    if (app.leaving) return;
    return leaveToHome(view?.removed ? 'The host removed you from the game.' : "You're not in this game any more.");
  }
  const isHost = view.you.host && !!app.host;
  if (view.stage !== 'rules') app.startError = null;
  if (isHost && (view.stage === 'playing' || view.stage === 'finished')) preloadModel();
  if (view.stage === 'lobby') {
    const hostSeats = app.host?.state.seats ?? [];
    router.show('lobby', lobbyScreen({
      view,
      isHost,
      seats: view.players.map((name) => hostSeats.find((seat) => seat.name === name)),
      busy: app.busy,
      onShare: share,
      onKick: kick,
      onOpenRules: () => hostAction(() => app.host.openRules()),
      onLeave: leave,
      onEndGame: endGame,
      testing: {
        ...app.testing,
        onToggle: (open) => (app.testing.open = open),
        onAddBot: () => botAction(addBot),
        onFill: () => botAction(fillBots),
      },
    }));
  } else if (view.stage === 'rules') {
    showRules(view, isHost);
  } else if (view.stage === 'playing' && view.task) {
    showTask(view, isHost);
  } else if (view.stage === 'finished') {
    if (app.shownRound !== null) announce('🏁 Game over! Papers to the reveal pile');
    app.shownRound = null;
    showFinished(view, isHost);
    if (isHost) startScoring(view);
  } else {
    router.show('stage', stageScreen({ view, isHost, onEndGame: endGame }));
  }
}

// ---- Finished: awards + leaderboards, then the chain reveal (P11, P12) ----------------------

function showFinished(view, isHost) {
  const reveal = view.reveal;
  if (app.reveal?.code !== view.code) app.reveal = cleanPosition(store.loadReveal(), view.code, reveal);
  if (reveal?.length) app.reveal = cleanPosition(app.reveal, view.code, reveal);
  const move = (position) => {
    app.reveal = position;
    store.saveReveal(position);
  };
  if (app.reveal.mode === 'reveal' && reveal?.length) {
    router.show('reveal', revealScreen({
      view,
      position: app.reveal,
      onMove: (position, { scroll }) => {
        const newChain = position.chain !== app.reveal.chain;
        move(position);
        render();
        if (newChain) window.scrollTo(0, 0);
        else if (scroll) document.querySelector('.beat.is-latest')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      onBack: () => {
        move({ ...app.reveal, mode: 'results' });
        render();
      },
    }));
    return;
  }
  router.show('finished', finishedScreen({
    view,
    isHost,
    download: isHost ? modelProgress() : null,
    started: app.reveal.chain > 0 || app.reveal.shown > 1,
    onOpenReveal: () => {
      move({ ...app.reveal, mode: 'reveal' });
      render();
    },
    onRetry: () => hostAction(() => app.host.retryScoring()),
    onEndGame: endGame,
  }));
}

// ---- Scoring (P10, host phone only) ----------------------------------------------------

/** Start downloading the model once per game; a failure here is retried when scoring starts. */
function preloadModel() {
  if (app.modelPreloaded) return;
  app.modelPreloaded = true;
  loadScorer().catch((error) => console.warn('Model preload failed, will retry at the end', error));
}

// Download progress redraws the finished screen, at most every 300 ms.
let progressTimer = null;
onModelProgress(() => {
  if (progressTimer || router.current !== 'finished') return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    if (app.client && router.current === 'finished') render();
  }, 300);
});

/** Once the game is finished: load the model (if needed) and score whatever isn't measured yet. */
function startScoring(view) {
  const { host } = app;
  const status = view.scoring?.status;
  if (!host || host.scoringRun || app.scoringStarting || !(status === 'loading' || status === 'scoring')) return;
  app.scoringStarting = true;
  loadScorer()
    .then((scorer) => {
      app.scoringStarting = false;
      if (app.host !== host) return;
      return host.score((a, b) => scorer.measure(a, b), savedTuning());
    })
    .then(() => {
      if (app.host === host) announce('✅ The scores are in!');
    })
    .catch(async (error) => {
      app.scoringStarting = false;
      console.error(error);
      // A model that didn't load: say so on every phone (a measure failure already did that).
      if (app.host === host && host.state.scoring?.status !== 'error') await host.failScoring(error.message).catch(() => {});
    });
}

// ---- Rules stage (P7) -----------------------------------------------------------------

function showRules(view, isHost) {
  app.ruleDraft ??= store.loadDraft(view.code) ?? emptyDraft();
  const state = {
    view,
    isHost,
    draft: app.ruleDraft,
    editing: app.rulesEditing || !(view.rules?.mine?.length > 0),
    busy: app.busy,
    starting: app.starting,
    startError: app.startError,
    testing: { open: app.testing.open, status: app.testing.status },
  };
  const fresh = router.current !== 'rules' || !app.rulesScreen;
  if (fresh) {
    app.rulesScreen = createRulesScreen({
      onDraftChange: (draft) => {
        app.ruleDraft = draft;
        store.saveDraft(view.code, draft);
      },
      onSend: sendRules,
      onEdit: editRules,
      onStart: startGame,
      onBackToLobby: () => {
        if (confirm("Back to the lobby? Everyone's rules will be dropped.")) hostAction(() => app.host.backToLobby());
      },
      onEndGame: endGame,
      testing: {
        onToggle: (open) => (app.testing.open = open),
        onBotRules: () => botAction(botsWriteRules),
      },
    });
  }
  app.rulesScreen.update(state);
  if (fresh) router.show('rules', app.rulesScreen.element);
}

async function sendRules() {
  if (app.busy || !app.client) return;
  app.busy = true;
  render();
  try {
    const result = await app.client.submitRules(draftToRules(app.ruleDraft));
    if (result.ok) {
      app.rulesEditing = false;
      toast('Rules sent 📨');
    } else {
      toast(result.message);
    }
  } finally {
    app.busy = false;
    if (app.client) render();
  }
}

function editRules() {
  const mine = app.view?.rules?.mine;
  if (mine?.length) {
    app.ruleDraft = mine.map(({ type, text }) => ({ type, text }));
    store.saveDraft(app.view.code, app.ruleDraft);
  }
  app.rulesEditing = true;
  render();
}

// ---- Preparation + task stage (P8) ------------------------------------------------------

/** Host: build the routing and deal the rules. A failure stays on the rules screen as an error card. */
async function startGame() {
  if (app.busy || !app.host) return;
  app.busy = true;
  app.starting = true;
  app.startError = null;
  render();
  try {
    await app.host.start();
  } catch (error) {
    console.error(error);
    app.startError = error.message;
  } finally {
    app.busy = false;
    app.starting = false;
    if (app.client) render();
  }
}

/** A new round (or the end): buzz the phone and say so. */
function announce(message) {
  toast(message);
  try {
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    // Some browsers refuse vibrate without a tap first: the toast is enough.
  }
}

function showTask(view, isHost) {
  const { round } = view.task;
  if (app.shownRound !== null && app.shownRound !== round) announce(roundTitle(round));
  app.shownRound = round;
  if (app.taskDraft?.round !== round) app.taskDraft = { round, text: store.loadTaskDraft(view.code, round) };
  if (app.revenge?.round !== round) {
    // A typed revenge from before a reload reopens the form.
    const saved = store.loadRevengeDraft(view.code, round);
    app.revenge = { round, open: !!saved?.text, skipped: false, text: saved?.text ?? '', target: saved?.target ?? null };
  }
  const fresh = router.current !== 'task' || !app.taskScreen;
  if (fresh) {
    app.taskScreen = createTaskScreen({
      // The screen stays mounted across rounds: read the round when typing, not when it was built.
      onDraftChange: (text) => {
        const current = app.view?.task?.round;
        if (!Number.isInteger(current)) return;
        app.taskDraft = { round: current, text };
        store.saveTaskDraft(app.view.code, current, text);
      },
      onSubmit: submitTask,
      onNextRound: () => hostAction(() => app.host.advance()),
      onEndGame: endGame,
      revenge: {
        onOpen: () => {
          app.revenge.open = true;
          render();
        },
        onSkip: () => {
          Object.assign(app.revenge, { open: false, skipped: true });
          render();
        },
        onDraft: (text, target) => {
          Object.assign(app.revenge, { text, target });
          store.saveRevengeDraft(app.view.code, app.revenge.round, text, target);
        },
        onSend: sendRevenge,
      },
      testing: {
        onToggle: (open) => (app.testing.open = open),
        onBotTasks: () => botAction(botsDoTasks),
        onBotRevenge: () => botAction(botsTakeRevenge),
      },
    });
  }
  app.taskScreen.update({
    view,
    isHost,
    draft: app.taskDraft.text,
    busy: app.busy,
    revenge: { ...app.revenge },
    testing: { open: app.testing.open, status: app.testing.status },
  });
  if (fresh) router.show('task', app.taskScreen.element);
}

async function submitTask(text) {
  if (app.busy || !app.client) return;
  app.busy = true;
  render();
  try {
    const result = await app.client.submitTask(text);
    toast(result.ok ? 'Done ✅' : result.message);
  } finally {
    app.busy = false;
    if (app.client) render();
  }
}

/** Send this round's revenge rule. A refusal (taken by someone else, round over) is said in a toast. */
async function sendRevenge(text, target) {
  if (app.busy || !app.client) return;
  app.busy = true;
  render();
  try {
    const result = await app.client.revenge(text, target);
    if (result.ok) {
      store.forgetRevengeDraft();
      toast('🔥 Revenge sent');
    } else {
      toast(result.message);
    }
  } finally {
    app.busy = false;
    if (app.client) render();
  }
}

async function hostAction(fn) {
  if (app.busy || !app.host) return;
  app.busy = true;
  render();
  try {
    await fn();
  } catch (error) {
    toast(error.message);
  } finally {
    app.busy = false;
    if (app.client) render();
  }
}

function kick(uid, name) {
  if (confirm(`Remove ${name} from the game?`)) hostAction(() => app.host.kick(uid));
}

function endGame() {
  if (confirm('Close this game on your phone? Everyone will need a new code to play again.')) leaveToHome('Game closed.');
}

async function leave() {
  if (app.busy || !confirm('Leave this game?')) return;
  app.busy = true;
  app.leaving = true;
  render();
  const result = await app.client.leave();
  if (result.ok) return leaveToHome('You left the game.');
  app.busy = false;
  app.leaving = false;
  toast(result.message);
  render();
}

async function share() {
  const code = app.client?.code;
  if (!code) return;
  const url = inviteLink(code, location);
  if (!url) {
    toast(`This preview address only works on this phone. Put the game online (PUBLIC_URL in js/ui/config.js). Code: ${code}`);
    return;
  }
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Telephone Sabotage', text: `Join my game! Code ${code}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied');
    }
  } catch (error) {
    if (error.name !== 'AbortError') toast(`Code: ${code}`);
  }
}

// ---- Testing bots ---------------------------------------------------------------------

async function botAction(fn) {
  if (app.busy || !app.bots) return;
  app.busy = true;
  app.testing.open = true;
  render();
  try {
    await fn();
  } catch (error) {
    console.error(error);
    app.testing.status = `⚠️ ${error.message}`;
  } finally {
    app.busy = false;
    if (app.client) render();
  }
}

async function addBot() {
  app.testing.status = 'Adding a bot…';
  render();
  const bot = await app.bots.add(app.host.state.seats);
  app.testing.status = `${bot.name} joined 🤖`;
}

async function fillBots() {
  let added = 0;
  while (app.host && app.host.state.seats.length < BOT_TARGET) {
    app.testing.status = `Adding bots… (${app.host.state.seats.length} / ${BOT_TARGET})`;
    render();
    await app.bots.add(app.host.state.seats);
    added++;
  }
  app.testing.status = `Added ${added} bot${added === 1 ? '' : 's'} 🤖`;
}

async function botsWriteRules() {
  app.testing.status = 'Bots are writing rules…';
  render();
  const sent = await app.bots.writeRules(app.host.state.seats, app.view?.rules?.missing ?? []);
  app.testing.status = sent ? `${sent} bot${sent === 1 ? '' : 's'} wrote rules 🤖` : 'No bot is missing rules';
}

async function botsDoTasks() {
  app.testing.status = 'Bots are doing their tasks…';
  render();
  const { waitingFor = [], round } = app.view ?? {};
  const done = await app.bots.doTasks(app.host.state.seats, waitingFor, round);
  app.testing.status = done ? `${done} bot${done === 1 ? '' : 's'} finished 🤖` : 'No bot is still busy';
}

async function botsTakeRevenge() {
  app.testing.status = 'Bots are plotting revenge…';
  render();
  const round = app.view?.round;
  const took = await app.bots.takeRevenge(app.host.state.seats, round, (p) => revengeOptions(app.host.state.game, p));
  app.testing.status = took ? `${took} bot${took === 1 ? '' : 's'} took revenge 🔥` : 'No bot can take revenge this round';
}

boot();
