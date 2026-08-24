/** Structured homepage visibility, order and density preferences. */

import * as storage from './storage.js';
import * as state from './state.js';
import { loadBookmarks } from './bookmarks.js';

const LAYOUT_KEYS = [
  'showClock',
  'showAssistant',
  'showBookmarks',
  'homeOrder',
  'contentDensity',
];

export function applyHomeLayout(settings) {
  const clock = document.getElementById('clock-section');
  const inputRow = document.getElementById('input-row');
  const assistant = document.getElementById('assistant-section');
  const dashboard = document.getElementById('home-dashboard');
  const shortcuts = document.getElementById('shortcuts-section');
  const bookmarks = document.getElementById('bookmarks-section');
  const showClock = settings.showClock !== false;
  const showAssistant = settings.showAssistant !== false;
  const showBookmarks = settings.showBookmarks !== false;

  clock.classList.toggle('hidden', !showClock);
  assistant.classList.toggle('hidden', !showAssistant);
  bookmarks.classList.toggle('hidden', !showBookmarks);
  inputRow.classList.toggle('assistant-hidden', !showAssistant);
  document.body.classList.toggle('clock-hidden', !showClock);
  document.documentElement.dataset.density = settings.contentDensity === 'compact'
    ? 'compact' : 'standard';

  const bookmarksFirst = settings.homeOrder === 'bookmarks-first';
  dashboard.classList.toggle('bookmarks-first', bookmarksFirst);
  if (bookmarksFirst) dashboard.append(bookmarks, shortcuts);
  else dashboard.append(shortcuts, bookmarks);
  if (showBookmarks) void loadBookmarks();
}

export function initHomeLayout(initialSettings) {
  applyHomeLayout(initialSettings);
  state.subscribe(async (changedKeys) => {
    if (changedKeys && !changedKeys.some((key) => LAYOUT_KEYS.includes(key))) return;
    applyHomeLayout(await storage.getSettings());
  });
}
