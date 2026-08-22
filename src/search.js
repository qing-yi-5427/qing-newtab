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

const SWITCH_ID = 'engine-switch';
const MENU_ID = 'engine-menu';

/** Re-read settings and refresh the in-field engine switch + menu. */
export async function refreshEngineUI() {
  const settings = await storage.getSettings();
  const btn = document.getElementById(SWITCH_ID);
  const menu = document.getElementById(MENU_ID);
  const eng = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.bing;
  if (btn) {
    btn.textContent = eng.letter;
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
  const btn = document.getElementById(SWITCH_ID);
  const menu = document.getElementById(MENU_ID);

  if (form && input) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const settings = await storage.getSettings();
      if (isUrl(q)) {
        window.location.href = /^https?:\/\//i.test(q) ? q : 'https://' + q;
        return;
      }
      window.location.href = buildQueryUrl(q, settings);
    });
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
