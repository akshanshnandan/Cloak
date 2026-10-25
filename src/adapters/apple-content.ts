// Discover native sibling groups rather than maintaining a separate page for each person.
export function installAppleContent() {
  const win = window as any;
  if (win.__cloakAdapter) return;
  const engine = win.__cloakDom;
  const main = document.querySelector<HTMLElement>('main,[role="main"],.main') || document.body;
  const transactional = /\/(?:shop\/(?:buy-|bag|checkout|signIn|account)|account|signin|payment)/i.test(location.pathname) || /^(?:id|appleid|secure\d*)\./.test(location.hostname);
  const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
  const text = (node: Element | null, max = 650) => {
    if (!node) return '';
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('script,style,noscript,template,svg').forEach(node => node.remove());
    return clean(copy.textContent).slice(0, max);
  };
  const hash = (value: string) => { let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16); };
  const title = (node: Element) => text(node.querySelector('h1,h2,h3,h4,[role="heading"]'), 120) || clean(node.querySelector('a')?.getAttribute('aria-label')) || clean(node.querySelector('img')?.getAttribute('alt')) || text(node, 100);
  const groups: { id: string; type: 'sections' | 'items' | 'categories'; ids: string[] }[] = [];
  const records = new Map<string, HTMLElement>();
  const parentSnapshots: { parent: HTMLElement; tags: Set<string>; children: Element[] }[] = [];
  const items: any[] = [], sections: any[] = [], categories: any[] = [];
  const used = new Set<HTMLElement>();
  function register(id: string, type: 'sections' | 'items' | 'categories', entries: {id: string; node: HTMLElement}[]) {
    if (entries.length < 2) return;
    engine.register(id, entries); groups.push({ id, type, ids: entries.map(entry => entry.id) });
    entries.forEach(entry => records.set(entry.id, entry.node));
    const parent = entries[0].node.parentElement!, tags = new Set(entries.map(entry => entry.node.tagName));
    parentSnapshots.push({ parent, tags, children: Array.from(parent.children).filter(child => tags.has(child.tagName)) });
  }
  function story(node: HTMLElement, sectionId: string, suffix: string) {
    const link = node.querySelector<HTMLAnchorElement>('a[href]:not([href^="#"])');
    const name = title(node) || document.title;
    const description = text(node);
    const priceMatch = suffix === 'summary' || suffix === 'page' ? null : description.match(/(?:From\s+|starting at\s+)?\$([\d,]+(?:\.\d{2})?)/i);
    const url = link?.href || location.href;
    const item = { id: `page-${hash(location.pathname + '|' + sectionId + '|' + name + '|' + suffix)}`, title: name, description, url, originalIndex: items.length, sectionId, kind: priceMatch && /\/shop\//.test(node.querySelector<HTMLAnchorElement>('a[href*="/shop/"]')?.href || '') ? 'product' : 'content', price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null, currency: 'USD', education: Array.from(node.querySelectorAll<HTMLAnchorElement>('a[href]')).some(a => { const u = new URL(a.href); return /(^|\.)apple\.com$/.test(u.hostname) && /\/(?:us-edu|shop\/education-pricing)(?:\/|$)/.test(u.pathname); }) };
    items.push(item); records.set(item.id, node); return item;
  }
  // Keep hero/chapter navigation and instructional steps intact. Marketing sections
  // travel as complete units, including their native animation and event handlers.
  const sectionNodes = Array.from(main.children).filter((node): node is HTMLElement => node instanceof HTMLElement && /^(SECTION|ARTICLE)$/.test(node.tagName) && !!node.querySelector('h2,h3') && !node.querySelector('h1,form,input,select,textarea,nav[class*="Index_nav"]') && !/ribbon|section-index|Index_|topic-search/.test(node.className));
  if (!transactional) {
    sectionNodes.forEach((node, i) => {
      const id = `content-${i}`, summary = story(node, id, 'summary');
      sections.push({ id, title: title(node), description: summary.description.slice(0, 400), itemIds: [summary.id], originalIndex: i });
    });
    register('page:sections', 'sections', sectionNodes.map((node, i) => ({ id: sections[i].id, node })));
  }
  const fallback = { id: 'page-content', title: document.title.replace(/ - Apple.*$/, ''), description: '', itemIds: [] as string[], originalIndex: sections.length };
  function sectionFor(node: HTMLElement) { return sections.find((_section, index) => sectionNodes[index]?.contains(node)) || fallback; }
  if (!transactional) {
    // Sibling cards can be reordered independently even when their parent section
    // is pinned. Exclude tab-linked slides, accordions, dot navigation and steps.
    const candidates = Array.from(main.querySelectorAll<HTMLElement>('ul,[role="list"],.section-hero,.section-promo,[class*="as-imagegrid"],[class*="as-tile-wrapper"],.tiles,.cards,.grid'));
    candidates.forEach(parent => {
      if (parent.closest('nav,footer,ol,[role="tablist"],.tabnav-gallery,.media-gallery,.section-endless-entertainment-gallery,.accordion,[class*="Accordion"],.as-search')) return;
      if (/color|paddle|dotnav|tabnav|chapternav|ChapterNav|bento|media-gallery/i.test(parent.className)) return;
      const nodes = Array.from(parent.children).filter((node): node is HTMLElement => node instanceof HTMLElement && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.tagName) && !!node.querySelector('a[href],button') && text(node).length > 4);
      if (nodes.length < 2 || nodes.length > 24 || nodes.some(node => used.has(node) || node.querySelector('input,select,textarea,form') || node.matches('[role="tab"],[role="tabpanel"]'))) return;
      if (!nodes.every(node => node.tagName === nodes[0].tagName)) return;
      if (!nodes.some(node => node.querySelector('h2,h3,h4,img,picture'))) return;
      // Do not register both a card and its inner link lists.
      if (nodes.some(node => [...used].some(existing => existing.contains(node) || node.contains(existing)))) return;
      const section = sectionFor(parent);
      const entries = nodes.map((node, i) => { used.add(node); const item = story(node, section.id, `${groups.length}:${i}`); section.itemIds.push(item.id); return { id: item.id, node }; });
      register(`page:cards:${groups.length}`, 'items', entries);
      const viewport = parent.parentElement;
      const gallery = parent.closest<HTMLElement>('[class*="Gallery_gallery"],.scroll-gallery,.card-gallery');
      if (gallery && viewport && getComputedStyle(viewport).overflowX.match(/auto|scroll/)) engine.registerPager(gallery, viewport);
    });
  }
  if (fallback.itemIds.length || !sections.length) {
    if (!fallback.itemIds.length) fallback.itemIds.push(story(main, fallback.id, 'page').id);
    sections.push(fallback);
  }
  // Reorder complete navigation entries so their original menus and links survive.
  const navLists = Array.from(document.querySelectorAll<HTMLElement>('#globalnav .globalnav-menu-list,ul.chapternav-items,ul[class*="ChapterNav_chapternav-items"]'));
  navLists.forEach(list => {
    let nodes = Array.from(list.children).filter((node): node is HTMLElement => node instanceof HTMLElement && !!node.querySelector('a[href]') && !/apple|search|bag|menutrigger/.test(node.className.replace(/globalnav-item-menu/g, '')));
    // Some Apple releases nest every desktop menu under one list entry.
    if (nodes.length === 1) nodes = Array.from(nodes[0].children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.matches('.globalnav-item') && !!node.querySelector('a[href]'));
    const entries = nodes.map((node, i) => {
      const link = node.querySelector<HTMLAnchorElement>('a[href]')!;
      const label = clean(link.getAttribute('aria-label')) || text(link, 80);
      const entry = { id: `nav-${categories.length}`, title: label, url: link.href, originalIndex: categories.length };
      categories.push(entry); return { id: entry.id, node };
    });
    register(`page:navigation:${groups.length}`, 'categories', entries);
  });
  const inventory = { url: location.href, mode: transactional ? 'transaction' : 'content', sections, categories, items, primarySectionId: sections[0]?.id || '', groups };
  let currentPlan = '';
  const physical = (ids: string[]) => [...ids].sort((a,b) => records.get(a)!.compareDocumentPosition(records.get(b)!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  function restore() { engine.restore(); currentPlan = ''; }
  function apply(plan: any) {
    if (!plan || currentPlan === plan.id) return;
    const allItems = plan.sectionOrder.flatMap((id: string) => plan.itemOrders[id] || []);
    const operations = groups.map(group => ({ group: group.id, order: (group.type === 'sections' ? plan.sectionOrder : group.type === 'categories' ? plan.categoryOrder : allItems).filter((id: string) => group.ids.includes(id)) }));
    engine.capture([]); engine.apply(operations, []);
    engine.present(plan.presentation, groups.filter(group => group.type === 'items').map(group => { const ids = allItems.filter((id: string) => group.ids.includes(id)); const nodes = ids.map((id: string) => records.get(id)!); return { nodes, parent: nodes[0].parentElement! }; }));
    currentPlan = plan.id;
    window.dispatchEvent(new Event('resize'));
  }
  win.__cloakAdapter = { inventory, extract: () => items, apply, restore, find: (id: string) => records.get(id)?.scrollIntoView({ block: 'center', behavior: 'instant' }),
    stale: () => groups.some(group => group.ids.some(id => !records.get(id)?.isConnected)) || parentSnapshots.some(({ parent, tags, children }) => { const current = Array.from(parent.children).filter(child => tags.has(child.tagName) && !child.hasAttribute('data-cloak-disclosure')); return current.length !== children.length || current.some(child => !children.includes(child)); }),
    diagnostics: () => ({ planId: currentPlan, mode: inventory.mode, groups: Object.fromEntries(groups.map(group => [group.id, physical(group.ids)])), connected: [...records.values()].every(node => node.isConnected), engine: engine.diagnostics() }) };
}
