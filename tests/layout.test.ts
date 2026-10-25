import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { installDomEngine } from '../src/engine/dom.ts';
import { installAppleContent } from '../src/adapters/apple-content.ts';

async function fixture(page: Page) {
  await page.setContent(`<!doctype html><style>
    *{box-sizing:border-box}body{margin:0;font:16px -apple-system,BlinkMacSystemFont,sans-serif}
    main{width:100%;max-width:1120px;margin:auto;padding:24px}header{min-height:450px;background:#f5f5f7}
    section{padding:24px 0}.viewport{overflow-x:auto;width:100%}ul{display:flex;gap:20px;width:max-content;list-style:none;padding:0;margin:0}
    li{flex:none;width:280px}.rf-cards-scroller-itemview,.rf-ccard{width:280px}article{height:250px;background:#f5f5f7;border-radius:20px;padding:20px}h3{margin:12px 0}
    img{display:block;width:100%;height:100px;object-fit:contain}a{color:#06c}button{font:inherit}
  </style><main><header id="hero"><h1>Apple</h1><a href="https://www.apple.com/iphone/">Explore iPhone</a></header>
    <section id="discover"><h2>Discover</h2><p style="font-size:16px">Useful native Apple content.</p></section>
    <section id="collection"><h2>Your products</h2><div id="gallery"><div class="viewport"><ul id="cards">${Array.from({ length: 6 }, (_, i) => `<li id="card-${i}"><div class="rf-cards-scroller-itemview"><article class="rf-ccard"><img alt="Product ${i}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='100'%3E%3Crect width='120' height='100' fill='%23ddd'/%3E%3C/svg%3E"><h3>Mac ${i}</h3><a href="https://www.apple.com/macbook-air/">Explore ${i}</a><button type="button" class="native-action">Save ${i}</button></article></div></li>`).join('')}</ul></div>
      <button type="button" aria-label="Previous products">Previous</button><button type="button" aria-label="Next products">Next</button>
    </div></section></main>`);
  await page.evaluate(() => { (window as any).__name = (value: unknown) => value; });
  await page.evaluate(installDomEngine);
  await page.evaluate(() => {
    const win = window as any, engine = win.__cloakDom;
    const main = document.querySelector<HTMLElement>('main')!, hero = document.querySelector<HTMLElement>('#hero')!;
    const collection = document.querySelector<HTMLElement>('#collection')!, discover = document.querySelector<HTMLElement>('#discover')!;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('#cards > li'));
    const parent = document.querySelector<HTMLElement>('#cards')!, viewport = document.querySelector<HTMLElement>('.viewport')!, root = document.querySelector<HTMLElement>('#gallery')!;
    engine.register('sections', [{ id: 'discover', node: discover }, { id: 'collection', node: collection }]);
    engine.register('cards', nodes.map(node => ({ id: node.id, node })));
    engine.registerPager(root, viewport);
    let clicks = 0;
    nodes.forEach(node => { node.querySelector('a')!.addEventListener('click', event => { event.preventDefault(); clicks++; }); node.querySelector('button')!.addEventListener('click', () => clicks++); });
    const original = main.innerHTML, nativeNodes = Array.from(main.querySelectorAll('*'));
    win.__fixture = { engine, main, hero, collection, discover, nodes, parent, viewport, root, original, nativeNodes, clicks: () => clicks };
    win.__applyLayout = (layout: string) => {
      engine.capture([viewport]);
      engine.apply([{ group: 'sections', order: ['collection', 'discover'] }, { group: 'cards', order: [...nodes].reverse().map(node => node.id) }], []);
      const options = { reading: 'standard', density: 'all', layout, maxVisible: layout === 'guided' ? 2 : layout === 'immersive' ? 4 : 6 };
      const ordered = [...nodes].reverse();
      engine.present(options, [{ nodes: ordered, parent }]);
      engine.layout(options, { main, sections: [collection, discover], heroes: [hero], kind: 'store', groups: [{ nodes: ordered, parent, viewport, root, kind: 'products' }] });
    };
  });
}

const geometry = (page: Page) => page.locator('#cards > li').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).display !== 'none').map(node => {
  const box = node.getBoundingClientRect(); return { id: node.id, left: box.left, top: box.top, width: box.width, right: box.right };
}));

test('native card grids visibly change geometry, retain handlers, and undo exactly', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await fixture(page);
    const native = await geometry(page);
    assert.equal(native[0].top, native[5].top, 'Fixture starts as a native horizontal shelf');
    await page.evaluate(() => (window as any).__applyLayout('compare'));
    const compare = await geometry(page);
    assert.equal(compare.length, 6, 'Comparison keeps every native choice');
    assert.equal(compare[0].top, compare[2].top, 'Comparison has three visible columns');
    assert.ok(compare[3].top > compare[0].top, 'Comparison creates a second row');
    assert.ok(compare[0].width > native[0].width, 'Comparison geometry grows the original cards');
    assert.ok(await page.locator('#cards > li').evaluateAll(nodes => nodes.every(node => Math.abs(node.getBoundingClientRect().width - node.querySelector('.rf-ccard')!.getBoundingClientRect().width) < 1)), 'Native fixed-width inner cards resize with their grid wrappers');
    assert.equal(await page.locator('#gallery > button').first().isVisible(), false, 'Obsolete shelf paging is hidden in a grid');
    assert.equal(await page.evaluate(() => { const f = (window as any).__fixture; return !!(f.collection.compareDocumentPosition(f.hero) & Node.DOCUMENT_POSITION_FOLLOWING); }), true, 'Useful native content moves ahead of the original hero');
    await page.locator('#card-5 a').click(); await page.locator('#card-5 .native-action').click();
    assert.equal(await page.evaluate(() => (window as any).__fixture.clicks()), 2, 'Original native link and button handlers survive');
    assert.equal(await page.locator('#card-5 a').getAttribute('href'), 'https://www.apple.com/macbook-air/');
    await page.evaluate(() => (window as any).__applyLayout('immersive'));
    const immersive = await geometry(page);
    assert.ok(immersive[0].width > immersive[1].width * 1.7, 'Immersive makes the leading native card dominant');
    await page.evaluate(() => (window as any).__applyLayout('guided'));
    const guided = await geometry(page);
    assert.equal(guided.length, 2, 'Guided presents two initial native choices');
    assert.ok(guided[0].width > compare[0].width * 1.3, 'Guided gives each choice more room');
    const reveal = page.locator('[data-cloak-disclosure] button');
    await reveal.click(); assert.equal((await geometry(page)).length, 6, 'All retained choices can be revealed');
    await reveal.click(); assert.equal((await geometry(page)).length, 2);
    await page.setViewportSize({ width: 390, height: 900 });
    const mobile = await geometry(page);
    assert.ok(mobile[1].top > mobile[0].top, 'Mobile uses one readable column');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal document overflow on mobile');
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.evaluate(() => (window as any).__fixture.engine.restore());
      assert.equal(await page.evaluate(() => { const f = (window as any).__fixture; return f.main.innerHTML === f.original && f.nativeNodes.every((node: Node) => node.isConnected); }), true, 'Original restores exact native markup, style attributes and node identities');
      if (cycle < 2) await page.evaluate(() => (window as any).__applyLayout('compare'));
    }
    await page.locator('#card-0 .native-action').click();
    assert.equal(await page.evaluate(() => (window as any).__fixture.clicks()), 3, 'Handlers still work after repeated apply/undo');
  } finally { await browser.close(); }
});

test('generic discovery and drastic layouts preserve interactive form and tab groups', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const interactive = ['<form><label>Memory <select><option>16 GB</option><option>32 GB</option></select></label></form>', '<div role="tablist"><button role="tab" aria-selected="true">Laptops</button></div><div role="tabpanel">MacBook Air</div>', '<details><summary>Specifications</summary>Details</details>'];
    await page.setContent(`<main><h1>Apple options</h1>${interactive.map((control, group) => `<section><h2>Choose your configuration ${group}</h2><div class="grid" id="interactive-${group}">${Array.from({ length: 6 }, (_, i) => `<article id="option-${group}-${i}"><h3>Configuration ${i}</h3><a href="https://www.apple.com/mac/">Explore</a>${i === 1 ? control : ''}</article>`).join('')}</div></section>`).join('')}</main>`);
    await page.evaluate(() => { (window as any).__name = (value: unknown) => value; });
    await page.evaluate(installDomEngine); await page.evaluate(installAppleContent);
    await page.evaluate(() => { const select = document.querySelector('select')!; select.value = '32 GB'; });
    const before = await page.locator('.grid').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.id, node.innerHTML])));
    const inventory = await page.evaluate(() => (window as any).__cloakAdapter.inventory);
    assert.equal(inventory.groups.some((group: any) => group.type === 'items'), false, 'Mixed interactive card groups are not registered for card reordering');
    await page.evaluate(() => {
      const adapter = (window as any).__cloakAdapter, inventory = adapter.inventory;
      adapter.apply({ id: 'guided', sectionOrder: inventory.sections.map((s: any) => s.id).reverse(), categoryOrder: inventory.categories.map((c: any) => c.id), itemOrders: Object.fromEntries(inventory.sections.map((s: any) => [s.id, [...s.itemIds].reverse()])), presentation: { reading: 'larger', density: 'focused', layout: 'guided' } });
    });
    assert.deepEqual(await page.locator('.grid').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.id, node.innerHTML]))), before, 'Form, nested tabs, details and options remain native');
    assert.equal(await page.locator('select').inputValue(), '32 GB');
    await page.locator('summary').click(); assert.equal(await page.locator('details').getAttribute('open'), '', 'Native disclosure still works');
    assert.equal(await page.locator('[data-cloak-disclosure]').count(), 0, 'Interactive options are never hidden behind Cloak disclosure');
  } finally { await browser.close(); }
});
