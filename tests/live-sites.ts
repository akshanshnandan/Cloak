import { createCompanionApp } from '../src/companion.ts';
import { SemanticModel } from '../src/model.ts';
import { LocalPlanner } from '../src/planner.ts';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChromium } from './browser.ts';

const root = process.cwd();
const bundle = path.join(root, 'extension', 'dist', 'content.js');
const bundleSource = await readFile(bundle, 'utf8');
const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const planner = new LocalPlanner('.cache');
const model = new SemanticModel('.cache/models');
const companion = createCompanionApp({ pairingCode: 'LIVE-SMOKE-ONCE', planner, model });
const server = companion.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address() as any;
const base = `http://127.0.0.1:${address.port}`;
const headers = { Origin: extensionOrigin, 'X-Cloak-Extension-Origin': extensionOrigin, 'Content-Type': 'application/json' };
const pair = await fetch(`${base}/api/extension/pair`, { method: 'POST', headers, body: JSON.stringify({ code: 'LIVE-SMOKE-ONCE' }) });
if (!pair.ok) throw new Error(`Live smoke companion pairing failed: HTTP ${pair.status}`);
const { token } = await pair.json() as any;
const sites = [
  { label: 'news', url: 'https://www.bbc.com/news', preference: 'Prioritize science, technology, and artificial intelligence coverage' },
  { label: 'documentation', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide', preference: 'Show beginner-friendly JavaScript tutorials and practical code examples first' }
];
const browser = await launchChromium();
const report: any[] = [];
try {
  for (const site of sites) {
    const page = await browser.newPage();
    const entry: any = { site: site.label, url: site.url };
    try {
      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      entry.httpStatus = response?.status();
      entry.finalUrl = page.url();
      await page.addInitScript({ content: `window.__name = value => value; window.chrome = { runtime: { onMessage: { addListener(listener) { window.__cloakListener = listener; } }, sendMessage: async () => ({}) } };\n${bundleSource}` });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1500);
      const snapshot = await page.evaluate(() => new Promise<any>(resolve => (window as any).__cloakListener({ type: 'inventory' }, {}, resolve)));
      if (snapshot?.error) { entry.result = 'unsupported'; entry.explanation = snapshot.error; report.push(entry); await page.close(); continue; }
      const inventory = snapshot.inventory;
      entry.inventory = { items: inventory.items.length, groups: inventory.groups.length, headings: inventory.items.map((item: any) => item.title).slice(0, 8) };
      const before = await page.locator('main').evaluate(node => node.innerHTML).catch(() => '');
      const responsePlan = await fetch(`${base}/api/extension/plan`, {
        method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ preference: site.preference, inventory }), signal: AbortSignal.timeout(180000)
      });
      const plan = await responsePlan.json() as any;
      if (!responsePlan.ok) throw new Error(`AI plan failed (${plan.code || responsePlan.status}): ${plan.error || ''}`);
      entry.plan = { source: plan.source, selectedIds: plan.selectedIds };
      const originalOrder = inventory.items.map((item: any) => item.title);
      const applied = await page.evaluate(plan => new Promise<any>(resolve => (window as any).__cloakListener({ type: 'apply-plan', plan: { ...plan, mode: 'local-ai', inventoryUrl: plan.inventoryUrl, source: plan.source } }, {}, resolve)), plan);
      entry.application = applied.status || applied.error;
      entry.visibleOrderChanged = applied.status === 'personalized';
      const pageLinksValid = await page.locator('a[href]').evaluateAll(nodes => nodes.every(node => node instanceof HTMLAnchorElement && !!node.href));
      entry.nativeLinksValid = pageLinksValid;
      if (applied.status === 'personalized') {
        const restored = await page.evaluate(() => new Promise<any>(resolve => (window as any).__cloakListener({ type: 'restore' }, {}, resolve)));
        entry.restore = restored.status || 'failed';
        if (restored.error) entry.restoreError = restored.error;
        entry.exactMainRestoration = restored.status === 'original' && await page.locator('main').evaluate((node, original) => node.innerHTML === original, before).catch(() => false);
      }
      entry.originalTitles = originalOrder;
    } catch (error) {
      entry.result = 'failed'; entry.explanation = error instanceof Error ? error.message : String(error);
    }
    report.push(entry);
    await page.close().catch(() => {});
  }
  console.log(JSON.stringify({ status: 'live-site-smoke-complete', report }, null, 2));
} finally {
  await browser.close();
  planner.close();
  server.close();
}
