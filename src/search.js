/**
 * search.js
 *
 * Search-box behaviour: submits the query using the currently selected engine
 * (Bing / Google / Custom), with lightweight URL detection so bare hosts are
 * navigated to directly. Exposes an in-field engine switcher (a small button
 * + dropdown menu) kept in sync with stored settings via the shared state bus.
 */

import { SEARCH_ENGINES } from './config.js';
import * as storage from './storage.js';
import * as state from './state.js';
import {
  initLocalSearchInvalidation,
  searchLocalItems,
} from './local-search.js';
import { openBrowserPage } from './browser-pages.js';

const SWITCH_ID = 'engine-switch';
const MENU_ID = 'engine-menu';

/** Re-read settings and refresh the in-field engine switch + menu. */
export async function refreshEngineUI() {
  const settings = await storage.getSettings();
  const btn = document.getElementById(SWITCH_ID);
  const menu = document.getElementById(MENU_ID);
  const eng = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.bing;
  if (btn) {
    btn.textContent = eng.label;
    btn.setAttribute('aria-label', `搜索引擎：${eng.label}`);
  }
  if (menu) {
    menu.querySelectorAll('.engine-option').forEach((opt) => {
      const on = opt.dataset.engine === settings.searchEngine;
      opt.setAttribute('aria-checked', on ? 'true' : 'false');
      opt.classList.toggle('active', on);
    });
  }
}

/** Crude URL heuristic used to navigate directly instead of searching. */
function isUrl(q) {
  if (/^https?:\/\//i.test(q)) return true;
  return /^[\w-]+(\.[\w-]+)+([\w.,@?^=%&:/~+#-]*)?$/i.test(q) && q.includes('.');
}

/** Build the destination URL for a query using stored settings. */
function buildQueryUrl(q, settings) {
  const eng = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.bing;
  if (settings.searchEngine === 'custom') return eng.build(q, settings.customEngineUrl);
  return eng.build(q);
}

/** Wire the search form and engine switcher. */
export function initSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  const localResults = document.getElementById('local-search-results');
  const btn = document.getElementById(SWITCH_ID);
  const menu = document.getElementById(MENU_ID);
  let currentResults = [];
  let activeResult = -1;
  let searchVersion = 0;

  function hideLocalResults() {
    currentResults = [];
    activeResult = -1;
    localResults.innerHTML = '';
    localResults.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActiveResult(index) {
    if (!currentResults.length) return;
    activeResult = (index + currentResults.length) % currentResults.length;
    localResults.querySelectorAll('.local-result').forEach((button, buttonIndex) => {
      const active = buttonIndex === activeResult;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) input.setAttribute('aria-activedescendant', button.id);
    });
  }

  async function openResult(item) {
    hideLocalResults();
    if (item.type === 'browser') {
      await openBrowserPage(item.action);
      return;
    }
    window.location.href = item.url;
  }

  function renderLocalResults(results) {
    currentResults = results;
    activeResult = -1;
    localResults.innerHTML = '';
    if (!results.length) {
      hideLocalResults();
      return;
    }
    const typeLabels = { shortcut: '快捷方式', bookmark: '书签', browser: '浏览器' };
    results.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `local-search-result-${index}`;
      button.className = 'local-result';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      const text = document.createElement('span');
      text.className = 'local-result-text';
      const label = document.createElement('strong');
      label.textContent = item.label;
      const detail = document.createElement('small');
      detail.textContent = item.detail;
      text.append(label, detail);
      const type = document.createElement('span');
      type.className = 'local-result-type';
      type.textContent = typeLabels[item.type] || '本地';
      button.append(text, type);
      button.addEventListener('pointerenter', () => setActiveResult(index));
      button.addEventListener('click', () => void openResult(item));
      localResults.appendChild(button);
    });
    localResults.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    setActiveResult(0);
  }

  async function refreshLocalResults() {
    const version = ++searchVersion;
    const query = input.value.trim();
    if (!query) {
      hideLocalResults();
      return;
    }
    const results = await searchLocalItems(query, 8);
    if (version === searchVersion && document.activeElement === input) renderLocalResults(results);
  }

  if (form && input) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (activeResult >= 0 && currentResults[activeResult]) {
        await openResult(currentResults[activeResult]);
        return;
      }
      const q = input.value.trim();
      if (!q) return;
      hideLocalResults();
      const settings = await storage.getSettings();
      if (isUrl(q)) {
        window.location.href = /^https?:\/\//i.test(q) ? q : 'https://' + q;
        return;
      }
      window.location.href = buildQueryUrl(q, settings);
    });
    input.addEventListener('input', () => void refreshLocalResults());
    input.addEventListener('focus', () => void refreshLocalResults());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && currentResults.length) {
        event.preventDefault();
        setActiveResult(activeResult + 1);
      } else if (event.key === 'ArrowUp' && currentResults.length) {
        event.preventDefault();
        setActiveResult(activeResult - 1);
      } else if (event.key === 'Escape') {
        hideLocalResults();
      }
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#search-section')) hideLocalResults();
    });
    initLocalSearchInvalidation();
  }

  if (btn && menu) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    menu.querySelectorAll('.engine-option').forEach((opt) => {
      opt.addEventListener('click', async () => {
        const engine = opt.dataset.engine;
        const settings = await storage.getSettings();
        settings.searchEngine = engine;
        await storage.saveSettings(settings);
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        state.notifySettingsChanged(['searchEngine']);
      });
    });

    // Close the menu on outside click.
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    // Keyboard: open with Enter/Space/ArrowDown.
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        menu.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        const first = menu.querySelector('.engine-option');
        if (first) first.focus();
      }
    });

    menu.addEventListener('keydown', (e) => {
      const opts = Array.from(menu.querySelectorAll('.engine-option'));
      const idx = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        opts[(idx + 1) % opts.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        opts[(idx - 1 + opts.length) % opts.length].focus();
      } else if (e.key === 'Escape') {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      }
    });
  }

  // Keep the switch in sync when settings change elsewhere (e.g. Preferences).
  state.subscribe((changedKeys) => {
    if (!changedKeys || changedKeys.some((key) => ['searchEngine', 'customEngineUrl'].includes(key))) {
      refreshEngineUI();
    }
  });
  refreshEngineUI();
}
