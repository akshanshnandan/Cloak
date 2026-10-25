// This function is serialized into the real page by Playwright. Keep it self-contained.
export function installCloak() {
  const win = window as any;
  if (win.__cloak) return;
  const host = document.createElement('div');
  host.id = 'cloak-controls';
  host.style.cssText = 'position:fixed;bottom:22px;right:22px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host{all:initial;color-scheme:light}*{box-sizing:border-box}button,select{font:inherit}button,select{cursor:pointer}button:focus-visible,select:focus-visible{outline:3px solid #e5a38e;outline-offset:3px}
      .panel{width:296px;border:1px solid #dfddd6;background:#faf9f5;border-radius:18px;box-shadow:0 12px 48px #24231824;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#292c25;overflow:hidden}
      header{display:flex;align-items:center;justify-content:space-between;padding:15px 17px}.brand{font-weight:700;font-size:20px;letter-spacing:-1px;display:flex;align-items:center;gap:8px}.mark{width:21px;height:25px;border:6px solid #d45b3b;border-right-width:0;border-radius:16px 0 0 16px;transform:rotate(-12deg)}
      .minimize{border:0;background:none;font-size:20px;color:#72766a;padding:0 6px}.body{padding:0 17px 17px}.label{font-size:10px;letter-spacing:1.5px;color:#777b6e;text-transform:uppercase;display:block;margin-bottom:7px}select{width:100%;background:#fff;border:1px solid #dedfd5;padding:10px;border-radius:9px;color:#2a2d25;margin-bottom:14px}
      .switch{display:flex;width:100%;padding:4px;border-radius:10px;background:#edece5;gap:4px}.switch button{border:0;background:none;color:#77796f;flex:1;padding:8px;border-radius:7px;font-size:12px}.switch button.active{background:#fff;color:#292c25;box-shadow:0 1px 4px #2221}
      .status{margin:13px 0 0;color:#6c7162;font-size:11px;display:flex;align-items:flex-start;gap:7px}.dot{background:#7a8865;width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:5px}.hint{font-size:11px;color:#8a8c81;margin:8px 0 0}.collapsed .body{display:none}.collapsed{width:154px}.collapsed header{padding:11px 14px}.error{color:#ad4631}.error .dot{background:#ad4631}
    </style>
    <section class="panel" aria-label="Cloak personalization controls"><header><div class="brand"><i class="mark"></i>cloak<span style="font-size:9px;letter-spacing:.5px;color:#858979;font-weight:400;margin-left:3px">LOCAL</span></div><button class="minimize" aria-label="Minimize Cloak" aria-expanded="true">−</button></header><div class="body"><label class="label" for="profile">Tailored for</label><select id="profile" aria-label="Personal profile"></select><div class="switch" role="group" aria-label="Website view"><button id="original">Original</button><button id="personalized">✦ For you</button></div><p class="status" role="status"><i class="dot"></i><span id="status">Connecting to Cloak…</span></p><p class="hint">Use + / − beside a story to teach Cloak.</p></div></section>`;
  document.documentElement.appendChild(host);
  const $ = (s: string) => shadow.querySelector(s) as HTMLElement;
  let latestState: any;
  async function action(payload: any) {
    try { await win.cloakAction(payload); }
    catch (error) { $('#status').textContent = error instanceof Error ? error.message : 'Connection lost'; }
  }
  $('.minimize').onclick = () => {
    const collapsed = $('.panel').classList.toggle('collapsed');
    $('.minimize').textContent = collapsed ? '+' : '−';
    $('.minimize').setAttribute('aria-expanded', String(!collapsed));
    $('.minimize').setAttribute('aria-label', collapsed ? 'Expand Cloak' : 'Minimize Cloak');
  };
  ($('#profile') as HTMLSelectElement).onchange = (e) => action({ type: 'profile', id: (e.target as HTMLSelectElement).value });
  $('#original').onclick = () => action({ type: 'toggle', enabled: false });
  $('#personalized').onclick = () => action({ type: 'toggle', enabled: true });

  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr.athing[id]'));
  const parent = rows[0]?.parentNode;
  const originalChildren = parent ? Array.from(parent.childNodes) : [];
  const groups = rows.map((row, originalIndex) => {
    const nodes: Node[] = [row];
    let sibling = row.nextSibling;
    while (sibling && !(sibling instanceof HTMLElement && (sibling.matches('tr.athing') || sibling.querySelector('.morelink')))) {
      if (sibling instanceof HTMLElement && sibling.tagName === 'TR' && sibling.querySelector('input,form')) break;
      nodes.push(sibling);
      // HN story group = title, metadata, optional spacer. Never move footer rows.
      if (sibling instanceof HTMLElement && sibling.classList.contains('spacer')) break;
      sibling = sibling.nextSibling;
    }
    const link = row.querySelector<HTMLAnchorElement>('.titleline > a');
    return { row, nodes, rank: row.querySelector('.rank'), rankText: row.querySelector('.rank')?.textContent, story: { id: row.id, title: link?.textContent || '', url: link?.href || '', description: row.querySelector('.sitestr')?.textContent || '', originalIndex } };
  });
  const sectionNodes = rows.length ? [] : Array.from(document.querySelectorAll<HTMLElement>('.mw-parser-output .mw-heading2, .mw-parser-output > h2')).filter(h => !/References|External links|See also|Notes|Further reading/i.test(h.textContent || '')).slice(0, 40);
  const originalStyles = new Map(sectionNodes.map(h => [h, h.getAttribute('style')]));
  const sections = sectionNodes.map((h, i) => ({ id: h.id || h.querySelector('[id]')?.id || `section-${i}`, title: h.textContent?.replace(/\[edit\]/g, '').trim() || '', description: h.nextElementSibling?.textContent?.slice(0, 500) || '', url: location.href.split('#')[0] + '#' + (h.id || h.querySelector('[id]')?.id || ''), originalIndex: i }));
  let badges: HTMLElement[] = [];
  function restore() {
    badges.forEach(n => n.remove()); badges = [];
    if (parent && groups.length) {
      const fragment = document.createDocumentFragment();
      originalChildren.forEach(n => fragment.appendChild(n));
      parent.appendChild(fragment);
      groups.forEach(g => { if (g.rank) g.rank.textContent = g.rankText ?? ''; });
    }
    originalStyles.forEach((style, h) => { if (style === null) h.removeAttribute('style'); else h.setAttribute('style', style); });
  }
  const feedbackStyle = document.createElement('style');
  feedbackStyle.textContent = '.cloak-feedback{font:10px Verdana,sans-serif;color:#828282;margin-left:7px;white-space:nowrap}.cloak-feedback button{font:11px Verdana,sans-serif;border:1px solid #d9d6ca;background:transparent;color:#828282;border-radius:3px;margin-left:4px;padding:0 4px;cursor:pointer}.cloak-feedback button:hover,.cloak-feedback button:focus-visible{background:#fff;color:#d45b3b;border-color:#d45b3b}.cloak-feedback button[aria-pressed=true]{background:#f5ddcc;color:#a34429;border-color:#c98565}';
  document.head.appendChild(feedbackStyle);
  win.__cloak = {
    extract: () => groups.length ? groups.map(g => g.story) : sections,
    restore,
    update: (state: any) => {
      latestState = state;
      const select = $('#profile') as HTMLSelectElement;
      if (JSON.stringify(Array.from(select.options).map(o => [o.value, o.text])) !== JSON.stringify(state.profiles.map((p: any) => [p.id, p.name]))) {
        select.replaceChildren(...state.profiles.map((p: any) => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; return option; }));
      }
      select.value = state.activeProfileId;
      $('#original').classList.toggle('active', !state.enabled);
      $('#personalized').classList.toggle('active', state.enabled);
      $('#original').setAttribute('aria-pressed', String(!state.enabled));
      $('#personalized').setAttribute('aria-pressed', String(state.enabled));
      $('#status').textContent = state.error || (state.busy ? 'Reading and ranking this page…' : state.model.phase !== 'ready' ? state.model.message : state.enabled ? `${state.ranked.length} items tailored to you · runs locally` : 'Original website restored');
      $('.status').classList.toggle('error', !!state.error || state.model.phase === 'error');
      if (state.busy) return;
      restore();
      if (!state.enabled || state.model.phase !== 'ready') return;
      const ranked = state.ranked as any[];
      if (parent && groups.length && ranked.length) {
        const anchor = document.createComment('cloak-anchor');
        parent.insertBefore(anchor, groups[0].row);
        const fragment = document.createDocumentFragment();
        ranked.forEach((story, i) => {
          const group = groups.find(g => g.story.id === story.id);
          if (!group) return;
          group.nodes.forEach(n => fragment.appendChild(n));
          if (group.rank) group.rank.textContent = `${i + 1}.`;
          const meta = group.nodes.find(n => n instanceof HTMLElement && n.querySelector('.subtext')) as HTMLElement | undefined;
          if (meta) {
            const badge = document.createElement('span'); badge.className = 'cloak-feedback';
            const label = document.createElement('span'); label.textContent = i < 5 ? '· for you' : '·'; label.title = story.reason;
            badge.appendChild(label);
            ([1, -1] as const).forEach(value => {
              const button = document.createElement('button'); button.textContent = value === 1 ? '+' : '−';
              button.setAttribute('aria-label', `${value === 1 ? 'More' : 'Less'} like: ${story.title}`);
              button.title = value === 1 ? 'More like this' : 'Less like this';
              const feedback = state.profiles.find((p: any) => p.id === state.activeProfileId)?.feedback.find((f: any) => f.id === story.id);
              button.setAttribute('aria-pressed', String(feedback?.value === value));
              button.onclick = () => action({ type: 'feedback', id: story.id, value });
              badge.appendChild(button);
            });
            meta.querySelector('.subtext')?.appendChild(badge); badges.push(badge);
          }
        });
        parent.insertBefore(fragment, anchor); anchor.remove();
      } else if (sections.length) {
        ranked.slice(0, Math.max(1, Math.ceil(sections.length / 3))).forEach(story => {
          const h = sectionNodes[story.originalIndex];
          if (h) { h.style.backgroundColor = '#fbf0dd'; h.style.boxShadow = 'inset 3px 0 #c5773f'; }
        });
      }
    }
  };
  // Explicit article opens become weak positive feedback; no navigation is automated.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.titleline > a') : null;
    const row = target?.closest('tr.athing[id]');
    if (row && latestState?.enabled) void action({ type: 'open', id: row.id });
  }, { capture: true });
}
