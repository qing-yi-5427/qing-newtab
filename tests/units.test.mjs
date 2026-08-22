/**
 * units.test.mjs — pure-function unit tests (node --test, no browser).
 *
 * These import the exported deterministic logic straight from src/*.js so they
 * run in plain Node (no DOM / no chrome) and act as a reliable backbone for
 * the runtime behaviours verified separately by the jsdom integration tests.
 *
 * Covered:
 *   - favicon letter-avatar SVG shape + uppercase first letter
 *   - favicon colorFor() stable hash (same input → same colour)
 *   - favicon hostFromUrl() host extraction (www. stripped, invalid → '')
 *   - config.SEARCH_ENGINES build() for bing / google / custom(%s) / no-%s
 *   - config.DEFAULT_SHORTCUTS / DEFAULT_SETTINGS schema
 *   - storage.KEYS namespacing (decision ⑦: chrome.storage.local + prefix nt_)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  letterAvatarSVG,
  colorFor,
  faviconCandidates,
  fetchFaviconDataUrl,
  hostFromUrl,
  isPrivateIconHost,
} from '../src/favicon.js';
import { SEARCH_ENGINES, DEFAULT_SHORTCUTS, DEFAULT_SETTINGS } from '../src/config.js';
import {
  getSettings,
  getCustomWallpaper,
  getShortcuts,
  KEYS,
  migrateLocalStorage,
  saveShortcuts,
} from '../src/storage.js';
import { normalizeShortcutUrl } from '../src/shortcuts.js';
import { chatCompletionsUrl } from '../src/assistant.js';
import { collectGroups } from '../src/bookmarks.js';
import { importLocalBookmarks, isLocalNetworkUrl, parseITabBackup } from '../src/itab-import.js';
import { WEB_CHAT_PROVIDERS, webChatProvider } from '../src/web-chat.js';

// ---------------------------------------------------------------------------
// favicon.js
// ---------------------------------------------------------------------------

test('letterAvatarSVG returns an inline SVG with default 40px viewBox', () => {
  const svg = letterAvatarSVG('GitHub', 40);
  assert.equal(typeof svg, 'string');
  assert.ok(svg.startsWith('<svg'), 'should start with <svg');
  assert.ok(svg.includes('viewBox="0 0 40 40"'), 'viewBox should be 40x40');
  assert.ok(svg.includes('width="40"') && svg.includes('height="40"'));
  assert.ok(svg.includes('role="img"'));
});

test('letterAvatarSVG uppercases the first letter of the label', () => {
  assert.ok(letterAvatarSVG('GitHub', 40).includes('>G<'));
  assert.ok(letterAvatarSVG('github', 40).includes('>G<')); // lower input still → G
  assert.ok(letterAvatarSVG('zhihu', 40).includes('>Z<'));
  assert.ok(letterAvatarSVG('bilibili', 40).includes('>B<'));
});

test('letterAvatarSVG honours the size argument', () => {
  const svg = letterAvatarSVG('X', 32);
  assert.ok(svg.includes('width="32"') && svg.includes('height="32"'));
  assert.ok(svg.includes('viewBox="0 0 40 40"')); // viewBox stays fixed at 40
});

test('colorFor is a deterministic hash (same input → identical colour)', () => {
  const a = colorFor('github.com');
  const b = colorFor('github.com');
  assert.equal(a, b, 'same domain must map to same colour');
  assert.ok(a.startsWith('#') && a.length === 7, 'colour is a #rrggbb hex');
});

test('colorFor output always comes from the AA palette', async () => {
  const { LETTER_PALETTE } = await import('../src/config.js');
  for (const d of ['github.com', 'google.com', 'x.com', 'example.com', 'a', 'ZZZ', '123']) {
    assert.ok(LETTER_PALETTE.includes(colorFor(d)), `palette should contain colour for ${d}`);
  }
});

test('hostFromUrl strips www. and extracts clean host', () => {
  assert.equal(hostFromUrl('https://www.github.com/foo'), 'github.com');
  assert.equal(hostFromUrl('http://example.com'), 'example.com');
  assert.equal(hostFromUrl('https://sub.example.co.uk/path?x=1'), 'sub.example.co.uk');
});

test('hostFromUrl returns empty string for invalid input', () => {
  assert.equal(hostFromUrl('not a url'), '');
  assert.equal(hostFromUrl(''), '');
});

test('favicon resolution prefers high-resolution site icons and rejects non-web schemes', async () => {
  const candidates = faviconCandidates('https://www.example.com/path?q=1');
  assert.deepEqual(candidates, [
    'https://favicon.im/example.com?larger=true&throw-error-on-404=true',
    'https://www.example.com/apple-touch-icon.png',
    'https://www.example.com/favicon-192x192.png',
    'https://www.example.com/favicon.svg',
    'https://www.example.com/favicon-96x96.png',
    'https://www.example.com/favicon.png',
    'https://www.example.com/favicon.ico',
    'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fwww.example.com&sz=128',
  ]);
  assert.equal(await fetchFaviconDataUrl('https://www.example.com/path?q=1'), candidates[0]);
  assert.deepEqual(faviconCandidates('chrome://bookmarks/'), []);
  assert.equal(await fetchFaviconDataUrl('chrome://bookmarks/'), null);
});

test('favicon resolution keeps private hosts away from public icon services', () => {
  assert.equal(isPrivateIconHost('192.168.1.10'), true);
  assert.equal(isPrivateIconHost('nas.local'), true);
  assert.equal(isPrivateIconHost('github.com'), false);
  const candidates = faviconCandidates('http://192.168.1.10:8080/dashboard');
  assert.equal(candidates.some((url) => url.includes('favicon.im') || url.includes('google.com')), false);
  assert.equal(candidates[0], 'http://192.168.1.10:8080/apple-touch-icon.png');
});

test('favicon resolution falls back from a subdomain to its parent domain', () => {
  const candidates = faviconCandidates('https://bbs.example.com/thread/1');
  assert.equal(candidates.includes('https://favicon.im/bbs.example.com?larger=true&throw-error-on-404=true'), true);
  assert.equal(candidates.includes('https://favicon.im/example.com?larger=true&throw-error-on-404=true'), true);
});

// ---------------------------------------------------------------------------
// config.js — search engines
// ---------------------------------------------------------------------------

test('SEARCH_ENGINES.bing builds the correct Bing URL', () => {
  assert.equal(
    SEARCH_ENGINES.bing.build('hello world'),
    'https://www.bing.com/search?q=hello%20world'
  );
});

test('SEARCH_ENGINES.google builds the correct Google URL', () => {
  assert.equal(
    SEARCH_ENGINES.google.build('hello world'),
    'https://www.google.com/search?q=hello%20world'
  );
});

test('SEARCH_ENGINES.custom replaces %s with the encoded query', () => {
  assert.equal(
    SEARCH_ENGINES.custom.build('node js', 'https://www.google.com/search?q=%s'),
    'https://www.google.com/search?q=node%20js'
  );
});

test('SEARCH_ENGINES.custom falls back to the default template when none given', () => {
  assert.equal(
    SEARCH_ENGINES.custom.build('q'),
    'https://www.google.com/search?q=q'
  );
});

test('SEARCH_ENGINES.custom appends ?q= when template has no %s', () => {
  assert.equal(
    SEARCH_ENGINES.custom.build('q', 'https://duckduckgo.com/search'),
    'https://duckduckgo.com/search?q=q'
  );
});

test('SEARCH_ENGINES.custom appends &q= when template already has a query', () => {
  assert.equal(
    SEARCH_ENGINES.custom.build('q', 'https://x.com/s?foo=1'),
    'https://x.com/s?foo=1&q=q'
  );
});

test('SEARCH_ENGINES.custom rejects executable URL schemes', () => {
  assert.equal(
    SEARCH_ENGINES.custom.build('safe query', 'javascript:alert(%s)'),
    'https://www.google.com/search?q=safe%20query'
  );
});

test('normalizeShortcutUrl accepts web URLs and rejects executable schemes', () => {
  assert.equal(normalizeShortcutUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeShortcutUrl('http://example.com/path'), 'http://example.com/path');
  assert.equal(normalizeShortcutUrl('javascript:alert(1)'), '');
  assert.equal(normalizeShortcutUrl('data:text/html,test'), '');
});

test('chatCompletionsUrl accepts a base address or a full endpoint', () => {
  assert.equal(chatCompletionsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
  assert.equal(chatCompletionsUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions');
  assert.equal(chatCompletionsUrl('javascript:alert(1)'), '');
});

test('web chat providers use the supported official entry pages', () => {
  assert.deepEqual(Object.keys(WEB_CHAT_PROVIDERS), ['deepseek', 'kimi', 'mimo', 'glm']);
  assert.equal(webChatProvider('deepseek').url, 'https://chat.deepseek.com/');
  assert.equal(webChatProvider('kimi').url, 'https://www.kimi.com/');
  assert.equal(webChatProvider('mimo').url, 'https://aistudio.xiaomimimo.com/');
  assert.equal(webChatProvider('glm').url, 'https://chatglm.cn/');
  assert.equal(webChatProvider('unknown').label, 'DeepSeek');
});

test('bookmark groups display only the current folder name', () => {
  const groups = collectGroups([{
    title: '收藏夹栏',
    children: [
      { title: '根部书签', url: 'https://root.example/' },
      { title: 'NYAA', children: [{ title: '站点', url: 'https://nyaa.example/' }] },
    ],
  }]);
  assert.deepEqual(groups.map((group) => group.title), ['收藏夹栏', 'NYAA']);
  assert.deepEqual(groups.map((group) => group.key), ['收藏夹栏', '收藏夹栏/NYAA']);
});

test('iTab import keeps first-page web links and private second-page links', () => {
  const parsed = parseITabBackup({ navConfig: [
    { children: [
      { name: '站点', url: 'https://example.com/path' },
      { name: '历史', url: 'chrome://history/' },
      { component: 'bookmarks' },
    ] },
    { children: [
      { name: '路由器', url: 'http://192.168.1.1/' },
      { name: '公网', url: 'https://example.org/' },
    ] },
  ] });
  assert.deepEqual(parsed.shortcuts, [
    { name: '站点', url: 'https://example.com/path', size: '1x1', icon: null },
  ]);
  assert.deepEqual(parsed.localBookmarks, [
    { name: '路由器', url: 'http://192.168.1.1/' },
  ]);
});

test('local network detection covers private addresses without treating public pages as local', () => {
  for (const url of [
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://172.31.255.254',
    'http://192.168.66.153:8066/',
    'http://localhost:3000',
    'http://nas.local/',
  ]) assert.equal(isLocalNetworkUrl(url), true, url);
  assert.equal(isLocalNetworkUrl('https://example.com/'), false);
  assert.equal(isLocalNetworkUrl('http://172.32.0.1/'), false);
});

test('local bookmark import creates one folder and skips duplicate URLs', async () => {
  const created = [];
  const api = {
    async getTree() {
      return [{ id: '0', children: [{ id: '1', title: '收藏夹栏', children: [] }] }];
    },
    async getChildren(id) {
      if (id === '1') return created.filter((item) => item.parentId === '1');
      return [{ id: 'old', title: '已有', url: 'http://192.168.1.1/' }];
    },
    async create(item) {
      const node = { id: `new-${created.length}`, ...item };
      created.push(node);
      return node;
    },
  };
  const result = await importLocalBookmarks([
    { name: '路由器', url: 'http://192.168.1.1/' },
    { name: '主机', url: 'http://192.168.1.2/' },
  ], api);
  assert.deepEqual(result, { created: 1, skipped: 1, total: 2 });
  assert.equal(created[0].title, 'local');
  assert.equal(created[1].title, '主机');
});

// ---------------------------------------------------------------------------
// config.js — defaults schema
// ---------------------------------------------------------------------------

test('DEFAULT_SHORTCUTS has the 6 expected entries', () => {
  assert.equal(DEFAULT_SHORTCUTS.length, 6);
  const names = DEFAULT_SHORTCUTS.map((s) => s.name);
  for (const n of ['GitHub', 'YouTube', 'Twitter', 'Reddit', '知乎', '哔哩哔哩']) {
    assert.ok(names.includes(n), `missing shortcut ${n}`);
  }
  for (const s of DEFAULT_SHORTCUTS) assert.equal(s.size, '1x1');
});

test('DEFAULT_SETTINGS matches the locked decisions', () => {
  assert.equal(DEFAULT_SETTINGS.theme, 'system'); // ③ three-state
  assert.equal(DEFAULT_SETTINGS.wallpaperEnabled, true); // ② wallpaper toggle
  assert.equal(DEFAULT_SETTINGS.searchEngine, 'bing'); // ④ default engine
  assert.ok(DEFAULT_SETTINGS.customEngineUrl.includes('%s'), 'custom template keeps %s'); // ④
  assert.equal(DEFAULT_SETTINGS.iconMode, 'favicon');
  assert.equal(DEFAULT_SETTINGS.wallpaperSource, 'bing');
  assert.equal(DEFAULT_SETTINGS.wallpaperDim, 45);
  assert.equal(DEFAULT_SETTINGS.llmApiKey, '');
  assert.equal(DEFAULT_SETTINGS.llmProvider, 'deepseek');
});

// ---------------------------------------------------------------------------
// storage.js — key namespacing (decision ⑦)
// ---------------------------------------------------------------------------

test('KEYS namespace shortcuts/settings under nt_', () => {
  assert.equal(KEYS.shortcuts, 'nt_shortcuts');
  assert.equal(KEYS.settings, 'nt_settings');
  assert.equal(KEYS.customWallpaper, 'nt_custom_wallpaper');
});

test('KEYS.wallpaper is keyed by local date (cache-by-date, decision ②)', () => {
  assert.equal(KEYS.wallpaper('2025-07-11'), 'nt_wallpaper_2025-07-11');
  assert.equal(KEYS.wallpaper('2024-12-31'), 'nt_wallpaper_2024-12-31');
});

test('KEYS.favicon is keyed by domain', () => {
  assert.equal(KEYS.favicon('github.com'), 'nt_favicon_github.com');
});

test('an intentionally empty shortcut list stays empty', async () => {
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    get length() { return values.size; },
    key: (i) => Array.from(values.keys())[i] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    await saveShortcuts([]);
    assert.deepEqual(await getShortcuts(), []);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('schema migration enables site icons and localises untouched default names', async () => {
  const values = new Map([
    [KEYS.settings, JSON.stringify({ iconMode: 'letter', theme: 'system', customWallpaper: 'data:image/png;base64,abc' })],
    [KEYS.shortcuts, JSON.stringify([
      { name: 'Zhihu', url: 'https://www.zhihu.com/', size: '2x2' },
      { name: 'Bilibili', url: 'https://www.bilibili.com/', size: '1x2' },
      { name: 'My Zhihu', url: 'https://www.zhihu.com/', size: '1x1' },
    ])],
  ]);
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    get length() { return values.size; },
    key: (i) => Array.from(values.keys())[i] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    await migrateLocalStorage();
    assert.equal((await getSettings()).iconMode, 'favicon');
    assert.equal(await getCustomWallpaper(), 'data:image/png;base64,abc');
    assert.equal('customWallpaper' in JSON.parse(values.get(KEYS.settings)), false);
    assert.equal(JSON.parse(values.get(KEYS.schemaVersion)), 5);
    assert.deepEqual((await getShortcuts()).map((shortcut) => shortcut.name), [
      '知乎',
      '哔哩哔哩',
      'My Zhihu',
    ]);
    assert.deepEqual((await getShortcuts()).map((shortcut) => shortcut.size), ['1x1', '1x1', '1x1']);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
