import test from 'node:test';
import assert from 'node:assert/strict';
import { type BrowserContext, type Page } from 'playwright';
import { launchChromium } from './browser.ts';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
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
    for (let i = 0; i < 5; i++) {
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

test('generic inventory refreshes after native dynamic updates before personalization begins', async () => {
  const browser = await launchChromium();
  try {
    const page = await setup(await browser.newContext());
    assert.equal((await send(page, { type: 'inventory' })).inventory.items.length, 3);
    await page.locator('.cards').evaluate(node => node.insertAdjacentHTML('beforeend', '<article class="card"><h2>Spring gardening</h2><p>Plant herbs and vegetables.</p></article>'));
    const result = await send(page, { type: 'inventory' });
    assert.equal(result.inventory.items.length, 4);
    const applied = await send(page, { type: 'personalize', preference: 'spring gardening herbs' });
    assert.equal(applied.status, 'personalized');
    assert.match((await order(page))[0], /Spring gardening|Gardening/);
    assert.equal((await send(page, { type: 'restore' })).status, 'original');
    await send(page, { type: 'personalize', preference: 'gardening herbs' });
    await page.locator('.cards').evaluate(node => node.insertAdjacentHTML('beforeend', '<article class="card"><h2>Summer gardening</h2><p>Seasonal plants.</p></article>'));
    const changed = await send(page, { type: 'restore' });
    assert.match(changed.error, /Reload this tab/);
  } finally { await browser.close(); }
});

test('generated-class content grids and repeated article sections are discovered safely', async () => {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const grid = await setup(context, '<main><h1>Search results</h1><div class="x-grid"><div class="x-card"><h2>Budget camera</h2><p>Affordable camera specifications.</p><a href="/camera">Details</a></div><div class="x-card"><h2>Garden tools</h2><p>Tools for growing herbs.</p><a href="/garden">Details</a></div></div></main>');
    const result = await send(grid, { type: 'personalize', preference: 'garden herbs' });
    assert.equal(result.status, 'personalized');
    assert.match((await grid.locator('.x-card h2').allTextContents())[0], /Garden/);
    await send(grid, { type: 'restore' });
    assert.deepEqual(await grid.locator('.x-card h2').allTextContents(), ['Budget camera', 'Garden tools']);

    const sections = await setup(context, '<main><h1>Guides</h1><section><h2>Travel photography</h2><p>Camera guide.</p></section><section><h2>Garden planning</h2><p>Herbs and vegetables.</p></section></main>');
    const sectionResult = await send(sections, { type: 'personalize', preference: 'herbs garden' });
    assert.equal(sectionResult.status, 'personalized');
    assert.match((await sections.locator('main > section h2').allTextContents())[0], /Garden/);
    await send(sections, { type: 'restore' });
    assert.deepEqual(await sections.locator('main > section h2').allTextContents(), ['Travel photography', 'Garden planning']);
  } finally { await browser.close(); }
});

test('shopping, news, and documentation fixtures can be reordered and exactly restored', async () => {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const cases = [
      ['shopping.html', '.product-card h2', 'affordable laptop specifications strong performance', /Value laptop/],
      ['news.html', '.story-card h2', 'science technology research', /science|technology/i],
      ['docs.html', '.guide-card h2', 'getting started python examples', /Python/i]
    ] as const;
    for (const [file, selector, preference, expected] of cases) {
      const html = await readFile(path.join(root, 'extension', 'test-fixtures', file), 'utf8');
      const page = await setup(context, html);
      const before = await page.locator('main').innerHTML();
      const inventory = await send(page, { type: 'inventory' });
      assert.equal(inventory.inventory.items.length, 3);
      assert.equal(inventory.inventory.url.includes('?'), false);
      assert.equal(inventory.inventory.items.some((item: any) => item.url.includes('tracking=')), false);
      const result = await send(page, { type: 'personalize', preference });
      assert.equal(result.status, 'personalized');
      assert.match((await page.locator(selector).first().textContent()) || '', expected);
      assert.equal((await send(page, { type: 'restore' })).status, 'original');
      assert.equal(await page.locator('main').innerHTML(), before);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('bundled popup persists the preference and sends actions to the background', async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><header><strong>cloak</strong></header><p id="site"></p><p id="ai"></p><input id="pairing"><button id="pair"></button><input id="auto" type="checkbox"><input id="enabled" type="checkbox"><button id="original"></button><button id="cloaked"></button><textarea id="preference"></textarea><button id="personalize"></button><p id="status" role="status"></p>');
    await page.evaluate('window.__name = value => value');
    await page.evaluate(() => {
      const state = (window as any).__popupTestState = { preference: '', messages: [] as any[], permissions: [] as any[] };
      (window as any).chrome = {
        storage: { local: { get: async () => ({ preference: state.preference }), set: async (value: any) => { state.preference = value.preference; } } },
        permissions: { request: async (request: any) => { state.permissions.push(request); return true; } },
        runtime: { sendMessage: async (message: any) => {
          state.messages.push(message);
          if (message.action === 'status') return { active: false, groups: 0, site: 'fixture.test' };
          if (message.action === 'auto-status') return { origin: 'https://fixture.test', enabled: false };
          if (message.action === 'auto-set') return { status: 'auto-updated', enabled: message.enabled, site: 'fixture.test' };
          if (message.action === 'personalize' || message.action === 'on') return { status: 'personalized', groups: 2, site: 'fixture.test' };
          return { status: 'original', groups: 2, site: 'fixture.test' };
        } }
      };
    });
    await page.addScriptTag({ path: path.join(root, 'extension', 'dist', 'popup.js') });
    await page.locator('#preference').fill('gardening guides');
    await page.locator('#preference').dispatchEvent('input');
    await page.locator('#personalize').click();
    assert.equal(await page.locator('#enabled').isChecked(), true);
    assert.match(await page.locator('#status').innerText(), /Personalized/);
    assert.equal(await page.locator('#site').innerText(), 'fixture.test');
    assert.equal(await page.evaluate(() => (window as any).__popupTestState.preference), 'gardening guides');
    assert.equal(await page.evaluate(() => (window as any).__popupTestState.messages.some((message: any) => message.action === 'personalize' && message.preference === 'gardening guides')), true);
    await page.locator('#original').click();
    assert.equal(await page.locator('#enabled').isChecked(), true, 'Original restores the page while leaving Cloak globally enabled');
    assert.match(await page.locator('#status').innerText(), /Original page restored/);
    await page.locator('#auto').check();
    assert.deepEqual(await page.evaluate(() => (window as any).__popupTestState.permissions), [{ origins: ['https://fixture.test/*'] }]);
    assert.equal(await page.evaluate(() => (window as any).__popupTestState.messages.some((message: any) => message.action === 'auto-set' && message.enabled)), true);
  } finally { await browser.close(); }
});

test('bundled background routes actions to the active tab and isolates tab state', async () => {
  const source = await readFile(path.join(root, 'extension', 'dist', 'background.js'), 'utf8');
  const handlers: Record<string, Function> = {};
  const saved: Record<string, any> = { local: { preference: 'gardening' }, session: {} };
  const injected = new Set<number>(), calls: any[] = [];
  const registered: any[] = [];
  let modelAvailable = false, delayAi = false, completeAi: (() => void) | undefined, sentInventory: any;
  let activeTab = 41;
  let currentUrl = `https://site-${activeTab}.test/page`;
  const chromeMock = {
    runtime: { onInstalled: { addListener: (fn: Function) => { handlers.installed = fn; } }, onMessage: { addListener: (fn: Function) => { handlers.message ||= fn; } } },
    storage: {
      local: { get: async (key: any) => typeof key === 'object' ? { preference: saved.local.preference, companionToken: saved.local.companionToken, cloakEnabled: saved.local.cloakEnabled } : { [key]: saved.local[key] }, set: async (value: any) => Object.assign(saved.local, value) },
      session: { get: async (key: string) => ({ [key]: saved.session[key] }), set: async (value: any) => Object.assign(saved.session, value) }
    },
    tabs: {
      query: async () => [{ id: activeTab, url: currentUrl }],
      get: async (tabId: number) => ({ id: tabId, url: currentUrl }),
      sendMessage: async (tabId: number, message: any) => {
        calls.push({ tabId, message });
        if (!injected.has(tabId)) throw new Error('No receiver');
        if (message.type === 'inventory') { const inventory = { url: `https://site-${tabId}.test/page`, groups: [{ id: 'items-0', ids: ['a', 'b'] }], items: [{ id: 'a' }, { id: 'b' }] }; sentInventory = inventory; return { inventory }; }
        return message.type === 'apply-plan' ? { status: 'personalized', groups: 1 } :
          message.type === 'inventory' ? { inventory: sentInventory } :
          message.type === 'status' ? { active: !!(saved.session['cloak-active-tab-ids'] || []).includes(tabId), groups: 1 } :
          message.type === 'restore' ? { status: 'original', groups: 1 } : { status: 'personalized', groups: 1 };
      },
      onRemoved: { addListener: (fn: Function) => { handlers.removed = fn; } },
      onUpdated: { addListener: (fn: Function) => { handlers.updated = fn; } },
      onActivated: { addListener: () => {} }
    },
    permissions: { contains: async () => true, remove: async () => true },
    scripting: {
      executeScript: async ({ target }: any) => { injected.add(target.tabId); },
      registerContentScripts: async (scripts: any[]) => { registered.push(...scripts); },
      getRegisteredContentScripts: async () => registered,
      unregisterContentScripts: async ({ ids }: any) => { for (let i = registered.length - 1; i >= 0; i--) if (ids.includes(registered[i].id)) registered.splice(i, 1); }
    },
    webNavigation: { onHistoryStateUpdated: { addListener: () => {} } }
  };
  runInNewContext(source, { chrome: chromeMock, URL, AbortController, AbortSignal, fetch: async (_url: string, init: any) => {
    if (!modelAvailable) throw new Error('No companion configured in this test');
    const body = JSON.parse(init.body); assert.match(body.preference, /gardening/);
    if (delayAi) await new Promise<void>((resolve, reject) => { completeAi = resolve; init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    return { ok: true, json: async () => ({ inventoryUrl: sentInventory.url, groupOrders: { 'items-0': ['b', 'a'] }, selectedIds: ['b'], source: { planner: 'controlled', semantic: 'controlled' } }) };
  } });
  async function send(message: any) {
    return await new Promise<any>((resolve, reject) => {
      try { assert.equal(handlers.message({ type: 'cloak-action', ...message }, {}, resolve), true); } catch (error) { reject(error); }
    });
  }
  const personalized = await send({ action: 'personalize' });
  assert.equal(personalized.status, 'personalized');
  assert.equal(personalized.site, 'site-41.test');
  assert.equal(calls.some(call => call.tabId === 41 && call.message.type === 'personalize' && call.message.preference === 'gardening'), true);
  assert.deepEqual(Array.from(saved.session['cloak-active-tab-ids']), [41]);
  saved.local.companionToken = 'a'.repeat(64); modelAvailable = true;
  const aiPersonalized = await send({ action: 'personalize' });
  assert.equal(aiPersonalized.mode, 'local-ai');
  assert.equal(calls.some(call => call.tabId === 41 && call.message.type === 'apply-plan' && call.message.plan.mode === 'local-ai'), true, 'validated local AI orders are sent to the content transformation path');
  const autoOn = await send({ action: 'auto-set', enabled: true });
  assert.equal(autoOn.enabled, true);
  assert.deepEqual(Array.from(registered[0].matches), ['https://site-41.test/*']);
  assert.deepEqual(Array.from(saved.local.autoSites), ['https://site-41.test']);
  const autoOff = await send({ action: 'auto-set', enabled: false });
  assert.equal(autoOff.enabled, false);
  assert.equal(registered.length, 0);
  assert.deepEqual(Array.from(saved.local.autoSites), []);
  delayAi = true;
  const applyCount = calls.filter(call => call.message.type === 'apply-plan').length;
  const stale = send({ action: 'personalize', preference: 'gardening plants' });
  for (let i = 0; i < 50 && !completeAi; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(typeof completeAi, 'function');
  const disabled = await send({ action: 'off' });
  assert.equal(disabled.cloakEnabled, false);
  const staleResult = await stale;
  assert.match(staleResult.error, /cancelled/i);
  assert.equal(calls.filter(call => call.message.type === 'apply-plan').length, applyCount, 'Off prevents a stale model result from reaching the DOM');
  activeTab = 42;
  assert.equal((await send({ action: 'status' })).active, false);
  activeTab = 41;
  const offStatus = await send({ action: 'status' });
  assert.equal(offStatus.active, false);
  assert.equal(offStatus.cloakEnabled, false);
  assert.deepEqual(Array.from(saved.session['cloak-active-tab-ids']), []);
  const afterOff = await send({ action: 'personalize', preference: 'gardening' });
  assert.equal(afterOff.status, 'personalized');
  assert.deepEqual(Array.from(saved.session['cloak-active-tab-ids']), [41]);
  currentUrl = 'https://unrelated.test/next-page';
  handlers.updated(41, { status: 'loading', url: currentUrl });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(Array.from(saved.session['cloak-active-tab-ids']), [], 'navigation drops the old document active marker');
});
