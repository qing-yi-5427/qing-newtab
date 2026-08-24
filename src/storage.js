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
let faviconPruneTimer = null;
const FAVICON_CACHE_VERSION = 4;
const SNAPSHOT_LIMIT = 6;
const SYNC_META_KEY = 'nt_sync_meta';
const SYNC_SETTINGS_KEY = 'nt_sync_settings';
const SYNC_SHORTCUT_PREFIX = 'nt_sync_shortcuts_';
const SYNC_CHUNK_SIZE = 6000;
const hasSync = hasChrome && !!chrome.storage.sync;
let syncTimer = null;

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
  selectedBookmarkFolder: 'nt_selected_bookmark_folder',
  schemaVersion: 'nt_schema_version',
  shortcutSnapshots: 'nt_shortcut_snapshots',
  dataUpdatedAt: 'nt_data_updated_at',
  /** Wallpaper cached by local date string (YYYY-MM-DD). */
  wallpaper: (date) => `nt_wallpaper_${date}`,
  /** Successful favicon source cached by domain. */
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

async function markDataUpdated() {
  const updatedAt = Date.now();
  await rawSet(KEYS.dataUpdatedAt, updatedAt);
  return updatedAt;
}

async function recordShortcutSnapshot(shortcuts, reason = 'change') {
  if (!Array.isArray(shortcuts)) return;
  const snapshots = await rawGet(KEYS.shortcutSnapshots, []);
  const next = Array.isArray(snapshots) ? snapshots.slice(-(SNAPSHOT_LIMIT - 1)) : [];
  const latest = next.at(-1)?.shortcuts;
  if (latest && JSON.stringify(latest) === JSON.stringify(shortcuts)) return;
  next.push({ createdAt: Date.now(), reason, shortcuts });
  await rawSet(KEYS.shortcutSnapshots, next);
}

/** @param {Array} list */
export async function saveShortcuts(list, { snapshot = true, reason = 'change' } = {}) {
  const current = await rawGet(KEYS.shortcuts, null);
  if (snapshot && Array.isArray(current) && JSON.stringify(current) !== JSON.stringify(list)) {
    await recordShortcutSnapshot(current, reason);
  }
  await rawSet(KEYS.shortcuts, list);
  await markDataUpdated();
  scheduleSyncWrite();
}

/** Restore and consume the newest automatic shortcut snapshot. */
export async function restoreLastShortcutSnapshot() {
  const snapshots = await rawGet(KEYS.shortcutSnapshots, []);
  if (!Array.isArray(snapshots) || !snapshots.length) return null;
  const next = snapshots.slice();
  const latest = next.pop();
  await rawSet(KEYS.shortcutSnapshots, next);
  await rawSet(KEYS.shortcuts, latest.shortcuts);
  await markDataUpdated();
  scheduleSyncWrite();
  return latest.shortcuts;
}

export async function getShortcutSnapshotCount() {
  const snapshots = await rawGet(KEYS.shortcutSnapshots, []);
  return Array.isArray(snapshots) ? snapshots.length : 0;
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
  await markDataUpdated();
  scheduleSyncWrite();
}

function syncedSettings(settings) {
  const {
    llmApiKey: _apiKey,
    syncEnabled: _syncEnabled,
    ...safe
  } = settings;
  return safe;
}

function syncedShortcuts(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item?.type === 'folder' && Array.isArray(item.children)) {
      return { ...item, children: syncedShortcuts(item.children) };
    }
    const icon = typeof item?.icon === 'string' && item.icon.startsWith('data:image/')
      ? null : item?.icon || null;
    return { ...item, icon };
  });
}

function shortcutChunks(shortcuts) {
  const chunks = [];
  let current = [];
  for (const shortcut of shortcuts) {
    const candidate = [...current, shortcut];
    if (current.length && JSON.stringify(candidate).length > SYNC_CHUNK_SIZE) {
      chunks.push(current);
      current = [shortcut];
    } else {
      current = candidate;
    }
  }
  if (current.length || !chunks.length) chunks.push(current);
  return chunks;
}

async function readSyncPayload() {
  if (!hasSync) return null;
  const metaResult = await chrome.storage.sync.get(SYNC_META_KEY);
  const meta = metaResult[SYNC_META_KEY];
  if (!meta?.updatedAt || !Number.isInteger(meta.chunkCount)) return null;
  const chunkKeys = Array.from(
    { length: Math.max(0, meta.chunkCount) },
    (_, index) => `${SYNC_SHORTCUT_PREFIX}${index}`
  );
  const values = await chrome.storage.sync.get([SYNC_SETTINGS_KEY, ...chunkKeys]);
  return {
    updatedAt: Number(meta.updatedAt) || 0,
    settings: values[SYNC_SETTINGS_KEY] || {},
    shortcuts: chunkKeys.flatMap((key) => Array.isArray(values[key]) ? values[key] : []),
  };
}

async function writeSyncPayload() {
  if (!hasSync) return false;
  const [settings, shortcuts] = await Promise.all([getSettings(), getShortcuts()]);
  if (!settings.syncEnabled) return false;
  const chunks = shortcutChunks(syncedShortcuts(shortcuts));
  const oldMeta = (await chrome.storage.sync.get(SYNC_META_KEY))[SYNC_META_KEY];
  const updatedAt = Date.now();
  const values = {
    [SYNC_META_KEY]: { version: 1, updatedAt, chunkCount: chunks.length },
    [SYNC_SETTINGS_KEY]: syncedSettings(settings),
  };
  chunks.forEach((chunk, index) => {
    values[`${SYNC_SHORTCUT_PREFIX}${index}`] = chunk;
  });
  await chrome.storage.sync.set(values);
  const staleKeys = Array.from(
    { length: Math.max(0, Number(oldMeta?.chunkCount) - chunks.length) },
    (_, index) => `${SYNC_SHORTCUT_PREFIX}${chunks.length + index}`
  );
  if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);
  await rawSet(KEYS.dataUpdatedAt, updatedAt);
  return true;
}

function scheduleSyncWrite() {
  if (!hasSync || settingsCache?.syncEnabled === false) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void writeSyncPayload().catch(() => {});
  }, 500);
  syncTimer.unref?.();
}

async function applySyncPayload(payload) {
  if (!payload) return false;
  const currentSettings = await getSettings();
  const currentShortcuts = await rawGet(KEYS.shortcuts, null);
  if (Array.isArray(currentShortcuts)) await recordShortcutSnapshot(currentShortcuts, 'sync');
  settingsCache = {
    ...DEFAULT_SETTINGS,
    ...currentSettings,
    ...payload.settings,
    llmApiKey: currentSettings.llmApiKey,
    syncEnabled: true,
  };
  await rawSet(KEYS.settings, settingsCache);
  if (Array.isArray(payload.shortcuts)) await rawSet(KEYS.shortcuts, payload.shortcuts);
  await rawSet(KEYS.dataUpdatedAt, payload.updatedAt);
  return true;
}

/** Reconcile local data with the browser's optional sync area. */
export async function syncFromBrowser({ preferRemote = false } = {}) {
  if (!hasSync) return { available: false, changed: false };
  const settings = await getSettings();
  if (!settings.syncEnabled) return { available: true, changed: false };
  const remote = await readSyncPayload();
  const localUpdatedAt = Number(await rawGet(KEYS.dataUpdatedAt, 0)) || 0;
  if (remote && (preferRemote || remote.updatedAt > localUpdatedAt)) {
    await applySyncPayload(remote);
    return { available: true, changed: true, source: 'remote' };
  }
  if (!remote || localUpdatedAt > remote.updatedAt) {
    await writeSyncPayload();
    return { available: true, changed: false, source: 'local' };
  }
  return { available: true, changed: false, source: 'same' };
}

export async function setSyncEnabled(enabled) {
  const settings = await getSettings();
  settingsCache = { ...settings, syncEnabled: !!enabled };
  await rawSet(KEYS.settings, settingsCache);
  if (!enabled) {
    clearTimeout(syncTimer);
    syncTimer = null;
    return { available: hasSync, changed: false };
  }
  const remote = await readSyncPayload();
  const localUpdatedAt = Number(await rawGet(KEYS.dataUpdatedAt, 0)) || 0;
  if (remote && remote.updatedAt > localUpdatedAt) {
    await applySyncPayload(remote);
    return { available: true, changed: true, source: 'remote' };
  }
  await markDataUpdated();
  await writeSyncPayload();
  return { available: true, changed: false, source: 'local' };
}

export async function getCustomWallpaper() {
  const value = await rawGet(KEYS.customWallpaper, '');
  return typeof value === 'string' && value.startsWith('data:image/') ? value : '';
}

export async function saveCustomWallpaper(value) {
  const safe = typeof value === 'string' && value.startsWith('data:image/') ? value : '';
  await rawSet(KEYS.customWallpaper, safe);
}

export async function getSelectedBookmarkFolder() {
  const value = await rawGet(KEYS.selectedBookmarkFolder, '');
  return typeof value === 'string' ? value : '';
}

export async function saveSelectedBookmarkFolder(value) {
  await rawSet(KEYS.selectedBookmarkFolder, String(value || ''));
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
  return cached?.version === FAVICON_CACHE_VERSION && typeof cached.url === 'string'
    ? cached.url : null;
}

export async function setCachedFavicon(domain, url) {
  if (!domain || !url) return;
  await rawSet(KEYS.favicon(domain), {
    url,
    version: FAVICON_CACHE_VERSION,
    cachedAt: Date.now(),
  });
  if (!faviconPruneTimer) {
    faviconPruneTimer = setTimeout(() => {
      faviconPruneTimer = null;
      void pruneCache('nt_favicon_', 128).catch(() => {});
    }, 1800);
    faviconPruneTimer.unref?.();
  }
}

/** Read only the requested favicon keys in one storage operation. */
export async function getCachedFavicons(domains) {
  const uniqueDomains = [...new Set((domains || []).filter(Boolean))];
  if (!uniqueDomains.length) return {};
  const keys = uniqueDomains.map(KEYS.favicon);
  let values;
  if (hasChrome) {
    values = await chrome.storage.local.get(keys);
  } else {
    values = Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await rawGet(key, null)])));
  }
  return Object.fromEntries(uniqueDomains.map((domain) => {
    const cached = values[KEYS.favicon(domain)];
    const url = cached?.version === FAVICON_CACHE_VERSION && typeof cached.url === 'string'
      ? cached.url : null;
    return [domain, url];
  }));
}

export async function removeCachedFavicon(domain) {
  if (!domain) return;
  await rawRemove([KEYS.favicon(domain)]);
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
  const {
    llmApiKey: _privateKey,
    syncEnabled: _syncEnabled,
    ...safeSettings
  } = settings;
  return {
    schemaVersion: 2,
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
