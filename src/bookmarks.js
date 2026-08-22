/** Homepage bookmark list grouped by browser folder. */

import * as storage from './storage.js';
import * as state from './state.js';
import { faviconCandidates, letterAvatarSVG, hostFromUrl } from './favicon.js';

let treeEl = null;
let countEl = null;
let loaded = false;
let renderedIconMode = null;
let reloadTimer = null;
let selectedFolderKey = null;

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
  const renderToken = {};
  container.iconRenderToken = renderToken;
  container.innerHTML = letterAvatarSVG(label, 18);
  if (container.iconRenderToken !== renderToken || iconMode !== 'favicon') return;

  const candidates = faviconCandidates(url);
  if (!candidates.length) return;
  const img = document.createElement('img');
  img.className = 'site-icon';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.loading = 'lazy';
  img.decoding = 'async';
  let candidateIndex = 0;
  const tryNext = () => {
    candidateIndex += 1;
    if (candidateIndex < candidates.length) img.src = candidates[candidateIndex];
  };
  img.onerror = tryNext;
  img.onload = () => {
    if (img.naturalWidth < 32 || img.naturalHeight < 32) {
      tryNext();
      return;
    }
    if (container.iconRenderToken === renderToken) container.replaceChildren(img);
  };
  img.src = candidates[0];
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
        key: nextPath.join('/') || '书签',
        title: title || nextPath.at(-1) || '书签',
        links,
      });
    }
    collectGroups(children.filter((child) => child.children), nextPath, groups);
  }
  return groups;
}

function renderBookmark(node, iconMode) {
  const link = document.createElement('a');
  link.className = 'bm-link';
  link.href = node.url;
  link.title = node.title || node.url;
  link.setAttribute('role', 'listitem');

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
    button.setAttribute('role', 'tab');
    button.textContent = group.title;
    const count = document.createElement('span');
    count.textContent = String(group.links.length);
    button.appendChild(count);
    button.addEventListener('click', () => showGroup(index));
    tabs.appendChild(button);
    return button;
  });

  function showGroup(index) {
    const group = groups[index] || groups[0];
    if (!group) return;
    selectedFolderKey = group.key;
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
    group.links.forEach((bookmark) => list.appendChild(renderBookmark(bookmark, renderedIconMode)));
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
  renderedIconMode = (await storage.getSettings()).iconMode;

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
    countEl.textContent = `${total} 个 · ${groups.length} 个文件夹`;
    renderFolderView(groups);
  } catch {
    showMessage('书签加载失败。');
  }
}
