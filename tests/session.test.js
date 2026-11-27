import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore, memoryStorage, checkSession, KEYS } from '../js/ui/session.js';

const SESSION = { code: 'ABCDE', role: 'host', uid: 'u1', name: 'Ana', bots: ['bot-1'] };

test('save and load round-trip for the same uid', () => {
  const store = createSessionStore(memoryStorage());
  store.save(SESSION);
  assert.deepEqual(store.load('u1'), SESSION);
});

test('bots default to an empty list', () => {
  const store = createSessionStore(memoryStorage());
  const { bots, ...rest } = SESSION;
  store.save(rest);
  assert.deepEqual(store.load('u1').bots, []);
});

test('a session saved by another uid is dropped, with its backup', () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  store.save(SESSION);
  store.saveBackup(JSON.stringify({ code: 'ABCDE' }));
  assert.equal(store.load('someone-else'), null);
  assert.equal(storage.getItem(KEYS.session), null);
  assert.equal(store.loadBackup('ABCDE'), null);
});

test('broken JSON or a bad shape is dropped', () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  storage.setItem(KEYS.session, '{not json');
  assert.equal(store.load('u1'), null);
  assert.equal(storage.getItem(KEYS.session), null);
  for (const bad of [{ ...SESSION, code: 'abcde' }, { ...SESSION, code: 'ABCIO' }, { ...SESSION, role: 'boss' }, { ...SESSION, uid: '' }, { ...SESSION, bots: [1] }]) {
    storage.setItem(KEYS.session, JSON.stringify(bad));
    assert.equal(store.load('u1'), null, JSON.stringify(bad));
  }
});

test('save refuses an invalid session', () => {
  const store = createSessionStore(memoryStorage());
  assert.throws(() => store.save({ ...SESSION, role: 'x' }), TypeError);
  assert.equal(checkSession(null), null);
});

test('clear forgets the game but keeps the last name', () => {
  const store = createSessionStore(memoryStorage());
  store.save(SESSION);
  store.saveBackup(JSON.stringify({ code: 'ABCDE' }));
  store.rememberName('  Ana ');
  store.clear();
  assert.equal(store.load('u1'), null);
  assert.equal(store.loadBackup('ABCDE'), null);
  assert.equal(store.lastName(), 'Ana');
});

test('the backup is only returned for its own code', () => {
  const store = createSessionStore(memoryStorage());
  const json = JSON.stringify({ code: 'ABCDE', seats: [] });
  store.saveBackup(json);
  assert.equal(store.loadBackup('ABCDE'), json);
  assert.equal(store.loadBackup('FGHJK'), null);
});

test('a storage that throws does not break the store', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const store = createSessionStore(broken);
  assert.doesNotThrow(() => store.save(SESSION));
  assert.equal(store.load('u1'), null);
  assert.equal(store.lastName(), '');
});
