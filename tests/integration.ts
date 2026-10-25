import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const work = path.resolve('work'); await mkdir(work, { recursive: true });
const data = await mkdtemp(path.join(work, 'integration-'));
process.env.PORT = '4318'; process.env.CLOAK_HEADLESS = '1'; process.env.CLOAK_DATA_DIR = data;
const app = await import('../src/server.ts');
let ui: Browser | undefined;
const base = 'http://127.0.0.1:4318';
async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 100)); }
}
async function request(payload: any) {
  const result = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  await waitFor(() => !app.state().busy, 'ranking');
  await app.browser.update();
}
try {
  await app.model.load();
  ui = await chromium.launch();
  const uiContext = await ui.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await uiContext.newPage();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.locator('#model-pill.ready').waitFor();
  const dashboardAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(dashboardAudit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'Dashboard accessibility audit');
  await page.getByRole('button', { name: 'Explore Apple with Cloak' }).click();
  await waitFor(() => !!app.browser.page && app.state().ranked.length > 0 && !app.state().busy, 'real Apple extraction and AI ranking');
  const live = app.browser.page!;
  await live.setViewportSize({ width: 1440, height: 1050 });
  await app.browser.update();
  const count = app.state().browser.count;
  assert.ok(count >= 8, `Expected at least 8 real product cards, found ${count}`);
  const engineering = app.state().ranked.slice(0, 5).map(s => s.title);
  console.log('Engineering recommendations:', engineering);
  await live.evaluate(() => { (window as any).__testNodes = Array.from(document.querySelectorAll('.rf-ccard')); });
  const titles = await live.locator('.rf-ccard-content-headerlink').allTextContents();
  assert.equal(await live.locator('[data-cloak-badge]').count(), 0, 'The demo must begin with the original website');
  await live.locator('.rf-ccard').first().scrollIntoViewIfNeeded();
  const scrollBefore = await live.evaluate(() => ({ x: scrollX, y: scrollY, shelves: Array.from(document.querySelectorAll('.rf-cards-scroller-content')).map(node => node.scrollLeft) }));
  await live.screenshot({ path: 'work/apple-before.png' });
  await live.getByRole('button', { name: /Cloak this page/ }).click();
  await waitFor(async () => await live.locator('[data-cloak-badge]').count() > 0, 'Cloak applied through the floating control');
  assert.ok(await live.locator('[data-cloak-badge]').count() > 0);
  const topId = app.state().ranked[0].id;
  const topCard = live.locator(`.rf-ccard:has([data-cloak-badge="${topId}"])`);
  await waitFor(async () => topCard.evaluate(node => { const b = node.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; }), 'top recommendation is visible on the real page');
  await live.waitForTimeout(500);
  assert.equal(await topCard.evaluate(node => { const b = node.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; }), true, 'The native carousel must keep the recommendation in view after settling');
  const overlayAudit = await new AxeBuilder({ page: live }).include('#cloak-controls').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(overlayAudit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'Floating control accessibility audit');
  await page.screenshot({ path: 'work/verified-dashboard.png', fullPage: true });
  await live.screenshot({ path: 'work/verified-apple.png' });
  // Locate the actual scroller wrapper without assuming a particular carousel title.
  const scrollBeforeNativeClick = await topCard.evaluate(node => node.closest('.rf-cards-scroller-content')!.scrollLeft);
  const previous = live.locator('.rf-cards-scroller').filter({ has: topCard }).getByRole('button', { name: /Previous/ }).first();
  await previous.click();
  await waitFor(async () => topCard.evaluate((node, left) => node.closest('.rf-cards-scroller-content')!.scrollLeft < left - 20, scrollBeforeNativeClick), 'native Apple previous button remains functional');
  await request({ type: 'profile', id: 'lifestyle' });
  const lifestyle = app.state().ranked.slice(0, 5).map(s => s.title);
  console.log('Active lifestyle recommendations:', lifestyle);
  assert.notDeepEqual(engineering, lifestyle, 'Profiles should produce different recommendations');
  assert.match(lifestyle.slice(0, 3).join(' '), /Watch|AirPods/i, 'Fitness profile should surface relevant wearable or audio products');
  const before = app.state().ranked[0];
  await request({ type: 'feedback', id: before.id, value: -1 });
  assert.ok(app.state().ranked.find(s => s.id === before.id)!.score < before.score, 'Negative feedback must lower the item score');
  const urlBefore = live.url();
  const badge = live.locator('[data-cloak-badge]').first();
  const badgeId = await badge.getAttribute('data-cloak-badge');
  await badge.getByRole('button', { name: 'More like this', exact: true }).click();
  await waitFor(() => app.store.active.feedback.some(f => f.id === badgeId && f.value === 1), 'feedback through native page control');
  await waitFor(() => !app.state().busy, 'feedback ranking');
  assert.equal(live.url(), urlBefore, 'Feedback must not trigger Apple’s whole-card navigation');
  await request({ type: 'find', id: app.state().ranked[0].id });
  await request({ type: 'toggle', enabled: false });
  assert.equal(await live.locator('[data-cloak-badge]').count(), 0, 'Undo must remove all Cloak badges');
  assert.equal(await live.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.rf-ccard')).every(n => n.style.outline === '')), true);
  assert.deepEqual(await live.locator('.rf-ccard-content-headerlink').allTextContents(), titles, 'Native card order and titles must be preserved');
  assert.equal(await live.evaluate(() => (window as any).__testNodes.every((node: Node, i: number) => node === document.querySelectorAll('.rf-ccard')[i])), true, 'Native nodes must retain identity');
  assert.ok(await live.locator('.rf-cards-scroller button').count() > 0, 'Native carousel controls must remain');
  const restoredScroll = await live.evaluate(() => ({ x: scrollX, y: scrollY, shelves: Array.from(document.querySelectorAll('.rf-cards-scroller-content')).map(node => node.scrollLeft) }));
  assert.deepEqual(restoredScroll, scrollBefore, 'Undo restores the exact pre-Cloak page and carousel scroll positions');
  await live.getByRole('button', { name: 'Cloak this page ✦' }).click();
  await waitFor(() => app.state().enabled, 'cloaking again');
  await live.getByRole('button', { name: 'Edit your perspective' }).click();
  await live.getByRole('textbox', { name: 'Profile name', exact: true }).fill('Outdoor athlete');
  await live.getByRole('button', { name: 'Save perspective', exact: true }).click();
  await waitFor(() => app.store.active.name === 'Outdoor athlete', 'profile settings directly on Apple');
  await waitFor(() => !app.state().busy, 'saved profile ranking');
  await page.getByRole('button', { name: 'Profiles', exact: true }).click();
  await page.getByLabel('Profile name', { exact: true }).fill('Trail runner');
  await page.getByRole('button', { name: 'Save perspective' }).click();
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#profile-dialog')?.open);
  assert.equal(app.store.active.name, 'Trail runner');
  const stored = new (await import('../src/store.ts')).PreferenceStore(data); await stored.load();
  assert.equal(stored.active.name, 'Trail runner'); assert.ok(stored.active.feedback.length > 0);
  await page.getByRole('button', { name: 'How it works' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#how-dialog').evaluate((d: HTMLDialogElement) => d.open), false);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No horizontal overflow at ${width}px`);
  }
  await page.screenshot({ path: 'work/verified-mobile.png', fullPage: true });
  const rejected = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ type: 'toggle', enabled: false }) });
  assert.equal(rejected.status, 403);
  assert.deepEqual(errors, []);
  await request({ type: 'profile', id: 'engineer' });
  await request({ type: 'toggle', enabled: true });
  await live.locator('.rf-ccard-content-headerlink').filter({ hasText: /^MacBook\s+Pro\s*$/ }).first().click();
  await live.waitForURL(url => url.hostname === 'www.apple.com' && url.pathname.includes('/shop/buy-mac/'), { timeout: 45000 });
  await waitFor(() => app.state().browser.count === 0 && !app.state().busy, 'product navigation returns to the unmodified original page');
  assert.equal(await live.locator('#cloak-controls').count(), 0, 'Product configurators remain original');
  console.log(`PASS: ${count} real Apple cards; model ranking, profile differences, feedback, native nodes, undo, persistence, dialogs, responsive layout and local API origin checks.`);
} finally {
  await ui?.close(); await app.browser.close();
  await new Promise<void>(resolve => app.server.close(() => resolve()));
  if (path.resolve(data).startsWith(work + path.sep)) await rm(data, { recursive: true, force: true });
}
