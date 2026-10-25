// Tested Apple Store adapter. No product nodes are moved or cloned.
export function installAppleCloak() {
  const win = window as any;
  if (win.__cloak) return;
  const clean = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
  const elements = Array.from(document.querySelectorAll<HTMLElement>('.rf-ccard')).filter(card => card.querySelector('.rf-ccard-content-headerlink'));
  const seen = new Set<string>();
  const cards = elements.map((node, index) => {
    const a = node.querySelector<HTMLAnchorElement>('.rf-ccard-content-headerlink')!;
    const title = clean(a.textContent);
    let hash = 2166136261;
    for (const char of `${a.href}|${title}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return { node, style: node.getAttribute('style'), story: { id: `apple-${(hash >>> 0).toString(16)}`, title, url: a.href, description: [clean(node.querySelector('.rf-ccard-content-desccontent')?.textContent), clean(node.querySelector('img')?.alt)].filter(Boolean).join(' ').slice(0, 700) || title, originalIndex: index } };
  }).filter(card => {
    const key = `${card.story.title}|${card.story.url}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 70);
  const scrollers = Array.from(document.querySelectorAll<HTMLElement>('.rf-cards-scroller-content')).map(node => ({ node, left: node.scrollLeft }));
  const originalScroll = { x: window.scrollX, y: window.scrollY };
  const host = document.createElement('div'); host.id = 'cloak-controls';
  host.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:2147483647;max-width:calc(100vw - 32px);';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;color-scheme:light}*{box-sizing:border-box}button,select{font:inherit;cursor:pointer}button:focus-visible,select:focus-visible{outline:3px solid #888;outline-offset:3px}button{color:inherit}
    .panel{width:302px;max-width:calc(100vw - 32px);border:1px solid #00000012;border-radius:21px;background:#ffffffef;backdrop-filter:blur(24px);box-shadow:0 8px 45px #00000018,0 1px 3px #0001;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:16px 19px}.brand{font-size:22px;letter-spacing:-1px;font-weight:650;display:flex;align-items:center;gap:7px}.mark{width:17px;height:20px;border:5px solid #1d1d1f;border-right:0;border-radius:14px 0 0 14px;transform:rotate(-14deg)}.local{font-size:8px;letter-spacing:1px;font-weight:500;color:#89898e;margin-left:3px}.minimize{border:0;border-radius:50%;width:23px;height:23px;background:#eeeef1;color:#737379;font-size:16px}.body{padding:0 19px 18px}.label{display:block;font-size:9px;letter-spacing:1.3px;color:#86868b;margin-bottom:7px}select{width:100%;padding:9px 10px;background:#f5f5f7;border:1px solid #e7e7ec;border-radius:9px;color:#444;font-size:11px;margin-bottom:13px}.switch{display:flex;background:#ececf0;border-radius:9px;padding:3px;gap:3px}.switch button{border:0;background:none;padding:7px;flex:1;font-size:11px;border-radius:7px;color:#737378}.switch button.active{background:white;box-shadow:0 1px 4px #0001;color:#1d1d1f}.status{font-size:10px;color:#77777d;margin:12px 0;line-height:1.6}.recommended{border-top:1px solid #e8e8ec;padding-top:11px;margin-top:10px}.recommendation{border:0;background:none;display:block;text-align:left;padding:7px 0;color:#333;width:100%;font-size:11px;font-weight:500}.recommendation:hover{text-decoration:underline}.recommendation span{display:block;font-size:9px;font-weight:400;color:#8a8a90;margin-top:2px}.feedback{display:flex;gap:7px;margin-top:7px}.feedback button{border:1px solid #e2e2e7;border-radius:7px;background:#f5f5f7;padding:5px 9px;font-size:10px}.feedback button[aria-pressed=true]{background:#222;color:white;border-color:#222}.hint{font-size:9px;color:#88888e;margin:11px 0 0}.collapsed{width:150px}.collapsed .body{display:none}.collapsed header{padding:11px 15px}.hidden{display:none}.error{color:#643d3d}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
    </style><section class="panel" aria-label="Cloak personalization controls"><header><div class="brand"><i class="mark"></i>cloak<span class="local">LOCAL</span></div><button class="minimize" aria-label="Minimize Cloak" aria-expanded="true">−</button></header><div class="body"><label class="label" for="profile">YOUR PERSPECTIVE</label><select id="profile" aria-label="Personal profile"></select><div class="switch" role="group" aria-label="Website view"><button id="original">Original</button><button id="personal">✦ For you</button></div><p class="status" id="status" role="status">Getting to know this page…</p><div class="recommended" id="recommended"><span class="label">IN FOCUS FOR YOU</span><div id="matches"></div></div><p class="hint">The real Apple Store. A little more you.</p></div></section>`;
  document.documentElement.appendChild(host);
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  let latest: any, badges: HTMLElement[] = [], selected = '', moved = false;
  async function action(payload: any) { try { await win.cloakAction(payload); } catch (error) { $('#status').textContent = (error as Error).message; } }
  $('.minimize').onclick = () => { const collapsed = $('.panel').classList.toggle('collapsed'); $('.minimize').textContent = collapsed ? '+' : '−'; $('.minimize').setAttribute('aria-expanded', String(!collapsed)); $('.minimize').setAttribute('aria-label', collapsed ? 'Expand Cloak' : 'Minimize Cloak'); };
  ($('#profile') as HTMLSelectElement).onchange = e => action({ type: 'profile', id: (e.target as HTMLSelectElement).value });
  $('#original').onclick = () => action({ type: 'toggle', enabled: false }); $('#personal').onclick = () => action({ type: 'toggle', enabled: true });
  function restore(restoreScroll = false) {
    badges.forEach(b => b.remove()); badges = [];
    cards.forEach(({ node, style }) => { if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style); });
    if (restoreScroll && moved) { scrollers.forEach(({node,left}) => node.scrollTo({left, behavior:'instant'})); window.scrollTo({left:originalScroll.x,top:originalScroll.y,behavior:'instant'}); moved = false; }
  }
  function find(id: string) {
    const card = cards.find(c => c.story.id === id); if (!card) return;
    moved = true; selected = id;
    card.node.scrollIntoView({ block: 'center', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  win.__cloak = {
    extract: () => cards.map(c => c.story), restore: () => restore(true), find,
    update: (state: any) => {
      latest = state;
      const select = $('#profile') as HTMLSelectElement;
      if (JSON.stringify(Array.from(select.options).map(o => [o.value,o.text])) !== JSON.stringify(state.profiles.map((p: any) => [p.id,p.name]))) {
        select.replaceChildren(...state.profiles.map((p: any) => { const o = document.createElement('option'); o.value=p.id; o.textContent=p.name; return o; }));
      }
      select.value=state.activeProfileId;
      $('#original').classList.toggle('active',!state.enabled); $('#personal').classList.toggle('active',state.enabled);
      $('#original').setAttribute('aria-pressed',String(!state.enabled)); $('#personal').setAttribute('aria-pressed',String(state.enabled));
      $('#status').textContent=state.error || (state.busy ? 'Finding what matters to you…' : state.model.phase !== 'ready' ? state.model.message : !cards.length ? 'Browse the Apple Store to personalize product cards.' : state.enabled ? `${cards.length} products considered. Your perspective, in focus.` : 'The original Apple Store, restored.');
      $('#status').classList.toggle('error',!!state.error || state.model.phase === 'error');
      $('#recommended').classList.toggle('hidden',!state.enabled || !state.ranked.length);
      if (!state.enabled) { restore(true); return; }
      if (state.busy) return;
      restore();
      if (state.model.phase !== 'ready') return;
      const matches = $('#matches'); matches.replaceChildren();
      state.ranked.slice(0,3).forEach((story: any) => {
        const button=document.createElement('button'); button.className='recommendation'; button.textContent=story.title;
        const subtitle=document.createElement('span'); subtitle.textContent='Find on page ↗'; button.append(subtitle); button.onclick=()=>find(story.id); matches.append(button);
      });
      const top = state.ranked.slice(0,Math.min(5,Math.ceil(cards.length/3)));
      top.forEach((story: any) => {
        const card=cards.find(c=>c.story.id===story.id); if (!card) return;
        card.node.style.outline='2px solid #86868b'; card.node.style.outlineOffset='-2px';
        card.node.style.position='relative';
        const badge=document.createElement('div');
        badge.dataset.cloakBadge=story.id;
        // Isolated controls don't inherit Apple card event delegation or typography.
        badge.style.cssText='position:absolute;right:14px;bottom:14px;z-index:3;';
        const shadow=badge.attachShadow({mode:'open'});
        shadow.innerHTML=`<style>:host{all:initial}*{box-sizing:border-box}.badge{display:flex;align-items:center;gap:5px;background:#fffffff2;backdrop-filter:blur(12px);color:#1d1d1f;box-shadow:0 1px 8px #0001;border:1px solid #0001;padding:5px 7px 5px 10px;border-radius:20px;font:10px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.badge span{padding-right:3px}button{cursor:pointer;border:0;border-radius:50%;width:24px;height:24px;font:14px/1 sans-serif;background:#eeeeef;color:#555}button[aria-pressed=true]{background:#222;color:white}button:focus-visible{outline:2px solid #777;outline-offset:2px}</style><div class="badge"><span>✦ For you</span><button aria-label="More like this">+</button><button aria-label="Less like this">−</button></div>`;
        shadow.querySelector('.badge')!.setAttribute('title',story.reason);
        const feedback=state.profiles.find((p:any)=>p.id===state.activeProfileId)?.feedback.find((f:any)=>f.id===story.id && f.title===story.title);
        Array.from(shadow.querySelectorAll('button')).forEach((button,i)=>{
          const value=i===0?1:-1; button.setAttribute('aria-pressed',String(feedback?.value===value));
          button.onclick=event=>{event.preventDefault();event.stopPropagation();void action({type:'feedback',id:story.id,value});};
        });
        // Prevent Apple's whole-card click handler from treating feedback as a purchase link.
        badge.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
        card.node.appendChild(badge); badges.push(badge);
      });
    }
  };
  document.addEventListener('click',event=>{
    if (!latest?.enabled) return;
    if (event.composedPath().some(n=>n instanceof HTMLElement && (n.dataset.cloakBadge || n.id==='cloak-controls'))) return;
    const target=event.target instanceof Element ? event.target.closest('.rf-ccard') : null;
    const card=cards.find(c=>c.node===target); if(card) void action({type:'open',id:card.story.id});
  },{capture:true});
}
