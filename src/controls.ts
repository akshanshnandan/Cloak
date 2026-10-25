// Shared compact control surface. The adapter owns every transformation of the website.
export function installCloakControls() {
  const win = window as any;
  if (win.__cloak) return;
  const adapter = win.__cloakAdapter;
  const host = document.createElement('div'); host.id = 'cloak-controls';
  host.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 24px);';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}button,input,textarea,select{font:inherit}button{border:0;cursor:pointer;color:inherit}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #727278;outline-offset:3px}
    .bar{display:flex;align-items:center;gap:14px;padding:8px 10px 8px 17px;border:1px solid #00000014;border-radius:17px;background:#fffffff2;backdrop-filter:blur(24px);box-shadow:0 5px 25px #00000012,0 1px 3px #0001;color:#1d1d1f;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap}.brand{font-size:18px;font-weight:650;letter-spacing:-.8px}.switch{display:flex;background:#ececef;padding:3px;border-radius:10px;gap:2px}.switch button{font-size:11px;padding:6px 11px;border-radius:7px;background:none;color:#5e5e65;min-height:30px}.switch button[aria-pressed=true]{background:white;color:#1d1d1f;box-shadow:0 1px 4px #00000014}.settings-button{display:flex;align-items:center;gap:8px;padding:7px 9px;background:none;font-size:11px;max-width:165px}.settings-button span{overflow:hidden;text-overflow:ellipsis}.settings-button svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.6;flex-shrink:0}.popover{position:absolute;bottom:calc(100% + 12px);right:0;width:340px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 105px);overflow:auto;background:#fff;border:1px solid #00000014;border-radius:18px;padding:21px;box-shadow:0 12px 55px #0002;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f}.heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:19px}.heading h2{font-size:18px;font-weight:600;letter-spacing:-.5px;margin:0}.close{display:grid;place-items:center;background:#f0f0f3;border-radius:50%;width:25px;height:25px;font-size:17px;color:#6e6e73}.popover label{display:block;font-size:11px;color:#55555b;margin:13px 0 6px}.popover input,.popover textarea,.popover select{width:100%;background:#fafafa;border:1px solid #d9d9df;border-radius:9px;padding:10px 11px;font-size:12px;color:#333;line-height:1.6}.popover select{padding:8px 10px}.popover textarea{resize:vertical;min-height:105px}.budget-row{display:flex;align-items:center;gap:10px}.budget-row input{max-width:140px}.budget-row span{font-size:11px;color:#6e6e73}.submit{margin-top:19px;width:100%;border-radius:10px;min-height:39px;background:#1d1d1f;color:#fff;font-size:12px;font-weight:500}.submit:disabled{opacity:.5;cursor:wait}.status{margin:11px 0 0;font-size:11px;line-height:1.6;color:#6e6e73}.status:empty{display:none}.feedback{margin-top:21px;border-top:1px solid #ececef;padding-top:14px}.feedback h3{font-size:11px;font-weight:500;color:#6e6e73;margin:0 0 9px}.feedback-row{display:flex;gap:7px;align-items:center;margin:7px 0}.feedback-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.feedback-row button{width:28px;height:28px;border-radius:7px;background:#f0f0f3;font-size:15px;color:#5b5b63}.feedback-row button[aria-pressed=true]{background:#222;color:white}.spinner{display:inline-block;width:9px;height:9px;border:1px solid #aaa;border-top-color:#222;border-radius:50%;animation:spin .8s linear infinite;margin-right:5px}.live-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    @keyframes spin{to{transform:rotate(360deg)}}@media(max-width:600px){.bar{gap:8px;padding-left:13px}.settings-button span{display:none}.settings-button{padding:8px}.popover{left:50%;right:auto;transform:translateX(-50%);width:316px}.switch button{padding:6px 9px}.brand{font-size:17px}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  </style>
  <section class="popover" id="preferences" aria-label="Cloak preferences" hidden><form id="form"><div class="heading"><h2>Your needs.</h2><button type="button" class="close" id="close" aria-label="Close preferences">×</button></div><label for="profile">Profile</label><select id="profile" aria-label="Personal profile"></select><label for="needs">What are you looking for?</label><textarea id="needs" maxlength="2000" required placeholder="A portable Mac for coding and university. Keep it under $1,400."></textarea><label for="budget">Maximum per product</label><div class="budget-row"><input id="budget" type="number" min="1" max="1000000" step="1" placeholder="No limit"><span>USD</span></div><p class="status" id="error" role="alert"></p><button class="submit" id="save" type="submit">Apply</button></form><div class="feedback" id="feedback" hidden><h3>Fine-tune</h3><div id="recommendations"></div></div></section>
  <section class="bar" aria-label="Cloak personalization controls"><span class="brand">cloak</span><div class="switch" role="group" aria-label="Website version"><button id="original" aria-pressed="true">Original</button><button id="personalized" aria-pressed="false">Cloaked</button></div><button class="settings-button" id="settings" aria-label="Edit preferences" aria-expanded="false"><span id="profile-name">Preferences</span><svg viewBox="0 0 16 16"><path d="M2 5h3m4 0h5M2 11h7m4 0h1"/><circle cx="7" cy="5" r="2"/><circle cx="11" cy="11" r="2"/></svg></button></section><span class="live-status" id="status" role="status" aria-live="polite"></span>`;
  document.documentElement.appendChild(host);
  const $ = (selector: string) => root.querySelector(selector) as HTMLElement;
  let latest: any, editingProfile = '', dirty = false, applying = '';
  async function action(payload: any) { try { await win.cloakAction(payload); return true; } catch (error) { $('#error').textContent = (error as Error).message; $('#status').textContent = (error as Error).message; return false; } }
  function close() { $('#preferences').hidden = true; $('#settings').setAttribute('aria-expanded', 'false'); }
  function fill() { const profile = latest?.profiles.find((p: any) => p.id === latest.activeProfileId); if (!profile) return; ($('#needs') as HTMLTextAreaElement).value = profile.description; ($('#budget') as HTMLInputElement).value = profile.budget || ''; editingProfile = profile.id; dirty = false; }
  $('#settings').onclick = () => { const open = $('#preferences').hidden; $('#preferences').hidden = !open; $('#settings').setAttribute('aria-expanded', String(open)); if (open) { fill(); $('#needs').focus(); } };
  $('#close').onclick = close;
  $('#original').onclick = () => action({ type: 'toggle', enabled: false });
  $('#personalized').onclick = () => action({ type: 'toggle', enabled: true });
  ($('#profile') as HTMLSelectElement).onchange = event => action({ type: 'profile', id: (event.target as HTMLSelectElement).value });
  $('#needs').oninput = $('#budget').oninput = () => { dirty = true; };
  ($('#form') as HTMLFormElement).onsubmit = async event => {
    event.preventDefault(); const profile = latest?.profiles.find((p: any) => p.id === latest.activeProfileId); if (!profile) return;
    const button = $('#save') as HTMLButtonElement; button.disabled = true;
    const amount = ($('#budget') as HTMLInputElement).value;
    const ok = await action({ type: 'save-profile', name: profile.name, description: ($('#needs') as HTMLTextAreaElement).value, interests: [], avoid: '', budget: amount ? Number(amount) : null });
    button.disabled = false; if (ok) { dirty = false; close(); await action({ type: 'toggle', enabled: true }); }
  };
  root.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') { close(); $('#settings').focus(); } });
  win.__cloak = {
    extract: adapter.extract, inventory: adapter.inventory, restore: adapter.restore, find: adapter.find, diagnostics: adapter.diagnostics,
    update: (state: any) => {
      latest = state;
      const profile = state.profiles.find((p: any) => p.id === state.activeProfileId);
      if (!profile) return;
      const select = $('#profile') as HTMLSelectElement;
      if (JSON.stringify(Array.from(select.options).map(o => [o.value, o.text])) !== JSON.stringify(state.profiles.map((p: any) => [p.id, p.name]))) select.replaceChildren(...state.profiles.map((p: any) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; return o; }));
      select.value = profile.id; $('#profile-name').textContent = profile.name;
      if (editingProfile !== profile.id || (!dirty && !$('#preferences').hidden)) fill();
      $('#original').setAttribute('aria-pressed', String(!state.enabled)); $('#personalized').setAttribute('aria-pressed', String(state.enabled));
      $('#personalized').innerHTML = state.enabled && state.busy ? '<i class="spinner" aria-hidden="true"></i>Adapting' : 'Cloaked';
      $('#error').textContent = state.error || '';
      if (!state.error && state.enabled && state.planner?.phase === 'loading') $('#error').textContent = `Preparing local AI${state.planner.progress ? ` · ${state.planner.progress}%` : ''}`;
      $('#status').textContent = state.error || (state.busy && state.enabled ? 'Adapting the page' : state.enabled ? 'Personalized website' : 'Original website');
      const matches = $('#recommendations');
      const feedbackKey = JSON.stringify([state.ranked.slice(0, 3), profile.feedback]);
      if (matches.dataset.key !== feedbackKey) {
        matches.dataset.key = feedbackKey; matches.replaceChildren();
        state.ranked.slice(0, 3).forEach((item: any) => {
          const row = document.createElement('div'); row.className = 'feedback-row'; const name = document.createElement('span'); name.className = 'feedback-name'; name.textContent = item.title; row.append(name);
          ([1, -1] as const).forEach(value => { const button = document.createElement('button'); button.textContent = value === 1 ? '+' : '−'; button.setAttribute('aria-label', `${value === 1 ? 'More' : 'Less'} like: ${item.title}`); button.setAttribute('aria-pressed', String(profile.feedback.find((f: any) => f.id === item.id)?.value === value)); button.onclick = () => action({ type: 'feedback', id: item.id, value }); row.append(button); });
          matches.append(row);
        });
      }
      $('#feedback').hidden = !state.ranked.length;
      try {
        if (!state.enabled) { if (applying) adapter.restore(); applying = ''; return; }
        if (state.plan?.profileId === state.activeProfileId) { adapter.apply(state.plan); applying = state.plan.id; }
        else if (applying) { adapter.restore(); applying = ''; }
      } catch (error) { adapter.restore(); applying = ''; $('#error').textContent = (error as Error).message; $('#status').textContent = (error as Error).message; }
    }
  };
}
