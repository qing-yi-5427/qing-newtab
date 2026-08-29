import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('local suggestions do not take over Enter until the user selects one', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <section id="search-section">
      <form id="search-form">
        <input id="search-input">
        <button id="engine-switch" type="button"></button>
        <div id="engine-menu" class="hidden">
          <button class="engine-option" data-engine="bing"></button>
          <button class="engine-option" data-engine="google"></button>
          <button class="engine-option" data-engine="custom"></button>
        </div>
      </form>
      <div id="local-search-results" class="hidden"></div>
    </section>
  </body>`, { url: 'https://extension.test/' });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    chrome: globalThis.chrome,
  };
  const values = new Map();
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (key === null) return Object.fromEntries(values);
          return values.has(key) ? { [key]: values.get(key) } : {};
        },
        async set(items) {
          Object.entries(items).forEach(([key, value]) => values.set(key, value));
        },
        async remove(keys) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => values.delete(key));
        },
      },
    },
    bookmarks: {
      async getTree() {
        return [{ children: [{ title: '常用', children: [
          { id: '1', title: '示例网站', url: 'https://example.com/' },
        ] }] }];
      },
    },
  };

  try {
    const { initSearch } = await import(`../src/search.js?selection=${Date.now()}`);
    initSearch({ searchEngine: 'bing' });
    const input = document.getElementById('search-input');
    input.value = '示例';
    input.focus();
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(100);

    const result = document.querySelector('.local-result');
    assert.ok(result);
    assert.equal(result.classList.contains('active'), false);
    assert.equal(input.hasAttribute('aria-activedescendant'), false);

    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true, cancelable: true,
    }));
    assert.equal(result.classList.contains('active'), true);
    assert.equal(input.getAttribute('aria-activedescendant'), result.id);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
