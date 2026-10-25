// A site-independent DOM transaction engine. Only registered native nodes can move.
export function installDomEngine() {
  const win = window as any;
  if (win.__cloakDom) return;
  const groups = new Map<string, { nodes: HTMLElement[]; slots: Comment[]; ids: string[] }>();
  const texts = new Map<string, { node: HTMLElement; children: Node[] }>();
  const scroll = new Map<HTMLElement, number>();
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
  function registerText(id: string, node: HTMLElement | null) { if (node && !texts.has(id)) texts.set(id, { node, children: Array.from(node.childNodes) }); }
  function capture(scrollers: HTMLElement[]) {
    if (active) return;
    savedWindow = { x: window.scrollX, y: window.scrollY };
    scrollers.forEach(node => scroll.set(node, node.scrollLeft)); active = true;
  }
  function restore(positions = true) {
    // Parent lists first, followed by their native item lists.
    for (const [id, group] of groups) reorder(id, group.ids);
    for (const { node, children } of texts.values()) node.replaceChildren(...children);
    if (positions && active) {
      scroll.forEach((left, node) => node.scrollTo({ left, behavior: 'instant' }));
      window.scrollTo({ left: savedWindow.x, top: savedWindow.y, behavior: 'instant' });
      active = false; scroll.clear();
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
      labels.forEach(label => { const entry = texts.get(label.id)!; entry.node.textContent = label.text; });
    } catch (error) { restore(); throw error; }
  }
  win.__cloakDom = { register, registerText, capture, apply, restore,
    diagnostics: () => Object.fromEntries([...groups].map(([id, group]) => [id, group.ids.map((id, i) => ({ id, connected: group.nodes[i].isConnected, slot: group.slots[i].isConnected }))])) };
}
