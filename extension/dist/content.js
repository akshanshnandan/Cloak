"use strict";
(() => {
  // src/engine/dom.ts
  function installDomEngine() {
    const win = window;
    if (win.__cloakDom) return;
    const groups = /* @__PURE__ */ new Map();
    const texts = /* @__PURE__ */ new Map();
    const expectedLabels = /* @__PURE__ */ new Map();
    const scroll = /* @__PURE__ */ new Map();
    const buttons = /* @__PURE__ */ new Map();
    const pagers = [];
    const abort = new AbortController(), observers = [];
    const presentation = /* @__PURE__ */ new Map();
    const attributes = /* @__PURE__ */ new Map();
    const hidden = /* @__PURE__ */ new Map();
    const disclosures = [];
    let layoutStyle;
    let savedWindow = { x: 0, y: 0 }, active = false;
    const media = new IntersectionObserver((entries) => {
      if (!active) return;
      entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
        entry.target.querySelectorAll("source[data-empty]").forEach((source) => source.remove());
      });
    }, { rootMargin: "1000px" });
    function register(id, entries) {
      if (!entries.length || groups.has(id)) return;
      const parent = entries[0].node.parentNode;
      if (!parent || entries.some((entry) => entry.node.parentNode !== parent)) throw new Error(`Unsafe DOM group: ${id}`);
      const slots = entries.map((entry) => {
        const slot = document.createComment(`cloak:${id}`);
        parent.insertBefore(slot, entry.node);
        return slot;
      });
      groups.set(id, { nodes: entries.map((e) => e.node), slots, ids: entries.map((e) => e.id) });
    }
    function reorder(id, requested) {
      const group = groups.get(id);
      if (!group) throw new Error(`Unknown DOM group: ${id}`);
      if (!Array.isArray(requested) || requested.length !== group.ids.length || new Set(requested).size !== group.ids.length || requested.some((id2) => !group.ids.includes(id2))) throw new Error(`Invalid DOM order: ${id}`);
      if (group.nodes.some((node) => !node.isConnected) || group.slots.some((slot) => !slot.isConnected)) throw new Error("The page structure changed. Reload Apple to personalize again.");
      requested.forEach((id2, index) => group.slots[index].after(group.nodes[group.ids.indexOf(id2)]));
    }
    function target(entry) {
      return entry.scope && entry.selector ? entry.scope.querySelector(entry.selector) || entry.node : entry.node;
    }
    function registerText(id, node, scope, selector) {
      if (!node || texts.has(id)) return;
      const entry = { node, children: Array.from(node.childNodes), scope, selector };
      texts.set(id, entry);
      const observer = new MutationObserver(() => {
        const expected = expectedLabels.get(id);
        const current = target(entry);
        if (active && expected !== void 0 && current.textContent !== expected) current.textContent = expected;
      });
      observer.observe(scope || node, { childList: true, characterData: true, subtree: true });
      observers.push(observer);
    }
    function capture(scrollers) {
      if (active) return;
      savedWindow = { x: window.scrollX, y: window.scrollY };
      scrollers.forEach((node) => scroll.set(node, node.scrollLeft));
      active = true;
      pagers.forEach(({ root }) => root.querySelectorAll("button").forEach((button) => buttons.set(button, { disabled: button.disabled, aria: button.getAttribute("aria-disabled") })));
    }
    function registerPager(root, viewport) {
      pagers.push({ root, viewport });
      const direction = (button) => /^(next)\b/i.test(button.getAttribute("aria-label") || "") ? 1 : /^(previous)\b/i.test(button.getAttribute("aria-label") || "") ? -1 : 0;
      const sync = () => {
        if (!active) return;
        root.querySelectorAll("button").forEach((button) => {
          const step = direction(button);
          if (!step) return;
          button.disabled = step < 0 ? viewport.scrollLeft <= 2 : viewport.scrollLeft >= viewport.scrollWidth - viewport.clientWidth - 2;
          button.setAttribute("aria-disabled", String(button.disabled));
        });
      };
      root.addEventListener("click", (event) => {
        if (!active) return;
        const target2 = event.target instanceof Element ? event.target.closest("button") : null;
        if (!target2) return;
        const step = direction(target2);
        if (!step) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        viewport.scrollBy({ left: step * Math.max(250, viewport.clientWidth - 100), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }, { capture: true, signal: abort.signal });
      viewport.addEventListener("scroll", () => requestAnimationFrame(sync), { passive: true, signal: abort.signal });
      window.addEventListener("resize", () => requestAnimationFrame(sync), { passive: true, signal: abort.signal });
    }
    function clearPresentation() {
      presentation.forEach((style2, node) => {
        if (style2 === null) {
          node.style.cssText = "";
          node.getAttribute("style");
          node.removeAttribute("style");
        } else node.setAttribute("style", style2);
      });
      presentation.clear();
      hidden.forEach((value, node) => {
        node.hidden = value;
      });
      hidden.clear();
      attributes.forEach((values, node) => values.forEach((value, name) => {
        if (value === null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      }));
      attributes.clear();
      disclosures.splice(0).forEach((node) => node.remove());
      layoutStyle?.remove();
      layoutStyle = void 0;
    }
    function remember(node) {
      if (!presentation.has(node)) presentation.set(node, node.getAttribute("style"));
    }
    function style(node, values) {
      if (!node) return;
      remember(node);
      Object.entries(values).forEach(([name, value]) => node.style.setProperty(name, value, "important"));
    }
    function mark(node, name, value) {
      if (!attributes.has(node)) attributes.set(node, /* @__PURE__ */ new Map());
      const values = attributes.get(node);
      if (!values.has(name)) values.set(name, node.getAttribute(name));
      node.setAttribute(name, value);
    }
    const unsafe2 = (node) => !!node.querySelector('form,input,select,textarea,[role="tablist"],[role="tabpanel"],details,summary,[role="dialog"],.tabnav-gallery');
    function disclose(nodes, parent, label, after) {
      const rest = nodes.filter((node) => !node.hidden && !unsafe2(node));
      if (!rest.length) return;
      rest.forEach((node) => {
        if (!hidden.has(node)) hidden.set(node, node.hidden);
        remember(node);
        node.hidden = true;
        node.style.setProperty("display", "none", "important");
      });
      const row = document.createElement("div"), button = document.createElement("button");
      row.dataset.cloakDisclosure = "true";
      row.style.cssText = "padding:24px;text-align:center;max-width:1180px;margin:auto;";
      const collapsed = label || `Show ${rest.length} more`;
      button.type = "button";
      button.textContent = collapsed;
      button.setAttribute("aria-expanded", "false");
      button.style.cssText = 'font:400 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:inherit;background:transparent;border:1px solid #86868b;border-radius:24px;padding:11px 24px;cursor:pointer;';
      button.onclick = () => {
        const expand = button.getAttribute("aria-expanded") === "false";
        rest.forEach((node) => {
          node.hidden = !expand;
          if (expand) node.style.removeProperty("display");
          else node.style.setProperty("display", "none", "important");
        });
        button.setAttribute("aria-expanded", String(expand));
        button.textContent = expand ? "Show fewer" : collapsed;
        window.dispatchEvent(new Event("resize"));
      };
      row.append(button);
      if (after) after.after(row);
      else parent.after(row);
      disclosures.push(row);
    }
    function present(options, focusGroups = []) {
      clearPresentation();
      if (options?.reading === "larger") {
        const main = document.querySelector('main,[role="main"],.main');
        main?.querySelectorAll('p,[class*="description"],[class*="desccontent"],[class*="descprice"]').forEach((node) => {
          if (node.closest("nav,footer,[hidden],noscript,script,style") || node.querySelector('p,[class*="description"]')) return;
          const computed = getComputedStyle(node), size = parseFloat(computed.fontSize);
          if (size < 12 || size > 24) return;
          remember(node);
          node.style.setProperty("font-size", `${Math.round(size * 1.18 * 10) / 10}px`, "important");
          node.style.setProperty("line-height", "1.55", "important");
        });
      }
      const limit = options?.maxVisible === null ? null : options?.maxVisible || (options?.layout === "guided" ? 2 : options?.density === "focused" ? 4 : null);
      if (limit) focusGroups.forEach(({ nodes, parent }) => {
        if (!nodes.some(unsafe2) && !parent.closest(".tabnav-gallery")) disclose(nodes.slice(limit), parent);
      });
    }
    function layout(options, config) {
      const mode = options?.layout || "balanced";
      const columns = mode === "guided" ? 2 : mode === "balanced" ? 2 : 3;
      layoutStyle = document.createElement("style");
      layoutStyle.dataset.cloakLayoutStyle = "true";
      layoutStyle.textContent = `[data-cloak-grid]{display:grid!important;grid-template-columns:repeat(var(--cloak-columns,3),minmax(0,1fr))!important;grid-template-areas:none!important;grid-template-rows:none!important;grid-auto-flow:row!important;grid-auto-columns:minmax(0,1fr)!important;grid-auto-rows:auto!important;gap:24px!important;align-items:stretch!important;transform:none!important;width:100%!important;min-width:0!important;max-width:none!important;overflow:visible!important;list-style:none!important;padding:0!important;margin:0!important;scroll-snap-type:none!important}[data-cloak-grid]>*{grid-column:auto!important;grid-row:auto!important}[data-cloak-griditem]{width:100%!important;max-width:none!important;min-width:0!important;flex:none!important;margin:0!important;transform:none!important;position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;grid-column:auto!important;grid-row:auto!important;order:0!important;scroll-snap-align:none!important}[data-cloak-griditem][hidden]{display:none!important}[data-cloak-featured]{grid-column:span 2!important}[data-cloak-griditem]>.rf-cards-scroller-itemview{transform:none!important;margin:0!important;padding:0!important;box-sizing:border-box!important}[data-cloak-griditem]>.rf-cards-scroller-itemview,[data-cloak-griditem] .rf-ccard,[data-cloak-griditem] .rf-recommcard{width:100%!important;max-width:none!important;min-width:0!important}[data-cloak-griditem] .rf-ccard-content{width:100%!important;box-sizing:border-box!important}[data-cloak-griditem] .rf-ccard-img-wrapper{width:100%!important}[data-cloak-griditem] .rf-ccard-img{left:50%!important;transform:translateX(-50%)!important}[data-cloak-layout=guided] [data-cloak-griditem] .rf-ccard{min-height:500px!important}[data-cloak-layout] .rs-productnav-cardsshelf .rf-productnav-card{max-height:54px!important;contain:none!important;content-visibility:visible!important}[data-cloak-layout=guided] .rs-productnav-cardsshelf .rf-productnav-card{max-height:108px!important}@media(max-width:1000px){[data-cloak-grid]{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:18px!important}}@media(max-width:700px){[data-cloak-grid]{grid-template-columns:minmax(0,1fr)!important;gap:16px!important}[data-cloak-featured]{grid-column:auto!important}[data-cloak-layout-root]{--cloak-gutter:36px!important}}`;
      document.head.append(layoutStyle);
      mark(config.main, "data-cloak-layout", mode);
      if (config.kind === "store") {
        config.main.querySelectorAll(".rs-shop-header-section,.rs-shop-chatstore-section").forEach((node) => style(node, { "padding-top": "32px", "padding-bottom": "24px", height: "auto" }));
        config.main.querySelectorAll(".rs-shop-container > .row > .column").forEach((node) => style(node, { "padding-top": "24px", "padding-bottom": "20px", height: "auto" }));
        const header = config.main.querySelector(".rs-shop-header");
        style(header, { "font-size": "56px", "line-height": "1.1" });
        config.main.querySelectorAll(".rs-productnav-cardsshelf").forEach((node) => style(node, { "padding-bottom": "20px", "padding-top": "0", height: "auto", "margin-bottom": "12px" }));
        config.main.querySelectorAll(".rs-productnav-cardsshelf .rf-cards-scroller-platter").forEach((node) => style(node, { "padding-top": "4px", "padding-bottom": "12px" }));
        config.main.querySelectorAll(".rs-productnav-cardsshelf .rf-cards-scroller-crop").forEach((node) => style(node, { "padding-bottom": "0", height: "auto" }));
        config.main.querySelectorAll(".rs-productnav-cardsshelf .rf-productnav-card-image").forEach((node) => style(node, mode === "guided" ? { height: "54px" } : { display: "none" }));
        config.main.querySelectorAll(".rs-productnav-cardsshelf .rf-productnav-card").forEach((node) => style(node, { height: "auto", "min-height": "0" }));
        config.main.querySelectorAll(".rs-productnav-cardsshelf").forEach((shelf) => {
          const nodes = Array.from(shelf.querySelectorAll("[data-core-scroller-item]"));
          const parent = nodes[0]?.parentElement;
          if (!parent) return;
          style(shelf, { "padding-top": "12px", "padding-bottom": "24px" });
          style(parent, { display: "flex", "flex-wrap": "nowrap", gap: mode === "guided" ? "12px" : "28px", "align-items": "center", "overflow-x": "auto", "overflow-y": "hidden", padding: "8px 0", width: "100%", height: "auto", "min-height": "0", transform: "none" });
          nodes.forEach((node) => {
            style(node, { width: mode === "guided" ? "112px" : "auto", height: "auto", flex: "0 0 auto" });
            style(node.querySelector(".rf-cards-scroller-itemview"), { width: "auto", margin: "0", padding: "0", transform: "none" });
            style(node.querySelector(".rf-productnav-card"), { width: "auto", padding: "0", height: mode === "guided" ? "108px" : "54px", "aspect-ratio": "auto" });
          });
          let ancestor = parent.parentElement;
          while (ancestor && ancestor !== shelf) {
            style(ancestor, { width: "100%", height: "auto", "min-height": "0", "max-height": "none", overflow: "visible", padding: "0", transform: "none" });
            ancestor = ancestor.parentElement;
          }
          const root = parent.closest(".rf-cards-scroller");
          if (root) {
            style(root, { width: "calc(100% - var(--cloak-gutter, 96px))", "max-width": "1180px", "margin-left": "auto", "margin-right": "auto" });
            root.querySelectorAll("button").forEach((node) => style(node, { display: "none" }));
          }
        });
      } else {
        config.main.querySelectorAll('[class*="PageHeader_container"]').forEach((node) => style(node, { "padding-top": "36px", "padding-bottom": "28px" }));
        Array.from(config.main.children).filter((node) => node instanceof HTMLElement && !!node.querySelector("h1") && !!node.querySelector('nav,[class*="ChapterNav"]')).forEach((node) => style(node, { "padding-bottom": "28px" }));
      }
      for (const group of config.groups) {
        if (group.nodes.length < 2 || group.nodes.some(unsafe2)) continue;
        mark(group.parent, "data-cloak-grid", mode);
        style(group.parent, { "--cloak-columns": String(columns) });
        group.nodes.forEach((node) => mark(node, "data-cloak-griditem", "true"));
        if (mode === "immersive" && group.nodes.length >= 3) mark(group.nodes[0], "data-cloak-featured", "true");
        const root = group.root || group.viewport || group.parent;
        mark(root, "data-cloak-layout-root", "true");
        if (config.kind === "store" || root !== group.parent) style(root, { "width": "calc(100% - var(--cloak-gutter, 96px))", "max-width": "1180px", "margin-left": "auto", "margin-right": "auto", "overflow": "visible", "height": "auto", "padding-left": "0", "padding-right": "0" });
        let ancestor = group.parent.parentElement;
        while (ancestor && ancestor !== root && ancestor !== config.main) {
          style(ancestor, { "overflow": "visible", "width": "100%", "max-width": "none", "height": "auto", "transform": "none", "padding-left": "0", "padding-right": "0" });
          ancestor = ancestor.parentElement;
        }
        if (group.viewport) style(group.viewport, { "scroll-snap-type": "none", "overflow": "visible", "height": "auto", "transform": "none", "padding-left": "0", "padding-right": "0" });
        root.querySelectorAll('.paddlenav,[class*="PaddleNav"],.rf-cards-scroller-paddlenav').forEach((node) => style(node, { display: "none" }));
        pagers.filter((pager) => pager.root === root || root.contains(pager.root)).forEach((pager) => pager.root.querySelectorAll("button").forEach((button) => {
          if (/^(next|previous)\b/i.test(button.getAttribute("aria-label") || "")) style(button, { display: "none" });
        }));
      }
      const hero = config.heroes?.find((node) => node.parentElement === config.main && !config.sections.includes(node) && !unsafe2(node));
      if (hero) config.sections.slice(0, mode === "guided" ? 2 : 1).filter((node) => node !== hero && node.parentElement === config.main).forEach((node) => config.main.insertBefore(node, hero));
      const keep = mode === "guided" ? 2 : mode === "immersive" ? 3 : 4;
      if (options?.maxVisible !== null && config.sections.length > keep) {
        const remaining = config.sections.slice(keep).filter((node) => !unsafe2(node));
        const anchor = config.sections[keep - 1];
        if (anchor) disclose(remaining, config.main, `Explore ${remaining.length} more sections`, anchor);
      }
      window.dispatchEvent(new Event("resize"));
    }
    function restore(positions = true) {
      expectedLabels.clear();
      media.disconnect();
      clearPresentation();
      for (const [id, group] of groups) if (group.nodes.every((node) => node.isConnected) && group.slots.every((slot) => slot.isConnected)) reorder(id, group.ids);
      for (const entry of texts.values()) target(entry).replaceChildren(...entry.children);
      if (positions && active) {
        scroll.forEach((left, node) => node.scrollTo({ left, behavior: "instant" }));
        window.scrollTo({ left: savedWindow.x, top: savedWindow.y, behavior: "instant" });
        active = false;
        scroll.clear();
        buttons.forEach((state, button) => {
          button.disabled = state.disabled;
          if (state.aria === null) button.removeAttribute("aria-disabled");
          else button.setAttribute("aria-disabled", state.aria);
        });
        buttons.clear();
        window.dispatchEvent(new Event("resize"));
        pagers.forEach(({ viewport }) => viewport.dispatchEvent(new Event("scroll")));
        requestAnimationFrame(() => {
          if (!active) {
            window.dispatchEvent(new Event("resize"));
            pagers.forEach(({ viewport }) => viewport.dispatchEvent(new Event("scroll")));
          }
        });
        const restorePaging = () => {
          if (active) return;
          pagers.forEach(({ root, viewport }) => {
            if (viewport.scrollWidth <= viewport.clientWidth + 2) return;
            root.querySelectorAll('[class*="hidePaddles"]').forEach((node) => Array.from(node.classList).filter((name) => /hidePaddles/.test(name)).forEach((name) => node.classList.remove(name)));
          });
        };
        restorePaging();
        requestAnimationFrame(restorePaging);
      }
    }
    function apply(operations, labels) {
      for (const op of operations) {
        const group = groups.get(op.group);
        if (!group || op.order.length !== group.ids.length || new Set(op.order).size !== group.ids.length || op.order.some((id) => !group.ids.includes(id))) throw new Error("The personalization plan does not match this page");
      }
      if (labels.some((label) => !texts.has(label.id) || typeof label.text !== "string" || label.text.length > 100)) throw new Error("Invalid collection label");
      try {
        operations.forEach((op) => reorder(op.group, op.order));
        labels.forEach((label) => {
          expectedLabels.set(label.id, label.text);
          target(texts.get(label.id)).textContent = label.text;
        });
        document.querySelectorAll("picture[data-lazy]").forEach((picture) => media.observe(picture));
      } catch (error) {
        restore();
        throw error;
      }
    }
    win.__cloakDom = {
      register,
      registerText,
      registerPager,
      capture,
      apply,
      restore,
      present,
      layout,
      clearPresentation,
      release: () => {
        restore();
        groups.forEach((group) => group.slots.forEach((slot) => slot.remove()));
        groups.clear();
        texts.clear();
        observers.forEach((observer) => observer.disconnect());
        observers.length = 0;
        scroll.clear();
      },
      destroy: () => {
        restore();
        media.disconnect();
        abort.abort();
        observers.forEach((observer) => observer.disconnect());
      },
      diagnostics: () => Object.fromEntries([...groups].map(([id, group]) => [id, group.ids.map((id2, i) => ({ id: id2, connected: group.nodes[i].isConnected, slot: group.slots[i].isConnected }))]))
    };
  }

  // extension/src/generic.ts
  var blockedPage = () => {
    const context = location.pathname + " " + location.hostname;
    return /(?:login|log-in|signin|sign-in|account|checkout|check-out|payment|payments|billing|cart|pay|auth|oauth|order-review)/i.test(context) || !!document.querySelector('input[type="password"],input[autocomplete="username"],input[autocomplete^="cc-"],input[autocomplete="current-password"],input[name*="card" i],input[name*="payment" i],form[action*="checkout" i],form[action*="payment" i]');
  };
  var unsafe = (node) => !!node.closest('form,[role="form"],[role="dialog"],dialog,nav,[role="navigation"],footer,header,aside,[role="tablist"],[role="tabpanel"],[contenteditable="true"],[aria-modal="true"]') || !!node.querySelector('form,input,select,textarea,button,[contenteditable="true"],[role="tablist"],[role="tabpanel"],[role="dialog"],dialog,[aria-modal="true"],script,style');
  var words = (value) => new Set(value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter((word) => word.length > 2));
  function relevance(text, preference) {
    const wanted = words(preference), available = words(text);
    if (!wanted.size || !available.size) return 0;
    let hits = 0;
    wanted.forEach((word) => {
      if (available.has(word)) hits++;
    });
    return hits / wanted.size;
  }
  function discoverGenericGroups(documentRoot = document) {
    const main = documentRoot.querySelector('main,[role="main"],article') || documentRoot.body;
    const candidates = [];
    for (const parent of main.querySelectorAll('ul,ol,[role="list"],section,article,[class*="result" i],[class*="product" i],[class*="card" i],[class*="cards" i],[class*="grid" i]')) {
      if (unsafe(parent)) continue;
      const nodes = Array.from(parent.children).filter((child) => child instanceof HTMLElement && !unsafe(child) && !!child.querySelector('h1,h2,h3,h4,[role="heading"]'));
      if (nodes.length < 2 || nodes.length > 40 || nodes.some((node) => !node.querySelector('h1,h2,h3,h4,[role="heading"]')?.textContent?.trim())) continue;
      candidates.push({ parent, nodes, type: "items" });
    }
    const sections = Array.from(main.children).filter((node) => node instanceof HTMLElement && /^(SECTION|ARTICLE)$/.test(node.tagName) && !unsafe(node) && !!node.querySelector('h1,h2,h3,[role="heading"]'));
    if (sections.length >= 2) candidates.push({ parent: main, nodes: sections, type: "sections" });
    const groups = [], seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      if (candidate.nodes.some((node) => seen.has(node))) continue;
      const entries = candidate.nodes.map((node, index) => ({ id: `${candidate.type}-${groups.length}-${index}`, node }));
      const titleNode = candidate.parent.querySelector(":scope > h1,:scope > h2,:scope > h3");
      groups.push({ id: `${candidate.type}-${groups.length}`, title: titleNode?.textContent?.trim() || candidate.parent.getAttribute("aria-label") || candidate.type, parent: candidate.parent, entries });
      candidate.nodes.forEach((node) => seen.add(node));
    }
    return groups;
  }
  function installGenericCloak() {
    const win = window;
    if (win.__cloakGeneric) return;
    if (!/^https?:$/.test(location.protocol)) throw new Error("Cloak works on ordinary HTTP and HTTPS websites.");
    if (blockedPage()) throw new Error("This page looks like an account, sign-in, checkout, or payment page. Cloak will leave it unchanged.");
    installDomEngine();
    const engine = win.__cloakDom;
    const groups = discoverGenericGroups();
    const safe = groups.filter((group) => group.entries.length >= 2 && group.entries.every((entry) => entry.node.parentElement === group.parent && !unsafe(entry.node)));
    if (!safe.length) throw new Error("No safe article, card, search result, or product groups were found on this page.");
    const items = safe.flatMap((group) => group.entries.map((entry, originalIndex) => {
      const heading = entry.node.querySelector('h1,h2,h3,h4,[role="heading"]');
      const anchor = entry.node.querySelector("a[href]");
      return { id: entry.id, title: heading.textContent?.trim() || "", url: anchor?.href || location.href, description: entry.node.innerText, originalIndex, sectionId: group.id, kind: "content" };
    }));
    const sections = safe.map((group, originalIndex) => ({ id: group.id, title: group.title, description: group.parent.innerText.slice(0, 1e3), itemIds: group.entries.map((entry) => entry.id), originalIndex }));
    const inventory = { url: location.href, mode: "content", sections, categories: [], items, primarySectionId: safe[0].id };
    let registered = false, active = false;
    function register() {
      safe.forEach((group) => engine.register(group.id, group.entries));
      registered = true;
    }
    function personalize(preference) {
      if (!preference.trim()) throw new Error("Describe what you want to find before personalizing.");
      if (!registered) register();
      engine.capture([]);
      try {
        engine.apply(safe.map((group) => ({ group: group.id, order: [...group.entries].sort((a, b) => relevance(`${b.node.innerText} ${group.title}`, preference) - relevance(`${a.node.innerText} ${group.title}`, preference)).map((entry) => entry.id) })), []);
      } catch (error) {
        throw new Error(error.message.replace("Reload Apple", "Reload this tab"));
      }
      active = true;
      return { status: "personalized", groups: safe.length };
    }
    function restore() {
      const health = engine.diagnostics();
      const restorable = Object.values(health).flat().every((entry) => entry.connected && entry.slot);
      engine.release();
      registered = false;
      active = false;
      if (!restorable) throw new Error("The page changed while Cloak was active, so the original layout could not be restored safely. Reload this tab to reset it.");
      return { status: "original", groups: safe.length };
    }
    win.__cloakGeneric = { inventory, personalize, restore, status: () => ({ active, groups: safe.length }) };
    window.addEventListener("pagehide", restore, { once: true });
  }

  // extension/src/content.ts
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === "status") {
        sendResponse(window.__cloakGeneric?.status() || { active: false, groups: 0 });
        return;
      }
      installGenericCloak();
      const result = message?.type === "personalize" ? window.__cloakGeneric.personalize(String(message.preference || "")) : message?.type === "restore" ? window.__cloakGeneric.restore() : null;
      if (!result) throw new Error("Unknown Cloak action.");
      sendResponse(result);
    } catch (error) {
      sendResponse({ error: error.message || "Cloak could not change this page." });
    }
    return false;
  });
})();
