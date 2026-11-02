import test from 'node:test';
import assert from 'node:assert/strict';
import { type BrowserContext, type Page } from 'playwright';
import { launchChromium } from './browser.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(root, 'extension', 'dist', 'content.js');
const fixture = '<main><section aria-label="Stories"><h1>Stories</h1><div class="cards"><article class="card"><h2>Travel photography</h2><p>Camera equipment and travel.</p><a href="/travel">Open</a></article><article class="card"><h2>Gardening basics</h2><p>Herbs, soil and growing vegetables.</p><a href="/garden">Open</a></article><article class="card"><h2>Winter gardening</h2><p>Grow herbs indoors.</p><a href="/winter">Open</a></article></div></section><form><input name="q" value="untouched"><button type="button">Submit</button></form></main>';
async function setup(context: BrowserContext, html = fixture) {
  const page = await context.newPage();
  await page.addInitScript({ content: 'window.__name = value => value;' });
  await page.route('http://cloak.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('http://cloak.test/');
  await page.addInitScript({ content: 'window.__name = value => value;' });
  await page.evaluate(() => { (window as any).chrome = { runtime: { onMessage: { addListener: (listener: any) => ((window as any).__cloakListener = listener) } } }; });
  await page.addScriptTag({ path: bundle });
  return page;
}
async function send(page: Page, message: object) {
  return await page.evaluate(message => new Promise(resolve => (window as any).__cloakListener(message, {}, resolve)), message) as any;
}
const order = (page: Page) => page.locator('.card h2').allTextContents();

test('generic extension safely reorders native cards and restores exact markup and identity through repeated cycles', async () => {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const page = await setup(context);
    const before = await page.locator('main').innerHTML();
    const originalOrder = await order(page);
    await page.evaluate(() => { (window as any).__refs = Array.from(document.querySelectorAll('.card')); });
    const first = await send(page, { type: 'personalize', preference: 'gardening herbs vegetables' });
    assert.equal(first.status, 'personalized');
    assert.match((await order(page))[0], /Gardening/);
    for (let i = 0; i < 3; i++) {
      assert.equal((await send(page, { type: 'restore' })).status, 'original');
      assert.deepEqual(await order(page), originalOrder);
      assert.equal(await page.locator('main').innerHTML(), before);
      assert.equal(await page.locator('main').evaluate(node => node.innerHTML.includes('cloak:')), false);
      assert.equal(await page.evaluate(() => (window as any).__refs.every((node: Node, i: number) => node.isSameNode(document.querySelectorAll('.card')[i]))), true);
      await send(page, { type: 'personalize', preference: 'gardening herbs' });
      assert.match((await order(page))[0], /Gardening/);
    }
    await send(page, { type: 'restore' });
    assert.deepEqual(await page.locator('.card a').evaluateAll(nodes => nodes.map(node => (node as HTMLAnchorElement).getAttribute('href'))), ['/travel', '/garden', '/winter']);
    await browser.close();
  } finally { await browser.close(); }
});

test('forms are not moved or modified', async () => {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const page = await setup(context);
    const formBefore = await page.locator('form').evaluate(node => node.outerHTML);
    await send(page, { type: 'personalize', preference: 'gardening' });
    assert.equal(await page.locator('form').evaluate(node => node.outerHTML), formBefore);
    assert.equal(await page.locator('input').inputValue(), 'untouched');
  } finally { await browser.close(); }
});

test('pages without safe groups report unsupported and remain intact', async () => {
  const browser = await launchChromium();
  try {
    const page = await setup(await browser.newContext(), '<main><h1>Welcome</h1><form><input><button>Go</button></form></main>');



    const result = await page.evaluate(() => new Promise(resolve => (window as any).__cloakListener({ type: 'personalize', preference: 'gardening' }, {}, resolve))) as any;
    assert.match(result.error, /No safe/);
    assert.equal(await page.locator('main').innerHTML(), '<h1>Welcome</h1><form><input><button>Go</button></form>');
  } finally { await browser.close(); }
});

test('content state is independent between tabs', async () => {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const first = await setup(context), second = await setup(context);
    await send(first, { type: 'personalize', preference: 'gardening' });
    assert.equal((await send(first, { type: 'status' })).active, true);
    assert.equal((await send(second, { type: 'status' })).active, false);
    assert.deepEqual(await order(second), ['Travel photography', 'Gardening basics', 'Winter gardening']);
  } finally { await browser.close(); }
});

test('structure changes fail gracefully and recommend reloading', async () => {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const page = await setup(context);
    await send(page, { type: 'personalize', preference: 'gardening' });
    await page.locator('.card').first().evaluate(node => node.remove());
    const result = await send(page, { type: 'restore' });
    assert.match(result.error, /Reload this tab/);
    assert.equal(await page.locator('.card').count(), 2);
  } finally { await browser.close(); }
});
