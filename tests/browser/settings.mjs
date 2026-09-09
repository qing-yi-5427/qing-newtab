/** Run against an isolated Edge profile. All remote requests are blocked. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'qing-settings-profile-'));
const artifacts = process.env.BROWSER_ARTIFACTS || await mkdtemp(path.join(tmpdir(), 'qing-settings-results-'));
await mkdir(artifacts, { recursive: true });
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'msedge' }),
    headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await context.route('https://**/*', (route) => route.abort());
  await context.route('http://**/*', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('edge://newtab/');
  await page.locator('.shortcut-item').first().waitFor();
  // Use seven items so the last row is incomplete and its centering is measurable.
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      nt_settings: { iconMode: 'letter', wallpaperSource: 'gradient', shortcutColumns: 4, shortcutRows: 2, shortcutGap: 16 },
      nt_shortcuts: Array.from({ length: 7 }, (_, i) => ({ name: `示例 ${i + 1}`, url: `https://example.com/${i}` })),
    });
  });
  await page.reload();
  await page.locator('.shortcut-item').first().waitFor();
  const open = async () => {
    await page.locator('#tab-shortcuts').click({ button: 'right' });
    await page.locator('#context-settings').click();
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
    await page.locator('#settings-tab-shortcuts').waitFor({ state: 'visible' });
  };
  const saved = () => page.evaluate(async () => (await chrome.storage.local.get('nt_settings')).nt_settings);
  const measure = () => page.locator('#shortcuts-grid').evaluate((grid) => {
    const items = [...grid.children].map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; });
    return { gap: getComputedStyle(grid).columnGap, rowGap: getComputedStyle(grid).rowGap, items };
  });
  await open();
  // Only the title bar drags the dialog; controls remain inside the viewport.
  const panel = page.locator('#settings-modal .settings-modal');
  const header = page.locator('#settings-modal .settings-header');
  await panel.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  const centered = await panel.boundingBox();
  async function dragHeader(dx, dy) {
    const box = await header.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 100 + dx, box.y + 30 + dy, { steps: 8 });
    await page.mouse.up();
  }
  await dragHeader(100, 50);
  let moved = await panel.boundingBox();
  assert.ok(Math.abs(moved.x - centered.x - 100) < 2, JSON.stringify({ moved, centered }));
  assert.ok(Math.abs(moved.y - centered.y - 50) < 2);
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'dragged-dialog.png') });
  await dragHeader(1800, 1200);
  moved = await panel.boundingBox();
  assert.ok(moved.x + moved.width <= 1440 && moved.y + moved.height <= 1000);
  await page.setViewportSize({ width: 390, height: 844 });
  moved = await panel.boundingBox();
  assert.ok(moved.x >= 0 && moved.y >= 0 && moved.x + moved.width <= 390 && moved.y + moved.height <= 844);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await header.dblclick({ position: { x: 100, y: 30 } });
  moved = await panel.boundingBox();
  assert.ok(Math.abs(moved.x - centered.x) < 2 && Math.abs(moved.y - centered.y) < 2);
  // Drag in a real new-tab document: preview changes must precede Save.
  const originalY = (await page.locator('.shortcut-item').first().boundingBox()).y;
  await page.locator('#shortcut-top').press('End');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('shortcuts-section')).marginTop === '400px');
  const shiftedY = (await page.locator('.shortcut-item').first().boundingBox()).y;
  assert.ok(Math.abs(shiftedY - originalY - 377) < 2);
  assert.equal((await saved()).shortcutTop, undefined, 'preview must not persist');
  await page.locator('#shortcut-gap').scrollIntoViewIfNeeded();
  const gapBox = await page.locator('#shortcut-gap').boundingBox();
  await page.mouse.move(gapBox.x + gapBox.width * .3, gapBox.y + gapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gapBox.x + gapBox.width - 2, gapBox.y + gapBox.height / 2, { steps: 12 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('shortcuts-grid')).columnGap === '80px');
  assert.equal(await page.locator('#settings-modal').evaluate(el => el.classList.contains('previewing')), true);
  assert.equal((await saved()).shortcutGap, 16);
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'live-drag.png') });
  await page.mouse.up();
  assert.equal(await page.locator('#settings-modal').evaluate(el => el.classList.contains('previewing')), false);
  await page.locator('#settings-tab-appearance').click();
  await page.locator('#wallpaper-blur').press('End');
  await page.locator('#wallpaper-dim').press('End');
  await page.locator('#glass-blur').press('End');
  await page.waitForFunction(() => document.getElementById('wallpaper').style.filter.includes('20px')
    && document.documentElement.style.getPropertyValue('--wallpaper-dim') === '0.75'
    && document.documentElement.style.getPropertyValue('--panel-strength') === '0.3');
  await page.locator('#settings-tab-home').click();
  await page.locator('#bookmark-width').press('Home');
  await page.locator('#bookmark-item-width').press('Home');
  await page.locator('#bookmark-scale').press('End');
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--bookmark-width') === '20vw'
    && document.documentElement.style.getPropertyValue('--bookmark-item-width') === '80px'
    && document.documentElement.style.getPropertyValue('--bookmark-scale') === '2');
  await page.locator('#settings-cancel').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('shortcuts-section')).marginTop === '23px'
    && getComputedStyle(document.getElementById('shortcuts-grid')).columnGap === '16px'
    && document.documentElement.style.getPropertyValue('--bookmark-scale') === '1'
    && document.getElementById('wallpaper').style.filter === 'none');
  await open();
  await page.locator('#shortcut-top').press('Home');
  await page.locator('#shortcut-top').press('ArrowRight');
  await page.locator('#settings-done').click();
  await page.locator('#settings-modal').waitFor({ state: 'hidden' });
  await page.reload(); await open();
  assert.equal(await page.locator('#shortcut-top').inputValue(), '1');
  assert.equal((await saved()).shortcutTop, 1);
  // Disable the runtime message channel: ordinary settings must still save.
  await page.evaluate(() => { chrome.runtime.sendMessage = () => Promise.reject(new Error('worker unavailable')); });
  await page.locator('#shortcut-gap').focus();
  await page.locator('#shortcut-gap').press('End');
  await page.locator('#shortcut-columns').selectOption('4');
  await page.locator('#shortcut-rows').selectOption('2');
  await page.locator('#shortcut-icon-size').press('Home');
  await page.locator('#shortcut-icon-size').press('ArrowRight');
  await page.locator('#settings-done').click();
  await page.locator('#settings-modal').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('shortcuts-grid')).columnGap === '80px');
  let s = await saved();
  assert.equal(s.shortcutGap, 80); assert.equal(s.shortcutIconSize, 22);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let layout = await measure();
  assert.equal(layout.gap, '80px'); assert.equal(layout.rowGap, '80px');
  assert.ok(Math.abs((layout.items[4].x + layout.items[6].x + layout.items[6].width) / 2 - 720) < 2, JSON.stringify(layout));
  await page.reload(); await open();
  assert.equal(await page.locator('#shortcut-gap').inputValue(), '80');
  await page.locator('#shortcut-gap').press('Home');
  await page.locator('#settings-cancel').click();
  await open(); assert.equal(await page.locator('#shortcut-gap').inputValue(), '80');

  // Unfinished text survives switching a category and changing another control.
  await page.locator('#settings-tab-search').click();
  await page.locator('#llm-provider').selectOption('api');
  await page.locator('#llm-model').fill('draft-model');
  await page.locator('#llm-base-url').fill('invalid');
  await page.locator('#settings-tab-shortcuts').click();
  await page.locator('#shortcut-gap').press('Home');
  await page.locator('#settings-done').click();
  assert.equal(await page.locator('#settings-tab-search').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#llm-model').inputValue(), 'draft-model');
  assert.match(await page.locator('#settings-save-status').textContent(), /有效的接口地址/);
  await page.locator('#llm-base-url').fill('https://example.com/v1');
  await page.evaluate(() => { window.originalSet = chrome.storage.local.set; chrome.storage.local.set = async () => { throw new Error('测试存储失败'); }; });
  await page.locator('#settings-done').click();
  await page.waitForFunction(() => document.getElementById('settings-save-status').textContent.includes('保存失败'));
  assert.equal(await page.locator('#settings-done').isEnabled(), true);
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'save-error.png') });
  await page.evaluate(() => { chrome.storage.local.set = window.originalSet; });
  await page.locator('#settings-done').click();
  await page.locator('#settings-modal').waitFor({ state: 'hidden' });
  s = await saved(); assert.equal(s.shortcutGap, 0); assert.equal(s.llmModel, 'draft-model');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('shortcuts-grid')).columnGap === '0px');

  // A second tab writes while the dialog is open: untouched fields must survive.
  await open();
  const second = await context.newPage();
  await second.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html`);
  await second.evaluate(async () => {
    const { nt_settings: settings } = await chrome.storage.local.get('nt_settings');
    await chrome.storage.local.set({ nt_settings: { ...settings, bookmarkWidth: 65 } });
  });
  await page.locator('#shortcut-gap').press('ArrowRight');
  await page.locator('#settings-done').click();
  await page.locator('#settings-modal').waitFor({ state: 'hidden' });
  assert.equal((await saved()).bookmarkWidth, 65);
  await second.close();

  // A chosen wallpaper is staged and cancellation must not write it.
  const picture = { name: 'test-wallpaper.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#336699"/></svg>') };
  await open();
  await page.locator('#settings-tab-appearance').click();
  await page.locator('#wallpaper-source').selectOption('custom');
  await page.locator('#custom-wallpaper-file').setInputFiles(picture);
  await page.waitForFunction(() => document.getElementById('custom-wallpaper-status').textContent.includes('已选择'));
  await page.locator('#settings-cancel').click();
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('nt_custom_wallpaper')).nt_custom_wallpaper), undefined);
  await open();
  await page.locator('#settings-tab-appearance').click();
  await page.locator('#wallpaper-source').selectOption('custom');
  await page.locator('#custom-wallpaper-file').setInputFiles(picture);
  await page.waitForFunction(() => document.getElementById('custom-wallpaper-status').textContent.includes('已选择'));
  await page.locator('[data-theme-mode="dark"]').click();
  await page.locator('#settings-done').click();
  await page.locator('#settings-modal').waitFor({ state: 'hidden' });
  assert.match(await page.evaluate(async () => (await chrome.storage.local.get('nt_custom_wallpaper')).nt_custom_wallpaper), /^data:image\//);
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await open();
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'dark.png') });
  await page.locator('#settings-cancel').click();
  await open();
  await page.locator('#shortcut-icon-size').press('End');
  await page.locator('#shortcut-columns').selectOption('16');
  await page.locator('#shortcut-rows').selectOption('4');
  await page.locator('#shortcut-gap').press('End');
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'desktop.png') });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `mobile-${width}.png`) });
    const bounds = await page.locator('#settings-done').boundingBox();
    assert.ok(bounds.y + bounds.height <= 844 && bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.ok(await page.locator('#settings-done').isVisible());
  }
  await page.locator('#settings-cancel').click();
  await open();
  await page.locator('#settings-modal').press('Escape');
  await page.locator('#settings-modal').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log(`PASS: real Edge settings save/cancel/retry, exact gaps, centering, persistence, validation, cross-tab edits, missing worker, live slider previews, vertical positioning, cancellation rollback and narrow-screen actions. Screenshots: ${artifacts}`);
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}
