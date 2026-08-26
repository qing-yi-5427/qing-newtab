/** Homepage bookmark list grouped by browser folder. */

import * as storage from './storage.js';
import * as state from './state.js';
import {
  cachedFaviconSources,
  hostFromUrl,
  renderWebsiteIcon,
} from './favicon.js';

let treeEl = null;
let countEl = null;
let loaded = false;
let renderedIconMode = null;
let reloadTimer = null;
let selectedFolderKey = null;
let renderedCachedSources = {};
let draggedBookmark = null;
let suppressBookmarkClickUntil = 0;

function formatUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function renderIcon(container, url, name, iconMode) {
  const label = name || hostFromUrl(url) || '?';
  renderWebsiteIcon(container, {
    url,
    label,
    iconMode,
    cachedUrl: renderedCachedSources[hostFromUrl(url)],
    size: 18,
    minimumSourceSize: 32,
    loading: 'lazy',
  });
}

export function collectGroups(nodes, path = [], groups = []) {
  for (const node of nodes || []) {
    if (node.url) continue;
    const title = String(node.title || '').trim();
    const nextPath = title ? [...path, title] : path;
    const children = node.children || [];
    const links = children.filter((child) => child.url);
    if (links.length) {
      groups.push({
        id: node.id,
        parentId: node.parentId,
        index: Number.isInteger(node.index) ? node.index : groups.length,
        key: nextPath.join('/') || '书签',
        title: title || nextPath.at(-1) || '书签',
        links,
      });
    }
    collectGroups(children.filter((child) => child.children), nextPath, groups);
  }
  return groups;
}

export function bookmarkMoveDestination(sourceIndex, targetIndex, placement = 'before') {
  const source = Math.max(0, Math.round(Number(sourceIndex) || 0));
  const target = Math.max(0, Math.round(Number(targetIndex) || 0));
  let destination = target + (placement === 'after' ? 1 : 0);
  if (source < destination) destination -= 1;
  return Math.max(0, destination);
}

function clearBookmarkDropState() {
  treeEl?.querySelectorAll('.bm-link, .bm-folder-tab').forEach((element) => {
    element.classList.remove('dragging', 'drop-before', 'drop-after');
  });
}

function bookmarkDropPlacement(event, element) {
  const rect = element.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

export async function moveBookmarkNode(id, parentId, index) {
  if (!id || !parentId || typeof chrome === 'undefined' || !chrome.bookmarks?.move) return false;
  await chrome.bookmarks.move(String(id), {
    parentId: String(parentId),
    index: Math.max(0, Math.round(Number(index) || 0)),
  });
  notifyBookmarkChange();
  return true;
}

function enableBookmarkDragging(element, item) {
  element.draggable = true;
  element.dataset.bookmarkParentId = item.parentId || '';
  element.dataset.bookmarkIndex = String(item.index);
  element.addEventListener('dragstart', (event) => {
    draggedBookmark = {
      type: item.type,
      id: item.id,
      parentId: item.parentId || '',
      index: item.index,
    };
    element.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(item.id));
    }
  });
  element.addEventListener('dragover', (event) => {
    if (!draggedBookmark
        || draggedBookmark.type !== item.type
        || draggedBookmark.parentId !== (item.parentId || '')
        || draggedBookmark.id === item.id) return;
    event.preventDefault();
    clearBookmarkDropState();
    element.classList.add(`drop-${bookmarkDropPlacement(event, element)}`);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });
  element.addEventListener('dragleave', () => {
    element.classList.remove('drop-before', 'drop-after');
  });
  element.addEventListener('drop', async (event) => {
    if (!draggedBookmark
        || draggedBookmark.type !== item.type
        || draggedBookmark.parentId !== (item.parentId || '')
        || draggedBookmark.id === item.id) return;
    event.preventDefault();
    const source = draggedBookmark;
    const placement = bookmarkDropPlacement(event, element);
    const destination = bookmarkMoveDestination(source.index, item.index, placement);
    suppressBookmarkClickUntil = Date.now() + 300;
    draggedBookmark = null;
    clearBookmarkDropState();
    if (destination === source.index) return;
    try {
      await moveBookmarkNode(source.id, item.parentId, destination);
    } catch {
      scheduleReload();
    }
  });
  element.addEventListener('dragend', () => {
    suppressBookmarkClickUntil = Date.now() + 300;
    draggedBookmark = null;
    clearBookmarkDropState();
  });
}

function renderBookmark(node, iconMode, parentId, index) {
  const link = document.createElement('a');
  link.className = 'bm-link';
  link.href = node.url;
  link.dataset.bookmarkId = node.id;
  link.dataset.bookmarkTitle = node.title || '';
  link.title = node.title || node.url;
  link.setAttribute('role', 'listitem');
  link.addEventListener('click', (event) => {
    if (Date.now() < suppressBookmarkClickUntil) event.preventDefault();
  });
  enableBookmarkDragging(link, {
    type: 'bookmark',
    id: node.id,
    parentId,
    index: Number.isInteger(node.index) ? node.index : index,
  });

  const icon = document.createElement('span');
  icon.className = 'bm-link-icon';
  link.appendChild(icon);
  renderIcon(icon, node.url, node.title, iconMode);

  const text = document.createElement('span');
  text.className = 'bm-link-text';
  const title = document.createElement('span');
  title.className = 'bm-link-title';
  title.textContent = node.title || formatUrl(node.url);
  const domain = document.createElement('span');
  domain.className = 'bm-link-url';
  domain.textContent = formatUrl(node.url);
  text.append(title, domain);
  link.appendChild(text);
  return link;
}

function renderFolderView(groups) {
  const tabs = document.createElement('div');
  tabs.className = 'bm-folder-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '书签文件夹');

  const panel = document.createElement('div');
  panel.className = 'bm-folder-panel';
  panel.setAttribute('role', 'tabpanel');

  const buttons = groups.map((group, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bm-folder-tab';
    button.dataset.bookmarkFolderId = group.id;
    button.dataset.bookmarkFolderTitle = group.title;
    button.setAttribute('role', 'tab');
    button.textContent = group.title;
    const count = document.createElement('span');
    count.textContent = String(group.links.length);
    button.appendChild(count);
    button.addEventListener('click', () => showGroup(index));
    enableBookmarkDragging(button, {
      type: 'folder',
      id: group.id,
      parentId: group.parentId,
      index: group.index,
    });
    tabs.appendChild(button);
    return button;
  });

  function showGroup(index) {
    const group = groups[index] || groups[0];
    if (!group) return;
    selectedFolderKey = group.key;
    void storage.saveSelectedBookmarkFolder(selectedFolderKey);
    buttons.forEach((button, buttonIndex) => {
      const active = buttonIndex === index;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
    panel.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'bm-items';
    list.setAttribute('role', 'list');
    group.links.forEach((bookmark, bookmarkIndex) => {
      list.appendChild(renderBookmark(bookmark, renderedIconMode, group.id, bookmarkIndex));
    });
    panel.appendChild(list);
  }

  tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = (Math.max(0, current) + direction + buttons.length) % buttons.length;
    showGroup(next);
    buttons[next].focus();
  });

  treeEl.append(tabs, panel);
  const initial = Math.max(0, groups.findIndex((group) => group.key === selectedFolderKey));
  showGroup(initial);
}

function notifyBookmarkChange() {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new document.defaultView.Event('bookmark-tree-changed'));
  }
  if (treeEl) scheduleReload();
}

export function normalizeEditableBookmarkUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:', 'file:', 'ftp:', 'edge:', 'chrome:'].includes(parsed.protocol)
      ? parsed.href : '';
  } catch {
    return '';
  }
}

export async function updateBookmarkNode(id, changes) {
  if (!id || typeof chrome === 'undefined' || !chrome.bookmarks?.update) return false;
  await chrome.bookmarks.update(String(id), changes);
  notifyBookmarkChange();
  return true;
}

export async function removeBookmarkNode(id) {
  if (!id || typeof chrome === 'undefined' || !chrome.bookmarks?.remove) return false;
  await chrome.bookmarks.remove(String(id));
  notifyBookmarkChange();
  return true;
}

function showMessage(message) {
  treeEl.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'bm-empty';
  empty.textContent = message;
  treeEl.appendChild(empty);
  countEl.textContent = '';
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    loaded = false;
    loadBookmarks();
  }, 80);
}

export function initBookmarks() {
  treeEl = document.getElementById('bookmarks-tree');
  countEl = document.getElementById('bookmarks-count');

  state.subscribe(async (changedKeys) => {
    if (changedKeys && !changedKeys.includes('iconMode')) return;
    const settings = await storage.getSettings();
    if (loaded && settings.iconMode !== renderedIconMode) scheduleReload();
  });

  if (typeof chrome !== 'undefined' && chrome.bookmarks) {
    const events = [
      chrome.bookmarks.onCreated,
      chrome.bookmarks.onRemoved,
      chrome.bookmarks.onChanged,
      chrome.bookmarks.onMoved,
      chrome.bookmarks.onChildrenReordered,
      chrome.bookmarks.onImportEnded,
    ];
    events.forEach((event) => event?.addListener?.(scheduleReload));
  }
}

export async function loadBookmarks() {
  if (!treeEl || loaded) return;
  loaded = true;
  treeEl.innerHTML = '';
  const [settings, savedFolderKey] = await Promise.all([
    storage.getSettings(),
    storage.getSelectedBookmarkFolder(),
  ]);
  renderedIconMode = settings.iconMode;
  if (!selectedFolderKey) selectedFolderKey = savedFolderKey;

  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    showMessage('当前环境无法读取书签。');
    return;
  }
  try {
    const tree = await chrome.bookmarks.getTree();
    const groups = collectGroups(tree?.[0]?.children || []);
    const total = groups.reduce((sum, group) => sum + group.links.length, 0);
    if (!total) {
      showMessage('还没有书签。');
      return;
    }
    renderedCachedSources = renderedIconMode === 'favicon'
      ? await cachedFaviconSources(groups.flatMap((group) => group.links.map((link) => link.url)))
      : {};
    countEl.textContent = `${total} 个 · ${groups.length} 个文件夹`;
    renderFolderView(groups);
  } catch {
    showMessage('书签加载失败。');
  }
}
