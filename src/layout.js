/** Structured homepage visibility, order and density preferences. */

import * as storage from './storage.js';
import * as state from './state.js';
import { loadBookmarks } from './bookmarks.js';
import { SIZE_LIMITS } from './config.js';

const LAYOUT_KEYS = [
  'showClock',
  'showAssistant',
  'showBookmarks',
  'homeOrder',
  'contentDensity',
  'bookmarkWidth',
  'bookmarkItemWidth',
  'bookmarkScale',
];

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

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
  const bookmarkWidth = numberInRange(
    settings.bookmarkWidth, SIZE_LIMITS.bookmarkWidth.min, SIZE_LIMITS.bookmarkWidth.max, 100
  );
  const bookmarkItemWidth = numberInRange(
    settings.bookmarkItemWidth,
    SIZE_LIMITS.bookmarkItemWidth.min,
    SIZE_LIMITS.bookmarkItemWidth.max,
    240
  );
  const bookmarkScale = numberInRange(
    settings.bookmarkScale, SIZE_LIMITS.bookmarkScale.min, SIZE_LIMITS.bookmarkScale.max, 100
  ) / 100;
  document.documentElement.style.setProperty('--bookmark-width', `${bookmarkWidth}vw`);
  document.documentElement.style.setProperty('--bookmark-item-width', `${bookmarkItemWidth}px`);
  document.documentElement.style.setProperty('--bookmark-scale', String(bookmarkScale));
  const bookmarkFontSize = Number((12 * bookmarkScale).toFixed(2));
  document.documentElement.style.setProperty('--bookmark-font-size', `${bookmarkFontSize}px`);

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
