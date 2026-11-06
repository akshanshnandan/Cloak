import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { executablePath } from './browser.ts';

if (process.platform === 'win32' && !executablePath) throw new Error('Install Chrome or Edge, or set TEST_CHROME_PATH.');
const root = process.cwd();
const extension = path.join(root, 'extension', 'dist');
const fixtures = new Map([['/shopping', 'shopping.html'], ['/news', 'news.html'], ['/docs', 'docs.html']]);
const fixtureServer = createServer(async (request, response) => {
  const filename = fixtures.get(new URL(request.url || '/', 'http://127.0.0.1').pathname);
  if (!filename) { response.writeHead(404); response.end('Unknown fixture'); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(await readFile(path.join(root, 'extension', 'test-fixtures', filename)));
});
await new Promise<void>(resolve => fixtureServer.listen(4318, '127.0.0.1', resolve));

let companionOutput = '';
let pairingCode = '';
const companion: ChildProcess = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/companion-start.ts'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const capture = (chunk: Buffer) => {
  companionOutput += chunk.toString();
  pairingCode ||= companionOutput.match(/One-time extension pairing code: ([A-F0-9]+)/)?.[1] || '';
};
companion.stdout?.on('data', capture);
companion.stderr?.on('data', capture);
const waitUntil = async (check: () => boolean, description: string, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (companion.exitCode !== null) throw new Error(`Companion exited early: ${companionOutput}`);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}. ${companionOutput}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};

let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
const profile = path.join(root, 'work', 'extension-e2e-profile');
await mkdir(profile, { recursive: true });
try {
  await waitUntil(() => !!pairingCode, 'the companion pairing code');
  const readyDeadline = Date.now() + 10000;
  while (Date.now() < readyDeadline) {
    try { if ((await fetch('http://127.0.0.1:4319/api/extension/pair-status')).status === 403) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  context = await chromium.launchPersistentContext(profile, {
    executablePath, headless: false, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check']
  });
  let worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'));
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  assert.ok(worker, 'the installed MV3 service worker is available');
  const serviceWorker = worker!;
  const id = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4318/shopping');
  let popup = await context.newPage();
  popup.on('close', () => console.error('E2E: popup page closed'));
  popup.on('console', message => console.log(`E2E popup console: ${message.type()} ${message.text()}`));
  popup.on('pageerror', error => console.error(`E2E popup error: ${error.message}`));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#pairing').waitFor();

  // Pair through the real popup and actual loopback companion process.
  await popup.locator('#pairing').fill(pairingCode);
  await popup.locator('#pair').click();
  await popup.waitForFunction(() => !(document.querySelector('#status')?.textContent || '').includes('Pairing local companion'), { timeout: 10000 });
  assert.match((await popup.locator('#ai').textContent()) || '', /Connected|ready/);
  const tokenState = await popup.evaluate(() => chrome.storage.local.get('companionToken'));
  assert.match(tokenState.companionToken, /^[a-f0-9]{64}$/);

  assert.equal(await popup.locator('#auto').isChecked(), false, 'Auto-Personalize is off by default');
  const hostPermission = await popup.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }));
  if (!hostPermission) throw new Error('E2E_BLOCKED_PERMISSION: This test will not accept the browser permission prompt. In Edge, open the Cloak extension details for this isolated test profile and allow the exact site http://127.0.0.1 under Site access → On specific sites, then rerun. Do not turn on Auto-Personalize during this setup. Profile: work/extension-e2e-profile.');

  async function activeFixtureTabId() {
    await page.bringToFront();
    const [tab] = await serviceWorker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
    assert.ok(tab?.id && tab.url?.startsWith('http://127.0.0.1:4318/'), `Expected fixture tab to be active, got ${tab?.url}`);
    return tab.id as number;
  }
  async function backgroundAction(action: string, tabId: number, data: Record<string, unknown> = {}) {
    return await popup.evaluate(({ action, tabId, data }) => new Promise<any>(resolve => chrome.runtime.sendMessage({ type: 'cloak-action', action, targetTabId: tabId, ...data }, resolve)), { action, tabId, data });
  }
  async function setPopupPreference(text: string) {
    await popup.evaluate(text => {
      const field = document.querySelector('#preference') as HTMLTextAreaElement; field.value = text; field.dispatchEvent(new Event('input', { bubbles: true }));
      const verification = document.querySelector('#require-ai') as HTMLInputElement; verification.checked = true; verification.dispatchEvent(new Event('change', { bubbles: true }));
    }, text);
    await popup.waitForFunction((text: string) => chrome.storage.local.get(['preference', 'requireRealAi']).then((saved: any) => saved.preference === text && saved.requireRealAi === true), text);
  }
  async function reportResult(result: any) {
    await popup.evaluate(result => {
      const status = document.querySelector('#status')!; status.textContent = result.error || result.message || result.status;
      if (result.ai?.message) document.querySelector('#ai')!.textContent = result.ai.message;
    }, result);
  }

  const cases = [
    { route: '/shopping', preference: 'Show affordable laptops with strong technical specifications first', selector: '.product-card h2' },
    { route: '/news', preference: 'Prioritize science and technology reporting', selector: '.story-card h2' },
    { route: '/docs', preference: 'Show beginner-friendly Python tutorials and practical code examples first', selector: '.guide-card h2' }
  ];
  const report = [] as any[];
  for (const item of cases) {
    if (page.url() !== `http://127.0.0.1:4318${item.route}`) {
      await popup.close();
      await page.goto(`http://127.0.0.1:4318${item.route}`);
      popup = await context.newPage();
      popup.on('close', () => console.error('E2E: popup page closed'));
      popup.on('console', message => console.log(`E2E popup console: ${message.type()} ${message.text()}`));
      await popup.goto(`chrome-extension://${id}/popup.html`);
    }
    const currentPage = page;
    const before = await currentPage.locator(item.selector).allTextContents();
    const beforeHtml = await currentPage.locator('main').innerHTML();
    await setPopupPreference(item.preference);
    const tabId = await activeFixtureTabId();
    for (let cycle = 0; cycle < 3; cycle++) {
      const result = await backgroundAction('personalize', tabId, { preference: item.preference });
      await reportResult(result);
      assert.equal(result.status, 'personalized', `${item.route}: ${result.error || result.message}`);
      assert.equal(result.mode, 'local-ai', 'verification mode forbids deterministic fallback');
      const cloaked = await currentPage.locator(item.selector).allTextContents();
      assert.notDeepEqual(cloaked, before, `${item.route} cycle ${cycle + 1} must change physical heading order`);
      assert.ok(await currentPage.locator('main a[href]').count() > 0, 'native links remain in the DOM');
      const links = await currentPage.locator('main a[href]').evaluateAll(nodes => nodes.every(node => node instanceof HTMLAnchorElement && !!node.href));
      assert.equal(links, true, 'native links retain valid destinations');
      const restored = await backgroundAction('original', tabId);
      await reportResult({ ...restored, message: 'Original page restored.' });
      assert.equal(restored.status, 'original');
      assert.deepEqual(await currentPage.locator(item.selector).allTextContents(), before, `${item.route} cycle ${cycle + 1} restores original order`);
      assert.equal(await currentPage.locator('main').innerHTML(), beforeHtml, `${item.route} restores original markup without a refresh`);
    }
    report.push({ route: item.route, original: before, cycles: 3, result: 'AI applied and exact DOM restored' });
  }
  const defaults = await popup.evaluate(async () => ({ autoSites: (await chrome.storage.local.get('autoSites')).autoSites, permissions: await chrome.permissions.getAll() }));
  assert.deepEqual(defaults.autoSites, [], 'Auto-Personalize starts off for all sites');
  console.log(JSON.stringify({ status: 'installed-extension-e2e-pass', browser: executablePath, extensionId: id, companion: 'npm run companion process', models: 'real local Qwen3 + MiniLM', report }, null, 2));
} catch (error) {
  console.error('E2E diagnostics:', { companionOutput, pages: context?.pages().map(page => page.url()) });
  throw error;
} finally {
  await context?.close().catch(() => {});
  fixtureServer.close();
  companion.kill();
}
