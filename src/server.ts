import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import type { Response } from 'express';
import { PreferenceStore } from './store.ts';
import { SemanticModel, MODEL } from './model.ts';
import { BrowserManager } from './browser.ts';
import { rankStories } from './ranking.ts';
import type { RankedStory } from './types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4317);
const store = new PreferenceStore(process.env.CLOAK_DATA_DIR || path.join(root, 'data'));
await store.load();
const clients = new Set<Response>();
let ranked: RankedStory[] = [], busy = false, error = '', revision = 0;
const model = new SemanticModel(path.join(root, '.cache/models'), () => broadcast());
const browser = new BrowserManager(path.join(store.directory, 'browser'), state, action, rerank, broadcast);
function state() {
  return { ...store.value, model: model.status, modelName: MODEL, ranked, busy, error, browser: { connected: !!browser?.page && !browser.page.isClosed(), url: browser?.url || '', site: browser?.site || '', count: browser?.stories.length || 0 } };
}
function broadcast() {
  const data = `data: ${JSON.stringify(state())}\n\n`;
  for (const response of clients) response.write(data);
  void browser.update();
}
async function rerank() {
  const current = ++revision;
  const stories = [...browser.stories];
  const profile = structuredClone(store.active);
  if (!stories.length) { ranked = []; busy = false; broadcast(); return; }
  busy = true; error = ''; broadcast();
  try {
    const result = await rankStories(model, stories, profile);
    if (current !== revision) return;
    ranked = result;
  } catch (cause) { if (current === revision) error = (cause as Error).message; }
  finally { if (current === revision) { busy = false; broadcast(); } }
}
function text(value: unknown, max: number, field: string) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${field}`);
  return value.trim();
}
let mutationQueue = Promise.resolve();
function action(payload: any): Promise<void> {
  const task = mutationQueue.then(() => performAction(payload));
  mutationQueue = task.catch(() => {});
  return task;
}
async function performAction(payload: any) {
  if (!payload || typeof payload.type !== 'string') throw new Error('Missing action');
  switch (payload.type) {
    case 'profile': {
      if (!store.value.profiles.some(p => p.id === payload.id)) throw new Error('Profile not found');
      store.value.activeProfileId = payload.id;
      await store.save(); void rerank(); break;
    }
    case 'toggle': {
      if (typeof payload.enabled !== 'boolean') throw new Error('Invalid toggle');
      store.value.enabled = payload.enabled;
      await store.save(); broadcast(); break;
    }
    case 'save-profile': {
      const profile = store.active;
      const name = text(payload.name, 60, 'name'), description = text(payload.description, 2000, 'description'), avoid = text(payload.avoid, 1000, 'avoid');
      if (!name || !description) throw new Error('Add a name and describe what matters to you');
      if (!Array.isArray(payload.interests) || payload.interests.length > 12) throw new Error('Use up to 12 interests');
      const interests = payload.interests.map((i: unknown) => text(i, 80, 'interest')).filter(Boolean);
      Object.assign(profile, { name, description, avoid, interests });
      await store.save(); void rerank(); break;
    }
    case 'create-profile': {
      if (store.value.profiles.length >= 10) throw new Error('You can save up to 10 profiles');
      const id = crypto.randomUUID();
      store.value.profiles.push({ id, name: 'My profile', description: 'I like learning new things and discovering useful ideas.', interests: [], avoid: '', feedback: [] });
      store.value.activeProfileId = id;
      await store.save(); void rerank(); break;
    }
    case 'feedback': case 'open': {
      const story = browser.stories.find(s => s.id === payload.id);
      if (!story) throw new Error('That story is no longer on the active page');
      if (payload.type === 'feedback' && payload.value !== 1 && payload.value !== -1) throw new Error('Invalid feedback');
      const existing = store.active.feedback.find(f => f.id === story.id);
      if (payload.type === 'open' && existing) return;
      store.active.feedback = store.active.feedback.filter(f => f.id !== story.id);
      store.active.feedback.push({ id: story.id, title: story.title, value: payload.type === 'open' ? 1 : payload.value, at: new Date().toISOString(), strength: payload.type === 'open' ? 0.25 : 1 });
      store.active.feedback = store.active.feedback.slice(-60);
      await store.save(); void rerank(); break;
    }
    case 'clear-feedback': store.active.feedback = []; await store.save(); void rerank(); break;
    case 'find': {
      if (!browser.stories.some(s => s.id === payload.id)) throw new Error('That item is no longer on this page');
      await browser.find(payload.id); break;
    }
    case 'retry-model': await model.load(); await rerank(); break;
    default: throw new Error('Unknown action');
  }
}
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!['127.0.0.1', 'localhost'].includes(req.hostname)) return res.status(403).json({ error: 'Local connections only' });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.get('origin');
    if ((origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) || !req.is('application/json')) return res.status(403).json({ error: 'Use the local Cloak dashboard' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '24kb' }));
app.get('/api/state', (_req, res) => res.json(state()));
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); clients.add(res); res.write(`data: ${JSON.stringify(state())}\n\n`);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
});
app.post('/api/action', async (req, res) => {
  try { await action(req.body); res.json(state()); }
  catch (cause) { res.status(400).json({ error: (cause as Error).message }); }
});
let launching = false;
app.post('/api/browser', async (req, res) => {
  if (launching) return res.status(409).json({ error: 'The browser is already opening' });
  if (!['hn', 'apple', 'focus'].includes(req.body.target)) return res.status(400).json({ error: 'Choose Apple Store' });
  launching = true; error = ''; broadcast();
  try {
    if (req.body.target === 'focus') await browser.focus(); else await browser.open(req.body.target);
    res.json(state());
  } catch (cause) { error = (cause as Error).message; broadcast(); res.status(500).json({ error }); }
  finally { launching = false; }
});
app.use(express.static(path.join(root, 'public')));
app.use((cause: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: cause.message }); });
await mkdir(path.join(root, '.cache'), { recursive: true });
const server = app.listen(port, '127.0.0.1', () => console.log(`\n  cloak · Your internet, tailored to you.\n  http://127.0.0.1:${port}\n`));
void model.load().then(() => rerank()).catch(() => broadcast());
async function shutdown() { clients.forEach(r => r.end()); await browser.close(); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
export { browser, model, store, server, state };
