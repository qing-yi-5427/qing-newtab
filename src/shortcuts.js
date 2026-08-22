/**
 * shortcuts.js
 *
 * Owns shortcut rendering, drag reordering, contextual add/edit interactions,
 * and custom icon uploads. Shortcut management deliberately lives on the new
 * tab page: right-click an existing card to edit it, or right-click empty space
 * in the shortcut panel to add one.
 */

import * as storage from './storage.js';
import * as state from './state.js';
import { faviconCandidates, letterAvatarSVG } from './favicon.js';

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

let dragSrcEl = null;
let editorIndex = -1;
let editorDraft = null;
let firstRender = true;
let wheelDelta = 0;
let wheelTimer = null;

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
      ? '两行显示，滚动查看更多快捷方式'
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
  const columns = Math.max(1, Math.ceil(gridEl.childElementCount / 2));
  const minimumGap = Math.min(gap, 8);
  const visibleColumns = Math.max(1, Math.floor((contentWidth + minimumGap) / (cell + minimumGap)));
  const overflowing = columns > visibleColumns;

  if (overflowing && visibleColumns > 1) {
    const fittedGap = Math.max(0, (contentWidth - visibleColumns * cell) / (visibleColumns - 1));
    gridEl.style.setProperty('--shortcut-column-gap', `${fittedGap}px`);
  } else {
    gridEl.style.removeProperty('--shortcut-column-gap');
  }
  const startedOverflowing = overflowing && !panel.classList.contains('has-overflow');
  panel.classList.toggle('has-overflow', overflowing);
  if (startedOverflowing) panel.scrollLeft = 0;
  panel.title = overflowing
    ? '两行显示，滚动查看更多快捷方式'
    : '右键空白处添加快捷方式';
}

/** Normalize a shortcut destination and reject executable/non-web schemes. */
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

// ---------------------------------------------------------------------------
// Icon rendering
// ---------------------------------------------------------------------------

/** Fill a container with a custom icon, website icon, or letter fallback. */
async function renderIcon(container, sc, iconMode = null) {
  container.innerHTML = '';
  if (sc.icon) {
    const img = document.createElement('img');
    img.className = 'custom-icon';
    img.src = sc.icon;
    img.alt = sc.name || '自定义图标';
    img.referrerPolicy = 'no-referrer';
    img.loading = 'eager';
    container.appendChild(img);
    return;
  }

  const renderToken = {};
  container.iconRenderToken = renderToken;
  container.innerHTML = letterAvatarSVG(sc.name || '?', 40);
  const mode = iconMode || (await storage.getSettings()).iconMode;
  if (container.iconRenderToken !== renderToken) return;

  if (mode === 'favicon') {
    const candidates = faviconCandidates(sc.url);
    if (candidates.length) {
      const img = document.createElement('img');
      img.className = 'site-icon';
      img.alt = sc.name || '网站图标';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'eager';
      img.decoding = 'async';
      let candidateIndex = 0;
      const tryNextCandidate = () => {
        candidateIndex += 1;
        if (candidateIndex < candidates.length) img.src = candidates[candidateIndex];
      };
      img.onerror = tryNextCandidate;
      img.onload = () => {
        // A technically successful 16/32px response is still visibly blurry
        // when rendered at 40px on a high-density display.
        if (img.naturalWidth < 64 || img.naturalHeight < 64) {
          tryNextCandidate();
          return;
        }
        if (container.iconRenderToken === renderToken) container.replaceChildren(img);
      };
      img.src = candidates[0];
    }
  }
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/** Re-render the whole shortcut grid from storage. */
export async function renderShortcuts() {
  if (!gridEl) return;
  const [shortcuts, settings] = await Promise.all([
    storage.getShortcuts(),
    storage.getSettings(),
  ]);
  gridEl.innerHTML = '';

  shortcuts.forEach((sc, i) => {
    const url = normalizeShortcutUrl(sc.url);
    if (!sc.name?.trim() || !url) return;

    const link = document.createElement('a');
    link.className = 'shortcut-item';
    link.href = url;
    link.title = `${sc.name}（右键编辑）`;
    link.draggable = true;
    link.dataset.index = String(i);
    link.setAttribute('aria-label', sc.name);

    const icon = document.createElement('div');
    icon.className = 'shortcut-icon';
    link.appendChild(icon);
    renderIcon(icon, sc, settings.iconMode);

    const name = document.createElement('span');
    name.className = 'shortcut-name';
    name.textContent = sc.name;
    link.appendChild(name);

    link.addEventListener('dragstart', onDragStart);
    link.addEventListener('dragend', onDragEnd);
    link.addEventListener('dragover', onDragOver);
    link.addEventListener('dragenter', onDragEnter);
    link.addEventListener('dragleave', onDragLeave);
    link.addEventListener('drop', onDrop);

    if (firstRender) {
      const delay = 240 + Math.min(i, 11) * 24;
      link.style.animationDelay = `${delay}ms`;
    }

    gridEl.appendChild(link);
  });

  gridEl.classList.toggle('empty', gridEl.childElementCount === 0);
  gridEl.style.setProperty(
    '--shortcut-cols',
    String(Math.max(1, Math.ceil(gridEl.childElementCount / 2)))
  );
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(syncShortcutOverflow);
  else setTimeout(syncShortcutOverflow, 0);
  firstRender = false;
}

function onDragStart(e) {
  dragSrcEl = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.index);
}

function onDragEnd() {
  this.classList.remove('dragging');
  dragSrcEl = null;
  gridEl?.querySelectorAll('.shortcut-item').forEach((el) => el.classList.remove('drag-over'));
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function onDragEnter() {
  if (this !== dragSrcEl) this.classList.add('drag-over');
}

function onDragLeave() {
  this.classList.remove('drag-over');
}

async function onDrop(e) {
  e.preventDefault();
  if (!dragSrcEl || this === dragSrcEl) return;
  this.classList.remove('drag-over');
  const from = Number(dragSrcEl.dataset.index);
  const to = Number(this.dataset.index);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
  const list = await storage.getShortcuts();
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  await storage.saveShortcuts(list);
  await renderShortcuts();
}

// ---------------------------------------------------------------------------
// Contextual editor
// ---------------------------------------------------------------------------

export async function openShortcutEditor(index) {
  const list = await storage.getShortcuts();
  const existing = Number.isInteger(index) && index >= 0 ? list[index] : null;
  editorIndex = existing ? index : -1;
  editorDraft = existing
    ? { ...existing, size: '1x1' }
    : { name: '', url: '', size: '1x1', icon: null };

  editorTitle.textContent = existing ? '编辑快捷方式' : '添加快捷方式';
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
  editorIndex = -1;
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

  const next = { ...editorDraft, name, url, size: '1x1' };
  const list = await storage.getShortcuts();
  if (editorIndex >= 0 && list[editorIndex]) list[editorIndex] = next;
  else list.push(next);
  await storage.saveShortcuts(list);
  closeShortcutEditor();
  await renderShortcuts();
}

async function deleteEditorShortcut() {
  if (editorIndex < 0) return;
  const list = await storage.getShortcuts();
  if (!list[editorIndex]) return;
  list.splice(editorIndex, 1);
  await storage.saveShortcuts(list);
  closeShortcutEditor();
  await renderShortcuts();
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

// ---------------------------------------------------------------------------
// Custom icon upload
// ---------------------------------------------------------------------------

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
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function initIconPreview() {
  document.getElementById('icon-preview-cancel').addEventListener('click', () => {
    iconPreviewModal.classList.add('hidden');
  });
  document.getElementById('icon-preview-save').addEventListener('click', async () => {
    if (!editorDraft) return;
    editorDraft.icon = iconPreviewImg.src;
    iconPreviewModal.classList.add('hidden');
    await syncEditorIcon();
  });
  iconPreviewModal.addEventListener('click', (event) => {
    if (event.target === iconPreviewModal) iconPreviewModal.classList.add('hidden');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!iconPreviewModal.classList.contains('hidden')) {
      iconPreviewModal.classList.add('hidden');
      return;
    }
    if (!editorModal.classList.contains('hidden')) closeShortcutEditor();
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initShortcuts() {
  gridEl = document.getElementById('shortcuts-grid');
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

  initEditor();
  initIconPreview();
  gridEl.parentElement.addEventListener('wheel', (event) => {
    const panel = gridEl.parentElement;
    if (panel.scrollWidth <= panel.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    wheelDelta += event.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const columns = Math.max(1, Math.round(Math.abs(wheelDelta) / shortcutColumnWidth()));
      panel.scrollBy({
        left: Math.sign(wheelDelta) * columns * shortcutColumnWidth(),
        behavior: 'smooth',
      });
      wheelDelta = 0;
    }, 60);
  }, { passive: false });
  window.addEventListener('resize', syncShortcutOverflow);
  renderShortcuts();

  state.subscribe((changedKeys) => {
    if ((!changedKeys || changedKeys.includes('iconMode')) && iconPreviewModal.classList.contains('hidden')) {
      renderShortcuts();
    }
  });
}
