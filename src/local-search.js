/** Unified in-page index for shortcuts, bookmarks and browser tools. */

import * as storage from './storage.js';
import { BROWSER_PAGES } from './browser-pages.js';

let indexPromise = null;

function clean(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function shortcutItems(items, folder = '') {
  const result = [];
  for (const item of items || []) {
    if (item?.type === 'folder' && Array.isArray(item.children)) {
      result.push(...shortcutItems(item.children, item.name || folder));
      continue;
    }
    if (!item?.url) continue;
    result.push({
      type: 'shortcut',
      label: item.name || item.url,
      detail: folder || '快捷方式',
      url: item.url,
    });
  }
  return result;
}

function bookmarkItems(nodes, path = []) {
  const result = [];
  for (const node of nodes || []) {
    if (node.url) {
      result.push({
        type: 'bookmark',
        label: node.title || node.url,
        detail: path.at(-1) || '书签',
        url: node.url,
      });
      continue;
    }
    const title = String(node.title || '').trim();
    result.push(...bookmarkItems(node.children, title ? [...path, title] : path));
  }
  return result;
}

export function rankLocalItems(items, query, limit = 8) {
  const needle = clean(query);
  if (!needle) return [];
  return (items || []).map((item, index) => {
    const label = clean(item.label);
    const detail = clean(item.detail);
    const url = clean(item.url);
    let score = 0;
    if (label === needle) score = 120;
    else if (label.startsWith(needle)) score = 90;
    else if (label.includes(needle)) score = 65;
    else if (detail.includes(needle)) score = 35;
    else if (url.includes(needle)) score = 25;
    return { item, index, score };
  }).filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

async function buildIndex() {
  const shortcuts = shortcutItems(await storage.getShortcuts());
  let bookmarks = [];
  if (typeof chrome !== 'undefined' && chrome.bookmarks?.getTree) {
    try {
      bookmarks = bookmarkItems(await chrome.bookmarks.getTree());
    } catch {
      bookmarks = [];
    }
  }
  const browserPages = Object.entries(BROWSER_PAGES).map(([action, item]) => ({
    type: 'browser',
    action,
    label: item.label,
    detail: '浏览器工具',
    url: item.url,
  }));
  return [...shortcuts, ...bookmarks, ...browserPages];
}

export function invalidateLocalSearch() {
  indexPromise = null;
}

export async function searchLocalItems(query, limit = 8) {
  if (!indexPromise) indexPromise = buildIndex();
  return rankLocalItems(await indexPromise, query, limit);
}

export function initLocalSearchInvalidation() {
  document.addEventListener('shortcut-tree-changed', invalidateLocalSearch);
  document.addEventListener('bookmark-tree-changed', invalidateLocalSearch);
  if (typeof chrome === 'undefined' || !chrome.bookmarks) return;
  [
    chrome.bookmarks.onCreated,
    chrome.bookmarks.onRemoved,
    chrome.bookmarks.onChanged,
    chrome.bookmarks.onMoved,
    chrome.bookmarks.onChildrenReordered,
    chrome.bookmarks.onImportEnded,
  ].forEach((event) => event?.addListener?.(invalidateLocalSearch));
}
