// Serialized into apple.com by Playwright. All DOM changes are reversible.
export function installAppleCloak() {
  const win = window as any;
  if (win.__cloak) return;
  const clean = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
  const seen = new Set<string>();
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.rf-ccard'))
    .filter(node => node.querySelector('.rf-ccard-content-headerlink'))
    .map((node, originalIndex) => {
      const link = node.querySelector<HTMLAnchorElement>('.rf-ccard-content-headerlink')!;
      const title = clean(link.textContent);
      let hash = 2166136261;
      for (const char of `${link.href}|${title}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      const description = [clean(node.querySelector('.rf-ccard-content-desccontent')?.textContent), clean(node.querySelector('img')?.alt)].filter(Boolean).join(' ').slice(0, 700) || title;
      return { node, style: node.getAttribute('style'), story: { id: `apple-${(hash >>> 0).toString(16)}`, title, url: link.href, description, originalIndex } };
    }).filter(card => { const key = `${card.story.title}|${card.story.url}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 70);

  const host = document.createElement('div');
  host.id = 'cloak-controls';
  host.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:2147483647;max-width:calc(100vw - 32px);';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}button,input,textarea,select{font:inherit}button,select{cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #777;outline-offset:3px}button{color:inherit;border:0}button:disabled{opacity:.55;cursor:wait}
    .panel{width:284px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 44px);overflow:auto;border:1px solid #00000014;border-radius:20px;background:#fffffff5;backdrop-filter:blur(24px);box-shadow:0 8px 45px #00000016,0 1px 3px #0001;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f}
    header{display:flex;align-items:center;justify-content:space-between;padding:15px 17px 10px;gap:12px}.brand{font-size:21px;letter-spacing:-1px;font-weight:650;display:flex;align-items:center;gap:7px}.mark{width:16px;height:19px;border:5px solid #1d1d1f;border-right:0;border-radius:14px 0 0 14px;transform:rotate(-14deg)}.header-actions{display:flex;gap:7px;align-items:center}.state{font-size:9px;color:#6e6e73;padding-right:3px}.icon{display:grid;place-items:center;border-radius:50%;width:25px;height:25px;background:#f0f0f3;color:#6e6e73;font-size:16px}.icon svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.5}
    .body{padding:4px 17px 17px}.headline{font-size:14px;font-weight:550;letter-spacing:-.25px;margin:4px 0 5px}.status{font-size:11px;color:#6e6e73;margin:0 0 13px;line-height:1.6}.label{display:block;font-size:10px;color:#6e6e73;margin-bottom:5px}select{width:100%;padding:8px 10px;background:#f5f5f7;border:1px solid #e7e7ec;border-radius:8px;color:#414145;font-size:11px;margin-bottom:12px}.primary{width:100%;min-height:38px;border-radius:11px;background:#1d1d1f;color:#fff;font-size:12px;font-weight:500;padding:9px 13px}.primary:hover{background:#363638}.primary.undo{background:#ededf0;color:#333}.find{display:block;width:100%;text-align:left;background:none;font-size:11px;line-height:1.5;padding:12px 0 0;color:#55555b}.find strong{font-weight:500;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:245px}.find span{font-size:10px;color:#6e6e73}.footnote{font-size:9px;color:#6e6e73;margin:11px 0 0;text-align:center}.collapsed{width:169px}.collapsed header{padding:11px 14px}.collapsed .body{display:none}.collapsed #settings-button,.collapsed .state{display:none}
    .settings label{display:block;font-size:11px;font-weight:500;margin:12px 0 5px}input,textarea{width:100%;border:1px solid #d7d7dd;border-radius:8px;background:#fafafa;color:#333;padding:9px 10px;font-size:11px;line-height:1.6;resize:vertical}textarea{min-height:70px}.settings h2{font-size:16px;font-weight:600;letter-spacing:-.4px;margin:4px 0 0}.settings p{font-size:11px;color:#6e6e73;margin:5px 0 12px}.settings .primary{margin-top:14px}.secondary{width:100%;background:none;color:#6e6e73;font-size:11px;padding:9px}.settings .error,.error{color:#6f3f3f}.retry{font-size:11px;text-decoration:underline;background:none;padding:0 0 12px;color:#555}
    @media(max-width:480px){.panel{width:266px}header{padding:13px 16px 9px}.body{padding:3px 16px 15px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
  <section class="panel" aria-label="Cloak personalization controls">
    <header><div class="brand"><i class="mark"></i>cloak</div><div class="header-actions"><span class="state" id="view-state">Original</span><button class="icon" id="settings-button" aria-label="Edit your perspective"><svg viewBox="0 0 16 16"><path d="M2 5h3m4 0h5M2 11h7m4 0h1"/><circle cx="7" cy="5" r="2"/><circle cx="11" cy="11" r="2"/></svg></button><button class="icon" id="minimize" aria-label="Minimize Cloak" aria-expanded="true">−</button></div></header>
    <div class="body"><div id="main"><p class="headline" id="headline">The Apple Store, as it is.</p><p class="status" id="status" role="status">Choose your perspective. Then see the difference.</p><label class="label" for="profile">Your perspective</label><select id="profile" aria-label="Personal profile"></select><button class="retry" id="retry" hidden>Retry loading local AI</button><button class="primary" id="apply">Cloak this page <span aria-hidden="true">✦</span></button><button class="find" id="top-match" hidden><strong></strong><span>Find your top match on the page ↗</span></button><p class="footnote">Local AI. Original design. Always reversible.</p></div>
    <form class="settings" id="settings" hidden><h2>Your perspective.</h2><p>A little context goes a long way.</p><label for="name">Profile name</label><input id="name" maxlength="60" required><label for="description">What matters to you?</label><textarea id="description" rows="4" maxlength="2000" required></textarea><label for="interests">Interests, separated by commas</label><input id="interests" maxlength="960"><label for="avoid">Less of</label><textarea id="avoid" rows="2" maxlength="1000"></textarea><p id="form-error" class="error" role="alert"></p><button type="submit" class="primary">Save perspective</button><button type="button" class="secondary" id="cancel">Back to the page</button><button type="button" class="secondary" id="reset">Reset this profile’s learning</button></form></div>
  </section>`;
  document.documentElement.appendChild(host);
  const $ = (selector: string) => root.querySelector(selector) as HTMLElement;
  let latest: any, badges: HTMLElement[] = [], pendingFocus = false, moved = false;
  let savedScroll = { x: window.scrollX, y: window.scrollY };
  let scrollers: { node: HTMLElement; left: number }[] = [];
  async function action(payload: any) {
    try { await win.cloakAction(payload); return true; }
    catch (error) { $('#status').textContent = (error as Error).message; $('#form-error').textContent = (error as Error).message; return false; }
  }
  function closeSettings() { $('#settings').hidden = true; $('#main').hidden = false; $('#settings-button').setAttribute('aria-expanded', 'false'); }
  $('#minimize').onclick = () => {
    const collapsed = $('.panel').classList.toggle('collapsed');
    $('#minimize').textContent = collapsed ? '+' : '−';
    $('#minimize').setAttribute('aria-expanded', String(!collapsed));
    $('#minimize').setAttribute('aria-label', collapsed ? 'Expand Cloak' : 'Minimize Cloak');
  };
  $('#settings-button').setAttribute('aria-expanded', 'false');
  $('#settings-button').onclick = () => {
    if (!$('#settings').hidden) { closeSettings(); return; }
    const profile = latest?.profiles.find((p: any) => p.id === latest.activeProfileId); if (!profile) return;
    for (const name of ['name', 'description', 'avoid']) ($(`#${name}`) as HTMLInputElement).value = profile[name];
    ($('#interests') as HTMLInputElement).value = profile.interests.join(', ');
    $('#form-error').textContent = ''; $('#main').hidden = true; $('#settings').hidden = false;
    $('#settings-button').setAttribute('aria-expanded', 'true'); $('#name').focus();
  };
  $('#cancel').onclick = closeSettings;
  root.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') { closeSettings(); $('#settings-button').focus(); } });
  ($('#settings') as HTMLFormElement).onsubmit = async event => {
    event.preventDefault();
    const value = (id: string) => ($(`#${id}`) as HTMLInputElement).value;
    const button = $('#settings button[type=submit]') as HTMLButtonElement; button.disabled = true;
    const ok = await action({ type: 'save-profile', name: value('name'), description: value('description'), avoid: value('avoid'), interests: value('interests').split(',').map(s => s.trim()).filter(Boolean) });
    button.disabled = false; if (ok) closeSettings();
  };
  $('#reset').onclick = () => action({ type: 'clear-feedback' });
  ($('#profile') as HTMLSelectElement).onchange = event => action({ type: 'profile', id: (event.target as HTMLSelectElement).value });
  $('#apply').onclick = () => action({ type: 'toggle', enabled: !latest?.enabled });
  $('#retry').onclick = () => action({ type: 'retry-model' });
  $('#top-match').onclick = () => { if (latest?.ranked[0]) find(latest.ranked[0].id); };
  function captureScroll() {
    savedScroll = { x: window.scrollX, y: window.scrollY };
    scrollers = Array.from(document.querySelectorAll<HTMLElement>('.rf-cards-scroller-content')).map(node => ({ node, left: node.scrollLeft }));
  }
  function restore(restoreScroll = false) {
    badges.forEach(b => b.remove()); badges = [];
    cards.forEach(({ node, style }) => { if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style); });
    if (restoreScroll && moved) {
      scrollers.forEach(({ node, left }) => node.scrollTo({ left, behavior: 'instant' }));
      window.scrollTo({ left: savedScroll.x, top: savedScroll.y, behavior: 'instant' }); moved = false;
    }
  }
  function find(id: string) {
    const card = cards.find(c => c.story.id === id); if (!card) return;
    if (!scrollers.length) captureScroll();
    moved = true;
    card.node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  }
  function focusShelves(ranked: any[]) {
    // Use the native scroller. Card order, event handlers and carousel controls stay intact.
    for (const { node } of scrollers) {
      const best = ranked.map(story => cards.find(c => c.story.id === story.id)).find(card => card && node.contains(card.node));
      if (!best) continue;
      const offset = best.node.getBoundingClientRect().left - node.getBoundingClientRect().left;
      node.scrollTo({ left: Math.max(0, node.scrollLeft + offset - 24), behavior: 'instant' });
      moved = true;
    }
    // The explicit Cloak action also reveals the highest-ranked real product.
    const first = cards.find(card => card.story.id === ranked[0]?.id);
    if (first) {
      const bounds = first.node.getBoundingClientRect();
      if (bounds.top < 60 || bounds.bottom > innerHeight) {
        window.scrollTo({ top: Math.max(0, window.scrollY + bounds.top - 140), behavior: 'instant' });
        moved = true;
      }
    }
  }
  win.__cloak = {
    extract: () => cards.map(c => c.story), restore: () => restore(true), find,
    update: (state: any) => {
      if (state.enabled && !latest?.enabled) { captureScroll(); pendingFocus = true; }
      if (state.enabled && latest && latest.activeProfileId !== state.activeProfileId) pendingFocus = true;
      latest = state;
      const select = $('#profile') as HTMLSelectElement;
      if (JSON.stringify(Array.from(select.options).map(o => [o.value, o.text])) !== JSON.stringify(state.profiles.map((p: any) => [p.id, p.name]))) {
        select.replaceChildren(...state.profiles.map((p: any) => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; return option; }));
      }
      select.value = state.activeProfileId;
      const enabled = state.enabled, ready = state.model.phase === 'ready';
      $('#view-state').textContent = enabled ? (state.busy || !ready ? 'Preparing' : 'Cloaked') : 'Original';
      $('#headline').textContent = enabled ? 'The Apple Store. For you.' : 'The Apple Store, as it is.';
      $('#apply').textContent = enabled ? 'Show original' : 'Cloak this page ✦'; $('#apply').classList.toggle('undo', enabled);
      $('#apply').setAttribute('aria-pressed', String(enabled));
      $('#status').textContent = state.error || (state.model.phase === 'error' ? 'Local AI couldn’t load. Retry below.' : state.busy && enabled ? 'Finding what matters to you…' : enabled && !ready ? 'Local AI is getting ready. You can keep browsing.' : enabled ? `${cards.length} items considered. Your interests come into focus.` : 'Choose your perspective. Then see the difference.');
      $('#status').classList.toggle('error', !!state.error || state.model.phase === 'error'); $('#retry').hidden = state.model.phase !== 'error';
      $('#top-match').hidden = !enabled || !state.ranked.length || state.busy;
      if (state.ranked[0]) $('#top-match strong').textContent = state.ranked[0].title;
      if (!enabled) { pendingFocus = false; restore(true); return; }
      if (state.busy) return;
      restore(); if (!ready) return;
      const top = state.ranked.slice(0, Math.min(5, Math.ceil(cards.length / 3)));
      top.forEach((story: any) => {
        const card = cards.find(c => c.story.id === story.id); if (!card) return;
        card.node.style.outline = '2px solid #86868b'; card.node.style.outlineOffset = '-2px'; card.node.style.position = 'relative';
        const badge = document.createElement('div'); badge.dataset.cloakBadge = story.id;
        badge.style.cssText = 'position:absolute;right:14px;bottom:14px;z-index:3;';
        const shadow = badge.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>:host{all:initial}*{box-sizing:border-box}.badge{display:flex;align-items:center;gap:5px;background:#fffffff5;backdrop-filter:blur(12px);color:#1d1d1f;box-shadow:0 1px 8px #0001;border:1px solid #0001;padding:5px 7px 5px 10px;border-radius:20px;font:11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.badge span{padding-right:3px}button{cursor:pointer;border:0;border-radius:50%;width:26px;height:26px;font:15px/1 sans-serif;background:#ededf0;color:#555}button[aria-pressed=true]{background:#222;color:white}button:focus-visible{outline:2px solid #777;outline-offset:2px}</style><div class="badge"><span>✦ For you</span><button aria-label="More like this">+</button><button aria-label="Less like this">−</button></div>`;
        shadow.querySelector('.badge')!.setAttribute('title', story.reason);
        const feedback = state.profiles.find((p: any) => p.id === state.activeProfileId)?.feedback.find((f: any) => f.id === story.id);
        Array.from(shadow.querySelectorAll('button')).forEach((button, i) => {
          const value = i === 0 ? 1 : -1; button.setAttribute('aria-pressed', String(feedback?.value === value));
          button.onclick = event => { event.preventDefault(); event.stopPropagation(); void action({ type: 'feedback', id: story.id, value }); };
        });
        badge.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
        card.node.appendChild(badge); badges.push(badge);
      });
      if (pendingFocus && state.ranked.length) { focusShelves(state.ranked); pendingFocus = false; }
    }
  };
  document.addEventListener('click', event => {
    if (!latest?.enabled || event.composedPath().some(n => n instanceof HTMLElement && (n.dataset.cloakBadge || n.id === 'cloak-controls'))) return;
    const target = event.target instanceof Element ? event.target.closest('.rf-ccard') : null;
    const card = cards.find(c => c.node === target); if (card) void action({ type: 'open', id: card.story.id });
  }, { capture: true });
}
