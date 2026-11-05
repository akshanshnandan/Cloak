const activeTabKey = 'cloak-active-tab-ids';
const planCache = new Map<string, any>();
const requests = new Map<number, { controller: AbortController; version: number }>();
const versions = new Map<number, number>();
const companion = 'http://127.0.0.1:4319';
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
chrome.tabs.onUpdated.addListener((tabId: number, change: any) => { if (change.status === 'loading' || change.url) cancel(tabId); });
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
  if (!token) return { mode: 'fallback', message: 'Not connected · deterministic fallback' };
  try {
    const response = await fetch(`${companion}/api/extension/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { mode: 'fallback', message: 'Companion unavailable · deterministic fallback' };
    const state = await response.json();
    return { mode: 'local-ai', message: state.planner?.phase === 'ready' && state.semantic?.phase === 'ready' ? 'Qwen3 + MiniLM ready' : 'Local AI connected · models may load on first request', planner: state.planner, semantic: state.semantic };
  } catch { return { mode: 'fallback', message: 'Companion unavailable · deterministic fallback' }; }
}
async function runPersonalize(tabId: number, url: string, preference: string, token: string) {
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
    const snapshot = await chrome.tabs.sendMessage(tabId, { type: 'inventory' });
    const inventory = snapshot?.inventory;
    if (!inventory?.items?.length) throw new Error('This page has no safe content to personalize.');
    let mode = 'fallback', plan: any;
    if (token) {
      try {
        const key = JSON.stringify([url.split('#')[0], preference, inventory]);
        plan = planCache.get(key);
        if (!plan) {
          const response = await fetch(`${companion}/api/extension/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ preference, inventory }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) });
          if (!response.ok) throw new Error(`Local AI request failed (${response.status}).`);
          plan = await response.json(); planCache.set(key, plan);
          if (planCache.size > 20) planCache.delete(planCache.keys().next().value!);
        }
        mode = 'local-ai';
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Personalization cancelled because the page or Cloak state changed.');
        plan = undefined;
      }
    }
    if (!await stillCurrent()) throw new Error('Page changed while AI was working. No plan was applied.');
    if (plan) {
      const currentSnapshot = await chrome.tabs.sendMessage(tabId, { type: 'inventory' });
      if (JSON.stringify(currentSnapshot?.inventory) !== JSON.stringify(inventory) || !await stillCurrent()) throw new Error('Page content changed while AI was working. No plan was applied.');
      const result = await chrome.tabs.sendMessage(tabId, { type: 'apply-plan', plan: { ...plan, mode, inventoryUrl: inventory.url, source: plan.source || {} } });
      if (result?.status === 'no-change') return { ...result, mode, message: 'No visible change was needed for this preference.' };
      if (result?.error) throw new Error(result.error);
      await setTabActive(tabId, true);
      return { ...result, mode, message: mode === 'local-ai' ? 'Personalized with Qwen3 + MiniLM.' : 'Personalized with deterministic fallback ranking.' };
    }
    const result = await chrome.tabs.sendMessage(tabId, { type: 'personalize', preference });
    if (result?.error) throw new Error(result.error);
    if (result?.status === 'no-change') return { ...result, mode: 'fallback', message: 'No visible change was needed for this preference.' };
    if (result?.status === 'personalized') await setTabActive(tabId, true);
    return { ...result, mode: 'fallback', message: 'Personalized with deterministic fallback ranking.' };
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
      const saved = await chrome.storage.local.get(['preference', 'companionToken']);
      const text = String(message.preference ?? saved.preference ?? '').slice(0, 500);
      if (!text.trim()) throw new Error('Describe what you want to find before personalizing.');
      await chrome.storage.local.set({ preference: text });
      const result = await runPersonalize(tabId, tab.url, text, saved.companionToken || '');
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
  })().then(sendResponse, error => sendResponse({ error: (error as Error).message }));
  return true;
});
chrome.runtime.onMessage.addListener((message: any, sender: any) => {
  if (message?.type !== 'cloak-auto-ready' || !sender.tab?.id || !sender.url) return;
  void (async () => {
    const tabId = sender.tab.id, tabUrl = new URL(sender.url), saved = await chrome.storage.local.get(['autoSites', 'preference', 'companionToken', 'cloakEnabled']);
    if (saved.cloakEnabled === false || !Array.isArray(saved.autoSites) || !saved.autoSites.includes(tabUrl.origin) || !saved.preference?.trim()) return;
    const result = await runPersonalize(tabId, sender.url, saved.preference, saved.companionToken || '').catch(() => null);
    if (result) await chrome.tabs.sendMessage(tabId, { type: 'auto-result', result }).catch(() => {});
  })();
});
