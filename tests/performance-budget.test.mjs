import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);

test('new-tab runtime stays within the lightweight asset budget', async () => {
  const [script, styles, manifest] = await Promise.all([
    stat(new URL('newtab.js', root)),
    stat(new URL('newtab.css', root)),
    readFile(new URL('manifest.json', root), 'utf8').then(JSON.parse),
  ]);

  assert.ok(script.size < 100 * 1024, `newtab.js is ${script.size} bytes`);
  assert.ok(styles.size < 70 * 1024, `newtab.css is ${styles.size} bytes`);
  assert.equal(manifest.background, undefined, 'new tab should not keep a background worker alive');
});

test('extension runtime has no application framework dependency', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.deepEqual(packageJson.dependencies || {}, {});
});
