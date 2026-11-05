import { installDomEngine } from '../../src/engine/dom.ts';
import type { PageInventory, PageSection, Story } from '../../src/types.ts';

type Group = { id: string; title: string; parent: HTMLElement; entries: { id: string; node: HTMLElement }[] };
type CloakWindow = Window & { __cloakDom?: any; __cloakGeneric?: any };
const blockedPage = () => {
  const context = location.pathname + ' ' + location.hostname;
  return /(?:login|log-in|signin|sign-in|account|checkout|check-out|payment|payments|billing|cart|pay|auth|oauth|order-review|banking|my-account|messages|mail|inbox|webmail|private|dashboard)/i.test(context + ' ' + document.title) ||
    !!document.querySelector('input[type="password"],input[autocomplete="username"],input[autocomplete^="cc-"],input[autocomplete="current-password"],input[name*="card" i],input[name*="payment" i],form[action*="checkout" i],form[action*="payment" i],[role="application"],[aria-label*="private message" i],[class*="inbox" i],[class*="message-thread" i],[contenteditable="true"]');
};
const unsafe = (node: HTMLElement) => !!node.closest('form,[role="form"],[role="dialog"],dialog,nav,[role="navigation"],footer,header,aside,[role="tablist"],[role="tabpanel"],[contenteditable="true"],[aria-modal="true"]') ||
  !!node.querySelector('form,input,select,textarea,button,[contenteditable="true"],[role="tablist"],[role="tabpanel"],[role="dialog"],dialog,[aria-modal="true"],script,style');
const words = (value: string) => new Set(value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(word => word.length > 2));
export function relevance(text: string, preference: string) {
  const wanted = words(preference), available = words(text);
  if (!wanted.size || !available.size) return 0;
  let hits = 0; wanted.forEach(word => { if (available.has(word)) hits++; });
  return hits / wanted.size;
}
export function discoverGenericGroups(documentRoot: Document = document) {
  const main = documentRoot.querySelector<HTMLElement>('main,[role="main"],article') || documentRoot.body;
  const candidates: { parent: HTMLElement; nodes: HTMLElement[]; type: string }[] = [];
  for (const parent of main.querySelectorAll<HTMLElement>('ul,ol,[role="list"],section,article,[class*="result" i],[class*="product" i],[class*="card" i],[class*="cards" i],[class*="grid" i],[class*="listing" i],[data-testid*="result" i],[data-testid*="product" i]')) {
    if (unsafe(parent)) continue;
    const nodes = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !unsafe(child) && !!child.querySelector('h1,h2,h3,h4,[role="heading"]'));
    if (nodes.length < 2 || nodes.length > 40 || nodes.some(node => !node.querySelector('h1,h2,h3,h4,[role="heading"]')?.textContent?.trim())) continue;
    candidates.push({ parent, nodes, type: 'items' });
  }
  // Many sites use generated class names or a plain div grid. Accept those only
  // when every same-tag sibling has a heading and shares a class/role signal.
  const inspected = Array.from(main.querySelectorAll<HTMLElement>('*')).slice(0, 1800);
  for (const parent of inspected) {
    if (unsafe(parent)) continue;
    const nodes = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    if (nodes.length < 2 || nodes.length > 40 || new Set(nodes.map(node => node.tagName)).size !== 1) continue;
    if (nodes.some(node => unsafe(node) || !node.querySelector('h1,h2,h3,h4,[role="heading"]')?.textContent?.trim())) continue;
    const sharedClasses = nodes[0].classList.length && [...nodes[0].classList].some(name => nodes.every(node => node.classList.contains(name)));
    const semantic = nodes.every(node => /^(ARTICLE|LI)$/.test(node.tagName) || /^(article|listitem)$/.test(node.getAttribute('role') || ''));
    if (sharedClasses || semantic) candidates.push({ parent, nodes, type: 'items' });
  }
  const sections = Array.from(main.children).filter((node): node is HTMLElement => node instanceof HTMLElement && /^(SECTION|ARTICLE)$/.test(node.tagName) && !unsafe(node) && !!node.querySelector('h1,h2,h3,[role="heading"]'));
  if (sections.length >= 2) candidates.push({ parent: main, nodes: sections, type: 'sections' });
  const groups: Group[] = [], seen = new Set<HTMLElement>();
  for (const candidate of candidates) {
    if (candidate.nodes.some(node => seen.has(node))) continue;
    const entries = candidate.nodes.map((node, index) => ({ id: `${candidate.type}-${groups.length}-${index}`, node }));
    const titleNode = candidate.parent.querySelector(':scope > h1,:scope > h2,:scope > h3');
    groups.push({ id: `${candidate.type}-${groups.length}`, title: titleNode?.textContent?.trim() || candidate.parent.getAttribute('aria-label') || candidate.type, parent: candidate.parent, entries });
    candidate.nodes.forEach(node => seen.add(node));
  }
  return groups;
}
export function installGenericCloak() {
  const win = window as CloakWindow;
  if (win.__cloakGeneric) {
    const existing = win.__cloakGeneric;
    if (existing.matchesCurrent()) return;
    if (existing.status().active) throw new Error('The site replaced content while Cloak was active. Reload this tab to restore safely.');
    existing.dispose();
    delete win.__cloakGeneric;
  }
  if (!/^https?:$/.test(location.protocol)) throw new Error('Cloak works on ordinary HTTP and HTTPS websites.');
  if (blockedPage()) throw new Error('This page looks like an account, sign-in, checkout, or payment page. Cloak will leave it unchanged.');
  installDomEngine();
  const engine = win.__cloakDom;
  const groups = discoverGenericGroups();
  const safe = groups.filter(group => group.entries.length >= 2 && group.entries.every(entry => entry.node.parentElement === group.parent && !unsafe(entry.node))).reduce((picked, group) => picked.reduce((sum, current) => sum + current.entries.length, 0) + group.entries.length <= 40 ? [...picked, group] : picked, [] as Group[]);
  if (!safe.length) throw new Error('No safe article, card, search result, or product groups were found on this page.');
  const pageUrl = (() => { const url = new URL(location.href); url.hash = ''; url.search = ''; return url.toString(); })();
  const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[email]').replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, '[number]').replace(/\s+/g, ' ').trim().slice(0, max);
  const contentUrl = (value?: string) => { try { const url = new URL(value || pageUrl); url.search = ''; url.hash = ''; return url.toString().slice(0, 500); } catch { return pageUrl; } };
  const visibleText = (node: HTMLElement) => {
    const clone = node.cloneNode(true) as HTMLElement;
    const originalElements = Array.from(node.querySelectorAll<HTMLElement>('*'));
    const clonedElements = Array.from(clone.querySelectorAll<HTMLElement>('*'));
    originalElements.forEach((element, index) => { const style = getComputedStyle(element); if (element.hidden || element.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') clonedElements[index]?.remove(); });
    clone.querySelectorAll('script,style,noscript,form,input,textarea,select,button,[contenteditable="true"],[hidden],[aria-hidden="true"]').forEach(child => child.remove());
    return clean(clone.innerText || clone.textContent || '', 700);
  };
  const items: Story[] = safe.flatMap(group => group.entries.map((entry, originalIndex) => {
    const heading = entry.node.querySelector<HTMLElement>('h1,h2,h3,h4,[role="heading"]')!;
    const anchor = entry.node.querySelector<HTMLAnchorElement>('a[href]');
    const summary = visibleText(entry.node), priceText = summary.match(/([$£€])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/), price = priceText ? Number(priceText[2].replace(/,/g, '')) : null;
    const currency = priceText ? ({ '$': 'USD', '£': 'GBP', '€': 'EUR' } as Record<string, string>)[priceText[1]] : undefined;
    return { id: entry.id, title: clean(visibleText(heading), 160), url: contentUrl(anchor?.href), description: summary, originalIndex, sectionId: group.id, kind: 'content', price, currency };
  }));
  const sections: PageSection[] = safe.map((group, originalIndex) => {
    const titleNode = group.parent.querySelector<HTMLElement>(':scope > h1,:scope > h2,:scope > h3');
    return { id: group.id, title: clean(titleNode ? visibleText(titleNode) : group.parent.getAttribute('aria-label') || group.title, 160), description: visibleText(group.parent), itemIds: group.entries.map(entry => entry.id), originalIndex };
  });
  const inventory: PageInventory = { url: pageUrl, title: clean(document.title, 200), mode: 'content', sections, categories: [], items, primarySectionId: safe[0].id, groups: safe.map(group => ({ id: group.id, type: 'items' as const, ids: group.entries.map(entry => entry.id) })) };
  let registered = false, active = false;
  function register() { safe.forEach(group => engine.register(group.id, group.entries)); registered = true; }
  function personalize(preference: string) {
    if (!preference.trim()) throw new Error('Describe what you want to find before personalizing.');
    const operations = safe.map(group => ({ group: group.id, order: [...group.entries].sort((a, b) => relevance(`${b.node.innerText} ${group.title}`, preference) - relevance(`${a.node.innerText} ${group.title}`, preference)).map(entry => entry.id) }));
    const changes = operations.some(op => {
      const group = safe.find(candidate => candidate.id === op.group)!;
      const target = op.order.map(id => group.entries.find(entry => entry.id === id)!.node);
      const current = Array.from(group.parent.children).filter(node => group.entries.some(entry => entry.node === node));
      return target.some((node, index) => current[index] !== node);
    });
    if (!changes) return { status: 'no-change', groups: safe.length, mode: 'fallback', active };
    if (!registered) register();
    engine.capture([]);
    try {
      engine.apply(operations, []);
    } catch (error) { throw new Error((error as Error).message.replace('Reload Apple', 'Reload this tab')); }
    active = true;
    return { status: 'personalized', groups: safe.length };
  }
  function applyPlan(plan: any) {
    if (!plan || !plan.groupOrders || !plan.source || !['local-ai', 'fallback'].includes(plan.mode)) throw new Error('Invalid personalization plan.');
    if (plan.inventoryUrl !== inventory.url) throw new Error('The page changed while Cloak was personalizing. Try again.');
    const operations = safe.map(group => {
      const order = plan.groupOrders[group.id];
      const ids = group.entries.map(entry => entry.id);
      if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || order.some((id: unknown) => typeof id !== 'string' || !ids.includes(id))) throw new Error('The plan does not match the current page.');
      return { group: group.id, order };
    });
    if (Object.keys(plan.groupOrders).length !== safe.length) throw new Error('The plan includes unknown page groups.');
    const changes = operations.some(op => {
      const group = safe.find(candidate => candidate.id === op.group)!;
      const target = op.order.map(id => group.entries.find(entry => entry.id === id)!.node);
      const current = Array.from(group.parent.children).filter(node => group.entries.some(entry => entry.node === node));
      return target.some((node, index) => current[index] !== node);
    });
    if (!changes) return { status: 'no-change', groups: safe.length, mode: plan.mode, active };
    if (!registered) register();
    engine.capture([]);
    try { engine.apply(operations, []); } catch (error) { throw new Error((error as Error).message.replace('Reload Apple', 'Reload this tab')); }
    active = true;
    return { status: 'personalized', groups: safe.length, mode: plan.mode };
  }
  function restore() {
    const health = engine.diagnostics();
    const restorable = matchesCurrent() && Object.values(health).flat().every((entry: any) => entry.connected && entry.slot) && safe.every(group => group.entries.every(entry => entry.node.parentElement === group.parent));
    if (!restorable) throw new Error('The page changed while Cloak was active, so the original layout could not be restored safely. Reload this tab to reset it.');
    engine.release(); registered = false; active = false;
    return { status: 'original', groups: safe.length };
  }
  const matchesCurrent = () => {
    const current = discoverGenericGroups().filter(group => group.entries.length >= 2 && group.entries.every(entry => entry.node.parentElement === group.parent && !unsafe(entry.node))).reduce((picked, group) => picked.reduce((sum, current) => sum + current.entries.length, 0) + group.entries.length <= 40 ? [...picked, group] : picked, [] as Group[]);
    return current.length === safe.length && safe.every((group, index) => group.parent === current[index].parent && group.entries.length === current[index].entries.length && group.entries.every(entry => current[index].entries.some(candidate => candidate.node === entry.node)));
  };
  win.__cloakGeneric = { inventory, personalize, applyPlan, restore, matchesCurrent, dispose: () => { if (registered) engine.release(); }, status: () => ({ active, groups: safe.length }) };
  window.addEventListener('pagehide', () => { try { restore(); } catch { /* Navigation discards this document; never mask the page transition. */ } }, { once: true });
}

