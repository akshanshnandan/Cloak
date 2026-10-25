// A site-independent DOM transaction engine. Only registered native nodes can move.
export function installDomEngine() {
  const win = window as any;
  if (win.__cloakDom) return;
  const groups = new Map<string, { nodes: HTMLElement[]; slots: Comment[]; ids: string[] }>();
  const texts = new Map<string, { node: HTMLElement; children: Node[]; scope?: HTMLElement; selector?: string }>();
  const expectedLabels = new Map<string, string>();
  const scroll = new Map<HTMLElement, number>();
  const buttons = new Map<HTMLButtonElement, { disabled: boolean; aria: string | null }>();
  const pagers: { root: HTMLElement; viewport: HTMLElement }[] = [];
  const abort = new AbortController(), observers: MutationObserver[] = [];
  const presentation = new Map<HTMLElement, string | null>();
  const hidden = new Map<HTMLElement, boolean>();
  const disclosures: HTMLElement[] = [];
  let savedWindow = { x: 0, y: 0 }, active = false;
  function register(id: string, entries: { id: string; node: HTMLElement }[]) {
    if (!entries.length || groups.has(id)) return;
    const parent = entries[0].node.parentNode;
    if (!parent || entries.some(entry => entry.node.parentNode !== parent)) throw new Error(`Unsafe DOM group: ${id}`);
    const slots = entries.map(entry => { const slot = document.createComment(`cloak:${id}`); parent.insertBefore(slot, entry.node); return slot; });
    groups.set(id, { nodes: entries.map(e => e.node), slots, ids: entries.map(e => e.id) });
  }
  function reorder(id: string, requested: string[]) {
    const group = groups.get(id); if (!group) throw new Error(`Unknown DOM group: ${id}`);
    if (!Array.isArray(requested) || requested.length !== group.ids.length || new Set(requested).size !== group.ids.length || requested.some(id => !group.ids.includes(id))) throw new Error(`Invalid DOM order: ${id}`);
    if (group.nodes.some(node => !node.isConnected) || group.slots.some(slot => !slot.isConnected)) throw new Error('The page structure changed. Reload Apple to personalize again.');
    requested.forEach((id, index) => group.slots[index].after(group.nodes[group.ids.indexOf(id)]));
  }
  function target(entry: { node: HTMLElement; scope?: HTMLElement; selector?: string }) { return entry.scope && entry.selector ? entry.scope.querySelector<HTMLElement>(entry.selector) || entry.node : entry.node; }
  function registerText(id: string, node: HTMLElement | null, scope?: HTMLElement, selector?: string) {
    if (!node || texts.has(id)) return;
    const entry = { node, children: Array.from(node.childNodes), scope, selector };
    texts.set(id, entry);
    const observer = new MutationObserver(() => {
      const expected = expectedLabels.get(id);
      const current = target(entry);
      if (active && expected !== undefined && current.textContent !== expected) current.textContent = expected;
    });
    observer.observe(scope || node, { childList: true, characterData: true, subtree: true }); observers.push(observer);
  }
  function capture(scrollers: HTMLElement[]) {
    if (active) return;
    savedWindow = { x: window.scrollX, y: window.scrollY };
    scrollers.forEach(node => scroll.set(node, node.scrollLeft)); active = true;
    pagers.forEach(({ root }) => root.querySelectorAll<HTMLButtonElement>('button').forEach(button => buttons.set(button, { disabled: button.disabled, aria: button.getAttribute('aria-disabled') })));
  }
  function registerPager(root: HTMLElement, viewport: HTMLElement) {
    pagers.push({ root, viewport });
    const direction = (button: HTMLButtonElement) => /^(next)\b/i.test(button.getAttribute('aria-label') || '') ? 1 : /^(previous)\b/i.test(button.getAttribute('aria-label') || '') ? -1 : 0;
    const sync = () => {
      if (!active) return;
      root.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
        const step = direction(button); if (!step) return;
        button.disabled = step < 0 ? viewport.scrollLeft <= 2 : viewport.scrollLeft >= viewport.scrollWidth - viewport.clientWidth - 2;
        button.setAttribute('aria-disabled', String(button.disabled));
      });
    };
    root.addEventListener('click', event => {
      if (!active) return;
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target) return;
      const step = direction(target); if (!step) return;
      // Native carousel controllers retain the pre-personalization item index.
      // Keep their exact buttons and scroll surface, but page through the new DOM order.
      event.preventDefault(); event.stopImmediatePropagation();
      viewport.scrollBy({ left: step * Math.max(250, viewport.clientWidth - 100), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }, { capture: true, signal: abort.signal });
    viewport.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true, signal: abort.signal });
    window.addEventListener('resize', () => requestAnimationFrame(sync), { passive: true, signal: abort.signal });
  }
  function clearPresentation() {
    presentation.forEach((style, node) => { if (style === null) { node.style.cssText = ''; node.getAttribute('style'); node.removeAttribute('style'); } else node.setAttribute('style', style); }); presentation.clear();
    hidden.forEach((value, node) => { node.hidden = value; }); hidden.clear();
    disclosures.splice(0).forEach(node => node.remove());
  }
  function present(options: { reading?: string; density?: string }, focusGroups: { nodes: HTMLElement[]; parent: HTMLElement }[] = []) {
    clearPresentation();
    if (options?.reading === 'larger') {
      const main = document.querySelector<HTMLElement>('main,[role="main"],.main');
      main?.querySelectorAll<HTMLElement>('p,[class*="description"],[class*="desccontent"],[class*="descprice"]').forEach(node => {
        if (node.closest('nav,footer,[hidden],noscript,script,style') || node.querySelector('p,[class*="description"]')) return;
        const computed = getComputedStyle(node), size = parseFloat(computed.fontSize);
        if (size < 12 || size > 24) return;
        presentation.set(node, node.getAttribute('style'));
        node.style.setProperty('font-size', `${Math.round(size * 1.18 * 10) / 10}px`, 'important');
        node.style.setProperty('line-height', '1.55', 'important');
      });
    }
    if (options?.density === 'focused') focusGroups.forEach(({ nodes, parent }) => {
      if (nodes.length <= 4) return;
      const rest = nodes.slice(4).filter(node => !node.hidden && !node.querySelector('input,select,textarea,form,[role="tab"]') && !node.closest('.tabnav-gallery'));
      if (!rest.length) return;
      rest.forEach(node => { hidden.set(node, node.hidden); presentation.set(node, node.getAttribute('style')); node.hidden = true; node.style.setProperty('display', 'none', 'important'); });
      const row = document.createElement('div'), button = document.createElement('button');
      row.dataset.cloakDisclosure = 'true'; row.style.cssText = 'padding:18px 24px;text-align:center;';
      button.type = 'button'; button.textContent = `Show ${rest.length} more`; button.setAttribute('aria-expanded', 'false');
      button.style.cssText = 'font:400 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:inherit;background:transparent;border:1px solid currentColor;border-radius:22px;padding:9px 20px;cursor:pointer;';
      button.onclick = () => { const expand = button.getAttribute('aria-expanded') === 'false'; rest.forEach(node => { node.hidden = !expand; const style = presentation.get(node); if (style === null) node.removeAttribute('style'); else if (style !== undefined) node.setAttribute('style', style); if (!expand) node.style.setProperty('display', 'none', 'important'); }); button.setAttribute('aria-expanded', String(expand)); button.textContent = expand ? 'Show fewer' : `Show ${rest.length} more`; window.dispatchEvent(new Event('resize')); };
      row.append(button); parent.after(row); disclosures.push(row);
    });
  }
  function restore(positions = true) {
    expectedLabels.clear();
    clearPresentation();
    // Parent lists first, followed by their native item lists.
    for (const [id, group] of groups) if (group.nodes.every(node => node.isConnected) && group.slots.every(slot => slot.isConnected)) reorder(id, group.ids);
    for (const entry of texts.values()) target(entry).replaceChildren(...entry.children);
    if (positions && active) {
      scroll.forEach((left, node) => node.scrollTo({ left, behavior: 'instant' }));
      window.scrollTo({ left: savedWindow.x, top: savedWindow.y, behavior: 'instant' });
      active = false; scroll.clear();
      buttons.forEach((state, button) => { button.disabled = state.disabled; if (state.aria === null) button.removeAttribute('aria-disabled'); else button.setAttribute('aria-disabled', state.aria); }); buttons.clear();
    }
  }
  function apply(operations: { group: string; order: string[] }[], labels: { id: string; text: string }[]) {
    // Validate the entire transaction before moving a single element.
    for (const op of operations) {
      const group = groups.get(op.group);
      if (!group || op.order.length !== group.ids.length || new Set(op.order).size !== group.ids.length || op.order.some(id => !group.ids.includes(id))) throw new Error('The personalization plan does not match this page');
    }
    if (labels.some(label => !texts.has(label.id) || typeof label.text !== 'string' || label.text.length > 100)) throw new Error('Invalid collection label');
    try {
      operations.forEach(op => reorder(op.group, op.order));
      labels.forEach(label => { expectedLabels.set(label.id, label.text); target(texts.get(label.id)!).textContent = label.text; });
    } catch (error) { restore(); throw error; }
  }
  win.__cloakDom = { register, registerText, registerPager, capture, apply, restore, present,
    destroy: () => { restore(); abort.abort(); observers.forEach(observer => observer.disconnect()); },
    diagnostics: () => Object.fromEntries([...groups].map(([id, group]) => [id, group.ids.map((id, i) => ({ id, connected: group.nodes[i].isConnected, slot: group.slots[i].isConnected }))])) };
}
