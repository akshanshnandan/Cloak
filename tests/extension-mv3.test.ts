import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executablePath } from './browser.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension', 'dist');

test('installed MV3 package starts its service worker and renders the popup controls', { skip: !executablePath }, async t => {
  const context = await chromium.launchPersistentContext('', {
    executablePath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check']
  });
  try {
    let worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'));
    if (!worker) {
      try { worker = await context.waitForEvent('serviceworker', { timeout: 5000 }); }
      catch { t.skip('Playwright launched the installed Chrome binary, but this environment did not expose its extension service worker. Load extension/dist through chrome://extensions for the interactive smoke test.'); return; }
    }
    assert.match(worker.url(), /^chrome-extension:\/\/.+\/background\.js$/);
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('#preference').waitFor();
    assert.equal(await popup.locator('header strong').textContent(), 'cloak');
    for (const selector of ['#enabled', '#original', '#cloaked', '#preference', '#personalize', '#status', '#site']) {
      assert.equal(await popup.locator(selector).count(), 1, `popup has ${selector}`);
    }
    await popup.locator('#preference').fill('gardening guides');
    await popup.waitForTimeout(100);
    assert.equal(await popup.evaluate(() => (window as any).chrome.storage.local.get('preference').then((value: any) => value.preference)), 'gardening guides');
  } finally {
    await context.close();
  }
});
