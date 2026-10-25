const $ = selector => document.querySelector(selector);
let state, toastTimer, currentResults = '', creating = false, online = true;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4200); }
async function request(url, payload) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  render(result); return result;
}
async function action(payload) { return request('/api/action', payload); }
async function safely(task) { try { return await task(); } catch (error) { notify(error.message); } }
function setView(enabled) { return safely(() => action({ type: 'toggle', enabled })); }
function activeProfile() { return state?.profiles.find(p => p.id === state.activeProfileId); }
function render(next) {
  state = next;
  const profile = activeProfile();
  if (!profile) return;
  $('#model-label').textContent = !online ? 'Reconnecting…' : state.model.phase === 'ready' ? 'Local AI is ready' : state.model.phase === 'error' ? 'Model needs attention' : `Loading local AI${state.model.progress ? ` · ${state.model.progress}%` : ''}`;
  $('#model-pill').className = 'model-pill ' + (online ? state.model.phase === 'ready' ? 'ready' : 'loading' : 'offline');
  $('#power-toggle').setAttribute('aria-checked', String(state.enabled));
  $('#view-personal').classList.toggle('active', state.enabled); $('#view-original').classList.toggle('active', !state.enabled);
  $('#view-personal').setAttribute('aria-pressed', String(state.enabled)); $('#view-original').setAttribute('aria-pressed', String(!state.enabled));
  const select = $('#profile-select');
  if (JSON.stringify([...select.options].map(o => [o.value, o.text])) !== JSON.stringify(state.profiles.map(p => [p.id, p.name]))) {
    select.replaceChildren(...state.profiles.map(p => { const o = el('option', '', p.name); o.value = p.id; return o; }));
  }
  select.value = profile.id;
  $('#profile-title').textContent = profile.name;
  $('#profile-description').textContent = profile.description;
  $('#interest-chips').replaceChildren(...profile.interests.map(interest => el('span', 'chip', interest)));
  $('#profile-avatar').innerHTML = icon(profile.id === 'lifestyle' ? 'heart' : profile.id === 'creative' ? 'spark' : 'code');
  $('#feedback-count').textContent = profile.feedback.length;
  $('#focus-browser').hidden = !state.browser.connected;
  $('#connection-label').hidden = state.browser.connected;
  $('#connection-label').textContent = 'Ready when you are';
  $('#result-count').textContent = state.browser.connected ? `${state.browser.count} items · ${state.enabled ? 'Personalized perspective' : 'Original perspective'}` : 'Your experience starts here';
  $('#results-eyebrow').textContent = state.browser.connected ? 'YOUR LIVE PERSPECTIVE' : 'A NEW POINT OF VIEW';
  const message = state.error || (state.model.phase === 'error' ? state.model.message : '');
  $('#error-banner').hidden = !message; $('#error-message').textContent = message; $('#retry-model').hidden = state.model.phase !== 'error';
  const signature = JSON.stringify([state.ranked, state.enabled, state.busy, state.browser, profile.feedback, state.model.phase]);
  if (signature !== currentResults) { currentResults = signature; renderResults(profile); }
  if ($('#learning-dialog').open) renderHistory();
}
function renderResults(profile) {
  const body = $('#results-body');
  if (!state.browser.connected) {
    if (!body.querySelector('.empty-state')) {
      body.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('spark')}</div><h3>There’s a whole internet out there.</h3><p>Open Apple to see what your perspective brings into focus.<br>Real products. Your priorities. The original website.</p><button class="button button-black launch-button">Let’s explore ${icon('arrow')}</button></div>`;
      body.querySelector('button').onclick = launch;
    }
    return;
  }
  body.replaceChildren();
  if (state.busy || state.model.phase === 'loading') {
    const status = el('div', 'busy-bar'); status.setAttribute('role', 'status');
    status.innerHTML = '<span class="spinner"></span>';
    status.append(document.createTextNode(state.model.phase !== 'ready' ? 'Loading local AI. The original page is ready to browse.' : 'Bringing your perspective into focus…'));
    body.append(status);
  }
  if (!state.ranked.length) {
    const empty = el('div', 'empty-state'); empty.append(el('h3', '', state.busy ? 'A moment for your perspective.' : 'Nothing to personalize on this page.'));
    empty.append(el('p', '', state.busy ? 'Cloak is reading the store and matching it to your interests.' : 'Go back to the Apple Store to explore its product cards.'));
    body.append(empty); return;
  }
  const stories = [...state.ranked];
  if (!state.enabled) stories.sort((a, b) => a.originalIndex - b.originalIndex);
  stories.slice(0, 6).forEach((story, index) => {
    const row = el('article', 'story'); row.append(el('span', 'story-number', String(index + 1).padStart(2, '0')));
    const content = el('div', 'story-content');
    content.append(el('h3', '', story.title));
    content.append(el('p', 'story-description', story.description));
    const meta = el('div', 'story-meta'); meta.append(el('span', 'story-reason', state.enabled ? story.reason : 'As it appears on the original website')); content.append(meta);
    const actions = el('div', 'story-actions');
    for (const [value, name, symbol] of [[1, 'More like this', 'plus'], [-1, 'Less like this', 'minus']]) {
      const button = el('button'); button.innerHTML = icon(symbol); button.append(document.createTextNode(value === 1 ? 'More' : 'Less'));
      button.setAttribute('aria-label', `${name}: ${story.title}`);
      const feedback = profile.feedback.find(f => f.id === story.id);
      button.setAttribute('aria-pressed', String(feedback?.value === value && feedback.strength !== 0.25));
      button.onclick = () => safely(async () => { button.disabled = true; try { await action({ type: 'feedback', id: story.id, value }); notify(value === 1 ? 'Noted. More of what matters to you.' : 'Noted. We’ll bring other things into focus.'); } finally { button.disabled = false; } });
      actions.append(button);
    }
    const find = el('button', 'find'); find.innerHTML = 'Find on page ' + icon('external'); find.setAttribute('aria-label', `Find ${story.title} on the real website`);
    find.onclick = () => safely(() => action({ type: 'find', id: story.id })); actions.append(find);
    content.append(actions); row.append(content); body.append(row);
  });
}
let opening = false;
async function launch() {
  if (opening) return;
  opening = true;
  document.querySelectorAll('.launch-button').forEach(b => b.disabled = true);
  $('#launch > span').textContent = 'Opening your perspective…';
  $('#launch-note').textContent = 'Connecting to the real Apple Store. This may take a moment.';
  try { await request('/api/browser', { target: 'apple' }); notify('Your Apple Store is ready. Look for the Cloak control in the browser.'); }
  catch (error) { notify(error.message); }
  finally {
    opening = false; document.querySelectorAll('.launch-button').forEach(b => b.disabled = false);
    $('#launch > span').textContent = 'Explore Apple with Cloak'; $('#launch-note').textContent = 'Opens the real Apple Store in a new browser window.';
  }
}
function editProfile() {
  const p = activeProfile(); if (!p) return;
  $('#edit-name').value = p.name; $('#edit-description').value = p.description; $('#edit-avoid').value = p.avoid; $('#edit-interests').value = p.interests.join(', '); $('#form-error').textContent = '';
  $('#profile-dialog').showModal();
}
function renderHistory() {
  const entries = [...activeProfile().feedback].reverse();
  const list = $('#learning-list'); list.replaceChildren();
  if (!entries.length) list.append(el('p', 'dialog-copy', 'A fresh start. Use More or Less on a recommendation to begin learning.'));
  entries.forEach(f => {
    const row = el('div', 'history-item'); row.append(el('span', '', f.value === 1 ? '+' : '−'));
    const text = el('div'); text.append(el('strong', '', f.title)); text.append(el('p', '', `${f.strength === 0.25 ? 'Opened · gentle positive signal' : f.value === 1 ? 'More like this' : 'Less like this'} · ${new Date(f.at).toLocaleDateString()}`)); row.append(text); list.append(row);
  });
  $('#clear-feedback').disabled = !entries.length;
}
document.querySelectorAll('.launch-button').forEach(b => b.onclick = launch);
document.querySelectorAll('[data-edit]').forEach(b => b.onclick = editProfile);
document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', event => { const bounds = d.getBoundingClientRect(); if (event.target === d && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) d.close(); }));
$('#profile-select').onchange = e => safely(() => action({ type: 'profile', id: e.target.value }));
$('#power-toggle').onclick = () => setView(!state.enabled);
$('#view-personal').onclick = () => setView(true); $('#view-original').onclick = () => setView(false);
$('#how-button').onclick = () => $('#how-dialog').showModal();
$('#focus-browser').onclick = () => safely(() => request('/api/browser', { target: 'focus' }));
$('#retry-model').onclick = () => safely(() => action({ type: 'retry-model' }));
$('#dismiss-error').onclick = () => $('#error-banner').hidden = true;
$('#manage-feedback').onclick = () => { if (!state) return; renderHistory(); $('#learning-dialog').showModal(); };
$('#clear-feedback').onclick = () => safely(async () => { await action({ type: 'clear-feedback' }); notify('This profile has a fresh start.'); });
$('#new-profile').onclick = () => safely(async () => { if (creating) return; creating = true; try { await action({ type: 'create-profile' }); editProfile(); } finally { creating = false; } });
$('#profile-form').onsubmit = async event => {
  event.preventDefault(); const submit = event.target.querySelector('[type=submit]'); submit.disabled = true;
  try {
    const interests = $('#edit-interests').value.split(',').map(s => s.trim()).filter(Boolean);
    await action({ type: 'save-profile', name: $('#edit-name').value, description: $('#edit-description').value, interests, avoid: $('#edit-avoid').value });
    $('#profile-dialog').close(); notify('Your perspective is saved.');
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { submit.disabled = false; }
};
const events = new EventSource('/api/events');
events.onmessage = event => { online = true; render(JSON.parse(event.data)); };
events.onerror = () => { online = false; if (state) render(state); };
// State fetch makes the initial view available even before the event stream connects.
fetch('/api/state').then(r => r.json()).then(render).catch(() => notify('Cloak is reconnecting. Keep this window open.'));
