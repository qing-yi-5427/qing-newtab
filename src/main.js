/**
 * main.js — entry point.
 *
 * Orchestrates initialisation in dependency order (architect's appendix B):
 *   storage migrate -> settings -> clock -> wallpaper -> search -> shortcuts
 *   -> assistant -> shortcuts -> bookmarks -> settings -> context menu.
 *
 * Builds to a single IIFE (`newtab.js`) via esbuild; this file is the bundle
 * entry and uses only native DOM + chrome.* APIs (no runtime framework).
 */

import * as storage from './storage.js';
import * as state from './state.js';
import { initClock } from './clock.js';
import { initSearch } from './search.js';
import { initShortcuts } from './shortcuts.js';
import { initBookmarks, loadBookmarks } from './bookmarks.js';
import { initWallpaper } from './wallpaper.js';
import { initSettings, applyTheme } from './settings.js';
import { initContextMenu } from './context-menu.js';
import { initAssistant } from './assistant.js';
import { initToast } from './toast.js';

/** Application bootstrap. */
async function main() {
  // One-time legacy data migration, then resolve settings.
  await storage.migrateLocalStorage();
  const settings = await storage.getSettings();

  // Apply theme before first paint of dynamic content.
  applyTheme(settings.theme);

  initClock();
  initToast();
  initWallpaper();
  initSearch();
  initAssistant();
  initShortcuts();
  initBookmarks();
  initSettings();
  initContextMenu();
  loadBookmarks();

  // Entrance stagger runs only on first paint (removed shortly after).
  document.body.classList.add('first-load');
  setTimeout(() => document.body.classList.remove('first-load'), 1200);

  // Global: '/' focuses search.
  const searchInput = document.getElementById('search-input');
  document.addEventListener('keydown', (e) => {
    const target = /** @type {HTMLElement|null} */ (e.target);
    const isEditing = !!target && (
      target.matches('input, textarea, select') || target.isContentEditable
    );
    const modalOpen = document.querySelector('.modal:not(.hidden)');
    if (
      e.key === '/' &&
      !e.metaKey && !e.ctrlKey && !e.altKey &&
      !isEditing && !modalOpen &&
      document.activeElement !== searchInput
    ) {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
