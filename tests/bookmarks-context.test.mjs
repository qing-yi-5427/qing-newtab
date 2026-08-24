import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { initContextMenu } from '../src/context-menu.js';

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

test('bookmark right-click menu exposes edit/delete and folder rename actions', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <a class="bm-link" href="https://example.com/" data-bookmark-id="42" data-bookmark-title="示例">示例</a>
    <button class="bm-folder-tab" data-bookmark-folder-id="9" data-bookmark-folder-title="工作">工作</button>
    <div id="context-menu" class="hidden">
      <button id="context-open-bookmark" class="hidden"></button>
      <button id="context-edit-bookmark" class="hidden"></button>
      <button id="context-rename-bookmark-folder" class="hidden"></button>
      <button id="context-delete-bookmark" class="hidden"></button>
      <div id="context-bookmark-separator" class="hidden"></div>
      <button id="context-edit-shortcut" class="hidden"></button>
      <button id="context-add-shortcut"></button>
      <button id="context-finish-managing" class="hidden"></button>
      <button id="context-undo-shortcut"></button>
      <button id="context-history"></button>
      <button id="context-downloads"></button>
      <button id="context-favorites"></button>
      <button id="context-extensions"></button>
      <button id="context-settings"></button>
      <button id="context-export-backup"></button>
      <button id="context-import-backup"></button>
    </div>
  </body>`, { url: 'https://extension.test/' });

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    chrome: globalThis.chrome,
  };
  const removed = [];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    bookmarks: { remove: async (id) => removed.push(id) },
    tabs: { create: async () => ({}) },
  };
  dom.window.confirm = () => true;

  try {
    initContextMenu();
    const bookmark = document.querySelector('.bm-link');
    bookmark.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 20, clientY: 20,
    }));
    assert.equal(document.getElementById('context-edit-bookmark').classList.contains('hidden'), false);
    assert.equal(document.getElementById('context-delete-bookmark').classList.contains('hidden'), false);
    assert.equal(document.getElementById('context-add-shortcut').classList.contains('hidden'), true);

    document.getElementById('context-delete-bookmark').click();
    await nextTurn();
    assert.deepEqual(removed, ['42']);

    document.querySelector('.bm-folder-tab').dispatchEvent(new dom.window.MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 20, clientY: 20,
    }));
    assert.equal(
      document.getElementById('context-rename-bookmark-folder').classList.contains('hidden'),
      false
    );
    assert.equal(document.getElementById('context-delete-bookmark').classList.contains('hidden'), true);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
