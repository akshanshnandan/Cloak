import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import type { Response } from 'express';
import { PreferenceStore } from './store.ts';
import { SemanticModel, MODEL } from './model.ts';
import { BrowserManager } from './browser.ts';
import { rankStories } from './ranking.ts';
import { LocalPlanner, PLANNER_MODEL } from './planner.ts';
import { compilePlan, inventoryKey } from './planning.ts';
import type { RankedStory, PersonalizationPlan } from './types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4317);
const store = new PreferenceStore(process.env.CLOAK_DATA_DIR || path.join(root, 'data'));
await store.load();
const clients = new Set<Response>();
let ranked: RankedStory[] = [], busy = false, error = '', revision = 0;
let plan: PersonalizationPlan | null = null;
const model = new SemanticModel(path.join(root, '.cache/models'), () => broadcast());
const planner = new LocalPlanner(path.join(root, '.cache'), () => broadcast());
const browser = new BrowserManager(path.join(store.directory, 'browser'), state, action, rerank, broadcast);
function state() {
  const currentPlan = plan && browser?.inventory && plan.inventoryKey === inventoryKey(browser.inventory) ? plan : null;
  return { ...store.value, engineVersion: 4, model: model.status, modelName: MODEL, planner: planner.status, plannerName: PLANNER_MODEL, plan: currentPlan, ranked, busy, error, browser: { connected: !!browser?.page && !browser.page.isClosed(), url: browser?.url || '', site: browser?.site || '', count: browser?.stories.length || 0 } };
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
  const inventory = browser.inventory ? structuredClone(browser.inventory) : null;
  if (!stories.length) { ranked = []; plan = null; busy = false; broadcast(); return; }
  busy = true; error = ''; broadcast();
  try {
    let result = await rankStories(model, stories, profile);
    if (current !== revision) return;
    let nextPlan: PersonalizationPlan | null = null;
    if (inventory) {
      // Embeddings provide an immediate local rearrangement while Qwen reasons
      // about the actual page. The final plan retains explicit model provenance.
      if (!plan || plan.profileId !== profile.id || plan.inventoryKey !== inventoryKey(inventory)) {
        const sectionRanking = await rankStories(model, inventory.sections.map(section => ({ ...section, description: section.description + ' ' + section.itemIds.map(id => stories.find(item => item.id === id)?.title).join('. '), url: inventory.url })), profile);
        const categoryRanking = await rankStories(model, inventory.categories.map(category => ({ ...category, description: category.title })), profile);
        if (current !== revision) return;
        const preview = { title: 'Selected for you', query: profile.description, budget: profile.budget || null, products: result.slice(0, 4).map(item => stories.findIndex(story => story.id === item.id)), sections: sectionRanking.map(section => inventory.sections.findIndex(s => s.id === section.id)), categories: categoryRanking.map(category => inventory.categories.findIndex(c => c.id === category.id)) };
        plan = compilePlan(preview, inventory, result, profile, { model: MODEL, generatedAt: new Date().toISOString(), cached: false }, Object.fromEntries(categoryRanking.map(category => [category.id, category.score])), Object.fromEntries(sectionRanking.map(section => [section.id, section.score])));
        ranked = result; broadcast();
      }
      const inference = await planner.decide(inventory, profile, result.map(item => item.id), () => current === revision);
      if (current !== revision) return;
      const understood = { ...profile, description: profile.description + '\n' + inference.decision.query };
      result = await rankStories(model, stories, understood);
      const categories = inventory.categories.map(category => {
        const normalize = (text: string) => text.toLowerCase().replace(/apple|\s/g, '');
        const relevant = stories.filter(item => normalize(item.title).includes(normalize(category.title)) || inventory.sections.some(section => normalize(section.title).replace(/\./g, '') === normalize(category.title) && section.id === item.sectionId));
        return { ...category, description: relevant.map(item => item.title).join('. ').slice(0, 700) };
      });
      const categoryRanking = await rankStories(model, categories, understood);
      const sectionRanking = await rankStories(model, inventory.sections.map(section => ({ ...section, description: section.description + ' ' + section.itemIds.map(id => { const item = stories.find(item => item.id === id); return item ? item.title + '. ' + item.description.slice(0, 100) : ''; }).join('. ').slice(0, 1100), url: inventory.url })), understood);
      nextPlan = compilePlan(inference.decision, inventory, result, profile, { model: PLANNER_MODEL, generatedAt: inference.generatedAt, cached: inference.cached }, Object.fromEntries(categoryRanking.map(category => [category.id, category.score])), Object.fromEntries(sectionRanking.map(section => [section.id, section.score])));
      const top = nextPlan.collection.itemIds;
      result.sort((a, b) => { const x = top.indexOf(a.id), y = top.indexOf(b.id); return (x < 0 ? 1000 : x) - (y < 0 ? 1000 : y) || b.score - a.score; });
    }
    if (current !== revision) return;
    ranked = result;
    plan = nextPlan;
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
      await store.save(); broadcast(); if (payload.enabled && !state().plan && !busy) void rerank(); break;
    }
    case 'save-profile': {
      const profile = store.active;
      const name = text(payload.name, 60, 'name'), description = text(payload.description, 2000, 'description'), avoid = text(payload.avoid, 1000, 'avoid');
      if (!name || !description) throw new Error('Add a name and describe what matters to you');
      if (!Array.isArray(payload.interests) || payload.interests.length > 12) throw new Error('Use up to 12 interests');
      const interests = payload.interests.map((i: unknown) => text(i, 80, 'interest')).filter(Boolean);
      if (payload.budget !== undefined && payload.budget !== null && (!Number.isFinite(payload.budget) || payload.budget < 1 || payload.budget > 1000000)) throw new Error('Enter a valid maximum budget');
      if (payload.reading !== undefined && !['auto', 'standard', 'larger'].includes(payload.reading)) throw new Error('Invalid reading preference');
      if (payload.density !== undefined && !['auto', 'all', 'focused'].includes(payload.density)) throw new Error('Invalid choices preference');
      Object.assign(profile, { name, description, avoid, interests, ...(payload.budget !== undefined ? { budget: payload.budget } : {}), ...(payload.reading !== undefined ? { reading: payload.reading } : {}), ...(payload.density !== undefined ? { density: payload.density } : {}) });
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
    case 'retry-model': await model.load(); await planner.load(); await rerank(); break;
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
void planner.load().catch(() => broadcast());
async function shutdown() { clients.forEach(r => r.end()); planner.close(); await browser.close(); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
export { browser, model, planner, store, server, state };
