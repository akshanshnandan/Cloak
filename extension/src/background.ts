const activeTabKey = 'cloak-active-tab-ids';
const planCache = new Map<string, any>();
const requests = new Map<number, { controller: AbortController; version: number }>();
const versions = new Map<number, number>();
const companion = 'http://127.0.0.1:4319';
const loopbackAddress = { targetAddressSpace: 'loopback' } as any;
const hostPattern = (url: URL) => `${url.protocol}//${url.hostname}/*`;
const scriptIdFor = (pattern: string) => `cloak-auto-${pattern.replace(/[^a-z0-9]/gi, '-').slice(0, 80)}`;
chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(['preference', 'autoSites']);
  if (typeof saved.preference !== 'string') await chrome.storage.local.set({ preference: '' });
  if (!Array.isArray(saved.autoSites)) await chrome.storage.local.set({ autoSites: [] });
  const state = await chrome.storage.local.get('cloakEnabled');
  if (typeof state.cloakEnabled !== 'boolean') await chrome.storage.local.set({ cloakEnabled: true });
});
async function setTabActive(tabId: number, active: boolean) {
  const saved = await chrome.storage.session.get(activeTabKey);
  const ids: number[] = Array.isArray(saved[activeTabKey]) ? saved[activeTabKey] : [];
  const next = new Set(ids.filter((id: unknown) => Number.isInteger(id)));
  if (active) next.add(tabId); else next.delete(tabId);
  await chrome.storage.session.set({ [activeTabKey]: [...next] });
}
async function isTabActive(tabId: number) {
  const saved = await chrome.storage.session.get(activeTabKey);
  return Array.isArray(saved[activeTabKey]) && saved[activeTabKey].includes(tabId);
}
function cancel(tabId: number) { requests.get(tabId)?.controller.abort(); requests.delete(tabId); versions.set(tabId, (versions.get(tabId) || 0) + 1); }
chrome.tabs.onRemoved.addListener((tabId: number) => { cancel(tabId); void setTabActive(tabId, false); });
chrome.tabs.onUpdated.addListener((tabId: number, change: any) => {
  if (change.status === 'loading' || change.url) {
    cancel(tabId);
    // The old document is going away, so its DOM cannot be restored after
    // navigation. Do not carry its active marker onto an unrelated document.
    if (change.status === 'loading' || change.url) void setTabActive(tabId, false);
  }
});
chrome.tabs.onActivated.addListener(({ tabId }: { tabId: number }) => { for (const pending of requests.keys()) if (pending !== tabId) cancel(pending); });
chrome.webNavigation.onHistoryStateUpdated.addListener((details: any) => {
  if (details.frameId !== 0) return;
  let origin = ''; try { origin = new URL(details.url).origin; } catch { return; }
  void chrome.storage.local.get('autoSites').then((saved: any) => {
    if (Array.isArray(saved.autoSites) && saved.autoSites.includes(origin)) void chrome.tabs.sendMessage(details.tabId, { type: 'cloak-auto-run' }).catch(() => {});
  });
});
async function ensureContent(tabId: number) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'status' }); }
  catch { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); }
}
async function aiStatus(token: string) {
  if (!token) return { mode: 'fallback', code: 'pairing-required', message: 'Pair or reconnect using the one-time code shown in the companion terminal.' };
  try {
    const response = await fetch(`${companion}/api/extension/health`, { headers: { Authorization: `Bearer ${token}`, 'X-Cloak-Extension-Origin': `chrome-extension://${chrome.runtime.id}` }, signal: AbortSignal.timeout(3000), ...loopbackAddress });
    if (response.status === 401) return { mode: 'fallback', code: 'authentication-expired', message: 'The saved AI connection expired. Reconnect with the current one-time code.' };
    if (response.status === 403) return { mode: 'fallback', code: 'pairing-required', message: 'The companion restarted. Reconnect using its current one-time code.' };
    if (!response.ok) return { mode: 'fallback', code: 'companion-unavailable', message: `The companion returned HTTP ${response.status}.` };
    const state = await response.json();
    if (state.planner?.phase === 'error' || state.semantic?.phase === 'error') return { mode: 'fallback', code: 'model-failure', message: 'A local model failed. See the companion terminal for details.', planner: state.planner, semantic: state.semantic };
    if (state.planner?.phase === 'loading' || state.semantic?.phase === 'loading') return { mode: 'loading', code: 'model-loading', message: 'Local models are loading. Keep the companion open.', planner: state.planner, semantic: state.semantic };
    return { mode: 'local-ai', code: state.planner?.phase === 'ready' && state.semantic?.phase === 'ready' ? 'models-ready' : 'connected', message: state.planner?.phase === 'ready' && state.semantic?.phase === 'ready' ? 'Qwen3 and MiniLM are ready locally.' : 'Connected. Models load on the first personalization request.', planner: state.planner, semantic: state.semantic };
  } catch (error) {
    const timeout = (error as Error)?.name === 'TimeoutError';
    return { mode: 'fallback', code: timeout ? 'request-timeout' : 'companion-unavailable', message: timeout ? 'The companion status request timed out.' : 'The local AI companion is offline.' };
  }
}
async function runPersonalize(tabId: number, url: string, preference: string, token: string, requireRealAi = false) {
  cancel(tabId);
  const version = versions.get(tabId) || 0;
  const controller = new AbortController(); requests.set(tabId, { controller, version });
  const stillCurrent = async () => {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    return !!current && current.url === url && versions.get(tabId) === version && requests.get(tabId)?.version === version;
  };
  try {
    await ensureContent(tabId);
    if (!await stillCurrent()) throw new Error('Page changed before personalization could start.');
    let mode = 'fallback', plan: any, inventory: any, aiFailure: any = token ? null : { code: 'pairing-required', message: 'Connect or reconnect the local AI companion.' };
    // Dynamic sites can replace a result list while local inference is running.
    // Rediscover and replan once against the new inventory; never apply a plan
    // to a snapshot that no longer describes the current page.
    for (let attempt = 0; attempt < 2; attempt++) {
      const snapshot = await chrome.tabs.sendMessage(tabId, { type: 'inventory' });
      inventory = snapshot?.inventory;
      if (!inventory?.items?.length) throw new Error('This page has no safe content to personalize.');
      plan = undefined;
      if (token) {
        try {
          const key = JSON.stringify([url.split('#')[0], preference, inventory]);
          plan = planCache.get(key);
          if (!plan) {
            const response = await fetch(`${companion}/api/extension/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Cloak-Extension-Origin': `chrome-extension://${chrome.runtime.id}` }, body: JSON.stringify({ preference, inventory }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]), ...loopbackAddress });
            if (!response.ok) {
              const failure = await response.json().catch(() => ({}));
              aiFailure = { code: failure.code || (response.status === 401 ? 'authentication-expired' : response.status === 403 ? 'pairing-required' : response.status === 429 ? 'companion-busy' : 'inference-failure'), message: failure.error || (response.status === 403 ? 'The companion restarted or no longer recognizes this connection. Pair again with its current code.' : response.status === 401 ? 'The saved companion token is invalid. Reconnect with a new pairing code.' : `Local AI request failed (${response.status}).`) };
              throw new Error(aiFailure.message);
            }
            plan = await response.json(); planCache.set(key, plan);
            if (planCache.size > 20) planCache.delete(planCache.keys().next().value!);
          }
          mode = 'local-ai';
        } catch (error) {
          if (controller.signal.aborted) { aiFailure = { code: 'cancelled-stale', message: 'Request cancelled because Cloak was switched off, preferences changed, or the page navigated.' }; throw new Error(aiFailure.message); }
          if ((error as Error)?.name === 'TimeoutError') aiFailure = { code: 'request-timeout', message: 'The local AI request timed out.' };
          else if (!aiFailure) aiFailure = { code: 'companion-unavailable', message: 'The local AI companion could not be reached.' };
          plan = undefined;
        }
      }
      if (!plan && requireRealAi) throw Object.assign(new Error(aiFailure?.message || 'A real local AI plan is required, but none was returned.'), { code: aiFailure?.code || 'inference-failure' });
      if (!await stillCurrent()) throw new Error('Page changed while AI was working. No plan was applied.');
      const currentSnapshot = await chrome.tabs.sendMessage(tabId, { type: 'inventory' });
      if (JSON.stringify(currentSnapshot?.inventory) === JSON.stringify(inventory)) break;
      if (attempt === 1) throw new Error('Page content kept changing while AI was working. No plan was applied; try again when the page is stable.');
    }
    if (plan) {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'apply-plan', plan: { ...plan, mode, inventoryUrl: inventory.url, source: plan.source || {} } });
      if (result?.status === 'no-change') return { ...result, mode, ai: { mode, code: 'no-change', message: 'AI returned a plan, but it would not visibly change this page.' }, message: 'No visible change was needed for this preference.' };
      if (result?.error) throw Object.assign(new Error(result.error), { code: 'invalid-model-response' });
      await setTabActive(tabId, true);
      return { ...result, mode, ai: { mode, code: 'models-ready', message: 'This page was planned by local Qwen3 and ranked with MiniLM.' }, message: mode === 'local-ai' ? 'Personalized with local Qwen3 + MiniLM.' : 'Personalized with deterministic fallback ranking.' };
    }
    const result = await chrome.tabs.sendMessage(tabId, { type: 'personalize', preference });
    if (result?.error) throw new Error(result.error);
    if (result?.status === 'no-change') return { ...result, mode: 'fallback', ai: { mode: 'fallback', ...aiFailure }, message: aiFailure ? `No visible change was needed. ${aiFailure.message}` : 'No visible change was needed for this preference.' };
    if (result?.status === 'personalized') await setTabActive(tabId, true);
    return { ...result, mode: 'fallback', ai: { mode: 'fallback', ...aiFailure }, message: `Personalized with deterministic fallback. ${aiFailure?.message || 'The real AI plan was unavailable.'}` };
  } finally { if (requests.get(tabId)?.version === version) requests.delete(tabId); }
}
chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response: any) => void) => {
  if (message?.type === 'cloak-preference-changed') {
    for (const tabId of requests.keys()) cancel(tabId);
    planCache.clear();
    sendResponse({ status: 'cancelled' });
    return false;
  }
  if (message?.type === 'cloak-store-token') {
    if (_sender.id !== chrome.runtime.id || typeof message.token !== 'string' || !/^[a-f0-9]{64}$/.test(message.token)) { sendResponse({ error: 'Invalid companion pairing response.' }); return false; }
    void chrome.storage.local.set({ companionToken: message.token, companionModels: message.models || {} }).then(() => sendResponse({ status: 'paired', message: 'Connected to local Cloak AI.' }), () => sendResponse({ error: 'Could not save the companion connection.' }));
    return true;
  }
  if (message?.type !== 'cloak-action') return;
  (async () => {
    if (message.action === 'ai-status') {
      const saved = await chrome.storage.local.get('companionToken');
      return { ai: await aiStatus(saved.companionToken || '') };
    }
    let tab: any;
    if (Number.isInteger(message.targetTabId)) {
      if (_sender.id !== chrome.runtime.id || !String(_sender.url || '').startsWith(`chrome-extension://${chrome.runtime.id}/`)) throw new Error('Only Cloak’s extension UI can select a target tab.');
      tab = await chrome.tabs.get(message.targetTabId);
    } else {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    if (!tab?.id) throw new Error('Select a browser tab first.');
    const tabId = tab.id;
    if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a regular HTTP or HTTPS page first.');
    const site = new URL(tab.url).hostname;
    if (message.action === 'status') {
      const saved = await chrome.storage.local.get(['companionToken', 'cloakEnabled']);
      let pageStatus: any;
      try { pageStatus = await chrome.tabs.sendMessage(tabId, { type: 'status' }); } catch { pageStatus = { active: await isTabActive(tabId), groups: 0 }; }
      return { ...pageStatus, site, cloakEnabled: saved.cloakEnabled !== false, ai: await aiStatus(saved.companionToken || '') };
    }
    if (message.action === 'off') {
      await chrome.storage.local.set({ cloakEnabled: false });
      const saved = await chrome.storage.session.get(activeTabKey);
      const tabIds = [...new Set([...(Array.isArray(saved[activeTabKey]) ? saved[activeTabKey] : []), tabId])];
      for (const id of requests.keys()) cancel(id);
      for (const id of tabIds) cancel(id);
      const restored = await Promise.allSettled(tabIds.map(id => chrome.tabs.sendMessage(id, { type: 'restore' })));
      const failed = tabIds.filter((_id, index) => restored[index].status !== 'fulfilled' || (restored[index] as PromiseFulfilledResult<any>).value?.status !== 'original');
      await chrome.storage.session.set({ [activeTabKey]: failed });
      if (failed.includes(tabId)) throw new Error('Cloak is off, but this page could not confirm restoration. Reload this tab to restore it.');
      if (failed.length) throw new Error(`Cloak is off. ${failed.length} other active tab${failed.length === 1 ? '' : 's'} need a reload to confirm restoration.`);
      return { status: 'original', groups: tabIds.length, cloakEnabled: false, site };
    }
    if (message.action === 'original') {
      cancel(tabId);
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'restore' });
        if (result?.status === 'original') await setTabActive(tabId, false);
        return { ...result, cloakEnabled: (await chrome.storage.local.get('cloakEnabled')).cloakEnabled !== false, site };
      } catch {
        if (!await isTabActive(tabId)) return { status: 'original', groups: 0, cloakEnabled: (await chrome.storage.local.get('cloakEnabled')).cloakEnabled !== false, site };
        throw new Error('Cloak could not reach this page to confirm restoration. Reload this tab to restore its original state.');
      }
    }
    if (message.action === 'personalize' || message.action === 'on') {
      await chrome.storage.local.set({ cloakEnabled: true });
      const saved = await chrome.storage.local.get(['preference', 'companionToken', 'requireRealAi']);
      const text = String(message.preference ?? saved.preference ?? '').slice(0, 500);
      if (!text.trim()) throw new Error('Describe what you want to find before personalizing.');
      await chrome.storage.local.set({ preference: text });
      const result = await runPersonalize(tabId, tab.url, text, saved.companionToken || '', saved.requireRealAi === true);
      return { ...result, cloakEnabled: true, site };
    }
    if (message.action === 'auto-status') {
      const saved = await chrome.storage.local.get(['autoSites', 'cloakEnabled']);
      const parsed = new URL(tab.url);
      return { enabled: Array.isArray(saved.autoSites) && saved.autoSites.includes(parsed.origin), cloakEnabled: saved.cloakEnabled !== false, origin: parsed.origin, site };
    }
    if (message.action === 'auto-set') {
      const parsed = new URL(tab.url), origin = parsed.origin;
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Auto-Personalize supports HTTP and HTTPS sites only.');
      const saved = await chrome.storage.local.get('autoSites'), current: string[] = Array.isArray(saved.autoSites) ? saved.autoSites : [];
      if (!message.enabled) cancel(tabId);
      if (message.enabled) {
        const pattern = hostPattern(parsed);
        const granted = await chrome.permissions.contains({ origins: [pattern] });
        if (!granted) throw new Error('Grant this site permission from the Auto-Personalize switch first.');
        if (!current.includes(origin)) current.push(origin);
        await chrome.storage.local.set({ autoSites: current });
        const scriptId = scriptIdFor(pattern);
        await chrome.scripting.unregisterContentScripts({ ids: [scriptId] }).catch(() => {});
        await chrome.scripting.registerContentScripts([{ id: scriptId, matches: [pattern], js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
      } else {
        const pattern = hostPattern(parsed);
        const next = current.filter(site => site !== origin);
        await chrome.storage.local.set({ autoSites: next });
        const stillEnabledOnHost = next.some(site => { try { return hostPattern(new URL(site)) === pattern; } catch { return false; } });
        if (!stillEnabledOnHost) await chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(pattern)] }).catch(() => {});
        cancel(tabId);
        let restored = false;
        try { restored = (await chrome.tabs.sendMessage(tabId, { type: 'restore' }))?.status === 'original'; } catch {}
        if (restored) await setTabActive(tabId, false);
        else if (await isTabActive(tabId)) throw new Error('Auto-Personalize is off, but this page could not confirm restoration. Reload the tab to restore it.');
        if (!stillEnabledOnHost) await chrome.permissions.remove({ origins: [pattern] });
      }
      return { status: 'auto-updated', enabled: !!message.enabled, site };
    }
    throw new Error('Unknown Cloak action.');
  })().then(sendResponse, error => {
    const message = (error as Error).message;
    const code = (error as any).code || (/no safe|looks like an account|supported size/i.test(message) ? 'unsupported-page' : /cancelled|page changed/i.test(message) ? 'cancelled-stale' : 'inference-failure');
    sendResponse({ error: message, ai: { mode: 'error', code, message } });
  });
  return true;
});
chrome.runtime.onMessage.addListener((message: any, sender: any) => {
  if (message?.type !== 'cloak-auto-ready' || !sender.tab?.id || !sender.url) return;
  void (async () => {
    const tabId = sender.tab.id, tabUrl = new URL(sender.url), saved = await chrome.storage.local.get(['autoSites', 'preference', 'companionToken', 'cloakEnabled', 'requireRealAi']);
    if (saved.cloakEnabled === false || !Array.isArray(saved.autoSites) || !saved.autoSites.includes(tabUrl.origin) || !saved.preference?.trim()) return;
    const result = await runPersonalize(tabId, sender.url, saved.preference, saved.companionToken || '', saved.requireRealAi === true).catch(error => ({ error: (error as Error).message, ai: { code: (error as any).code || 'inference-failure', message: (error as Error).message } }));
    if (result) await chrome.tabs.sendMessage(tabId, { type: 'auto-result', result }).catch(() => {});
  })();
});
