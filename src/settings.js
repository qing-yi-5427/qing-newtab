/**
 * settings.js
 *
 * Settings dialog: ARIA dialog with focus trap, plus the "Preferences" section
 * (theme / daily wallpaper / search engine / shortcut icon mode). Shortcut
 * editing intentionally lives on the page itself instead of in this dialog.
 */

import * as storage from './storage.js';
import * as state from './state.js';
import { normalizeShortcutTree } from './shortcuts.js';
import { ICON_MODES, SEARCH_ENGINES, SIZE_LIMITS, THEME_MODES } from './config.js';
import { showToast } from './toast.js';
import { importLocalBookmarks, parseITabBackup } from './itab-import.js';
import { WEB_CHAT_PROVIDERS } from './web-chat.js';

const THEME_BTNS = '.pref-theme-btn';
const ICON_BTNS = '.pref-icon-btn';
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/** Element that had focus before the dialog opened (for focus restore). */
let lastFocused = null;
let openSettingsDialog = null;

/** Open the preferences dialog from the page context menu. */
export function openSettings() {
  return openSettingsDialog?.();
}

/**
 * Apply the resolved theme to <html data-theme>. 'system' removes the
 * attribute so CSS follows prefers-color-scheme. Also writes the FOUC cache
 * used by the inline <head> script on subsequent loads.
 * @param {string} theme 'system' | 'light' | 'dark'
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
  try {
    localStorage.setItem('nt_theme', theme);
  } catch (e) {
    /* storage may be unavailable */
  }
}

function isValidSearchTemplate(value) {
  try {
    const parsed = new URL(String(value || '').replace('%s', 'query'));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isValidHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value || '')).protocol);
  } catch {
    return false;
  }
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function resizeWallpaper(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, 2560 / image.width, 1440 / image.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('无法处理图片'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.84));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** Initialise the settings dialog and all preference controls. */
export function initSettings() {
  const modal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('settings-close');
  const doneBtn = document.getElementById('settings-done');
  const wallpaperSource = document.getElementById('wallpaper-source');
  const customWallpaperRow = document.getElementById('custom-wallpaper-row');
  const wallpaperChoose = document.getElementById('custom-wallpaper-choose');
  const wallpaperClear = document.getElementById('custom-wallpaper-clear');
  const wallpaperFile = document.getElementById('custom-wallpaper-file');
  const wallpaperBlur = document.getElementById('wallpaper-blur');
  const wallpaperDim = document.getElementById('wallpaper-dim');
  const glassBlur = document.getElementById('glass-blur');
  const shortcutColumns = document.getElementById('shortcut-columns');
  const shortcutRows = document.getElementById('shortcut-rows');
  const shortcutIconSize = document.getElementById('shortcut-icon-size');
  const bookmarkWidth = document.getElementById('bookmark-width');
  const bookmarkItemWidth = document.getElementById('bookmark-item-width');
  const bookmarkScale = document.getElementById('bookmark-scale');
  const showClock = document.getElementById('show-clock');
  const showAssistant = document.getElementById('show-assistant');
  const showBookmarks = document.getElementById('show-bookmarks');
  const homeOrder = document.getElementById('home-order');
  const contentDensity = document.getElementById('content-density');
  const engSel = document.getElementById('engine-select');
  const customRow = document.getElementById('custom-engine-row');
  const customInput = document.getElementById('custom-engine-input');
  const exportBtn = document.getElementById('settings-export');
  const importBtn = document.getElementById('settings-import');
  const importFile = document.getElementById('settings-import-file');
  const clearCacheBtn = document.getElementById('settings-clear-cache');
  const syncBtn = document.getElementById('settings-sync');
  const restoreSnapshotBtn = document.getElementById('settings-restore-snapshot');
  const dataStatus = document.getElementById('data-status');
  const llmProvider = document.getElementById('llm-provider');
  const llmApiSettings = document.getElementById('llm-api-settings');
  const llmWebNote = document.getElementById('llm-web-note');
  const llmBaseUrl = document.getElementById('llm-base-url');
  const llmApiKey = document.getElementById('llm-api-key');
  const llmModel = document.getElementById('llm-model');
  const llmWebUrl = document.getElementById('llm-web-url');
  let customWallpaperAvailable = false;
  let preferenceSaveQueue = Promise.resolve();

  function setDataStatus(message, isError = false) {
    dataStatus.textContent = message;
    dataStatus.classList.toggle('error', isError);
  }

  async function open() {
    lastFocused = document.activeElement;
    const [settings, customWallpaper] = await Promise.all([
      storage.getSettings(),
      storage.getCustomWallpaper(),
    ]);
    customWallpaperAvailable = !!customWallpaper;
    syncControls(settings);
    setDataStatus('');
    modal.classList.remove('hidden');
    const first = modal.querySelector(FOCUSABLE);
    if (first) first.focus();
  }
  openSettingsDialog = open;
  async function close() {
    const customTemplate = customInput.value.trim();
    const settings = await storage.getSettings();
    if (isValidSearchTemplate(customTemplate)) settings.customEngineUrl = customTemplate;
    const baseUrl = llmBaseUrl.value.trim();
    const webUrl = llmWebUrl.value.trim();
    if (!baseUrl || isValidHttpUrl(baseUrl)) settings.llmBaseUrl = baseUrl;
    if (!webUrl || isValidHttpUrl(webUrl)) settings.llmWebUrl = webUrl;
    settings.llmProvider = llmProvider.value;
    settings.llmApiKey = llmApiKey.value.trim();
    settings.llmModel = llmModel.value.trim();
    await storage.saveSettings(settings);
    state.notifySettingsChanged([
      'customEngineUrl', 'llmProvider', 'llmBaseUrl', 'llmApiKey', 'llmModel', 'llmWebUrl',
    ]);
    modal.classList.add('hidden');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  closeBtn.addEventListener('click', close);
  doneBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  // Theme segmented control.
  modal.querySelectorAll(THEME_BTNS).forEach((b) => {
    b.addEventListener('click', async () => {
      const mode = b.dataset.themeMode;
      const s = await storage.getSettings();
      s.theme = mode;
      await storage.saveSettings(s);
      applyTheme(mode);
      syncControls(s);
      state.notifySettingsChanged(['theme']);
    });
  });

  function savePreference(patch) {
    const save = async () => {
      const s = await storage.getSettings();
      const next = { ...s, ...patch };
      await storage.saveSettings(next);
      syncControls(next);
      state.notifySettingsChanged(Object.keys(patch));
    };
    preferenceSaveQueue = preferenceSaveQueue.then(save, save);
    return preferenceSaveQueue;
  }

  wallpaperSource.addEventListener('change', () => {
    savePreference({ wallpaperSource: wallpaperSource.value });
  });
  wallpaperChoose.addEventListener('click', () => wallpaperFile.click());
  wallpaperClear.addEventListener('click', async () => {
    await storage.saveCustomWallpaper('');
    customWallpaperAvailable = false;
    syncControls(await storage.getSettings());
    state.notifySettingsChanged(['customWallpaper']);
  });
  wallpaperFile.addEventListener('change', async () => {
    const file = wallpaperFile.files?.[0];
    if (!file) return;
    try {
      const image = await resizeWallpaper(file);
      await storage.saveCustomWallpaper(image);
      customWallpaperAvailable = true;
      await savePreference({ wallpaperSource: 'custom' });
      setDataStatus('自定义壁纸已保存。');
    } catch {
      setDataStatus('图片处理失败，请换一张较小的图片。', true);
    } finally {
      wallpaperFile.value = '';
    }
  });
  [wallpaperBlur, wallpaperDim, glassBlur].forEach((control) => {
    let saveTimer = null;
    control.addEventListener('input', () => {
      const key = control.id === 'wallpaper-blur'
        ? 'wallpaperBlur'
        : control.id === 'wallpaper-dim' ? 'wallpaperDim' : 'glassBlur';
      const value = Number(control.value);
      const output = document.getElementById(`${control.id}-value`);
      output.textContent = control.id === 'wallpaper-dim' ? `${value}%` : String(value);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => savePreference({ [key]: value }), 80);
    });
  });

  shortcutColumns.addEventListener('change', () => {
    savePreference({ shortcutColumns: Number(shortcutColumns.value) });
  });
  shortcutRows.addEventListener('change', () => {
    savePreference({ shortcutRows: Number(shortcutRows.value) });
  });
  [
    [shortcutIconSize, 'shortcutIconSize', (value) => value],
    [bookmarkWidth, 'bookmarkWidth', (value) => `${value}%`],
    [bookmarkItemWidth, 'bookmarkItemWidth', (value) => value],
    [bookmarkScale, 'bookmarkScale', (value) => `${value}%`],
  ].forEach(([control, key, format]) => {
    let saveTimer = null;
    control.addEventListener('input', () => {
      const value = Number(control.value);
      document.getElementById(`${control.id}-value`).textContent = format(String(value));
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => savePreference({ [key]: value }), 80);
    });
  });
  [showClock, showAssistant, showBookmarks].forEach((control) => {
    control.addEventListener('change', () => {
      const key = control.id === 'show-clock'
        ? 'showClock' : control.id === 'show-assistant' ? 'showAssistant' : 'showBookmarks';
      savePreference({ [key]: control.checked });
    });
  });
  homeOrder.addEventListener('change', () => savePreference({ homeOrder: homeOrder.value }));
  contentDensity.addEventListener('change', () => savePreference({ contentDensity: contentDensity.value }));

  // Search engine select.
  engSel.addEventListener('change', async () => {
    const s = await storage.getSettings();
    s.searchEngine = engSel.value;
    await storage.saveSettings(s);
    syncControls(s);
    state.notifySettingsChanged(['searchEngine']);
  });
  customInput.addEventListener('change', async () => {
    const value = customInput.value.trim();
    if (!isValidSearchTemplate(value)) {
      customInput.setCustomValidity('请输入有效的 http:// 或 https:// 搜索地址。');
      customInput.reportValidity();
      return;
    }
    customInput.setCustomValidity('');
    const s = await storage.getSettings();
    s.customEngineUrl = value;
    await storage.saveSettings(s);
  });

  [llmBaseUrl, llmApiKey, llmModel, llmWebUrl].forEach((control) => {
    control.addEventListener('change', async () => {
      const values = {
        llmBaseUrl: llmBaseUrl.value.trim(),
        llmApiKey: llmApiKey.value.trim(),
        llmModel: llmModel.value.trim(),
        llmWebUrl: llmWebUrl.value.trim(),
      };
      if (values.llmBaseUrl && !isValidHttpUrl(values.llmBaseUrl)) {
        llmBaseUrl.setCustomValidity('请输入有效的 http:// 或 https:// 地址。');
        llmBaseUrl.reportValidity();
        return;
      }
      if (values.llmWebUrl && !isValidHttpUrl(values.llmWebUrl)) {
        llmWebUrl.setCustomValidity('请输入有效的 http:// 或 https:// 地址。');
        llmWebUrl.reportValidity();
        return;
      }
      llmBaseUrl.setCustomValidity('');
      llmWebUrl.setCustomValidity('');
      await savePreference(values);
    });
  });
  llmProvider.addEventListener('change', () => {
    savePreference({ llmProvider: llmProvider.value });
  });

  exportBtn.addEventListener('click', async () => {
    try {
      const backup = await storage.createBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `qing-newtab-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setDataStatus('设置已导出。');
      showToast('配置备份已导出。');
    } catch {
      setDataStatus('设置导出失败。', true);
      showToast('配置备份导出失败。', true);
    }
  });

  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const iTabData = parseITabBackup(backup);
      if (iTabData) {
        if (!iTabData.shortcuts.length) throw new Error('iTab 备份中没有可用的快捷方式');
        await storage.saveShortcuts(iTabData.shortcuts);
        document.dispatchEvent(new document.defaultView.Event('shortcut-tree-changed'));
        const bookmarkResult = await importLocalBookmarks(iTabData.localBookmarks);
        state.notifySettingsChanged();
        const message = `已导入 ${iTabData.shortcuts.length} 个快捷方式，local 收藏夹新增 ${bookmarkResult.created} 项。`;
        setDataStatus(message);
        showToast(message);
        return;
      }
      if (!backup || typeof backup.settings !== 'object' || !Array.isArray(backup.shortcuts)) {
        throw new Error('备份格式无效');
      }

      const current = await storage.getSettings();
      const incoming = backup.settings;
      const nextSettings = {
        ...current,
        theme: THEME_MODES.includes(incoming.theme) ? incoming.theme : current.theme,
        wallpaperEnabled:
          typeof incoming.wallpaperEnabled === 'boolean'
            ? incoming.wallpaperEnabled
            : current.wallpaperEnabled,
        wallpaperSource: ['bing', 'custom', 'gradient'].includes(incoming.wallpaperSource)
          ? incoming.wallpaperSource : current.wallpaperSource,
        wallpaperBlur: numberInRange(incoming.wallpaperBlur, 0, 20, current.wallpaperBlur),
        wallpaperDim: numberInRange(incoming.wallpaperDim, 0, 75, current.wallpaperDim),
        glassBlur: numberInRange(incoming.glassBlur, 0, 30, current.glassBlur),
        shortcutColumns: Math.round(numberInRange(
          incoming.shortcutColumns, 4, 16, current.shortcutColumns
        )),
        shortcutRows: Math.round(numberInRange(
          incoming.shortcutRows, 1, 4, current.shortcutRows
        )),
        shortcutIconSize: Math.round(numberInRange(
          incoming.shortcutIconSize,
          SIZE_LIMITS.shortcutIconSize.min,
          SIZE_LIMITS.shortcutIconSize.max,
          current.shortcutIconSize
        )),
        bookmarkWidth: Math.round(numberInRange(
          incoming.bookmarkWidth,
          SIZE_LIMITS.bookmarkWidth.min,
          SIZE_LIMITS.bookmarkWidth.max,
          current.bookmarkWidth
        )),
        bookmarkItemWidth: Math.round(numberInRange(
          incoming.bookmarkItemWidth,
          SIZE_LIMITS.bookmarkItemWidth.min,
          SIZE_LIMITS.bookmarkItemWidth.max,
          current.bookmarkItemWidth
        )),
        bookmarkScale: Math.round(numberInRange(
          incoming.bookmarkScale,
          SIZE_LIMITS.bookmarkScale.min,
          SIZE_LIMITS.bookmarkScale.max,
          current.bookmarkScale
        )),
        showClock: typeof incoming.showClock === 'boolean' ? incoming.showClock : current.showClock,
        showAssistant: typeof incoming.showAssistant === 'boolean'
          ? incoming.showAssistant : current.showAssistant,
        showBookmarks: typeof incoming.showBookmarks === 'boolean'
          ? incoming.showBookmarks : current.showBookmarks,
        homeOrder: ['shortcuts-first', 'bookmarks-first'].includes(incoming.homeOrder)
          ? incoming.homeOrder : current.homeOrder,
        contentDensity: ['standard', 'compact'].includes(incoming.contentDensity)
          ? incoming.contentDensity : current.contentDensity,
        searchEngine: Object.hasOwn(SEARCH_ENGINES, incoming.searchEngine)
          ? incoming.searchEngine
          : current.searchEngine,
        customEngineUrl: isValidSearchTemplate(incoming.customEngineUrl)
          ? incoming.customEngineUrl
          : current.customEngineUrl,
        iconMode: ICON_MODES.includes(incoming.iconMode)
          ? incoming.iconMode
          : current.iconMode,
        llmProvider: incoming.llmProvider === 'api' || Object.hasOwn(WEB_CHAT_PROVIDERS, incoming.llmProvider)
          ? incoming.llmProvider : current.llmProvider,
        llmBaseUrl: isValidHttpUrl(incoming.llmBaseUrl) ? incoming.llmBaseUrl : current.llmBaseUrl,
        llmApiKey: current.llmApiKey,
        llmModel: typeof incoming.llmModel === 'string' ? incoming.llmModel : current.llmModel,
        llmWebUrl: !incoming.llmWebUrl || isValidHttpUrl(incoming.llmWebUrl)
          ? String(incoming.llmWebUrl || '') : current.llmWebUrl,
      };
      const nextShortcuts = normalizeShortcutTree(backup.shortcuts);

      await storage.saveSettings(nextSettings);
      if (typeof backup.customWallpaper === 'string' && backup.customWallpaper.startsWith('data:image/')) {
        await storage.saveCustomWallpaper(backup.customWallpaper);
        customWallpaperAvailable = true;
      }
      await storage.saveShortcuts(nextShortcuts);
      document.dispatchEvent(new document.defaultView.Event('shortcut-tree-changed'));
      applyTheme(nextSettings.theme);
      syncControls(nextSettings);
      state.notifySettingsChanged();
      setDataStatus(`已导入 ${nextShortcuts.length} 个快捷方式。`);
      showToast(`配置已导入，包含 ${nextShortcuts.length} 个快捷方式。`);
    } catch {
      setDataStatus('该文件不是有效的 qing-newtab 备份。', true);
      showToast('配置备份无效，导入失败。', true);
    } finally {
      importFile.value = '';
    }
  });

  clearCacheBtn.addEventListener('click', async () => {
    try {
      const count = await storage.clearCaches();
      setDataStatus(`已清理 ${count} 项缓存。`);
    } catch {
      setDataStatus('缓存清理失败。', true);
    }
  });
  syncBtn.addEventListener('click', async () => {
    const current = await storage.getSettings();
    try {
      const result = await storage.setSyncEnabled(!current.syncEnabled);
      if (!result.available) {
        setDataStatus('当前浏览器不支持扩展同步。', true);
        return;
      }
      const next = await storage.getSettings();
      syncControls(next);
      state.notifySettingsChanged();
      setDataStatus(next.syncEnabled
        ? (result.source === 'remote' ? '已开启同步，并恢复云端配置。' : '已开启浏览器同步。')
        : '已关闭浏览器同步。');
    } catch {
      setDataStatus('浏览器同步失败，请稍后重试。', true);
    }
  });
  restoreSnapshotBtn.addEventListener('click', async () => {
    const restored = await storage.restoreLastShortcutSnapshot();
    if (!restored) {
      setDataStatus('没有可恢复的快捷方式变更。');
      return;
    }
    document.dispatchEvent(new document.defaultView.Event('shortcut-tree-changed'));
    state.notifySettingsChanged();
    setDataStatus('已恢复上一次快捷方式变更。');
    showToast('已恢复上一次快捷方式变更。');
  });

  // Icon mode radio.
  modal.querySelectorAll(ICON_BTNS).forEach((b) => {
    b.addEventListener('click', async () => {
      const mode = b.dataset.iconMode;
      const s = await storage.getSettings();
      s.iconMode = mode;
      await storage.saveSettings(s);
      syncControls(s);
      state.notifySettingsChanged(['iconMode']);
    });
  });

  /** Reflect a settings object into all preference controls. */
  function syncControls(s) {
    modal.querySelectorAll(THEME_BTNS).forEach((b) => {
      const on = b.dataset.themeMode === s.theme;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('active', on);
    });
    wallpaperSource.value = s.wallpaperSource || (s.wallpaperEnabled ? 'bing' : 'gradient');
    customWallpaperRow.classList.toggle('hidden', wallpaperSource.value !== 'custom');
    wallpaperClear.disabled = !customWallpaperAvailable;
    wallpaperBlur.value = String(s.wallpaperBlur);
    wallpaperDim.value = String(s.wallpaperDim);
    glassBlur.value = String(s.glassBlur);
    shortcutColumns.value = String(s.shortcutColumns);
    shortcutRows.value = String(s.shortcutRows);
    shortcutIconSize.value = String(s.shortcutIconSize);
    bookmarkWidth.value = String(s.bookmarkWidth);
    bookmarkItemWidth.value = String(s.bookmarkItemWidth);
    bookmarkScale.value = String(s.bookmarkScale);
    showClock.checked = s.showClock !== false;
    showAssistant.checked = s.showAssistant !== false;
    showBookmarks.checked = s.showBookmarks !== false;
    homeOrder.value = s.homeOrder === 'bookmarks-first' ? 'bookmarks-first' : 'shortcuts-first';
    contentDensity.value = s.contentDensity === 'compact' ? 'compact' : 'standard';
    syncBtn.textContent = s.syncEnabled ? '关闭浏览器同步' : '开启浏览器同步';
    syncBtn.setAttribute('aria-pressed', s.syncEnabled ? 'true' : 'false');
    document.getElementById('wallpaper-blur-value').textContent = String(s.wallpaperBlur);
    document.getElementById('wallpaper-dim-value').textContent = `${s.wallpaperDim}%`;
    document.getElementById('glass-blur-value').textContent = String(s.glassBlur);
    document.getElementById('shortcut-icon-size-value').textContent = String(s.shortcutIconSize);
    document.getElementById('bookmark-width-value').textContent = `${s.bookmarkWidth}%`;
    document.getElementById('bookmark-item-width-value').textContent = String(s.bookmarkItemWidth);
    document.getElementById('bookmark-scale-value').textContent = `${s.bookmarkScale}%`;
    engSel.value = s.searchEngine;
    customRow.style.display = s.searchEngine === 'custom' ? '' : 'none';
    customInput.value = s.customEngineUrl;
    const provider = s.llmProvider === 'api' || Object.hasOwn(WEB_CHAT_PROVIDERS, s.llmProvider)
      ? s.llmProvider : 'deepseek';
    llmProvider.value = provider;
    llmApiSettings.classList.toggle('hidden', provider !== 'api');
    llmWebNote.classList.toggle('hidden', provider === 'api');
    llmBaseUrl.value = s.llmBaseUrl || '';
    llmApiKey.value = s.llmApiKey || '';
    llmModel.value = s.llmModel || '';
    llmWebUrl.value = s.llmWebUrl || '';
    modal.querySelectorAll(ICON_BTNS).forEach((b) => {
      const on = b.dataset.iconMode === s.iconMode;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('active', on);
    });
  }

  // Focus trap + Esc-to-close while the dialog is open.
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null
    );
    if (!f.length) return;
    const first = f[0];
    const lastEl = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      first.focus();
    }
  });
}
