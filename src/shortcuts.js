/**
 * Shortcut desktop: rendering, edit mode, drag sorting/folders and icon upload.
 * Folders are intentionally one level deep so the interaction stays predictable.
 */

import * as storage from './storage.js';
import * as state from './state.js';
import {
  cachedFaviconSources,
  hostFromUrl,
  renderWebsiteIcon,
} from './favicon.js';
import { showToast } from './toast.js';

const FOLDER_TYPE = 'folder';
const DEFAULT_FOLDER_NAME = '新文件夹';

let gridEl = null;
let editorModal = null;
let editorForm = null;
let editorTitle = null;
let editorName = null;
let editorUrl = null;
let editorDelete = null;
let editorIconPreview = null;
let editorIconReset = null;
let iconPreviewModal = null;
let iconPreviewImg = null;
let folderModal = null;
let folderGrid = null;
let folderName = null;

let dragSrcEl = null;
let dragPath = '';
let editorPath = '';
let editorParentIndex = -1;
let editorDraft = null;
let openedFolderIndex = -1;
let wheelDelta = 0;
let wheelTimer = null;
let layoutRows = 2;
let layoutColumns = 12;
let layoutFrame = 0;
let canUndoShortcutChange = false;
let sessionUndoCount = 0;
let managedPath = '';

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

async function saveShortcutList(list, reason) {
  await storage.saveShortcuts(list, { reason });
  sessionUndoCount += 1;
  canUndoShortcutChange = true;
  document.dispatchEvent(new document.defaultView.Event('shortcut-tree-changed'));
}

function integerInRange(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function isShortcutFolder(item) {
  return item?.type === FOLDER_TYPE && Array.isArray(item.children);
}

function parsePath(path) {
  const value = String(path ?? '');
  if (!/^\d+(?:\/\d+)?$/.test(value)) return [];
  return value.split('/').map(Number);
}

function itemAtPath(list, path) {
  const [topIndex, childIndex] = parsePath(path);
  if (!Number.isInteger(topIndex)) return null;
  if (!Number.isInteger(childIndex)) return list[topIndex] || null;
  const folder = list[topIndex];
  return isShortcutFolder(folder) ? folder.children[childIndex] || null : null;
}

function removeAtPath(list, path) {
  const [topIndex, childIndex] = parsePath(path);
  if (!Number.isInteger(topIndex)) return null;
  if (!Number.isInteger(childIndex)) return list.splice(topIndex, 1)[0] || null;
  const folder = list[topIndex];
  if (!isShortcutFolder(folder)) return null;
  return folder.children.splice(childIndex, 1)[0] || null;
}

function dissolveSmallFolders(list) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const folder = list[index];
    if (!isShortcutFolder(folder)) continue;
    folder.children = folder.children.filter((child) => child && !isShortcutFolder(child));
    if (folder.children.length === 1) list.splice(index, 1, folder.children[0]);
    if (folder.children.length === 0) list.splice(index, 1);
  }
  return list;
}

function uniqueFolderName(list) {
  const names = new Set(list.filter(isShortcutFolder).map((folder) => folder.name));
  if (!names.has(DEFAULT_FOLDER_NAME)) return DEFAULT_FOLDER_NAME;
  let number = 2;
  while (names.has(`${DEFAULT_FOLDER_NAME} ${number}`)) number += 1;
  return `${DEFAULT_FOLDER_NAME} ${number}`;
}

/** Return a changed copy after a drag action: before, after, or group. */
export function rearrangeShortcutList(input, sourcePath, targetPath, mode = 'after') {
  const list = deepCopy(Array.isArray(input) ? input : []);
  const source = itemAtPath(list, sourcePath);
  const target = itemAtPath(list, targetPath);
  if (!source || !target || source === target) return list;

  const sourceParts = parsePath(sourcePath);
  const targetParts = parsePath(targetPath);
  const targetTopItem = list[targetParts[0]];
  const targetFolder = targetParts.length > 1 ? targetTopItem : (isShortcutFolder(target) ? target : null);
  const canGroup = mode === 'group' && !isShortcutFolder(source)
    && (targetParts.length === 1 || isShortcutFolder(targetTopItem));

  if (canGroup) {
    removeAtPath(list, sourcePath);
    if (targetFolder) {
      targetFolder.children.push(source);
    } else {
      const currentTargetIndex = list.indexOf(target);
      if (currentTargetIndex >= 0) {
        list.splice(currentTargetIndex, 1, {
          type: FOLDER_TYPE,
          name: uniqueFolderName(list),
          children: [target, source],
        });
      }
    }
    return dissolveSmallFolders(list);
  }

  if (sourceParts.length > 1 && targetParts.length > 1
      && sourceParts[0] === targetParts[0]) {
    const folder = list[sourceParts[0]];
    removeAtPath(list, sourcePath);
    const currentTargetIndex = folder.children.indexOf(target);
    const insertAt = mode === 'before' ? currentTargetIndex : currentTargetIndex + 1;
    folder.children.splice(Math.max(0, insertAt), 0, source);
    return list;
  }

  if (targetParts.length === 1) {
    removeAtPath(list, sourcePath);
    const currentTargetIndex = list.indexOf(target);
    const insertAt = mode === 'before' ? currentTargetIndex : currentTargetIndex + 1;
    list.splice(Math.max(0, insertAt), 0, source);
    return dissolveSmallFolders(list);
  }

  return list;
}

/** Clean a backup shortcut tree and keep only one folder level. */
export function normalizeShortcutTree(items) {
  const cleanIcon = (value) => {
    const icon = typeof value === 'string' ? value.trim() : '';
    if (icon.startsWith('data:image/')) return icon;
    try {
      const parsed = new URL(icon);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  };
  const cleanShortcut = (item) => {
    const name = String(item?.name || '').trim().slice(0, 64);
    const url = normalizeShortcutUrl(item?.url);
    if (!name || !url) return null;
    return {
      name,
      url,
      size: '1x1',
      icon: cleanIcon(item?.icon),
    };
  };
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (isShortcutFolder(item)) {
      const children = item.children.map(cleanShortcut).filter(Boolean);
      if (children.length > 1) {
        result.push({
          type: FOLDER_TYPE,
          name: String(item.name || DEFAULT_FOLDER_NAME).trim().slice(0, 32) || DEFAULT_FOLDER_NAME,
          children,
        });
      } else if (children.length === 1) {
        result.push(children[0]);
      }
      continue;
    }
    const shortcut = cleanShortcut(item);
    if (shortcut) result.push(shortcut);
  }
  return result;
}

function shortcutColumnWidth() {
  const styles = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement) : null;
  const cell = Number.parseFloat(styles?.getPropertyValue('--cell')) || 88;
  const gridStyles = gridEl && typeof getComputedStyle === 'function' ? getComputedStyle(gridEl) : null;
  const gap = Number.parseFloat(gridStyles?.columnGap) || 12;
  return cell + gap;
}

function syncShortcutOverflow() {
  if (!gridEl) return;
  const panel = gridEl.parentElement;
  if (typeof getComputedStyle !== 'function') {
    const overflowing = panel.scrollWidth > panel.clientWidth + 2;
    panel.classList.toggle('has-overflow', overflowing);
    panel.title = overflowing
      ? `${layoutRows} 行显示，横向滚动查看更多快捷方式`
      : '右键空白处添加快捷方式';
    return;
  }
  const rootStyles = getComputedStyle(document.documentElement);
  const panelStyles = getComputedStyle(panel);
  const cell = Number.parseFloat(rootStyles.getPropertyValue('--cell')) || 88;
  const gap = Number.parseFloat(rootStyles.getPropertyValue('--gap')) || 12;
  const horizontalPadding = (Number.parseFloat(panelStyles.paddingLeft) || 0)
    + (Number.parseFloat(panelStyles.paddingRight) || 0);
  const contentWidth = Math.max(cell, panel.clientWidth - horizontalPadding);
  const columns = Math.max(1, Math.ceil(gridEl.childElementCount / layoutRows));
  const minimumGap = Math.min(gap, 8);
  const physicallyVisible = Math.max(1, Math.floor((contentWidth + minimumGap) / (cell + minimumGap)));
  const visibleColumns = Math.max(1, Math.min(layoutColumns, physicallyVisible));
  const overflowing = columns > visibleColumns;

  if (overflowing) {
    const trackWidth = Math.max(cell, (contentWidth - minimumGap * Math.max(0, visibleColumns - 1)) / visibleColumns);
    const gridWidth = columns * trackWidth + Math.max(0, columns - 1) * minimumGap;
    gridEl.style.gridTemplateColumns = `repeat(${columns}, ${trackWidth}px)`;
    gridEl.style.width = `${gridWidth}px`;
    gridEl.style.minWidth = `${gridWidth}px`;
    gridEl.style.setProperty('--shortcut-column-gap', `${minimumGap}px`);
  } else {
    gridEl.style.gridTemplateColumns = `repeat(${columns}, minmax(${cell}px, 1fr))`;
    gridEl.style.width = '100%';
    gridEl.style.minWidth = '100%';
    gridEl.style.removeProperty('--shortcut-column-gap');
  }
  const startedOverflowing = overflowing && !panel.classList.contains('has-overflow');
  panel.classList.toggle('has-overflow', overflowing);
  if (startedOverflowing) panel.scrollLeft = 0;
  panel.title = overflowing
    ? `${layoutRows} 行显示，横向滚动查看更多快捷方式`
    : '右键空白处添加快捷方式';
}

function scheduleShortcutOverflow() {
  if (typeof requestAnimationFrame !== 'function') {
    clearTimeout(layoutFrame);
    layoutFrame = setTimeout(syncShortcutOverflow, 0);
    return;
  }
  if (layoutFrame) cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    syncShortcutOverflow();
  });
}

function applyShortcutLayout(settings, resetScroll = false) {
  if (!gridEl) return;
  layoutRows = integerInRange(settings.shortcutRows, 1, 4, 2);
  layoutColumns = integerInRange(settings.shortcutColumns, 4, 16, 12);
  const iconSize = integerInRange(settings.shortcutIconSize, 28, 80, 48);
  const compact = settings.contentDensity === 'compact';
  const rowGap = compact ? 9 : 13;
  const rowHeight = Math.max(compact ? 72 : 82, iconSize + (compact ? 28 : 34));
  const root = document.documentElement;
  root.style.setProperty('--shortcut-icon-size', `${iconSize}px`);
  root.style.setProperty('--shortcut-folder-cell-size', `${Math.max(13, Math.round((iconSize - 14) / 2))}px`);
  gridEl.style.setProperty('--shortcut-rows', String(layoutRows));
  gridEl.style.setProperty('--shortcut-row-height', `${rowHeight}px`);
  gridEl.style.setProperty('--shortcut-grid-height', `${layoutRows * rowHeight + Math.max(0, layoutRows - 1) * rowGap}px`);
  gridEl.style.setProperty('--shortcut-cols', String(Math.max(1, Math.ceil(gridEl.childElementCount / layoutRows))));
  if (resetScroll) gridEl.parentElement.scrollLeft = 0;
  scheduleShortcutOverflow();
}

export function normalizeShortcutUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

async function renderIcon(container, shortcut, iconMode = null, cachedSources = null) {
  container.innerHTML = '';
  const renderAutomaticIcon = async () => {
    const mode = iconMode || (await storage.getSettings()).iconMode;
    const host = hostFromUrl(shortcut.url);
    const cachedUrl = cachedSources
      ? cachedSources[host]
      : await storage.getCachedFavicon(host);
    renderWebsiteIcon(container, {
      url: shortcut.url,
      label: shortcut.name,
      iconMode: mode,
      cachedUrl,
      size: 40,
      minimumSourceSize: 96,
      loading: 'eager',
    });
  };
  if (shortcut.icon) {
    const image = document.createElement('img');
    image.className = 'custom-icon';
    image.src = shortcut.icon;
    image.alt = shortcut.name || '自定义图标';
    image.referrerPolicy = 'no-referrer';
    image.loading = 'eager';
    image.onerror = () => {
      container.innerHTML = '';
      void renderAutomaticIcon();
    };
    container.appendChild(image);
    return;
  }
  await renderAutomaticIcon();
}

function createRemoveButton(path, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shortcut-remove';
  button.textContent = '−';
  button.draggable = false;
  button.setAttribute('aria-label', `删除${label}`);
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await deleteShortcutAtPath(path);
  });
  return button;
}

function createFolderIcon(folder, iconMode, cachedSources) {
  const icon = document.createElement('div');
  icon.className = 'shortcut-icon folder-icon';
  folder.children.slice(0, 4).forEach((child) => {
    const preview = document.createElement('span');
    preview.className = 'folder-icon-item';
    icon.appendChild(preview);
    renderIcon(preview, child, iconMode, cachedSources);
  });
  return icon;
}

function createShortcutElement(item, path, iconMode, cachedSources, insideFolder = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `shortcut-item${isShortcutFolder(item) ? ' shortcut-folder' : ''}`;
  if (insideFolder) wrapper.classList.add('folder-child');
  wrapper.draggable = true;
  wrapper.dataset.path = path;
  wrapper.dataset.kind = isShortcutFolder(item) ? 'folder' : 'shortcut';
  wrapper.tabIndex = -1;

  let opener;
  if (isShortcutFolder(item)) {
    opener = document.createElement('button');
    opener.type = 'button';
    opener.addEventListener('click', () => {
      if (wrapper.classList.contains('management-target')) return;
      if (isShortcutManagementActive()) exitShortcutManagement();
      openShortcutFolder(Number(parsePath(path)[0]));
    });
    opener.appendChild(createFolderIcon(item, iconMode, cachedSources));
  } else {
    opener = document.createElement('a');
    opener.href = normalizeShortcutUrl(item.url);
    opener.addEventListener('click', (event) => {
      if (wrapper.classList.contains('management-target')) {
        event.preventDefault();
      } else if (isShortcutManagementActive()) {
        exitShortcutManagement();
      }
    });
    const icon = document.createElement('div');
    icon.className = 'shortcut-icon';
    opener.appendChild(icon);
    renderIcon(icon, item, iconMode, cachedSources);
  }
  opener.className = 'shortcut-open';
  opener.title = isShortcutFolder(item) ? `打开${item.name}` : item.name;
  opener.setAttribute('aria-label', isShortcutFolder(item) ? `打开文件夹${item.name}` : item.name);

  const name = document.createElement('span');
  name.className = 'shortcut-name';
  name.textContent = item.name;
  opener.appendChild(name);
  wrapper.append(opener, createRemoveButton(path, item.name));

  wrapper.addEventListener('dragstart', onDragStart);
  wrapper.addEventListener('dragend', onDragEnd);
  wrapper.addEventListener('dragover', onDragOver);
  wrapper.addEventListener('dragenter', onDragEnter);
  wrapper.addEventListener('dragleave', onDragLeave);
  wrapper.addEventListener('drop', onDrop);
  wrapper.addEventListener('keydown', async (event) => {
    if (!isShortcutManagementActive() || !['Backspace', 'Delete'].includes(event.key)) return;
    event.preventDefault();
    await deleteShortcutAtPath(path);
  });
  return wrapper;
}

export async function renderShortcuts() {
  if (!gridEl) return;
  const [shortcuts, settings] = await Promise.all([storage.getShortcuts(), storage.getSettings()]);
  const urls = shortcuts.flatMap((item) => (
    isShortcutFolder(item) ? item.children.map((child) => child.url) : [item.url]
  ));
  const cachedSources = settings.iconMode === 'favicon'
    ? await cachedFaviconSources(urls) : {};
  gridEl.innerHTML = '';
  shortcuts.forEach((item, index) => {
    if (isShortcutFolder(item) ? !item.children.length : !normalizeShortcutUrl(item.url)) return;
    const element = createShortcutElement(item, String(index), settings.iconMode, cachedSources);
    gridEl.appendChild(element);
  });
  gridEl.classList.toggle('empty', gridEl.childElementCount === 0);
  applyShortcutLayout(settings);
  syncManagementDom();
}

function dropModeForEvent(event, target) {
  const sourceParts = parsePath(dragPath);
  const targetParts = parsePath(target.dataset.path);
  const targetIcon = target.querySelector('.shortcut-icon');
  const rect = targetIcon?.getBoundingClientRect?.();
  const overIcon = rect && event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  const sourceIsFolder = dragSrcEl?.dataset.kind === 'folder';
  if (overIcon && !sourceIsFolder && (targetParts.length === 1 || sourceParts[0] !== targetParts[0])) {
    return 'group';
  }
  const targetRect = target.getBoundingClientRect();
  return event.clientX < targetRect.left + targetRect.width / 2 ? 'before' : 'after';
}

function clearDragClasses() {
  document.querySelectorAll('.shortcut-item').forEach((element) => {
    element.classList.remove('drag-over', 'folder-target', 'drop-before', 'drop-after');
  });
}

function onDragStart(event) {
  dragSrcEl = this;
  dragPath = this.dataset.path;
  this.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragPath);
}

function onDragEnd() {
  this.classList.remove('dragging');
  dragSrcEl = null;
  dragPath = '';
  clearDragClasses();
}

function onDragOver(event) {
  if (!dragSrcEl || this === dragSrcEl) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';
  const mode = dropModeForEvent(event, this);
  clearDragClasses();
  this.classList.add('drag-over');
  this.classList.add(mode === 'group' ? 'folder-target' : `drop-${mode}`);
}

function onDragEnter(event) {
  if (this !== dragSrcEl) event.preventDefault();
}

function onDragLeave(event) {
  if (this.contains(event.relatedTarget)) return;
  this.classList.remove('drag-over', 'folder-target', 'drop-before', 'drop-after');
}

async function onDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!dragSrcEl || this === dragSrcEl) return;
  const sourcePath = dragPath;
  const targetPath = this.dataset.path;
  const mode = dropModeForEvent(event, this);
  const list = await storage.getShortcuts();
  const targetWasFolder = isShortcutFolder(itemAtPath(list, targetPath));
  const next = rearrangeShortcutList(list, sourcePath, targetPath, mode);
  await saveShortcutList(next, mode === 'group' ? 'folder' : 'move');
  if (mode === 'group') showToast(targetWasFolder ? '已加入文件夹。' : '已创建文件夹。');
  await renderShortcuts();
  if (!folderModal.classList.contains('hidden')) await renderOpenFolder();
}

async function moveNestedShortcutToDesktop(path) {
  const list = deepCopy(await storage.getShortcuts());
  const item = removeAtPath(list, path);
  if (!item) return;
  list.push(item);
  dissolveSmallFolders(list);
  await saveShortcutList(list, 'move');
  closeShortcutFolder();
  await renderShortcuts();
  showToast('已移回首页。');
}

export function enterShortcutManagement(path = '') {
  managedPath = path;
  document.body.classList.add('shortcut-managing');
  syncManagementDom();
  if (path) document.querySelector(`.shortcut-item[data-path="${path}"]`)?.focus();
}

export function exitShortcutManagement() {
  managedPath = '';
  document.body.classList.remove('shortcut-managing');
  syncManagementDom();
}

export function isShortcutManagementActive() {
  return document.body.classList.contains('shortcut-managing');
}

function syncManagementDom() {
  document.querySelectorAll('.shortcut-item').forEach((item) => {
    const isTarget = !!managedPath && item.dataset.path === managedPath;
    item.classList.toggle('management-target', isTarget);
    item.tabIndex = isTarget ? 0 : -1;
  });
}

export async function deleteShortcutAtPath(path) {
  const list = await storage.getShortcuts();
  const item = itemAtPath(list, path);
  if (!item) return;
  const next = deepCopy(list);
  removeAtPath(next, path);
  dissolveSmallFolders(next);
  await saveShortcutList(next, 'delete');
  exitShortcutManagement();
  const deletedPath = parsePath(path);
  if (!folderModal.classList.contains('hidden')
      && (deletedPath.length === 1 || !isShortcutFolder(next[openedFolderIndex]))) {
    closeShortcutFolder();
  }
  await renderShortcuts();
  if (!folderModal.classList.contains('hidden')) await renderOpenFolder();
  showToast(`已删除“${item.name}”，按 Command/Ctrl+Z 可撤销。`);
}

export async function undoLastShortcutChange() {
  if (!canUndoShortcutChange || sessionUndoCount < 1) {
    showToast('本次打开后没有可撤销的快捷方式变更。');
    return false;
  }
  const previous = await storage.restoreLastShortcutSnapshot();
  if (!previous) {
    canUndoShortcutChange = false;
    sessionUndoCount = 0;
    showToast('没有可撤销的快捷方式变更。');
    return false;
  }
  document.dispatchEvent(new document.defaultView.Event('shortcut-tree-changed'));
  await renderShortcuts();
  if (!folderModal.classList.contains('hidden')) await renderOpenFolder();
  sessionUndoCount = Math.max(0, sessionUndoCount - 1);
  canUndoShortcutChange = sessionUndoCount > 0;
  showToast('已撤销上一次快捷方式变更。');
  return true;
}

export async function openShortcutEditor(path, parentIndex = -1) {
  const list = await storage.getShortcuts();
  const normalizedPath = Number.isInteger(path) ? String(path) : String(path ?? '');
  const existing = normalizedPath && normalizedPath !== '-1' ? itemAtPath(list, normalizedPath) : null;
  if (isShortcutFolder(existing)) {
    await openShortcutFolder(parsePath(normalizedPath)[0], true);
    return;
  }
  editorPath = existing ? normalizedPath : '';
  editorParentIndex = Number.isInteger(parentIndex) ? parentIndex : -1;
  editorDraft = existing ? { ...existing, size: '1x1' } : { name: '', url: '', size: '1x1', icon: null };
  editorTitle.textContent = existing ? '编辑快捷方式' : (editorParentIndex >= 0 ? '添加到文件夹' : '添加快捷方式');
  editorName.value = editorDraft.name || '';
  editorUrl.value = editorDraft.url || '';
  editorUrl.setCustomValidity('');
  editorDelete.classList.toggle('hidden', !existing);
  await syncEditorIcon();
  editorModal.classList.remove('hidden');
  editorName.focus();
}

function closeShortcutEditor() {
  editorModal.classList.add('hidden');
  iconPreviewModal.classList.add('hidden');
  editorPath = '';
  editorParentIndex = -1;
  editorDraft = null;
}

async function syncEditorIcon() {
  if (!editorDraft) return;
  editorIconReset.classList.toggle('hidden', !editorDraft.icon);
  await renderIcon(editorIconPreview, editorDraft);
}

async function saveEditor() {
  if (!editorDraft) return;
  const name = editorName.value.trim();
  const url = normalizeShortcutUrl(editorUrl.value);
  if (!url) {
    editorUrl.setCustomValidity('请输入有效的 http:// 或 https:// 地址。');
    editorUrl.reportValidity();
    return;
  }
  editorUrl.setCustomValidity('');
  const nextItem = { ...editorDraft, name, url, size: '1x1' };
  const list = await storage.getShortcuts();
  if (editorPath && itemAtPath(list, editorPath)) {
    const [topIndex, childIndex] = parsePath(editorPath);
    if (Number.isInteger(childIndex)) list[topIndex].children[childIndex] = nextItem;
    else list[topIndex] = nextItem;
  } else if (editorParentIndex >= 0 && isShortcutFolder(list[editorParentIndex])) {
    list[editorParentIndex].children.push(nextItem);
  } else {
    list.push(nextItem);
  }
  await saveShortcutList(list, editorPath ? 'edit' : 'add');
  closeShortcutEditor();
  await renderShortcuts();
  if (!folderModal.classList.contains('hidden')) await renderOpenFolder();
}

async function deleteEditorShortcut() {
  if (!editorPath) return;
  const path = editorPath;
  closeShortcutEditor();
  await deleteShortcutAtPath(path);
}

function initEditor() {
  editorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (editorForm.reportValidity()) saveEditor();
  });
  document.getElementById('shortcut-editor-close').addEventListener('click', closeShortcutEditor);
  document.getElementById('shortcut-editor-cancel').addEventListener('click', closeShortcutEditor);
  editorDelete.addEventListener('click', deleteEditorShortcut);
  editorIconReset.addEventListener('click', async () => {
    if (!editorDraft) return;
    editorDraft.icon = null;
    await syncEditorIcon();
  });
  document.getElementById('shortcut-editor-icon').addEventListener('click', triggerIconUpload);
  editorModal.addEventListener('click', (event) => {
    if (event.target === editorModal) closeShortcutEditor();
  });
}

function triggerIconUpload() {
  if (!editorDraft) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      const dataUrl = await downsampleToSquare(loadEvent.target.result, 128);
      if (!dataUrl) return;
      iconPreviewImg.src = dataUrl;
      iconPreviewModal.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

function downsampleToSquare(dataUrl, size = 128) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const side = Math.min(image.width, image.height);
      const sx = (image.width - side) / 2;
      const sy = (image.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      try {
        context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function initIconPreview() {
  document.getElementById('icon-preview-cancel').addEventListener('click', () => iconPreviewModal.classList.add('hidden'));
  document.getElementById('icon-preview-save').addEventListener('click', async () => {
    if (!editorDraft) return;
    editorDraft.icon = iconPreviewImg.src;
    iconPreviewModal.classList.add('hidden');
    await syncEditorIcon();
  });
  iconPreviewModal.addEventListener('click', (event) => {
    if (event.target === iconPreviewModal) iconPreviewModal.classList.add('hidden');
  });
}

async function saveFolderName() {
  const list = await storage.getShortcuts();
  const folder = list[openedFolderIndex];
  if (!isShortcutFolder(folder)) return;
  const value = folderName.value.trim().slice(0, 32) || DEFAULT_FOLDER_NAME;
  folder.name = value;
  folderName.value = value;
  await saveShortcutList(list, 'rename-folder');
  await renderShortcuts();
}

async function renderOpenFolder() {
  const [list, settings] = await Promise.all([storage.getShortcuts(), storage.getSettings()]);
  const folder = list[openedFolderIndex];
  if (!isShortcutFolder(folder)) {
    closeShortcutFolder();
    return;
  }
  folderModal.dataset.index = String(openedFolderIndex);
  folderName.value = folder.name;
  const cachedSources = settings.iconMode === 'favicon'
    ? await cachedFaviconSources(folder.children.map((child) => child.url)) : {};
  folderGrid.innerHTML = '';
  folder.children.forEach((child, childIndex) => {
    folderGrid.appendChild(createShortcutElement(
      child,
      `${openedFolderIndex}/${childIndex}`,
      settings.iconMode,
      cachedSources,
      true
    ));
  });
  syncManagementDom();
}

export async function openShortcutFolder(index, focusName = false) {
  const list = await storage.getShortcuts();
  if (!isShortcutFolder(list[index])) return;
  openedFolderIndex = index;
  folderModal.classList.remove('hidden');
  await renderOpenFolder();
  if (focusName) {
    folderName.focus();
    folderName.select();
  } else {
    folderGrid.querySelector('.shortcut-open')?.focus();
  }
}

function closeShortcutFolder() {
  folderModal?.classList.add('hidden');
  if (folderModal) folderModal.dataset.index = '';
  openedFolderIndex = -1;
  exitShortcutManagement();
}

function initFolder() {
  document.getElementById('shortcut-folder-close').addEventListener('click', closeShortcutFolder);
  document.getElementById('shortcut-folder-add').addEventListener('click', () => openShortcutEditor(-1, openedFolderIndex));
  folderName.addEventListener('change', saveFolderName);
  folderName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveFolderName();
      folderName.blur();
    }
  });
  folderModal.addEventListener('click', (event) => {
    if (event.target === folderModal) closeShortcutFolder();
  });
  folderModal.addEventListener('dragover', (event) => {
    if (event.target !== folderModal || parsePath(dragPath).length < 2) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    folderModal.classList.add('move-out-target');
  });
  folderModal.addEventListener('dragleave', (event) => {
    if (event.target === folderModal) folderModal.classList.remove('move-out-target');
  });
  folderModal.addEventListener('drop', async (event) => {
    folderModal.classList.remove('move-out-target');
    if (event.target !== folderModal || parsePath(dragPath).length < 2) return;
    event.preventDefault();
    await moveNestedShortcutToDesktop(dragPath);
  });
}

export function activeShortcutFolderIndex() {
  return openedFolderIndex;
}

export function initShortcuts() {
  gridEl = document.getElementById('shortcuts-grid');
  sessionUndoCount = 0;
  canUndoShortcutChange = false;
  editorModal = document.getElementById('shortcut-editor-modal');
  editorForm = document.getElementById('shortcut-editor-form');
  editorTitle = document.getElementById('shortcut-editor-title');
  editorName = document.getElementById('shortcut-editor-name');
  editorUrl = document.getElementById('shortcut-editor-url');
  editorDelete = document.getElementById('shortcut-editor-delete');
  editorIconPreview = document.getElementById('shortcut-editor-icon-preview');
  editorIconReset = document.getElementById('shortcut-editor-icon-reset');
  iconPreviewModal = document.getElementById('icon-preview-modal');
  iconPreviewImg = document.getElementById('icon-preview-img');
  folderModal = document.getElementById('shortcut-folder-modal');
  folderGrid = document.getElementById('shortcut-folder-grid');
  folderName = document.getElementById('shortcut-folder-name');

  initEditor();
  initIconPreview();
  initFolder();
  gridEl.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const openers = Array.from(gridEl.querySelectorAll('.shortcut-open'));
    const current = openers.indexOf(event.target.closest('.shortcut-open'));
    if (current < 0 || !openers.length) return;
    const columns = Math.max(1, Math.ceil(openers.length / layoutRows));
    const row = Math.floor(current / columns);
    const column = current % columns;
    const lastRow = Math.floor((openers.length - 1) / columns);
    let next = current;
    if (event.key === 'ArrowLeft' && column > 0) next = current - 1;
    if (event.key === 'ArrowRight' && column < columns - 1 && current + 1 < openers.length) {
      next = current + 1;
    }
    if (event.key === 'ArrowUp' && row > 0) next = current - columns;
    if (event.key === 'ArrowDown' && row < lastRow) {
      next = Math.min(openers.length - 1, current + columns);
    }
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = openers.length - 1;
    next = Math.max(0, Math.min(openers.length - 1, next));
    if (next === current) return;
    event.preventDefault();
    openers[next].focus();
  });
  gridEl.parentElement.addEventListener('wheel', (event) => {
    const panel = gridEl.parentElement;
    if (panel.scrollWidth <= panel.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    wheelDelta += event.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const columns = Math.max(1, Math.round(Math.abs(wheelDelta) / shortcutColumnWidth()));
      panel.scrollBy({ left: Math.sign(wheelDelta) * columns * shortcutColumnWidth(), behavior: 'smooth' });
      wheelDelta = 0;
    }, 60);
  }, { passive: false });
  window.addEventListener('resize', scheduleShortcutOverflow, { passive: true });
  document.addEventListener('click', (event) => {
    if (!isShortcutManagementActive()) return;
    if (event.target.closest('#shortcuts-section, #shortcut-folder-modal, #context-menu')) return;
    exitShortcutManagement();
  });
  document.addEventListener('keydown', (event) => {
    const input = event.target?.matches?.('input, textarea, [contenteditable="true"]');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !input && canUndoShortcutChange) {
      event.preventDefault();
      undoLastShortcutChange();
      return;
    }
    if (event.key !== 'Escape') return;
    if (!iconPreviewModal.classList.contains('hidden')) iconPreviewModal.classList.add('hidden');
    else if (!editorModal.classList.contains('hidden')) closeShortcutEditor();
    else if (!folderModal.classList.contains('hidden')) closeShortcutFolder();
    else exitShortcutManagement();
  });
  renderShortcuts();

  state.subscribe(async (changedKeys) => {
    if (!iconPreviewModal.classList.contains('hidden')) return;
    if (!changedKeys || changedKeys.includes('iconMode')) {
      await renderShortcuts();
      if (!folderModal.classList.contains('hidden')) await renderOpenFolder();
      return;
    }
    if (changedKeys.some((key) => [
      'shortcutRows', 'shortcutColumns', 'shortcutIconSize', 'contentDensity',
    ].includes(key))) {
      applyShortcutLayout(await storage.getSettings(), true);
    }
  });
}

export function hasUndoableShortcutChange() {
  return canUndoShortcutChange && sessionUndoCount > 0;
}
