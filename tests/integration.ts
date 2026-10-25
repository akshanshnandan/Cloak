import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from 'playwright';

const work = path.resolve('work'); await mkdir(work, { recursive: true });
const directory = await mkdtemp(path.join(work, 'integration-'));
process.env.PORT = '4318'; process.env.CLOAK_HEADLESS = '1'; process.env.CLOAK_DATA_DIR = directory;
const app = await import('../src/server.ts');
const base = 'http://127.0.0.1:4318';
async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 100)); }
}
async function action(payload: any) {
  const result = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  await waitFor(() => !app.state().busy, 'local planning and ranking');
  assert.equal(app.state().error, ''); await app.browser.update();
}
async function layout(page: Page) { return page.evaluate(() => { const result = (window as any).__cloak.diagnostics(); delete result.engine; return result; }); }
try {
  const started = Date.now();
  await app.browser.open('apple');
  await waitFor(() => !app.state().busy, 'initial local plan');
  assert.equal(app.state().error, '');
  const page = app.browser.page!; await page.setViewportSize({ width: 1440, height: 1050 });
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  const inventory = app.browser.inventory!;
  assert.ok(inventory.items.length >= 40, 'Extract actual product, accessory and content cards');
  assert.ok(inventory.sections.length >= 6 && inventory.categories.length >= 8);
  assert.ok(inventory.items.some(item => item.education), 'Education offers must have a verified education link');
  const original = await layout(page);
  await page.evaluate(() => {
    (window as any).__originalNodes = Array.from(document.querySelectorAll('.rf-cards-scroller-itemview,.rf-ccard,.rf-recommcard'));
    (window as any).__originalLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.rs-cardsshelf a[href]')).map(a => [a, a.href, a.textContent]);
    const appearance = (node: Element) => { const s = getComputedStyle(node); return [s.fontFamily, s.fontSize, s.color, s.padding, s.borderRadius, s.transition]; };
    (window as any).__originalAppearance = Array.from(document.querySelectorAll('.rf-ccard-content,.rf-recommcard-content')).map(node => [node, appearance(node)]);
  });
  await page.screenshot({ path: 'work/v2-original.png', fullPage: false });
  const engineerPlan = structuredClone(app.state().plan!);
  assert.match(engineerPlan.source.model, /Qwen3-1\.7B/);
  await page.getByRole('button', { name: 'Cloaked', exact: true }).click();
  await waitFor(async () => (await layout(page)).planId === engineerPlan.id, 'real native transformation');
  const engineering = await layout(page);
  assert.deepEqual(engineering.sections, engineerPlan.sectionOrder);
  assert.deepEqual(engineering.categories, engineerPlan.categoryOrder);
  assert.deepEqual(engineering.itemOrders, engineerPlan.itemOrders);
  assert.notDeepEqual(engineering.sections, original.sections, 'Whole native sections must actually move');
  assert.notDeepEqual(engineering.categories, original.categories, 'The native category navigation must actually reorder');
  assert.notDeepEqual(engineering.itemOrders[inventory.primarySectionId], original.itemOrders[inventory.primarySectionId], 'Native product cards must actually reorder');
  assert.equal(await page.evaluate(() => (window as any).__originalAppearance.every(([node, expected]: [Element, string[]]) => { const s = getComputedStyle(node); return JSON.stringify([s.fontFamily, s.fontSize, s.color, s.padding, s.borderRadius, s.transition]) === JSON.stringify(expected); })), true, 'Native typography, colors, padding, shape and transitions are preserved');
  const topItems = engineerPlan.collection.itemIds.map(id => inventory.items.find(item => item.id === id)!);
  assert.ok(topItems.every(item => item.price == null || item.price <= 1400), 'Curated choices must respect the verified price and budget');
  assert.match(topItems[0].title, /Mac/);
  const savings = inventory.sections.find(section => section.itemIds.some(id => inventory.items.find(item => item.id === id)?.education))!;
  assert.ok(engineering.sections.indexOf(savings.id) <= 2, 'Verified education pricing is promoted for student needs');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'work/v2-engineering.png', fullPage: false });
  console.log('Verified native section, category and product reordering. Testing carousel paging.');
  // Test native next/previous behavior after moving complete carousel items.
  const primaryIndex = engineering.sections.indexOf(inventory.primarySectionId);
  const primary = page.locator('.rs-cardsshelf').filter({ has: page.locator('.rs-cards-shelf-mainheader') }).nth(primaryIndex);
  const scroller = primary.locator('.rf-cards-scroller-content');
  await primary.getByRole('button', { name: /Next/ }).click();
  await waitFor(async () => (await scroller.evaluate(node => node.scrollLeft)) > 50, 'native Apple next button');
  await page.waitForTimeout(600);
  const nextLeft = await scroller.evaluate(node => node.scrollLeft);
  await primary.getByRole('button', { name: /Previous/ }).click();
  await waitFor(async () => (await scroller.evaluate(node => node.scrollLeft)) < nextLeft, 'native Apple previous button');
  await page.waitForTimeout(600);
  console.log('Verified native next and previous controls. Testing second profile.');
  await page.getByRole('button', { name: 'Edit preferences' }).click();
  const audit = await new AxeBuilder({ page }).include('#cloak-controls').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'Compact controls accessibility');
  await page.getByRole('combobox', { name: 'Personal profile' }).selectOption('creative');
  await waitFor(() => !app.state().busy && app.state().plan?.profileId === 'creative', 'creative local LLM plan');
  assert.equal(app.state().error, ''); await app.browser.update();
  const creativePlan = structuredClone(app.state().plan!);
  const creative = await layout(page);
  assert.notDeepEqual(creative.sections, engineering.sections, 'Two people must produce different section hierarchies');
  assert.notDeepEqual(creative.itemOrders[inventory.primarySectionId].slice(0, 4), engineering.itemOrders[inventory.primarySectionId].slice(0, 4), 'Two people must produce different product collections');
  const creativeItems = creativePlan.collection.itemIds.map(id => inventory.items.find(item => item.id === id)!);
  assert.match(creativeItems.slice(0, 3).map(item => item.title).join(' '), /Pro|Studio/);
  await page.getByRole('button', { name: 'Close preferences' }).click();
  await waitFor(async () => page.locator('.rs-cards-shelf-mainheader').first().textContent().then(text => text === creativePlan.collection.title.replace(/[.!?]+$/, '') + '.'), 'the live personalized collection heading survives native rerenders');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'work/v2-creative.png', fullPage: false });
  const beforeFeedback = app.state().ranked[0];
  await action({ type: 'feedback', id: beforeFeedback.id, value: -1 });
  assert.ok(app.state().ranked.find(item => item.id === beforeFeedback.id)!.score < beforeFeedback.score);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await waitFor(() => !app.store.value.enabled, 'instant original toggle'); await app.browser.update();
  const restored = await layout(page);
  assert.deepEqual(restored.sections, original.sections);
  assert.deepEqual(restored.categories, original.categories);
  assert.deepEqual(restored.itemOrders, original.itemOrders);
  assert.equal(await page.evaluate(() => (window as any).__originalNodes.every((node: Node) => node.isConnected)), true, 'Every original card keeps its identity');
  const changedLinks = await page.evaluate(() => {
    const current = Array.from(document.querySelectorAll<HTMLAnchorElement>('.rs-cardsshelf a[href]'));
    // Apple’s animated video card can replace its own internal anchor. The native
    // card must retain identity, and its product target and copy must still exist.
    return (window as any).__originalLinks.filter(([_node, href, text]: [HTMLAnchorElement, string, string]) => !current.some(node => node.href === href && node.textContent === text)).map(([_node, href, text]: [HTMLAnchorElement, string, string]) => ({ href, text }));
  });
  assert.deepEqual(changedLinks, [], 'Every native link and product copy survives unchanged');
  for (let i = 0; i < 3; i++) { await action({ type: 'toggle', enabled: true }); await action({ type: 'toggle', enabled: false }); }
  assert.deepEqual((await layout(page)).itemOrders, original.itemOrders, 'Repeated apply/undo cycles restore the same native order');
  // Natural-language refinement is evaluated by the actual local LLM.
  await page.getByRole('button', { name: 'Edit preferences' }).click();
  await page.getByRole('textbox', { name: 'What are you looking for?' }).fill('I need a portable Mac for coding and classes, not a desktop. Value and battery life matter. Maximum $1000. Show education and refurbished options.');
  await page.getByRole('spinbutton', { name: 'Maximum per product' }).fill('1000');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await waitFor(() => app.store.active.budget === 1000, 'new needs saved');
  const undoStarted = Date.now();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await waitFor(() => !app.store.value.enabled, 'original while local AI is planning');
  assert.ok(Date.now() - undoStarted < 1500, 'Undo must not wait for local LLM inference');
  await waitFor(() => !app.state().busy && app.state().plan?.intent.budget === 1000, 'free-form needs produce a new plan');
  assert.equal(app.state().error, '');
  assert.equal((await layout(page)).planId, '', 'A completed inference must not reapply after the user chose Original');
  const refined = app.state().plan!;
  assert.notEqual(refined.id, creativePlan.id);
  assert.ok(refined.collection.itemIds.every(id => { const item = inventory.items.find(item => item.id === id)!; return item.price == null || item.price <= 1000; }));
  const persisted = new (await import('../src/store.ts')).PreferenceStore(directory); await persisted.load();
  assert.equal(persisted.active.budget, 1000); assert.ok(persisted.active.feedback.length > 0);
  await page.getByRole('button', { name: 'Original', exact: true }).click(); await app.browser.update();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const bar = page.locator('#cloak-controls'); const bounds = await bar.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `Control fits at ${width}px`);
  }
  const denied = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ type: 'toggle', enabled: true }) });
  assert.equal(denied.status, 403);
  // Follow a real native product link. No buttons submit carts or purchases.
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('.rf-ccard-content-headerlink').filter({ hasText: /^MacBook\s+Pro\s*$/ }).first().click();
  await page.waitForURL(url => url.hostname === 'www.apple.com' && url.pathname.includes('/shop/buy-mac/'));
  await waitFor(() => app.browser.inventory?.mode === 'transaction' && !app.state().busy, 'native product configurator with persistent controls');
  assert.equal(await page.locator('#cloak-controls').count(), 1);
  assert.equal(app.browser.inventory?.groups?.some(group => group.type === 'items' || group.type === 'sections'), false, 'Configuration choices keep their original order');
  assert.deepEqual(pageErrors, [], 'No native JavaScript errors after restructuring and interaction');
  const report = { items: inventory.items.length, sections: inventory.sections.length, categories: inventory.categories.length, elapsedSeconds: Math.round((Date.now() - started) / 1000), engineering: { title: engineerPlan.intent.title, products: topItems.map(item => item.title), sections: engineerPlan.sectionOrder }, creative: { title: creativePlan.intent.title, products: creativeItems.map(item => item.title), sections: creativePlan.sectionOrder } };
  await writeFile('work/v2-verification.json', JSON.stringify(report, null, 2));
  console.log('PASS real transformations:', JSON.stringify(report, null, 2));
} finally {
  app.planner.close(); await app.browser.close(); await new Promise<void>(resolve => app.server.close(() => resolve()));
  if (path.resolve(directory).startsWith(work + path.sep)) await rm(directory, { recursive: true, force: true });
}
