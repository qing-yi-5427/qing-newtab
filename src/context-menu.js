/** Page-level context menu for shortcut actions and preferences. */

import { openShortcutEditor } from './shortcuts.js';
import { openSettings } from './settings.js';

let menu = null;
let editButton = null;
let targetShortcutIndex = -1;

function closeMenu() {
  if (!menu) return;
  menu.classList.add('hidden');
  targetShortcutIndex = -1;
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

  document.addEventListener('contextmenu', (event) => {
    if (event.altKey || event.target.closest('.modal, #context-menu')) return;
    const shortcut = event.target.closest('.shortcut-item');
    if (!shortcut && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) {
      return;
    }

    event.preventDefault();
    targetShortcutIndex = shortcut ? Number(shortcut.dataset.index) : -1;
    editButton.classList.toggle('hidden', targetShortcutIndex < 0);
    positionMenu(event);
    const first = menu.querySelector('button:not(.hidden)');
    first?.focus();
  });

  editButton.addEventListener('click', () => {
    const index = targetShortcutIndex;
    closeMenu();
    if (index >= 0) openShortcutEditor(index);
  });
  addButton.addEventListener('click', () => {
    closeMenu();
    openShortcutEditor(-1);
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
