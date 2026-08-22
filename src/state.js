/**
 * state.js
 *
 * A tiny synchronous pub/sub used to keep UI fragments in sync whenever the
 * user changes a setting. Modules subscribe with a callback; any writer calls
 * `notifySettingsChanged()` after persisting. This avoids a hard dependency
 * graph (e.g. settings.js <-> search.js) and lets the grid, wallpaper, search
 * switch, and preference controls all react to the same event.
 */

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
      cb(changedKeys);
    } catch (e) {
      /* a broken subscriber must not break others */
    }
  });
}
