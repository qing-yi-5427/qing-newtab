/** Lightweight editor for a browser bookmark or bookmark-folder name. */

import {
  normalizeEditableBookmarkUrl,
  updateBookmarkNode,
} from './bookmarks.js';
import { showToast } from './toast.js';

let modal;
let form;
let titleEl;
let nameInput;
let urlRow;
let urlInput;
let editing = null;

function closeEditor() {
  modal.classList.add('hidden');
  editing = null;
  form.reset();
  urlInput.setCustomValidity('');
}

export function openBookmarkEditor(item) {
  if (!item?.id) return;
  editing = { ...item };
  const folder = item.type === 'folder';
  titleEl.textContent = folder ? '重命名书签文件夹' : '编辑书签';
  nameInput.value = item.title || '';
  urlInput.value = folder ? '' : item.url || '';
  urlRow.classList.toggle('hidden', folder);
  urlInput.required = !folder;
  modal.classList.remove('hidden');
  nameInput.focus();
  nameInput.select();
}

export function initBookmarkEditor() {
  modal = document.getElementById('bookmark-editor-modal');
  form = document.getElementById('bookmark-editor-form');
  titleEl = document.getElementById('bookmark-editor-title');
  nameInput = document.getElementById('bookmark-editor-name');
  urlRow = document.getElementById('bookmark-editor-url-row');
  urlInput = document.getElementById('bookmark-editor-url');

  document.getElementById('bookmark-editor-close').addEventListener('click', closeEditor);
  document.getElementById('bookmark-editor-cancel').addEventListener('click', closeEditor);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeEditor();
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEditor();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editing) return;
    const title = nameInput.value.trim().slice(0, 255);
    if (!title) {
      nameInput.setCustomValidity('名称不能为空。');
      nameInput.reportValidity();
      return;
    }
    nameInput.setCustomValidity('');
    const changes = { title };
    if (editing.type !== 'folder') {
      const url = normalizeEditableBookmarkUrl(urlInput.value);
      if (!url) {
        urlInput.setCustomValidity('请输入有效的网址。');
        urlInput.reportValidity();
        return;
      }
      urlInput.setCustomValidity('');
      changes.url = url;
    }
    try {
      const wasFolder = editing.type === 'folder';
      await updateBookmarkNode(editing.id, changes);
      closeEditor();
      showToast(wasFolder ? '书签文件夹已重命名。' : '书签已更新。');
    } catch {
      showToast('书签更新失败。', true);
    }
  });
}
