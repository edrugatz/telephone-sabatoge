// Game app controller (P6): connects to Firebase, restores this phone's session, and shows the screen
// that fits the player's view (home → lobby → later stages). The host phone also runs the Host and
// the testing bots.

import { firebaseConfig } from '../sync/firebase-config.js';
import { connectFirebase } from '../sync/firebase-transport.js';
import { normalizeCode } from '../sync/transport.js';
import { Host } from '../game/host.js';
import { Client } from '../game/client.js';
import { GameError } from '../game/game.js';
import { createSessionStore, memoryStorage } from './session.js';
import { Bots } from './bots.js';
import { createRouter } from './router.js';
import { toast } from './dom.js';
import { inviteLink } from './config.js';
import { homeScreen } from './screens/home.js';
import { lobbyScreen, BOT_TARGET } from './screens/lobby.js';
import { loadingScreen, errorScreen, stageScreen } from './screens/status.js';

const router = createRouter(document.getElementById('screen'));
const codeChip = document.getElementById('code-chip');
const store = createSessionStore(safeStorage());

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
  Object.assign(app, { session: null, host: null, client: null, bots: null, view: null, busy: false, leaving: false, testing: { open: false, status: '' } });
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
  } else {
    router.show('stage', stageScreen({ view, isHost, busy: app.busy, onBackToLobby: () => hostAction(() => app.host.backToLobby()), onEndGame: endGame }));
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

boot();
