import { installGenericCloak } from './generic.ts';
declare global { interface Window { __cloakGeneric?: any } }
chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response: any) => void) => {
  try {
    if (message?.type === 'auto-result') { sendResponse({ received: true }); return; }
    if (message?.type === 'cloak-auto-run') { notifyAuto(); sendResponse({ queued: true }); return; }
    if (message?.type === 'status') { sendResponse(window.__cloakGeneric?.status() || { active: false, groups: 0 }); return; }
    installGenericCloak();
    const result = message?.type === 'inventory' ? { inventory: window.__cloakGeneric.inventory } :
      message?.type === 'apply-plan' ? window.__cloakGeneric.applyPlan(message.plan) :
      message?.type === 'personalize' ? window.__cloakGeneric.personalize(String(message.preference || '')) :
      message?.type === 'restore' ? window.__cloakGeneric.restore() : null;
    if (!result) throw new Error('Unknown Cloak action.');
    sendResponse(result);
  } catch (error) { sendResponse({ error: (error as Error).message || 'Cloak could not change this page.' }); }
  return false;
});
let lastAutoUrl = location.href;
let routeTimer = 0;
const autoReady = () => { if (chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: 'cloak-auto-ready' }).catch(() => {}); };
const notifyAuto = () => {
  if (lastAutoUrl === location.href) return;
  window.clearTimeout(routeTimer);
  routeTimer = window.setTimeout(() => {
    const nextUrl = location.href;
    if (lastAutoUrl === nextUrl) return;
    const generic = window.__cloakGeneric;
    if (generic) {
      try {
        if (generic.status().active) generic.restore();
        generic.dispose();
        delete window.__cloakGeneric;
      } catch (error) {
        chrome.runtime.sendMessage({ type: 'cloak-auto-error', error: (error as Error).message }).catch(() => {});
        lastAutoUrl = nextUrl;
        return;
      }
    }
    lastAutoUrl = nextUrl;
    autoReady();
  }, 300);
};
window.addEventListener('popstate', notifyAuto);
window.addEventListener('hashchange', notifyAuto);
autoReady();
