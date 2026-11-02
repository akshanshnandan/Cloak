const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const preference = byId<HTMLTextAreaElement>('preference');
const status = byId<HTMLElement>('status');
const master = byId<HTMLInputElement>('enabled');
const show = (message: string, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
async function action(actionName: string, text?: string) {
  show('Working...');
  const result = await chrome.runtime.sendMessage({ type: 'cloak-action', action: actionName, preference: text });
  if (result?.error) { show(result.error, true); return; }
  if (result?.status === 'personalized') {
    master.checked = true;
    show(`Personalized ${result.groups} safe content group${result.groups === 1 ? '' : 's'}.`);
  } else if (result?.status === 'original') {
    master.checked = false;
    show('Original page restored.');
  } else {
    master.checked = !!result?.active;
    show(result?.active ? `Cloak is active on ${result.groups} groups.` : 'Ready. Your page is in Original mode.');
  }
}
void (async () => { const saved = await chrome.storage.local.get({ preference: '' }); preference.value = saved.preference; await action('status'); })();
preference.addEventListener('input', () => void chrome.storage.local.set({ preference: preference.value }));
master.addEventListener('change', async () => { if (master.checked) await action('on', preference.value); else await action('off'); });
byId('cloaked').addEventListener('click', () => void action('on', preference.value));
byId('personalize').addEventListener('click', () => void action('personalize', preference.value));
byId('original').addEventListener('click', () => void action('original'));
