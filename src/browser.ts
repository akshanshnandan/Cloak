import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Story } from './types.ts';
import { installCloak } from './inject.ts';
import { installAppleCloak } from './adapters/apple.ts';

export class BrowserManager {
  context?: BrowserContext;
  page?: Page;
  stories: Story[] = [];
  url = '';
  site = '';
  private opening?: Promise<void>;
  private attached = new WeakSet<Page>();
  private navigationVersion = 0;
  constructor(private directory: string, private getState: () => any, private onAction: (action: any) => Promise<void>, private onExtract: () => Promise<void>, private changed: () => void) {}
  static supported(url: string) {
    try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'news.ycombinator.com' || (u.hostname === 'www.apple.com' && /^\/(?:[a-z]{2}\/)?store\/?$/.test(u.pathname))); } catch { return false; }
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
      await context.exposeBinding('cloakAction', async ({ page }, action) => {
        if (page !== this.page || !BrowserManager.supported(page.url())) throw new Error('This page is not the active Cloak page');
        await this.onAction(action);
      });
      context.on('page', page => this.attach(page));
      context.on('close', () => { this.context = undefined; this.page = undefined; this.stories = []; this.url = ''; this.site = ''; this.changed(); });
      context.pages().forEach(page => this.attach(page));
    })().finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private attach(page: Page) {
    if (this.attached.has(page)) return;
    this.attached.add(page);
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) this.reading.delete(page); });
    page.on('domcontentloaded', () => { void this.read(page).catch(error => console.error('Page extraction:', error.message)); });
    page.on('close', () => {
      if (this.page === page) { this.page = undefined; this.stories = []; this.url = ''; this.site = ''; this.navigationVersion++; this.changed(); }
    });
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
  private reading = new WeakMap<Page, string>();
  async read(page: Page) {
    const url = page.url();
    if (this.reading.get(page) === url) return;
    this.reading.set(page, url);
    if (!BrowserManager.supported(url)) {
      if (page === this.page) { this.stories = []; this.url = url; this.site = 'Browsing original website'; this.navigationVersion++; await this.onExtract(); }
      return;
    }
    this.page = page;
    const version = ++this.navigationVersion;
    // tsx names nested functions using __name; supply the helper in the page realm.
    await page.evaluate(() => { (window as any).__name = (value: unknown) => value; });
    await page.evaluate(url.includes('apple.com') ? installAppleCloak : installCloak);
    const stories = await page.evaluate(() => (window as any).__cloak.extract()) as Story[];
    if (version !== this.navigationVersion || page.url() !== url) return;
    this.stories = stories;
    this.url = url;
    this.site = url.includes('apple.com') ? 'Apple Store' : 'Hacker News';
    this.changed();
    await this.onExtract();
  }
  async update() {
    const page = this.page;
    if (!page || page.isClosed() || !BrowserManager.supported(page.url())) return;
    try { await page.evaluate(state => (window as any).__cloak?.update(state), this.getState()); }
    catch (error) {
      const message = (error as Error).message;
      if (!page.isClosed() && !/Execution context was destroyed|Cannot find context|Target page, context or browser has been closed/.test(message)) console.error('Page update:', message);
    }
  }
  async focus() { if (this.page && !this.page.isClosed()) await this.page.bringToFront(); }
  async find(id: string) {
    if (!this.page || !BrowserManager.supported(this.page.url())) throw new Error('Open the Apple Store first');
    await this.page.evaluate(id => (window as any).__cloak?.find?.(id), id);
    await this.page.bringToFront();
  }
  async close() { await this.context?.close(); }
}
