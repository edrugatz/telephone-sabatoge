import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteLink, isLocalAddress } from '../js/ui/config.js';

const page = (href) => {
  const u = new URL(href);
  return { origin: u.origin, pathname: u.pathname, hostname: u.hostname };
};

test('a local preview address gives no invite link', () => {
  assert.equal(inviteLink('WSMAY', page('http://127.0.0.1:8080/'), ''), null);
  assert.equal(inviteLink('WSMAY', page('http://localhost:8080/index.html'), ''), null);
  assert.equal(isLocalAddress('example.github.io'), false);
});

test('a public page links to itself', () => {
  assert.equal(inviteLink('WSMAY', page('https://me.github.io/game/?join=OLDCD'), ''), 'https://me.github.io/game/?join=WSMAY');
});

test('PUBLIC_URL wins, also from the local preview', () => {
  assert.equal(inviteLink('WSMAY', page('http://127.0.0.1:8080/'), 'https://me.github.io/game/'), 'https://me.github.io/game/?join=WSMAY');
});
