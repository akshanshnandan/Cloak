// The primary experience is the real website. The localhost UI is optional.
const port = Number(process.env.PORT || 4317);
const base = `http://127.0.0.1:${port}`;
let running = false;
try {
  const response = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(1200) });
  const state = await response.json() as any;
  running = state.modelName === 'Xenova/all-MiniLM-L6-v2';
} catch { /* Start a new local process below. */ }
if (running) {
  for (const [route, payload] of [['action', { type: 'toggle', enabled: false }], ['browser', { target: 'apple' }]] as const) {
    const result = await fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!result.ok) throw new Error((await result.json() as any).error);
  }
  console.log('Apple is open in Original mode. Choose “Cloaked” to personalize it.');
} else {
  const app = await import('./server.ts');
  app.store.value.enabled = false; await app.store.save();
  try {
    await app.browser.open('apple');
    console.log('Apple is open in Original mode. Choose “Cloaked” when you’re ready.');
  } catch (error) { console.error('Could not open Apple Store:', (error as Error).message, '\nRun npm start again to retry.'); }
}
