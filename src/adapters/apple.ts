// Apple-specific extraction and registration; layout operations live in the reusable engine.
export function installAppleCloak() {
  const win = window as any;
  if (win.__cloakAdapter) return;
  const engine = win.__cloakDom;
  if (!engine) throw new Error('Cloak’s DOM engine is unavailable');
  const clean = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').replace(/\s*- \(Opens in a new window\)/g, '').replace(/\s*- (New|Free engraving)$/g, '').trim();
  const hash = (text: string) => { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return (value >>> 0).toString(16); };
  const nativeSections = Array.from(document.querySelectorAll<HTMLElement>('.rs-cardsshelf')).filter(node => node.querySelector('.rs-cards-shelf-mainheader'));
  const items: any[] = [];
  const sections = nativeSections.map((node, index) => {
    const id = `section-${index}`;
    const nodes = Array.from(node.querySelectorAll<HTMLElement>('.rf-cards-scroller-itemview')).map(item => item.closest<HTMLElement>('[data-core-scroller-item]') || item);
    const entries = nodes.map((itemNode, itemIndex) => {
      const links = Array.from(itemNode.querySelectorAll<HTMLAnchorElement>('.rf-ccard-content-headerlink, .rf-recommcard-content-title a'));
      const link = links[0] || itemNode.querySelector<HTMLAnchorElement>('a[href]');
      const title = clean(links.map(a => a.textContent).join(' · ') || itemNode.querySelector('h3')?.textContent || link?.textContent);
      const url = link?.href || location.href;
      const priceText = clean(itemNode.querySelector('.rf-ccard-content-descprice, .rf-recommcard-content-price')?.textContent);
      const match = priceText.match(/\$([\d,]+(?:\.\d{2})?)/);
      const price = match ? Number(match[1].replace(/,/g, '')) : null;
      const description = clean(itemNode.querySelector('.rf-ccard-content-desccontent, .rf-ccard-content-desc')?.textContent || itemNode.querySelector('.rf-recommcard-content-title')?.textContent || itemNode.textContent).slice(0, 550);
      const image = Array.from(itemNode.querySelectorAll<HTMLImageElement>('img')).find(img => img.width > 32);
      const story = { id: `apple-${hash(url + '|' + title + '|' + id)}`, title: title || 'Apple collection', url, description: clean(description + ' ' + (image?.alt || '')).slice(0, 750), price, currency: 'USD', sectionId: id, kind: price !== null || /\/shop\/(buy-|product\/)/.test(url) ? 'product' : 'content', education: links.some(a => { try { const u = new URL(a.href); return ['www.apple.com', 'apple.com'].includes(u.hostname) && /^\/(us-edu\/|shop\/education-pricing(?:\/|$))/.test(u.pathname); } catch { return false; } }), originalIndex: items.length };
      const entry = { id: story.id, node: itemNode, story, originalIndex: itemIndex }; items.push(entry); return entry;
    });
    engine.register(`items:${id}`, entries.map(entry => ({ id: entry.id, node: entry.node })));
    engine.registerText(`heading:${id}`, node.querySelector('.rs-cards-shelf-mainheader'), node, '.rs-cards-shelf-mainheader');
    engine.registerText(`subheading:${id}`, node.querySelector('.rs-cards-shelf-secondaryheader'), node, '.rs-cards-shelf-secondaryheader');
    return { id, node, title: clean(node.querySelector('.rs-cards-shelf-mainheader')?.textContent), description: clean(node.querySelector('.rs-cards-shelf-secondaryheader')?.textContent), itemIds: entries.map(entry => entry.id), originalIndex: index };
  });
  engine.register('sections', sections.map(section => ({ id: section.id, node: section.node })));
  const categoryNodes = Array.from(document.querySelectorAll<HTMLElement>('.rs-productnav-cardsshelf .rf-cards-scroller-itemview')).map(item => item.closest<HTMLElement>('[data-core-scroller-item]') || item);
  const categories = categoryNodes.map((node, index) => ({ id: `category-${index}`, node, title: clean(node.querySelector('.rf-productnav-card-title')?.textContent), url: node.querySelector<HTMLAnchorElement>('a')?.href || '', originalIndex: index }));
  engine.register('categories', categories.map(category => ({ id: category.id, node: category.node })));
  const globalNavigation = Array.from(document.querySelectorAll<HTMLElement>('#globalnav .globalnav-menu-list > .globalnav-item-menu'));
  const menus = globalNavigation.map((node, index) => ({ id: `menu-${index}`, node, title: clean(node.querySelector('.globalnav-link-text')?.textContent || node.querySelector('.globalnav-link')?.getAttribute('aria-label')) }));
  if (menus.length && menus.every(menu => menu.node.parentNode === menus[0].node.parentNode)) engine.register('navigation', menus);
  const primarySectionId = [...sections].sort((a, b) => b.itemIds.filter(id => items.find(item => item.id === id)?.story.kind === 'product').length - a.itemIds.filter(id => items.find(item => item.id === id)?.story.kind === 'product').length)[0]?.id || '';
  const inventory = { url: location.href, mode: 'store', primarySectionId, sections: sections.map(({ node, ...section }) => section), categories: categories.map(({ node, ...category }) => category), items: items.map(item => item.story) };
  const scrollers = Array.from(document.querySelectorAll<HTMLElement>('.rf-cards-scroller-content'));
  scrollers.forEach(viewport => { const root = viewport.closest<HTMLElement>('.rf-cards-scroller'); if (root) engine.registerPager(root, viewport); });
  let currentPlan = '', resetVersion = 0, active = false;
  const physicalOrder = (entries: any[]) => [...entries].sort((a, b) => a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).map(entry => entry.id);
  function restore() {
    resetVersion++; engine.restore(); currentPlan = ''; active = false;
  }
  function apply(plan: any) {
    if (!plan || plan.id === currentPlan) return;
    const operations = [{ group: 'sections', order: plan.sectionOrder }, { group: 'categories', order: plan.categoryOrder }, ...sections.map(section => ({ group: `items:${section.id}`, order: plan.itemOrders[section.id] }))];
    if (menus.length) {
      const preferred = plan.categoryOrder.map((id: string) => categories.find(category => category.id === id)?.title.toLowerCase());
      const order = [...menus].sort((a, b) => { const rank = (menu: any) => { const index = preferred.indexOf(menu.title.toLowerCase()); return index < 0 ? 100 + menus.indexOf(menu) : index; }; return rank(a) - rank(b); }).map(menu => menu.id);
      operations.push({ group: 'navigation', order });
    }
    engine.capture(scrollers);
    engine.apply(operations, [{ id: `heading:${primarySectionId}`, text: plan.collection.title.replace(/[.!?]+$/, '') + '.' }, { id: `subheading:${primarySectionId}`, text: '\u00a0Selected for you.' }]);
    const layoutGroups = plan.sectionOrder.map((id: string) => sections.find(section => section.id === id)).filter(Boolean).map((section: any) => {
      const nodes = plan.itemOrders[section.id].map((id: string) => items.find(item => item.id === id)?.node).filter(Boolean);
      return { nodes, parent: nodes[0]?.parentElement, viewport: nodes[0]?.closest('.rf-cards-scroller-content'), root: nodes[0]?.closest('.rf-cards-scroller'), kind: section.id === primarySectionId ? 'products' : 'content' };
    }).filter((group: any) => group.parent);
    engine.present(plan.presentation, layoutGroups);
    engine.layout(plan.presentation, { kind: 'store', main: nativeSections[0]?.parentElement || document.querySelector('main'), sections: plan.sectionOrder.map((id: string) => sections.find(section => section.id === id)?.node).filter(Boolean), groups: layoutGroups });
    currentPlan = plan.id; active = true;
    // DOM order is the personalization. Reset native scroll offsets so first really means first.
    const version = ++resetVersion;
    const reset = () => { if (version !== resetVersion || !active) return; scrollers.forEach(node => node.scrollTo({ left: 0, behavior: 'instant' })); };
    reset(); requestAnimationFrame(() => requestAnimationFrame(reset));
  }
  function find(id: string) { const entry = items.find(item => item.id === id); entry?.node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }
  win.__cloakAdapter = { inventory, extract: () => inventory.items, apply, restore, find, stale: () => sections.some(section => !section.node.isConnected) || nativeSections.reduce((count, node) => count + node.querySelectorAll('.rf-cards-scroller-itemview').length, 0) !== items.length || document.querySelectorAll('.rs-cardsshelf .rs-cards-shelf-mainheader').length !== sections.length,
    diagnostics: () => ({ planId: currentPlan, layout: document.querySelector('[data-cloak-layout]')?.getAttribute('data-cloak-layout') || '', grids: document.querySelectorAll('[data-cloak-grid]').length, sections: physicalOrder(sections), categories: physicalOrder(categories), itemOrders: Object.fromEntries(sections.map(section => [section.id, physicalOrder(items.filter(item => item.story.sectionId === section.id))])), connected: items.every(item => item.node.isConnected), engine: engine.diagnostics() }) };
  document.addEventListener('click', event => {
    if (!active || event.composedPath().some(node => node instanceof HTMLElement && node.id === 'cloak-controls')) return;
    const target = event.target instanceof Element ? event.target.closest('.rf-cards-scroller-itemview') : null;
    const item = items.find(item => target && item.node.contains(target));
    if (item) void win.cloakAction({ type: 'open', id: item.id }).catch(() => {});
  }, { capture: true });
}
