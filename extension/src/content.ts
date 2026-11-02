import { installGenericCloak } from './generic.ts';
declare global { interface Window { __cloakGeneric?: any } }
chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response: any) => void) => {
  try {
    if (message?.type === 'status') { sendResponse(window.__cloakGeneric?.status() || { active: false, groups: 0 }); return; }
    installGenericCloak();
    const result = message?.type === 'personalize' ? window.__cloakGeneric.personalize(String(message.preference || '')) :
      message?.type === 'restore' ? window.__cloakGeneric.restore() : null;
    if (!result) throw new Error('Unknown Cloak action.');
    sendResponse(result);
  } catch (error) { sendResponse({ error: (error as Error).message || 'Cloak could not change this page.' }); }
  return false;
});
