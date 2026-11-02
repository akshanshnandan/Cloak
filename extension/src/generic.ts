import { installDomEngine } from '../../src/engine/dom.ts';
import type { PageInventory, PageSection, Story } from '../../src/types.ts';

type Group = { id: string; title: string; parent: HTMLElement; entries: { id: string; node: HTMLElement }[] };
type CloakWindow = Window & { __cloakDom?: any; __cloakGeneric?: any };
const blockedPage = () => {
  const context = location.pathname + ' ' + location.hostname;
  return /(?:login|log-in|signin|sign-in|account|checkout|check-out|payment|payments|billing|cart|pay|auth|oauth|order-review)/i.test(context) ||
    !!document.querySelector('input[type="password"],input[autocomplete="username"],input[autocomplete^="cc-"],input[autocomplete="current-password"],input[name*="card" i],input[name*="payment" i],form[action*="checkout" i],form[action*="payment" i]');
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
  for (const parent of main.querySelectorAll<HTMLElement>('ul,ol,[role="list"],section,article,[class*="result" i],[class*="product" i],[class*="card" i],[class*="cards" i],[class*="grid" i]')) {
    if (unsafe(parent)) continue;
    const nodes = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !unsafe(child) && !!child.querySelector('h1,h2,h3,h4,[role="heading"]'));
    if (nodes.length < 2 || nodes.length > 40 || nodes.some(node => !node.querySelector('h1,h2,h3,h4,[role="heading"]')?.textContent?.trim())) continue;
    candidates.push({ parent, nodes, type: 'items' });
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
  if (win.__cloakGeneric) return;
  if (!/^https?:$/.test(location.protocol)) throw new Error('Cloak works on ordinary HTTP and HTTPS websites.');
  if (blockedPage()) throw new Error('This page looks like an account, sign-in, checkout, or payment page. Cloak will leave it unchanged.');
  installDomEngine();
  const engine = win.__cloakDom;
  const groups = discoverGenericGroups();
  const safe = groups.filter(group => group.entries.length >= 2 && group.entries.every(entry => entry.node.parentElement === group.parent && !unsafe(entry.node)));
  if (!safe.length) throw new Error('No safe article, card, search result, or product groups were found on this page.');
  const items: Story[] = safe.flatMap(group => group.entries.map((entry, originalIndex) => {
    const heading = entry.node.querySelector('h1,h2,h3,h4,[role="heading"]')!;
    const anchor = entry.node.querySelector<HTMLAnchorElement>('a[href]');
    return { id: entry.id, title: heading.textContent?.trim() || '', url: anchor?.href || location.href, description: entry.node.innerText, originalIndex, sectionId: group.id, kind: 'content' };
  }));
  const sections: PageSection[] = safe.map((group, originalIndex) => ({ id: group.id, title: group.title, description: group.parent.innerText.slice(0, 1000), itemIds: group.entries.map(entry => entry.id), originalIndex }));
  const inventory: PageInventory = { url: location.href, mode: 'content', sections, categories: [], items, primarySectionId: safe[0].id };
  let registered = false, active = false;
  function register() { safe.forEach(group => engine.register(group.id, group.entries)); registered = true; }
  function personalize(preference: string) {
    if (!preference.trim()) throw new Error('Describe what you want to find before personalizing.');
    if (!registered) register();
    engine.capture([]);
    try {
      engine.apply(safe.map(group => ({ group: group.id, order: [...group.entries].sort((a, b) => relevance(`${b.node.innerText} ${group.title}`, preference) - relevance(`${a.node.innerText} ${group.title}`, preference)).map(entry => entry.id) })), []);
    } catch (error) { throw new Error((error as Error).message.replace('Reload Apple', 'Reload this tab')); }
    active = true;
    return { status: 'personalized', groups: safe.length };
  }
  function restore() {
    const health = engine.diagnostics();
    const restorable = Object.values(health).flat().every((entry: any) => entry.connected && entry.slot);
    engine.release(); registered = false; active = false;
    if (!restorable) throw new Error('The page changed while Cloak was active, so the original layout could not be restored safely. Reload this tab to reset it.');
    return { status: 'original', groups: safe.length };
  }
  win.__cloakGeneric = { inventory, personalize, restore, status: () => ({ active, groups: safe.length }) };
  window.addEventListener('pagehide', restore, { once: true });
}

