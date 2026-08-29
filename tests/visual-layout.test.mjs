import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { applyHomeLayout } from '../src/layout.js';

test('homepage layout can hide optional modules and move bookmarks before shortcuts', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <section id="clock-section"></section>
    <section id="input-row"><section id="search-section"></section><section id="assistant-section"></section></section>
    <section id="home-dashboard"><section id="shortcuts-section"></section><section id="bookmarks-section"></section></section>
  </body>`);
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    applyHomeLayout({
      showClock: false,
      showAssistant: false,
      showBookmarks: true,
      homeOrder: 'bookmarks-first',
      contentDensity: 'compact',
      bookmarkWidth: 75,
      bookmarkItemWidth: 320,
      bookmarkScale: 135,
    });
    assert.equal(document.getElementById('clock-section').classList.contains('hidden'), true);
    assert.equal(document.getElementById('assistant-section').classList.contains('hidden'), true);
    assert.equal(document.getElementById('input-row').classList.contains('assistant-hidden'), true);
    assert.equal(document.documentElement.dataset.density, 'compact');
    assert.equal(document.documentElement.style.getPropertyValue('--bookmark-width'), '75vw');
    assert.equal(document.documentElement.style.getPropertyValue('--bookmark-item-width'), '320px');
    assert.equal(document.documentElement.style.getPropertyValue('--bookmark-scale'), '1.35');
    assert.equal(document.documentElement.style.getPropertyValue('--bookmark-font-size'), '16.2px');
    assert.equal(document.getElementById('home-dashboard').firstElementChild.id, 'bookmarks-section');

    applyHomeLayout({
      showClock: true,
      showAssistant: true,
      showBookmarks: true,
      homeOrder: 'shortcuts-first',
      contentDensity: 'standard',
      bookmarkWidth: 1,
      bookmarkItemWidth: 2000,
      bookmarkScale: 500,
    });
    assert.equal(document.documentElement.style.getPropertyValue('--bookmark-width'), '20vw');
    assert.equal(document.documentElement.style.getPropertyValue('--bookmark-item-width'), '800px');
    assert.equal(document.documentElement.style.getPropertyValue('--bookmark-scale'), '2');
    assert.equal(document.documentElement.style.getPropertyValue('--bookmark-font-size'), '24px');
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('visual CSS keeps folder-drop labels inside the shortcut scroller', async () => {
  const css = await readFile(new URL('../newtab.css', import.meta.url), 'utf8');
  const paddingMatch = css.match(/#tab-shortcuts\s*\{[^}]*padding:\s*0\s+2px\s+(\d+)px/s);
  const bottomMatch = css.match(/\.shortcut-item\.folder-target::after\s*\{[^}]*bottom:\s*-(\d+)px/s);
  assert.ok(paddingMatch, 'shortcut scroller must reserve bottom space');
  assert.ok(bottomMatch, 'folder drop label must have an explicit offset');
  assert.ok(Number(paddingMatch[1]) > Number(bottomMatch[1]), 'reserved space must exceed label offset');
  assert.match(css, /#input-row\.assistant-hidden/);
  assert.match(css, /:root\[data-density="compact"\]/);
  assert.match(css, /var\(--shortcut-icon-size, 48px\)/);
  assert.match(css, /var\(--bookmark-width, 100vw\)/);
  assert.match(css, /var\(--bookmark-item-width, 240px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
