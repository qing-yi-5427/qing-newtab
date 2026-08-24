/** Page-level context menu for shortcut actions and preferences. */

import {
  activeShortcutFolderIndex,
  enterShortcutManagement,
  exitShortcutManagement,
  hasUndoableShortcutChange,
  isShortcutManagementActive,
  openShortcutEditor,
  undoLastShortcutChange,
} from './shortcuts.js';
import { openSettings } from './settings.js';
import { showToast } from './toast.js';
import { BROWSER_PAGES, openBrowserPage } from './browser-pages.js';
import { removeBookmarkNode } from './bookmarks.js';
import { openBookmarkEditor } from './bookmark-editor.js';

let menu = null;
let editButton = null;
let targetShortcutPath = '';
let insertionFolderIndex = -1;
let targetBookmark = null;

function closeMenu() {
  if (!menu) return;
  menu.classList.add('hidden');
  targetShortcutPath = '';
  insertionFolderIndex = -1;
  targetBookmark = null;
}

function positionMenu(event) {
  menu.classList.remove('hidden');
  const fallback = event.target?.getBoundingClientRect?.();
  const x = event.clientX || fallback?.left || 12;
  const y = event.clientY || fallback?.bottom || 12;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function initContextMenu() {
  menu = document.getElementById('context-menu');
  editButton = document.getElementById('context-edit-shortcut');
  const addButton = document.getElementById('context-add-shortcut');
  const settingsButton = document.getElementById('context-settings');
  const exportBackupButton = document.getElementById('context-export-backup');
  const importBackupButton = document.getElementById('context-import-backup');
  const finishManagingButton = document.getElementById('context-finish-managing');
  const undoButton = document.getElementById('context-undo-shortcut');
  const bookmarkOpenButton = document.getElementById('context-open-bookmark');
  const bookmarkEditButton = document.getElementById('context-edit-bookmark');
  const bookmarkRenameFolderButton = document.getElementById('context-rename-bookmark-folder');
  const bookmarkDeleteButton = document.getElementById('context-delete-bookmark');
  const bookmarkSeparator = document.getElementById('context-bookmark-separator');

  document.addEventListener('contextmenu', (event) => {
    if (event.altKey || event.target.closest(
      '#context-menu, #settings-modal, #bookmark-editor-modal, #shortcut-editor-modal, #icon-preview-modal'
    )) return;
    const shortcut = event.target.closest('.shortcut-item');
    const bookmark = event.target.closest('.bm-link');
    const bookmarkFolder = event.target.closest('.bm-folder-tab');
    const bookmarkTarget = bookmark || bookmarkFolder;
    if (!shortcut && !bookmarkTarget && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) {
      return;
    }

    event.preventDefault();
    if (bookmarkTarget) {
      exitShortcutManagement();
      targetBookmark = bookmark ? {
        type: 'bookmark',
        id: bookmark.dataset.bookmarkId,
        title: bookmark.dataset.bookmarkTitle || bookmark.title || bookmark.href,
        url: bookmark.href,
      } : {
        type: 'folder',
        id: bookmarkFolder.dataset.bookmarkFolderId,
        title: bookmarkFolder.dataset.bookmarkFolderTitle || bookmarkFolder.textContent,
      };
      editButton.classList.add('hidden');
      addButton.classList.add('hidden');
      finishManagingButton.classList.add('hidden');
      undoButton.classList.add('hidden');
      bookmarkOpenButton.classList.toggle('hidden', targetBookmark.type !== 'bookmark');
      bookmarkEditButton.classList.toggle('hidden', targetBookmark.type !== 'bookmark');
      bookmarkRenameFolderButton.classList.toggle('hidden', targetBookmark.type !== 'folder');
      bookmarkDeleteButton.classList.toggle('hidden', targetBookmark.type !== 'bookmark');
      bookmarkSeparator.classList.remove('hidden');
      positionMenu(event);
      menu.querySelector('button:not(.hidden)')?.focus();
      return;
    }

    [bookmarkOpenButton, bookmarkEditButton, bookmarkRenameFolderButton, bookmarkDeleteButton]
      .forEach((button) => button.classList.add('hidden'));
    bookmarkSeparator.classList.add('hidden');
    targetShortcutPath = shortcut?.dataset.path || '';
    const pathParts = targetShortcutPath.split('/');
    insertionFolderIndex = pathParts.length > 1 || shortcut?.dataset.kind === 'folder'
      ? Number(pathParts[0])
      : (event.target.closest('#shortcut-folder-modal') ? activeShortcutFolderIndex() : -1);
    if (targetShortcutPath) enterShortcutManagement(targetShortcutPath);
    editButton.classList.toggle('hidden', !targetShortcutPath);
    addButton.classList.remove('hidden');
    undoButton.classList.toggle('hidden', !hasUndoableShortcutChange());
    editButton.textContent = shortcut?.dataset.kind === 'folder' ? '打开并重命名文件夹' : '编辑快捷方式';
    addButton.textContent = insertionFolderIndex >= 0 ? '添加到此文件夹' : '添加快捷方式';
    finishManagingButton.classList.toggle('hidden', !isShortcutManagementActive());
    positionMenu(event);
    const first = menu.querySelector('button:not(.hidden)');
    first?.focus();
  });

  editButton.addEventListener('click', () => {
    const path = targetShortcutPath;
    closeMenu();
    if (path) openShortcutEditor(path);
  });
  addButton.addEventListener('click', () => {
    const parentIndex = insertionFolderIndex;
    closeMenu();
    openShortcutEditor(-1, parentIndex);
  });
  finishManagingButton.addEventListener('click', () => {
    closeMenu();
    exitShortcutManagement();
  });
  undoButton.addEventListener('click', () => {
    closeMenu();
    void undoLastShortcutChange();
  });
  bookmarkOpenButton.addEventListener('click', () => {
    const item = targetBookmark;
    closeMenu();
    if (!item?.url) return;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void Promise.resolve(chrome.tabs.create({ url: item.url }))
        .catch(() => showToast('无法打开书签。', true));
    } else {
      window.open(item.url, '_blank', 'noopener');
    }
  });
  bookmarkEditButton.addEventListener('click', () => {
    const item = targetBookmark;
    closeMenu();
    if (item) openBookmarkEditor(item);
  });
  bookmarkRenameFolderButton.addEventListener('click', () => {
    const item = targetBookmark;
    closeMenu();
    if (item) openBookmarkEditor(item);
  });
  bookmarkDeleteButton.addEventListener('click', async () => {
    const item = targetBookmark;
    closeMenu();
    if (!item?.id || !window.confirm(`确认删除书签“${item.title}”吗？`)) return;
    try {
      await removeBookmarkNode(item.id);
      showToast('书签已删除。');
    } catch {
      showToast('书签删除失败。', true);
    }
  });
  Object.keys(BROWSER_PAGES).forEach((name) => {
    document.getElementById(`context-${name}`).addEventListener('click', () => {
      closeMenu();
      void openBrowserPage(name).then((opened) => {
        if (!opened) showToast('无法打开浏览器页面。', true);
      });
    });
  });
  settingsButton.addEventListener('click', () => {
    closeMenu();
    openSettings();
  });
  exportBackupButton.addEventListener('click', () => {
    closeMenu();
    document.getElementById('settings-export').click();
  });
  importBackupButton.addEventListener('click', () => {
    closeMenu();
    document.getElementById('settings-import-file').click();
  });

  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('shortcut-tree-changed', closeMenu);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (menu.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(menu.querySelectorAll('button:not(.hidden)'));
    const current = items.indexOf(document.activeElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    items[(current + direction + items.length) % items.length]?.focus();
  });
}
