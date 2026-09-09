/**
 * Settings dialog: category navigation and a local draft with explicit save/cancel.
 * Controls never write or repopulate one another while editing. Only changed
 * fields are committed; backup/sync actions are separate, immediate operations.
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
  const shortcutTop = document.getElementById('shortcut-top');
  const shortcutGap = document.getElementById('shortcut-gap');
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
  let wallpaperDraft;
  let initialWallpaper = '';
  let baseline = null;
  let selectedTheme = 'system';
  let selectedIconMode = 'favicon';
  let busy = false;
  let imageLoading = false;
  const cancelBtn = document.getElementById('settings-cancel');
  const saveStatus = document.getElementById('settings-save-status');
  const preview = document.getElementById('settings-shortcut-preview');
  const numericFields = [
    [wallpaperBlur, 'wallpaperBlur', ''], [wallpaperDim, 'wallpaperDim', '%'],
    [glassBlur, 'glassBlur', ''], [shortcutColumns, 'shortcutColumns', ''],
    [shortcutRows, 'shortcutRows', ''], [shortcutTop, 'shortcutTop', 'px'], [shortcutGap, 'shortcutGap', 'px'],
    [shortcutIconSize, 'shortcutIconSize', 'px'], [bookmarkWidth, 'bookmarkWidth', '%'],
    [bookmarkItemWidth, 'bookmarkItemWidth', 'px'], [bookmarkScale, 'bookmarkScale', '%'],
  ];
  const textFields = [
    [wallpaperSource, 'wallpaperSource'], [homeOrder, 'homeOrder'],
    [contentDensity, 'contentDensity'], [engSel, 'searchEngine'],
    [customInput, 'customEngineUrl'], [llmProvider, 'llmProvider'],
    [llmBaseUrl, 'llmBaseUrl'], [llmApiKey, 'llmApiKey'],
    [llmModel, 'llmModel'], [llmWebUrl, 'llmWebUrl'],
  ];
  const checkFields = [[showClock, 'showClock'], [showAssistant, 'showAssistant'], [showBookmarks, 'showBookmarks']];

  function selectTab(id, focus = false) {
    modal.querySelectorAll('[data-settings-tab]').forEach((tab) => {
      const active = tab.dataset.settingsTab === id;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).classList.toggle('hidden', !active);
      if (active && focus) tab.focus();
    });
    modal.querySelector('.settings-panels').scrollTop = 0;
  }
  modal.querySelectorAll('[data-settings-tab]').forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.settingsTab));
    tab.addEventListener('keydown', (event) => {
      const tabs = [...modal.querySelectorAll('[data-settings-tab]')];
      const index = tabs.indexOf(tab);
      let next;
      if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (index + 1) % tabs.length;
      if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectTab(tabs[next].dataset.settingsTab, true); }
    });
  });

  function values() {
    return {
      theme: selectedTheme, iconMode: selectedIconMode,
      ...Object.fromEntries(numericFields.map(([control, key]) => [key, Number(control.value)])),
      ...Object.fromEntries(textFields.map(([control, key]) => [key, control.value.trim()])),
      ...Object.fromEntries(checkFields.map(([control, key]) => [key, control.checked])),
    };
  }
  function changedFields() {
    if (!baseline) return {};
    return Object.fromEntries(Object.entries(values()).filter(([key, value]) => value !== baseline[key]));
  }
  function hasChanges() { return Object.keys(changedFields()).length > 0 || wallpaperDraft !== undefined; }
  function setSaveStatus(message, error = false) {
    saveStatus.textContent = message;
    saveStatus.classList.toggle('error', error);
  }
  function updateDraft() {
    if (!baseline) return;
    const draft = values();
    numericFields.forEach(([control, , unit]) => {
      const output = document.getElementById(`${control.id}-value`);
      if (output) output.textContent = `${control.value}${unit}`;
    });
    customWallpaperRow.classList.toggle('hidden', draft.wallpaperSource !== 'custom');
    wallpaperClear.disabled = busy || imageLoading || !customWallpaperAvailable;
    customRow.classList.toggle('hidden', draft.searchEngine !== 'custom');
    llmApiSettings.classList.toggle('hidden', draft.llmProvider !== 'api');
    llmWebNote.classList.toggle('hidden', draft.llmProvider === 'api');
    modal.querySelectorAll(THEME_BTNS).forEach((button) => {
      const active = button.dataset.themeMode === selectedTheme;
      button.classList.toggle('active', active); button.setAttribute('aria-checked', String(active));
    });
    modal.querySelectorAll(ICON_BTNS).forEach((button) => {
      const active = button.dataset.iconMode === selectedIconMode;
      button.classList.toggle('active', active); button.setAttribute('aria-checked', String(active));
    });
    renderPreview(draft);
    // Only numeric layout/effect controls are previewed; never expose draft API fields.
    const numericKeys = new Set(numericFields.map(([, key]) => key));
    state.previewSettings(Object.fromEntries(Object.entries(changedFields())
      .filter(([key]) => numericKeys.has(key))));
    if (!busy) setSaveStatus(hasChanges() ? '正在实时预览，保存以保留修改，取消可恢复。' : '修改后点击保存，取消不保留更改。');
  }
  function renderPreview(draft = values()) {
    preview.replaceChildren();
    const columns = draft.shortcutColumns;
    const size = 12 + draft.shortcutIconSize * 0.15;
    const gap = 4 + draft.shortcutGap * 0.18;
    const width = preview.parentElement.clientWidth || 500;
    const scale = Math.min(1, (width - 24) / (columns * size + (columns - 1) * gap));
    preview.style.gridTemplateColumns = `repeat(${columns}, ${size * scale}px)`;
    preview.style.gap = `${gap * scale}px`;
    for (let i = 0; i < columns * draft.shortcutRows; i += 1) {
      const icon = document.createElement('span');
      icon.style.width = icon.style.height = `${size * scale}px`;
      preview.appendChild(icon);
    }
    document.getElementById('settings-preview-caption').textContent =
      `每行 ${columns} 个 · 每屏 ${draft.shortcutRows} 行 · 间距 ${draft.shortcutGap}px`;
  }
  if (typeof ResizeObserver !== 'undefined') {
    let previousWidth = 0;
    const observer = new ResizeObserver(() => {
      const width = preview.parentElement.clientWidth;
      if (baseline && width > 0 && width !== previousWidth) {
        previousWidth = width; renderPreview();
      }
    });
    observer.observe(preview.parentElement);
  }
  function allowDataAction() {
    if (!modal.classList.contains('hidden') && hasChanges()) {
      setSaveStatus('请先保存或取消当前修改，再操作数据。', true);
      return false;
    }
    return !busy;
  }

  function setDataStatus(message, isError = false) {
    dataStatus.textContent = message;
    dataStatus.classList.toggle('error', isError);
  }

  async function open() {
    lastFocused = document.activeElement;
    modal.classList.remove('hidden');
    document.getElementById('page-toast')?.classList.add('hidden');
    selectTab('shortcuts');
    setSaveStatus('正在读取设置…');
    try {
      const [settings, customWallpaper] = await Promise.all([storage.getSettings(), storage.getCustomWallpaper()]);
      initialWallpaper = customWallpaper;
      customWallpaperAvailable = !!customWallpaper;
      wallpaperDraft = undefined;
      syncControls(settings);
      setDataStatus('');
      document.getElementById('settings-tab-shortcuts').focus();
    } catch {
      setSaveStatus('设置读取失败，请关闭后重试。', true);
    }
  }
  openSettingsDialog = open;
  function close() {
    if (busy || imageLoading) return;
    modal.classList.add('hidden');
    modal.classList.remove('previewing');
    state.previewSettings();
    baseline = null;
    wallpaperDraft = undefined;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });

  function validateDraft() {
    const draft = values();
    const checks = [
      [customInput, draft.searchEngine !== 'custom' || isValidSearchTemplate(draft.customEngineUrl), '请输入有效的 http:// 或 https:// 搜索地址。'],
      [llmBaseUrl, draft.llmProvider !== 'api' || !draft.llmBaseUrl || isValidHttpUrl(draft.llmBaseUrl), '请输入有效的接口地址，以 http:// 或 https:// 开头。'],
      [llmWebUrl, draft.llmProvider !== 'api' || !draft.llmWebUrl || isValidHttpUrl(draft.llmWebUrl), '请输入有效的备用网页地址，或留空。'],
    ];
    for (const [control, valid, message] of checks) {
      control.setCustomValidity(valid ? '' : message);
      control.setAttribute('aria-invalid', String(!valid));
      if (!valid) {
        selectTab('search'); setSaveStatus(message, true); control.focus(); return false;
      }
    }
    return true;
  }
  function setBusy(value) {
    busy = value;
    modal.querySelectorAll('button, input, select').forEach((control) => { control.disabled = value; });
    wallpaperClear.disabled = value || !customWallpaperAvailable;
    doneBtn.textContent = value ? '正在保存…' : '保存并关闭';
    modal.setAttribute('aria-busy', String(value));
  }
  doneBtn.addEventListener('click', async () => {
    if (busy || imageLoading || !baseline || !validateDraft()) return;
    const patch = changedFields();
    if (!Object.keys(patch).length && wallpaperDraft === undefined) { close(); return; }
    setBusy(true); setSaveStatus('正在保存设置…');
    try {
      await storage.saveSettings(patch, wallpaperDraft === undefined ? {} : { customWallpaper: wallpaperDraft });
      if ('theme' in patch) applyTheme(patch.theme);
      state.notifySettingsChanged([...Object.keys(patch), ...(wallpaperDraft === undefined ? [] : ['customWallpaper'])]);
      setBusy(false); close(); showToast('设置已保存。');
    } catch (error) {
      setBusy(false);
      setSaveStatus(`保存失败：${error?.message || '请重试'}。修改已保留，可重试或取消。`, true);
    }
  });

  [...numericFields, ...textFields, ...checkFields].forEach(([control]) => {
    control.addEventListener('input', () => {
      control.setCustomValidity(''); control.removeAttribute('aria-invalid'); updateDraft();
    });
    control.addEventListener('change', updateDraft);
  });
  // Fade the settings panel only while manipulating a slider, so the real page
  // remains visible without moving the control underneath the pointer.
  let previewControl = null;
  const endPreviewGesture = () => { previewControl = null; modal.classList.remove('previewing'); };
  modal.querySelectorAll('input[type="range"]').forEach((control) => {
    control.addEventListener('pointerdown', () => { previewControl = control; modal.classList.add('previewing'); });
    control.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        previewControl = control;
        modal.classList.add('previewing');
      }
    });
    control.addEventListener('keyup', endPreviewGesture);
    control.addEventListener('blur', () => { if (previewControl === control) endPreviewGesture(); });
  });
  document.addEventListener('pointerup', endPreviewGesture);
  document.addEventListener('pointercancel', endPreviewGesture);
  window.addEventListener('blur', endPreviewGesture);

  modal.querySelectorAll(THEME_BTNS).forEach((button) => button.addEventListener('click', () => {
    selectedTheme = button.dataset.themeMode; updateDraft();
  }));
  modal.querySelectorAll(ICON_BTNS).forEach((button) => button.addEventListener('click', () => {
    selectedIconMode = button.dataset.iconMode; updateDraft();
  }));
  wallpaperChoose.addEventListener('click', () => wallpaperFile.click());
  wallpaperClear.addEventListener('click', () => {
    wallpaperDraft = initialWallpaper ? '' : undefined;
    customWallpaperAvailable = false;
    document.getElementById('custom-wallpaper-status').textContent = '保存后移除自定义壁纸。';
    updateDraft();
  });
  wallpaperFile.addEventListener('change', async () => {
    const file = wallpaperFile.files?.[0];
    if (!file) return;
    imageLoading = true;
    doneBtn.disabled = cancelBtn.disabled = closeBtn.disabled = wallpaperChoose.disabled = wallpaperClear.disabled = true;
    setSaveStatus('正在处理图片…');
    let imageError = false;
    try {
      wallpaperDraft = await resizeWallpaper(file);
      customWallpaperAvailable = true;
      wallpaperSource.value = 'custom';
      document.getElementById('custom-wallpaper-status').textContent = `已选择 ${file.name}，保存后应用。`;
    } catch {
      imageError = true;
    } finally {
      imageLoading = false;
      doneBtn.disabled = cancelBtn.disabled = closeBtn.disabled = wallpaperChoose.disabled = false;
      wallpaperFile.value = '';
      updateDraft();
      if (imageError) setSaveStatus('图片处理失败，请换一张较小的图片。', true);
    }
  });

  exportBtn.addEventListener('click', async () => {
    if (!allowDataAction()) return;
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

  importBtn.addEventListener('click', () => { if (allowDataAction()) importFile.click(); });
  importFile.addEventListener('change', async () => {
    if (!allowDataAction()) return;
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
          incoming.shortcutColumns, 1, 16, current.shortcutColumns
        )),
        shortcutRows: Math.round(numberInRange(
          incoming.shortcutRows, 1, 4, current.shortcutRows
        )),
        shortcutTop: Math.round(numberInRange(incoming.shortcutTop, 0, 400, current.shortcutTop)),
        shortcutGap: Math.round(numberInRange(incoming.shortcutGap, 0, 80, current.shortcutGap)),
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

      const media = typeof backup.customWallpaper === 'string'
        && (backup.customWallpaper === '' || backup.customWallpaper.startsWith('data:image/'))
        ? { customWallpaper: backup.customWallpaper } : {};
      await storage.saveSettings(nextSettings, media);
      if ('customWallpaper' in media) {
        initialWallpaper = media.customWallpaper;
        customWallpaperAvailable = !!initialWallpaper;
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
    if (!allowDataAction()) return;
    try {
      const count = await storage.clearCaches();
      setDataStatus(`已清理 ${count} 项缓存。`);
    } catch {
      setDataStatus('缓存清理失败。', true);
    }
  });
  syncBtn.addEventListener('click', async () => {
    if (!allowDataAction()) return;
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
    if (!allowDataAction()) return;
    try {
    const restored = await storage.restoreLastShortcutSnapshot();
    if (!restored) {
      setDataStatus('没有可恢复的快捷方式变更。');
      return;
    }
    document.dispatchEvent(new document.defaultView.Event('shortcut-tree-changed'));
    state.notifySettingsChanged();
    setDataStatus('已恢复上一次快捷方式变更。');
    showToast('已恢复上一次快捷方式变更。');
    } catch { setDataStatus('恢复失败，请重试。', true); }
  });

  /** Populate once when opening or explicitly replacing stored configuration. */
  function syncControls(settings) {
    baseline = { ...settings };
    selectedTheme = settings.theme;
    selectedIconMode = settings.iconMode;
    numericFields.forEach(([control, key]) => { control.value = String(settings[key]); });
    textFields.forEach(([control, key]) => { control.value = String(settings[key] || ''); });
    checkFields.forEach(([control, key]) => { control.checked = settings[key] !== false; });
    [...numericFields, ...textFields, ...checkFields].forEach(([control]) => {
      control.setCustomValidity(''); control.removeAttribute('aria-invalid');
    });
    syncBtn.textContent = settings.syncEnabled ? '关闭浏览器同步' : '开启浏览器同步';
    syncBtn.setAttribute('aria-pressed', String(!!settings.syncEnabled));
    document.getElementById('custom-wallpaper-status').textContent = customWallpaperAvailable ? '已保存自定义壁纸。' : '尚未选择自定义壁纸。';
    updateDraft();
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
