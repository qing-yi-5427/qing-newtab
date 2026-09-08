import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(await readFile(new URL('../newtab.html', import.meta.url), 'utf8'), { url: 'https://extension.test/' });
for (const key of ['window', 'document', 'localStorage', 'FileReader', 'Image']) globalThis[key] = dom.window[key];
const data = {};
let failWrite = false;
let writes = 0;
globalThis.chrome = { storage: { local: {
  async get(key) { return key === null ? structuredClone(data) : { [key]: structuredClone(data[key]) }; },
  async set(values) { if (failWrite) throw new Error('测试写入失败'); writes++; Object.assign(data, structuredClone(values)); },
  async remove(key) { delete data[key]; },
} } };
const { DEFAULT_SETTINGS } = await import('../src/config.js');
const { initSettings, openSettings } = await import('../src/settings.js');
const { getSettings } = await import('../src/storage.js');
initSettings();
const el = (id) => document.getElementById(id);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function input(id, value) {
  el(id).value = value;
  el(id).dispatchEvent(new window.Event('input', { bubbles: true }));
}
async function reset() {
  failWrite = false; writes = 0;
  for (const key of Object.keys(data)) delete data[key];
  data.nt_settings = { ...DEFAULT_SETTINGS };
  await openSettings();
}

test('rapid edits save the latest values once; cancel and reopen discard drafts', async () => {
  await reset();
  for (const gap of [20, 40, 60, 80]) input('shortcut-gap', String(gap));
  input('shortcut-columns', '4'); input('shortcut-rows', '3');
  assert.equal(writes, 0, 'editing never starts a hidden background save');
  assert.match(el('settings-preview-caption').textContent, /间距 80px/);
  el('settings-done').click(); // Same event turn as the last input.
  await tick();
  assert.equal(writes, 1);
  assert.equal(data.nt_settings.shortcutGap, 80);
  assert.equal(data.nt_settings.shortcutColumns, 4);
  assert.equal(data.nt_settings.shortcutRows, 3);
  assert.ok(el('settings-modal').classList.contains('hidden'));
  await openSettings();
  assert.equal(el('shortcut-gap').value, '80');
  input('shortcut-gap', '0');
  el('settings-cancel').click();
  await openSettings();
  assert.equal(el('shortcut-gap').value, '80');
  el('settings-close').click();
});

test('save errors are visible, preserve the draft and permit retry or cancel', async () => {
  await reset();
  input('shortcut-gap', '42');
  failWrite = true;
  el('settings-done').click(); await tick();
  assert.ok(!el('settings-modal').classList.contains('hidden'));
  assert.match(el('settings-save-status').textContent, /保存失败/);
  assert.equal(el('settings-done').disabled, false);
  assert.equal(el('shortcut-gap').value, '42');
  assert.equal(data.nt_settings.shortcutGap, 16);
  failWrite = false;
  el('settings-done').click(); await tick();
  assert.equal(data.nt_settings.shortcutGap, 42);
  assert.ok(el('settings-modal').classList.contains('hidden'));
  await openSettings(); input('shortcut-gap', '22'); failWrite = true;
  el('settings-done').click(); await tick();
  el('settings-cancel').click();
  assert.ok(el('settings-modal').classList.contains('hidden'));
});

test('validation reveals the invalid field and correction can immediately save', async () => {
  await reset();
  input('engine-select', 'custom'); input('custom-engine-input', 'javascript:alert(1)');
  el('settings-tab-shortcuts').click();
  el('settings-done').click(); await tick();
  assert.equal(writes, 0);
  assert.equal(document.activeElement, el('custom-engine-input'));
  assert.equal(el('settings-tab-search').getAttribute('aria-selected'), 'true');
  input('custom-engine-input', 'https://example.com/?q=%s');
  el('settings-done').click(); await tick();
  assert.equal(data.nt_settings.customEngineUrl, 'https://example.com/?q=%s');
  assert.ok(el('settings-modal').classList.contains('hidden'));
});

test('switching sections keeps drafts and saving does not overwrite another tab', async () => {
  await reset();
  input('shortcut-gap', '36');
  el('settings-tab-search').click();
  input('llm-provider', 'api'); input('llm-model', 'draft-model');
  el('settings-tab-appearance').click();
  document.querySelector('[data-theme-mode="dark"]').click();
  el('settings-tab-search').click();
  assert.equal(el('llm-model').value, 'draft-model');
  data.nt_settings.bookmarkWidth = 65; // A different tab changed this after opening.
  el('settings-done').click(); await tick();
  const settings = await getSettings();
  assert.equal(settings.bookmarkWidth, 65);
  assert.equal(settings.shortcutGap, 36);
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.llmModel, 'draft-model');
});

test('data actions cannot replace unsaved preferences; Escape cancels', async () => {
  await reset(); input('shortcut-gap', '54');
  el('settings-tab-data').click(); el('settings-clear-cache').click(); await tick();
  assert.match(el('settings-save-status').textContent, /请先保存或取消/);
  el('settings-modal').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(el('settings-modal').classList.contains('hidden'));
  assert.equal(data.nt_settings.shortcutGap, 16);
});
