import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { getSettings, getShortcuts, saveSettings, saveShortcuts } from '../src/storage.js';
import { initShortcuts } from '../src/shortcuts.js';
import { initContextMenu } from '../src/context-menu.js';
import * as state from '../src/state.js';

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

test('right-click edits a shortcut and right-clicking empty space adds one', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="tab-shortcuts"><div id="shortcuts-grid"></div></div>
    <div id="context-menu" class="hidden">
      <button id="context-edit-shortcut" class="hidden"></button>
      <button id="context-add-shortcut"></button>
      <button id="context-settings"></button>
      <button id="context-export-backup"></button>
      <button id="context-import-backup"></button>
    </div>
    <div id="shortcut-editor-modal" class="hidden">
      <form id="shortcut-editor-form">
        <h3 id="shortcut-editor-title"></h3>
        <button id="shortcut-editor-close" type="button"></button>
        <button id="shortcut-editor-icon" type="button"></button>
        <span id="shortcut-editor-icon-preview"></span>
        <button id="shortcut-editor-icon-reset" type="button"></button>
        <input id="shortcut-editor-name" required>
        <input id="shortcut-editor-url" required>
        <button id="shortcut-editor-delete" type="button"></button>
        <button id="shortcut-editor-cancel" type="button"></button>
        <button id="shortcut-editor-save" type="submit"></button>
      </form>
    </div>
    <div id="icon-preview-modal" class="hidden">
      <img id="icon-preview-img">
      <button id="icon-preview-cancel"></button><button id="icon-preview-save"></button>
    </div>
  </body>`, { url: 'https://extension.test/' });

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    Image: globalThis.Image,
    FileReader: globalThis.FileReader,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Image = dom.window.Image;
  globalThis.FileReader = dom.window.FileReader;

  try {
    await saveSettings({ ...(await getSettings()), shortcutColumns: 4, shortcutRows: 3 });
    await saveShortcuts([
      { name: 'One', url: 'https://one.example', size: '1x1', icon: null },
      { name: 'Two', url: 'https://two.example', size: '1x1', icon: null },
      { name: 'Three', url: 'https://three.example', size: '1x1', icon: null },
    ]);
    initShortcuts();
    initContextMenu();
    await nextTurn();
    await nextTurn();

    const grid = document.getElementById('shortcuts-grid');
    assert.equal(grid.querySelectorAll('.shortcut-item').length, 3);
    assert.equal(grid.style.getPropertyValue('--shortcut-rows'), '3');
    assert.equal(grid.style.getPropertyValue('--shortcut-cols'), '1');
    assert.equal(document.getElementById('add-shortcut'), null);

    const firstShortcut = grid.firstElementChild;
    await saveSettings({ ...(await getSettings()), shortcutRows: 4 });
    state.notifySettingsChanged(['shortcutRows']);
    await nextTurn();
    await nextTurn();
    assert.equal(grid.style.getPropertyValue('--shortcut-rows'), '4');
    assert.equal(grid.firstElementChild, firstShortcut, 'layout changes should not rebuild icons');

    grid.querySelectorAll('.shortcut-item')[1].dispatchEvent(new dom.window.MouseEvent(
      'contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }
    ));
    await nextTurn();
    assert.equal(document.getElementById('context-menu').classList.contains('hidden'), false);
    assert.equal(document.getElementById('context-edit-shortcut').classList.contains('hidden'), false);
    document.getElementById('context-edit-shortcut').click();
    await nextTurn();
    assert.equal(document.getElementById('shortcut-editor-title').textContent, '编辑快捷方式');
    assert.equal(document.getElementById('shortcut-editor-name').value, 'Two');

    document.getElementById('shortcut-editor-name').value = 'Two edited';
    document.getElementById('shortcut-editor-form').dispatchEvent(new dom.window.Event(
      'submit', { bubbles: true, cancelable: true }
    ));
    await nextTurn();
    await nextTurn();

    let shortcuts = await getShortcuts();
    assert.equal(shortcuts[1].name, 'Two edited');
    assert.equal(shortcuts[1].size, '1x1');

    document.getElementById('tab-shortcuts').dispatchEvent(new dom.window.MouseEvent(
      'contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }
    ));
    await nextTurn();
    assert.equal(document.getElementById('context-edit-shortcut').classList.contains('hidden'), true);
    document.getElementById('context-add-shortcut').click();
    await nextTurn();
    assert.equal(document.getElementById('shortcut-editor-title').textContent, '添加快捷方式');
    document.getElementById('shortcut-editor-name').value = 'Four';
    document.getElementById('shortcut-editor-url').value = 'four.example';
    document.getElementById('shortcut-editor-form').dispatchEvent(new dom.window.Event(
      'submit', { bubbles: true, cancelable: true }
    ));
    await nextTurn();
    await nextTurn();

    shortcuts = await getShortcuts();
    assert.equal(shortcuts.length, 4);
    assert.equal(shortcuts[3].name, 'Four');
    assert.equal(shortcuts[3].url, 'https://four.example/');
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
