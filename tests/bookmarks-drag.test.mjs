import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

test('pointer dragging reorders bookmarks and persists the destination', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <span id="bookmarks-count"></span>
    <div id="bookmarks-tree"></div>
  </body>`, { url: 'https://extension.test/' });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    chrome: globalThis.chrome,
  };
  const moves = [];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.chrome = {
    bookmarks: {
      async getTree() {
        return [{ id: '0', children: [{
          id: '1', parentId: '0', title: '收藏夹栏', index: 0, children: [
            { id: 'a', parentId: '1', index: 0, title: '甲', url: 'https://a.example/' },
            { id: 'b', parentId: '1', index: 1, title: '乙', url: 'https://b.example/' },
            { id: 'c', parentId: '1', index: 2, title: '丙', url: 'https://c.example/' },
          ],
        }] }];
      },
      async move(id, destination) {
        moves.push([id, destination]);
      },
    },
  };

  try {
    const bookmarks = await import(`../src/bookmarks.js?pointer-test=${Date.now()}`);
    bookmarks.initBookmarks();
    await bookmarks.loadBookmarks();
    const source = document.querySelector('[data-bookmark-id="a"]');
    const target = document.querySelector('[data-bookmark-id="c"]');
    assert.ok(source?.classList.contains('bookmark-draggable'));
    assert.equal(source.draggable, false);

    target.getBoundingClientRect = () => ({ left: 100, width: 100 });
    document.elementFromPoint = () => target;
    source.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 10, clientY: 10,
    }));
    source.dispatchEvent(new dom.window.MouseEvent('pointermove', {
      bubbles: true, cancelable: true, clientX: 180, clientY: 10,
    }));
    assert.equal(target.classList.contains('drop-after'), true);
    source.dispatchEvent(new dom.window.MouseEvent('pointerup', {
      bubbles: true, cancelable: true, clientX: 180, clientY: 10,
    }));
    await nextTurn();

    assert.deepEqual(moves, [['a', { parentId: '1', index: 2 }]]);
    assert.equal(document.querySelector('.bm-items').lastElementChild, source);
    // Let the debounced browser-bookmark refresh finish before removing the test DOM.
    await new Promise((resolve) => setTimeout(resolve, 120));
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
