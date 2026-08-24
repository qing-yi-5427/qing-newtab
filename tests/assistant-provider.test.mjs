import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { initAssistant } from '../src/assistant.js';
import { getSettings, saveSettings } from '../src/storage.js';

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

test('assistant provider can be switched directly from the conversation bar', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="assistant-provider-switch" aria-expanded="false"><span id="assistant-title"></span></button>
    <div id="assistant-provider-wrap">
      <div id="assistant-provider-menu" class="hidden">
        <button class="assistant-provider-option" data-provider="deepseek"></button>
        <button class="assistant-provider-option" data-provider="kimi"></button>
        <button class="assistant-provider-option" data-provider="api"></button>
      </div>
    </div>
    <form id="assistant-form"><textarea id="assistant-input"></textarea><button id="assistant-send"></button></form>
    <p id="assistant-status"></p><div id="assistant-messages" class="hidden"></div>
    <button id="assistant-clear" class="hidden"></button><a id="assistant-web" class="hidden"></a>
  </body>`, { url: 'https://extension.test/' });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  try {
    await saveSettings({ ...(await getSettings()), llmProvider: 'deepseek' });
    initAssistant();
    await nextTurn();
    assert.equal(document.getElementById('assistant-title').textContent, 'DeepSeek');

    document.querySelector('[data-provider="kimi"]').click();
    await nextTurn();
    await nextTurn();
    assert.equal((await getSettings()).llmProvider, 'kimi');
    assert.equal(document.getElementById('assistant-title').textContent, 'Kimi');
    assert.equal(document.querySelector('[data-provider="kimi"]').classList.contains('active'), true);
    assert.equal(document.getElementById('assistant-provider-menu').classList.contains('hidden'), true);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
