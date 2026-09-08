import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { shortcutGridLayout } from '../src/shortcuts.js';
import { initAssistant } from '../src/assistant.js';
import { findComposer, findSendButton, deliverPendingPrompt } from '../src/web-chat-bridge.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('shortcut rows use configured columns and center each incomplete row', () => {
  const layout = shortcutGridLayout(11, 4, 2, 86, 20, 1400);
  assert.equal(layout.visibleColumns, 4);
  assert.equal(layout.pages, 2);
  assert.deepEqual(layout.positions[4], { row: 2, column: 1, offset: 0 });
  assert.deepEqual(layout.positions[8], { row: 1, column: 5, offset: 53 });
  assert.equal(shortcutGridLayout(3, 12, 2, 86, 20, 1400).width, 298);
  assert.equal(shortcutGridLayout(11, 4, 2, 86, 20, 300).visibleColumns, 3);
  assert.equal(shortcutGridLayout(11, 4, 2, 86, 0, 300).width, 258);
});

test('IME confirmation does not submit and a small send button can deliver once', async () => {
  const dom = new JSDOM(await readFile(new URL('../newtab.html', import.meta.url), 'utf8'), {
    url: 'https://chat.deepseek.com/',
  });
  const names = ['window', 'document', 'localStorage', 'location', 'HTMLElement', 'HTMLTextAreaElement',
    'HTMLInputElement', 'InputEvent', 'Event', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle'];
  for (const name of names) globalThis[name] = dom.window[name];
  const calls = [];
  const pending = { id: 'one', provider: 'deepseek', prompt: '你好', createdAt: Date.now() };
  globalThis.chrome = { runtime: { async sendMessage(message) {
    calls.push(message.type);
    return { ok: true, pending };
  } } };
  try {
    initAssistant();
    const input = document.getElementById('assistant-input');
    input.value = '候选词';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    await wait(0);
    assert.equal(input.value, '候选词');
    assert.deepEqual(calls, []);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(0);
    assert.deepEqual(calls, ['open-web-chat']);
    assert.equal(input.value, '');

    const form = document.createElement('div');
    form.innerHTML = '<textarea></textarea><button aria-label="Send">↑</button>';
    document.body.appendChild(form);
    const composer = form.firstChild;
    const button = form.lastChild;
    composer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 100, right: 500, bottom: 100 });
    button.getBoundingClientRect = () => ({ left: 450, top: 60, width: 32, height: 32, right: 482, bottom: 92 });
    assert.equal(findComposer(), composer);
    assert.equal(findSendButton(composer), button);
    button.setAttribute('aria-disabled', 'true');
    assert.equal(findSendButton(composer), null);
    button.removeAttribute('aria-disabled');
    let clicks = 0;
    button.onclick = () => { clicks++; composer.value = ''; };
    await deliverPendingPrompt();
    assert.equal(clicks, 1);
    assert.equal(calls.at(-1), 'complete-web-prompt');

    calls.length = 0;
    button.onclick = () => { clicks++; }; // Website ignores the click.
    await deliverPendingPrompt();
    assert.equal(composer.value, pending.prompt);
    assert.ok(!calls.includes('complete-web-prompt'), 'failed delivery retains its record');
    assert.match(form.textContent, /请点击发送按钮/);
  } finally {
    dom.window.close();
    for (const name of names) delete globalThis[name];
    delete globalThis.chrome;
  }
});
