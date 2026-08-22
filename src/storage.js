/**
 * storage.js
 *
 * Thin async wrapper over `chrome.storage.local` (Manifest V3) with a
 * transparent `localStorage` fallback so the page also works when opened
 * directly as a file. Also owns the one-time migration of legacy
 * `localStorage` shortcut data into the new storage backend.
 *
 * Storage keys are namespaced via `KEYS` so they stay consistent across modules.
 */

import { DEFAULT_SHORTCUTS, DEFAULT_SETTINGS } from './config.js';

/** Whether the chrome.storage.local backend is available. */
const hasChrome =
  typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);
let settingsCache = null;

// ---------------------------------------------------------------------------
// Low-level get/set
// ---------------------------------------------------------------------------

/**
 * @param {string} key
 * @param {*} def
 * @returns {Promise<*>}
 */
async function rawGet(key, def) {
  if (hasChrome) {
    const r = await chrome.storage.local.get(key);
    return key in r ? r[key] : def;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? def : JSON.parse(raw);
  } catch {
    return def;
  }
}

/**
 * @param {string} key
 * @param {*} val
 * @returns {Promise<void>}
 */
async function rawSet(key, val) {
  if (hasChrome) {
    await chrome.storage.local.set({ [key]: val });
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* quota or unavailable — ignore */
  }
}

/** @returns {Promise<Record<string, *>>} */
async function rawGetAll() {
  if (hasChrome) return chrome.storage.local.get(null);
  const result = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      try {
        result[key] = JSON.parse(localStorage.getItem(key));
      } catch {
        // Ignore values not owned by this extension's JSON storage wrapper.
      }
    }
  } catch {
    // localStorage can be unavailable for direct-file previews.
  }
  return result;
}

/** @param {string[]} keys */
async function rawRemove(keys) {
  if (!keys.length) return;
  if (hasChrome) {
    await chrome.storage.local.remove(keys);
    return;
  }
  try {
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore unavailable fallback storage.
  }
}

/** Keep only the newest cache entries for the supplied key prefix. */
async function pruneCache(prefix, maxEntries) {
  const all = await rawGetAll();
  const entries = Object.entries(all)
    .filter(([key]) => key.startsWith(prefix))
    .sort(([, a], [, b]) => (b?.cachedAt || 0) - (a?.cachedAt || 0));
  await rawRemove(entries.slice(maxEntries).map(([key]) => key));
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

export const KEYS = {
  shortcuts: 'nt_shortcuts',
  settings: 'nt_settings',
  customWallpaper: 'nt_custom_wallpaper',
  schemaVersion: 'nt_schema_version',
  /** Wallpaper cached by local date string (YYYY-MM-DD). */
  wallpaper: (date) => `nt_wallpaper_${date}`,
  /** Favicon data URL cached by domain. */
  favicon: (domain) => `nt_favicon_${domain}`,
};

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

/** @returns {Promise<Array>} */
export async function getShortcuts() {
  const list = await rawGet(KEYS.shortcuts, null);
  if (Array.isArray(list)) return list;
  return DEFAULT_SHORTCUTS.map((s) => ({ ...s, icon: null }));
}

/** @param {Array} list */
export async function saveShortcuts(list) {
  await rawSet(KEYS.shortcuts, list);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** @returns {Promise<object>} merged with defaults */
export async function getSettings() {
  if (settingsCache) return { ...settingsCache };
  const s = await rawGet(KEYS.settings, {});
  settingsCache = { ...DEFAULT_SETTINGS, ...s };
  return { ...settingsCache };
}

/** @param {object} s */
export async function saveSettings(s) {
  settingsCache = { ...DEFAULT_SETTINGS, ...s };
  await rawSet(KEYS.settings, settingsCache);
}

export async function getCustomWallpaper() {
  const value = await rawGet(KEYS.customWallpaper, '');
  return typeof value === 'string' && value.startsWith('data:image/') ? value : '';
}

export async function saveCustomWallpaper(value) {
  const safe = typeof value === 'string' && value.startsWith('data:image/') ? value : '';
  await rawSet(KEYS.customWallpaper, safe);
}

// ---------------------------------------------------------------------------
// Wallpaper cache (by date)
// ---------------------------------------------------------------------------

export async function getCachedWallpaper(date) {
  const cached = await rawGet(KEYS.wallpaper(date), null);
  return typeof cached === 'string' ? cached : cached?.url || null;
}

export async function setCachedWallpaper(date, url) {
  await rawSet(KEYS.wallpaper(date), { url, cachedAt: Date.now() });
  await pruneCache('nt_wallpaper_', 7);
}

// ---------------------------------------------------------------------------
// Favicon cache (by domain)
// ---------------------------------------------------------------------------

export async function getCachedFavicon(domain) {
  const cached = await rawGet(KEYS.favicon(domain), null);
  return typeof cached === 'string' ? cached : cached?.dataUrl || null;
}

export async function setCachedFavicon(domain, url) {
  await rawSet(KEYS.favicon(domain), { dataUrl: url, cachedAt: Date.now() });
  await pruneCache('nt_favicon_', 128);
}

/** Remove wallpaper/favicon caches without touching user settings or shortcuts. */
export async function clearCaches() {
  const all = await rawGetAll();
  const keys = Object.keys(all).filter(
    (key) => key.startsWith('nt_wallpaper_') || key.startsWith('nt_favicon_')
  );
  await rawRemove(keys);
  return keys.length;
}

/** Return a portable backup object containing only user-owned configuration. */
export async function createBackup() {
  const settings = await getSettings();
  const { llmApiKey: _privateKey, ...safeSettings } = settings;
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: safeSettings,
    customWallpaper: await getCustomWallpaper(),
    shortcuts: await getShortcuts(),
  };
}

// ---------------------------------------------------------------------------
// One-time migration from legacy localStorage
// ---------------------------------------------------------------------------

/**
 * Imports legacy `newtab_shortcuts` data (old single-file version) into the
 * new backend exactly once, then removes it. The FOUC theme cache
 * (`nt_theme`) is intentionally left untouched.
 * @returns {Promise<void>}
 */
export async function migrateLocalStorage() {
  try {
    const legacy = localStorage.getItem('newtab_shortcuts');
    if (legacy) {
      const list = JSON.parse(legacy);
      if (Array.isArray(list) && list.length) {
        const current = await rawGet(KEYS.shortcuts, null);
        if (!current) {
          await rawSet(KEYS.shortcuts, list);
        }
      }
      localStorage.removeItem('newtab_shortcuts');
    }
  } catch {
    /* nothing to migrate */
  }

  // v2 changes the default icon strategy from letters to site-owned favicons.
  const version = await rawGet(KEYS.schemaVersion, 1);
  if (version < 2) {
    const settings = await rawGet(KEYS.settings, {});
    settings.iconMode = 'favicon';
    await rawSet(KEYS.settings, settings);
    await rawSet(KEYS.schemaVersion, 2);
  }

  // v3 localises default shortcut names without touching custom user labels.
  const currentVersion = await rawGet(KEYS.schemaVersion, 1);
  if (currentVersion < 3) {
    const shortcuts = await rawGet(KEYS.shortcuts, null);
    if (Array.isArray(shortcuts)) {
      shortcuts.forEach((shortcut) => {
        if (shortcut.name === 'Zhihu' && hostFromStoredUrl(shortcut.url) === 'zhihu.com') {
          shortcut.name = '知乎';
        }
        if (shortcut.name === 'Bilibili' && hostFromStoredUrl(shortcut.url) === 'bilibili.com') {
          shortcut.name = '哔哩哔哩';
        }
      });
      await rawSet(KEYS.shortcuts, shortcuts);
    }
    await rawSet(KEYS.schemaVersion, 3);
  }

  // v4 returns the dashboard to a uniform compact shortcut grid.
  const layoutVersion = await rawGet(KEYS.schemaVersion, 1);
  if (layoutVersion < 4) {
    const shortcuts = await rawGet(KEYS.shortcuts, null);
    if (Array.isArray(shortcuts)) {
      await rawSet(KEYS.shortcuts, shortcuts.map((shortcut) => ({
        ...shortcut,
        size: '1x1',
      })));
    }
    await rawSet(KEYS.schemaVersion, 4);
  }

  // v5 keeps large custom wallpaper data outside the frequently-read settings object.
  const mediaVersion = await rawGet(KEYS.schemaVersion, 1);
  if (mediaVersion < 5) {
    const settings = await rawGet(KEYS.settings, {});
    if (typeof settings.customWallpaper === 'string' && settings.customWallpaper.startsWith('data:image/')) {
      await rawSet(KEYS.customWallpaper, settings.customWallpaper);
    }
    delete settings.customWallpaper;
    await rawSet(KEYS.settings, settings);
    await rawSet(KEYS.schemaVersion, 5);
  }
  settingsCache = null;
}

function hostFromStoredUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
