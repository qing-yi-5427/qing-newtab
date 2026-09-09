/**
 * state.js
 *
 * A tiny synchronous pub/sub used to keep UI fragments in sync whenever the
 * user changes a setting. Modules subscribe with a callback; any writer calls
 * `notifySettingsChanged()` after persisting. This avoids a hard dependency
 * graph (e.g. settings.js <-> search.js) and lets the grid, wallpaper, search
 * switch, and preference controls all react to the same event.
 */

import { getSettings } from './storage.js';

let settingsPreview = {};

/** Display-only overrides stay in this tab; storage, sync and backups never see them. */
export async function getDisplaySettings() {
  return { ...(await getSettings()), ...settingsPreview };
}

export function previewSettings(patch = {}) {
  const keys = Object.keys({ ...settingsPreview, ...patch })
    .filter((key) => settingsPreview[key] !== patch[key]);
  settingsPreview = { ...patch };
  if (keys.length) notifySettingsChanged(keys);
}

/** @type {Set<Function>} */
const subscribers = new Set();

/**
 * Register a callback invoked on every settings change.
 * @param {Function} cb
 * @returns {Function} unsubscribe function
 */
export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Notify all subscribers that settings changed. Swallows subscriber errors. */
export function notifySettingsChanged(changedKeys = null) {
  subscribers.forEach((cb) => {
    try {
      const result = cb(changedKeys);
      result?.catch?.(() => {});
    } catch (e) {
      /* a broken subscriber must not break others */
    }
  });
}
