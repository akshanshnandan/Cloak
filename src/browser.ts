import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Story, PageInventory } from './types.ts';
import { installCloak } from './inject.ts';
import { installAppleCloak } from './adapters/apple.ts';
import { installDomEngine } from './engine/dom.ts';
import { installCloakControls } from './controls.ts';
import { installAppleContent } from './adapters/apple-content.ts';

export class BrowserManager {
  context?: BrowserContext;
  page?: Page;
  stories: Story[] = [];
  inventory?: PageInventory;
  url = '';
  site = '';
  private opening?: Promise<void>;
  private attached = new WeakSet<Page>();
  private navigationVersion = 0;
  constructor(private directory: string, private getState: () => any, private onAction: (action: any) => Promise<void>, private onExtract: () => Promise<void>, private changed: () => void) {}
  static supported(url: string) {
    try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'news.ycombinator.com' || ['www.apple.com', 'apple.com', 'support.apple.com'].includes(u.hostname)); } catch { return false; }
  }
  private async launch() {
    if (this.context) return;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const context = await chromium.launchPersistentContext(this.directory, {
        headless: process.env.CLOAK_HEADLESS === '1', viewport: null,
        args: ['--start-maximized']
      });
      this.context = context;
      await context.exposeBinding('cloakAction', async ({ page, frame }, action) => {
        if (frame !== page.mainFrame() || !BrowserManager.supported(page.url())) throw new Error('This page is not an Apple page');
        if (page !== this.page) await this.activate(page);
        await this.onAction(action);
      });
      await context.exposeBinding('cloakActivate', async ({ page, frame }) => {
        if (frame === page.mainFrame() && BrowserManager.supported(page.url()) && page !== this.page) await this.activate(page);
      });
      await context.addInitScript(() => {
        window.addEventListener('focus', () => { void (window as any).cloakActivate?.().catch(() => {}); });
      });
      context.on('page', page => this.attach(page));
      context.on('close', () => { this.context = undefined; this.page = undefined; this.stories = []; this.inventory = undefined; this.url = ''; this.site = ''; this.changed(); });
      context.pages().forEach(page => this.attach(page));
    })().finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private attach(page: Page) {
    if (this.attached.has(page)) return;
    this.attached.add(page);
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      this.reading.delete(page);
      if (page === this.page) { this.inventory = undefined; this.stories = []; this.url = page.url(); this.navigationVersion++; this.changed(); }
    });
    page.on('domcontentloaded', () => { void this.read(page).catch(error => { if (!page.isClosed() && !/Execution context was destroyed|Target page, context or browser has been closed/.test(error.message)) console.error('Page extraction:', error.message); }); });
    page.on('close', () => {
      if (this.page === page) { this.page = undefined; this.stories = []; this.inventory = undefined; this.url = ''; this.site = ''; this.navigationVersion++; this.changed(); }
    });
    let checking = false;
    const timer = setInterval(async () => {
      if (checking || this.reading.get(page)?.pending || page.isClosed() || !BrowserManager.supported(page.url())) return;
      checking = true;
      try {
        const refresh = await page.evaluate(() => document.readyState !== 'loading' && (!(window as any).__cloak || (window as any).__cloak.inventory.url !== location.href || (window as any).__cloakAdapter?.stale?.()));
        if (refresh) { this.reading.delete(page); await this.read(page); }
      } catch { /* Document navigation is retried on the next tick. */ }
      finally { checking = false; }
    }, 1500); timer.unref(); page.once('close', () => clearInterval(timer));
  }
  async open(target: 'hn' | 'apple') {
    await this.launch();
    const url = target === 'hn' ? 'https://news.ycombinator.com/' : 'https://www.apple.com/store';
    const page = this.page && !this.page.isClosed() ? this.page : this.context!.pages()[0] || await this.context!.newPage();
    this.page = page;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.bringToFront();
    // The navigation event owns extraction; wait for it before returning from launch.
    await this.read(page);
  }
  private reading = new WeakMap<Page, { url: string; promise: Promise<void>; pending: boolean }>();
  private async activate(page: Page) {
    const inventory = await page.evaluate(() => (window as any).__cloak?.inventory) as PageInventory | undefined;
    if (!inventory || inventory.url !== page.url()) { await this.read(page); return; }
    this.page = page; this.inventory = inventory; this.stories = inventory.items; this.url = page.url(); this.site = await page.title(); this.navigationVersion++;
    this.changed(); void this.onExtract();
  }
  read(page: Page): Promise<void> {
    const url = page.url();
    const existing = this.reading.get(page);
    if (existing?.url === url) return existing.promise;
    const promise = this.readPage(page, url);
    const entry = { url, promise, pending: true };
    this.reading.set(page, entry);
    void promise.then(() => { entry.pending = false; }, () => { entry.pending = false; this.reading.delete(page); });
    return promise;
  }
  private async readPage(page: Page, url: string) {
    if (!BrowserManager.supported(url)) {
      if (page === this.page) { this.stories = []; this.inventory = undefined; this.url = url; this.site = 'Browsing original website'; this.navigationVersion++; await this.onExtract(); }
      return;
    }
    this.page = page;
    const version = ++this.navigationVersion;
    this.inventory = undefined; this.stories = []; this.url = url; this.changed();
    // tsx names nested functions using __name; supply the helper in the page realm.
    await page.evaluate(() => { (window as any).__name = (value: unknown) => value; });
    if (url.includes('apple.com')) {
      const isStore = /^\/(?:[a-z]{2}(?:-[a-z]{2,3})?\/)?store\/?$/.test(new URL(url).pathname);
      await page.waitForSelector('main,[role="main"],.main', { timeout: 15000 });
      if (isStore) await page.waitForFunction(() => {
        const items = Array.from(document.querySelectorAll('.rf-cards-scroller-itemview'));
        return items.length > 0 && items.every(item => item.parentElement?.hasAttribute('data-core-scroller-item'));
      }, undefined, { timeout: 15000 });
      else await page.waitForTimeout(900);
      if (version !== this.navigationVersion || page.url() !== url) return;
      await page.evaluate(() => {
        if ((window as any).__cloakAdapter && ((window as any).__cloakAdapter.stale?.() || (window as any).__cloakAdapter.inventory.url !== location.href)) {
          (window as any).__cloakDom?.destroy(); document.getElementById('cloak-controls')?.remove();
          delete (window as any).__cloak; delete (window as any).__cloakAdapter; delete (window as any).__cloakDom;
        }
      });
      await page.evaluate(installDomEngine);
      await page.evaluate(isStore ? installAppleCloak : installAppleContent);
      await page.evaluate(installCloakControls);
    } else await page.evaluate(installCloak);
    const stories = await page.evaluate(() => (window as any).__cloak.extract()) as Story[];
    if (version !== this.navigationVersion || page.url() !== url) return;
    this.stories = stories;
    this.inventory = await page.evaluate(() => (window as any).__cloak.inventory) as PageInventory | undefined;
    this.url = url;
    this.site = url.includes('apple.com') ? await page.title() : 'Hacker News';
    this.changed();
    await this.update();
    await this.onExtract();
  }
  async update() {
    const state = this.getState();
    await Promise.all((this.context?.pages() || []).filter(page => !page.isClosed() && BrowserManager.supported(page.url())).map(async page => {
      try { await page.evaluate(state => (window as any).__cloak?.update(state), state); }
      catch (error) {
        const message = (error as Error).message;
        if (!page.isClosed() && !/Execution context was destroyed|Cannot find context|Target page, context or browser has been closed/.test(message)) console.error('Page update:', message);
      }
    }));
  }
  async focus() { if (this.page && !this.page.isClosed()) await this.page.bringToFront(); }
  async find(id: string) {
    if (!this.page || !BrowserManager.supported(this.page.url())) throw new Error('Open the Apple Store first');
    await this.page.evaluate(id => (window as any).__cloak?.find?.(id), id);
    await this.page.bringToFront();
  }
  async close() { await this.context?.close(); }
}
