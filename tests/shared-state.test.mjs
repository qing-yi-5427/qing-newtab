import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingPromptKey } from '../src/web-chat.js';

// Exercise the actual message listener, including its serialization queue.
test('settings patches and web prompt claims are isolated across tabs', async () => {
  const data = {};
  let listener;
  let removed;
  let nextTab = 10;
  const extension = { id: 'test', url: 'chrome-extension://test/newtab.html' };
  const site = (id) => ({ id: 'test', tab: { id }, frameId: 0, url: 'https://chat.deepseek.com/' });
  globalThis.chrome = {
    runtime: { id: 'test', getURL: (path) => `chrome-extension://test/${path}`,
      onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: {
      async get(key) { await Promise.resolve(); return { [key]: structuredClone(data[key]) }; },
      async set(values) { Object.assign(data, structuredClone(values)); },
      async remove(key) { delete data[key]; },
    } },
    tabs: {
      async create() { return { id: nextTab++ }; },
      async update(id) { assert.ok(data[pendingPromptKey(id)], 'persist before navigation'); },
      async remove() {}, onRemoved: { addListener(fn) { removed = fn; } },
    },
  };
  await import('../src/background.js');
  const send = (message, sender = extension) => new Promise((resolve) => listener(message, sender, resolve));
  chrome.runtime.sendMessage = (message) => send(message);
  const a = await import('../src/storage.js?tab=a');
  const b = await import('../src/storage.js?tab=b');
  await Promise.all([a.getSettings(), b.getSettings()]);
  await Promise.all([a.saveSettings({ theme: 'dark' }), b.saveSettings({ searchEngine: 'google' })]);
  assert.equal((await b.getSettings()).theme, 'dark');
  assert.equal((await a.getSettings()).searchEngine, 'google');

  await Promise.all(['first', 'second'].map((prompt) => send({ type: 'open-web-chat', provider: 'deepseek', prompt })));
  const first = (await send({ type: 'peek-web-prompt' }, site(10))).pending;
  const second = (await send({ type: 'peek-web-prompt' }, site(11))).pending;
  assert.equal(first.prompt, 'first');
  assert.equal(second.prompt, 'second');
  assert.equal((await send({ type: 'peek-web-prompt' }, site(12))).pending, null);
  const claims = await Promise.all([1, 2].map(() => send({ type: 'claim-web-prompt', id: first.id }, site(10))));
  assert.equal(claims.filter((result) => result.pending).length, 1);
  assert.equal((await send({ type: 'peek-web-prompt' }, site(10))).pending, null, 'reload cannot resend a claimed prompt');
  await send({ type: 'complete-web-prompt', id: first.id }, site(11));
  assert.equal(data[pendingPromptKey(11)].id, second.id, 'old completion cannot delete a different message');
  await send({ type: 'complete-web-prompt', id: first.id }, site(10));
  assert.equal(data[pendingPromptKey(10)], undefined);
  removed(11);
  await send({ type: 'peek-web-prompt' }, site(11));
  assert.equal(data[pendingPromptKey(11)], undefined);
  assert.equal((await send({ type: 'save-settings', patch: { theme: 'light' } }, site(10))).ok, false);
  delete globalThis.chrome;
});
