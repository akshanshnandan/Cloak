import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from 'playwright';

const work = path.resolve('work'); await mkdir(work, { recursive: true });
const directory = await mkdtemp(path.join(work, 'journeys-'));
process.env.PORT = '4318'; process.env.CLOAK_HEADLESS = '1'; process.env.CLOAK_DATA_DIR = directory;
const app = await import('../src/server.ts');
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}; ${app.state().error}`); await new Promise(r => setTimeout(r, 100)); }
}
async function settled() { await until(() => !app.state().busy && !!app.state().plan, 'local planning'); assert.equal(app.state().error, ''); assert.match(app.state().plan!.source.model, /Qwen3/); await app.browser.update(); }
async function action(payload: any, wait = true) {
  const response = await fetch('http://127.0.0.1:4318/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(response.status, 200, await response.text()); if (wait) await settled(); else await app.browser.update();
}
const layout = (page: Page) => page.evaluate(() => { const d = (window as any).__cloak.diagnostics(); delete d.engine; return d; });
const report: any[] = [];
try {
  await app.browser.open('apple'); await settled();
  const page = app.browser.page!; await page.setViewportSize({ width: 1440, height: 1050 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const [index, url] of ['https://www.apple.com/', 'https://www.apple.com/mac/', 'https://www.apple.com/iphone/', 'https://www.apple.com/macbook-air/', 'https://support.apple.com/', 'https://www.apple.com/accessibility/'].entries()) {
    await action({ type: 'toggle', enabled: false }, false);
    await page.goto(url, { waitUntil: 'domcontentloaded' }); await app.browser.read(page); await settled();
    assert.equal(await page.locator('#cloak-controls').count(), 1);
    const original = await layout(page), inventory = app.browser.inventory!;
    assert.ok(inventory.groups!.length >= 2, `Discover native groups: ${url}`);
    await page.evaluate(() => {
      const win = window as any;
      win.__nativeSections = Array.from(document.querySelectorAll('main > section, main > article, [role=main] > section'));
      win.__nativeLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href],[role=main] a[href]')).map(a => ({ href: a.href, text: a.textContent }));
      win.__sample = Array.from(document.querySelectorAll<HTMLElement>('main p,[role=main] p')).find(n => { const size = parseFloat(getComputedStyle(n).fontSize); return size >= 12 && size <= 24 && n.textContent!.length > 8 && !n.closest('nav,[hidden]'); });
      win.__sampleSize = win.__sample ? parseFloat(getComputedStyle(win.__sample).fontSize) : null;
    });
    const profiles: any[] = [];
    for (const id of ['engineer', 'grandma']) {
      await action({ type: 'profile', id }); await action({ type: 'toggle', enabled: true });
      const plan = structuredClone(app.state().plan!), actual = await layout(page);
      assert.ok(actual.connected, 'All native registered nodes retain identity');
      for (const group of inventory.groups!) {
        const order = group.type === 'sections' ? plan.sectionOrder : group.type === 'categories' ? plan.categoryOrder : plan.sectionOrder.flatMap(id => plan.itemOrders[id]);
        assert.deepEqual(actual.groups[group.id], order.filter(id => group.ids.includes(id)), `Physical order: ${url} ${group.id}`);
      }
      assert.notDeepEqual(actual.groups, original.groups, `Page visibly restructures for ${id}: ${url}`);
      assert.equal(await page.evaluate(() => (window as any).__nativeSections.every((n: Node) => n.isConnected)), true);
      if (id === 'grandma') {
        assert.deepEqual(plan.presentation, { reading: 'larger', density: 'focused' });
        const size = await page.evaluate(() => { const w = window as any; return !w.__sample || parseFloat(getComputedStyle(w.__sample).fontSize) > w.__sampleSize; });
        assert.ok(size, `Larger body copy: ${url}`);
        const disclosure = page.locator('[data-cloak-disclosure] button').first();
        if (await disclosure.count()) {
          const before = await page.locator('[hidden]').count(); await disclosure.click();
          assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
          assert.ok(await page.locator('[hidden]').count() < before, 'Reveal retained native content');
          await disclosure.click();
        }
        if (url === 'https://www.apple.com/mac/') {
          await page.getByRole('tab', { name: /^Laptops\b/ }).click();
          assert.equal(await page.getByRole('tab', { name: /^Laptops\b/ }).getAttribute('aria-selected'), 'true', 'Native product tabs work');
          await page.getByRole('tab', { name: /^All products\b/ }).click();
          const gallery = page.locator('div[class*="StickyFooterGallery_gallery__"]').filter({ visible: true }).first();
          const viewport = gallery.locator('[data-rsc-scrollable]');
          await gallery.getByRole('button', { name: /^Next/ }).click();
          await until(async () => await viewport.evaluate(node => node.scrollLeft) > 20, 'native Mac lineup next button');
          await page.waitForTimeout(700);
          const scrolled = await viewport.evaluate(node => node.scrollLeft);
          await gallery.getByRole('button', { name: /^Previous/ }).click();
          await until(async () => await viewport.evaluate(node => node.scrollLeft) < scrolled, 'native Mac lineup previous button');
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `work/apple-${index}-${id}.png` });
      if (url.includes('/macbook-air/')) {
        const continuity = inventory.sections.find(section => section.title === 'Continuity')!;
        await page.evaluate(id => (window as any).__cloak.find(id), continuity.id);
        await until(() => page.locator('.section-continuity picture').first().locator('img').evaluate((node: HTMLImageElement) => node.naturalWidth > 10 && !node.currentSrc.startsWith('data:')), 'native images load at their personalized location');
        await page.screenshot({ path: `work/apple-${index}-${id}-content.png` });
      }
      profiles.push({ id, sections: plan.sectionOrder, groups: actual.groups, presentation: plan.presentation });
      await action({ type: 'toggle', enabled: false }, false);
      assert.deepEqual((await layout(page)).groups, original.groups, 'Exact original ordering after every profile');
      const linksRetained = await page.evaluate(() => {
        const current = Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href],[role=main] a[href]'));
        return (window as any).__nativeLinks.every((old: any) => current.some(n => n.href === old.href && n.textContent === old.text));
      }); assert.ok(linksRetained, `Native links and copy preserved: ${url}`);
      assert.equal(await page.locator('[data-cloak-disclosure]').count(), 0);
    }
    assert.notDeepEqual(profiles[0].groups, profiles[1].groups, 'Different people produce different native layouts');
    report.push({ url, items: inventory.items.length, groups: inventory.groups!.length, profiles });
    console.log(`PASS ${url}: ${inventory.items.length} items, ${inventory.groups!.length} groups, two profiles + undo`);
  }
  // The same profile follows native links, back navigation, history changes and tabs.
  await action({ type: 'toggle', enabled: true });
  await page.locator('#globalnav .globalnav-item-mac .globalnav-link').first().hover();
  await until(() => page.locator('#globalnav .globalnav-item-mac .globalnav-submenu').isVisible(), 'native Apple flyout after menu reorder');
  await page.locator('#globalnav .globalnav-item-mac .globalnav-link').first().click();
  await until(() => app.browser.url === 'https://www.apple.com/mac/' && !!app.browser.inventory, 'native Mac navigation'); await settled();
  assert.equal(await page.getByRole('button', { name: 'Cloaked', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.locator('a[href="/macbook-air/"]').filter({ visible: true }).first().click();
  await until(() => app.browser.url === 'https://www.apple.com/macbook-air/' && !!app.browser.inventory, 'native product navigation'); await settled();
  assert.equal(app.state().activeProfileId, 'grandma');
  await page.goBack(); await until(() => app.browser.url === 'https://www.apple.com/mac/' && !!app.browser.inventory, 'back navigation'); await settled();
  await page.evaluate(() => history.pushState({}, '', '?cloak-journey=1'));
  await until(() => app.browser.url.includes('?cloak-journey=1') && !!app.browser.inventory, 'client-side URL navigation'); await settled();
  assert.equal(await page.locator('#cloak-controls').count(), 1, 'One control after rebuilding in the same document');
  const popup = await app.browser.context!.newPage(); await popup.goto('https://support.apple.com/', { waitUntil: 'domcontentloaded' });
  await until(() => app.browser.page === popup && !!app.browser.inventory, 'new Apple tab'); await settled();
  assert.equal(await popup.locator('#cloak-controls').count(), 1);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await until(() => app.browser.page === page && !app.state().enabled, 'switch back to an existing tab');
  await page.getByRole('button', { name: 'Edit preferences' }).click();
  const audit = await new AxeBuilder({ page }).include('#cloak-controls').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(audit.violations.map(v => v.id), []);
  await page.getByRole('button', { name: 'Close preferences' }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); const bounds = await page.locator('#cloak-controls').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `Controls fit ${width}px`);
  }
  await page.goto('https://www.apple.com/shop/buy-mac/macbook-air', { waitUntil: 'domcontentloaded' }); await app.browser.read(page); await settled();
  assert.equal(app.browser.inventory!.mode, 'transaction');
  assert.equal(app.browser.inventory!.groups!.some(group => group.type !== 'categories'), false, 'No purchase option or form reordering');
  await action({ type: 'toggle', enabled: true });
  assert.equal(await page.locator('#cloak-controls').count(), 1);
  assert.deepEqual(errors, [], 'Native scripts continue running without errors');
  await writeFile('work/apple-journey-verification.json', JSON.stringify(report, null, 2));
  console.log('PASS native links, back/history navigation, multiple tabs, responsive controls, accessibility and configurator');
} finally {
  app.planner.close(); await app.browser.close(); await new Promise<void>(r => app.server.close(() => r()));
  if (path.resolve(directory).startsWith(work + path.sep)) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
