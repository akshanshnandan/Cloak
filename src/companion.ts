import express, { type Express } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { SemanticModel, MODEL } from './model.ts';
import { LocalPlanner, PLANNER_MODEL } from './planner.ts';
import { rankStories } from './ranking.ts';
import type { PageInventory, PageSection, Profile, Story } from './types.ts';

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const cleanText = (value: unknown, max: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
function safeUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 500);
  } catch { return ''; }
}
function validOrigin(req: express.Request, origin: string | undefined) {
  // The browser may label chrome-extension → loopback as cross-site in Fetch
  // Metadata. Origin is the decisive check here; a website cannot set it to an
  // installed extension's chrome-extension origin.
  return !!origin && EXTENSION_ORIGIN.test(origin) && req.get('sec-fetch-mode') !== 'navigate';
}
function equalSecret(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface CompanionOptions {
  pairingCode: string;
  planner?: LocalPlanner;
  model?: SemanticModel;
  cacheDirectory?: string;
}
export function createCompanionApp(options: CompanionOptions): Express {
  const app = express();
  const planner = options.planner || new LocalPlanner(options.cacheDirectory || path.resolve('.cache'));
  const model = options.model || new SemanticModel(path.resolve('.cache/models'));
  let pairedOrigin = '', token = '', usedPairCode = false, active = 0;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const origin = req.get('origin') || '';
    if (EXTENSION_ORIGIN.test(origin) && (origin === pairedOrigin || req.path === '/api/extension/pair')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return EXTENSION_ORIGIN.test(origin) && (origin === pairedOrigin || req.path === '/api/extension/pair') ? res.sendStatus(204) : res.sendStatus(403);
    next();
  });
  app.get('/api/extension/pair-status', (req, res) => {
    if (!validOrigin(req, req.get('origin'))) return res.sendStatus(403);
    res.json({ paired: !!pairedOrigin && req.get('origin') === pairedOrigin });
  });
  app.post('/api/extension/pair', (req, res) => {
    const origin = req.get('origin');
    if (!validOrigin(req, origin) || typeof req.body?.code !== 'string' || usedPairCode || !equalSecret(req.body.code, options.pairingCode)) return res.sendStatus(403);
    usedPairCode = true;
    pairedOrigin = origin!;
    token = randomBytes(32).toString('hex');
    res.json({ token, models: { planner: PLANNER_MODEL, semantic: MODEL } });
  });
  const authorize: express.RequestHandler = (req, res, next) => {
    const origin = req.get('origin') || '';
    if (!pairedOrigin || origin !== pairedOrigin || !validOrigin(req, origin)) return res.sendStatus(403);
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
    if (!match || !equalSecret(match[1], token)) return res.sendStatus(401);
    next();
  };
  app.get('/api/extension/health', authorize, (_req, res) => res.json({
    companion: 'ready', planner: planner.status, semantic: model.status,
    plannerModel: PLANNER_MODEL, semanticModel: MODEL
  }));
  app.post('/api/extension/plan', authorize, async (req, res) => {
    if (active >= 2) return res.status(429).json({ error: 'The local AI is busy. Try again shortly.' });
    active++;
    const abort = new AbortController();
    const cancel = () => { if (!res.writableEnded) abort.abort(); };
    req.on('aborted', cancel); res.on('close', cancel);
    try {
      const body = req.body;
      const preference = cleanText(body?.preference, 500);
      const source = body?.inventory;
      if (!preference || !source || !Array.isArray(source.groups) || !Array.isArray(source.items) || source.items.length < 2 || source.items.length > 40 || source.groups.length < 1 || source.groups.length > 20) return res.status(400).json({ error: 'Invalid bounded page inventory or preference.' });
      const ids = new Set<string>();
      const items: Story[] = source.items.map((item: any, index: number) => {
        const id = cleanText(item?.id, 80), title = cleanText(item?.title, 160), description = cleanText(item?.description, 500), sectionId = cleanText(item?.sectionId, 80);
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id) || !title) throw new Error('Invalid item in page inventory.');
        ids.add(id);
        const price = Number.isFinite(item.price) && item.price >= 0 && item.price <= 1000000 ? item.price : null;
        const currency = ['USD', 'GBP', 'EUR'].includes(item.currency) ? item.currency : undefined;
        return { id, title, description, url: safeUrl(item.url), sectionId, originalIndex: index, kind: 'content', price, currency };
      });
      const groups: PageSection[] = source.groups.map((group: any, index: number): PageSection => {
        const id = cleanText(group?.id, 80), itemIds = Array.isArray(group?.ids) ? group.ids : [];
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || itemIds.length < 2 || itemIds.length > 40 || new Set(itemIds).size !== itemIds.length || itemIds.some((itemId: unknown) => typeof itemId !== 'string' || !ids.has(itemId))) throw new Error('Invalid group in page inventory.');
        return { id, title: cleanText(group.title, 160) || `Section ${index + 1}`, description: cleanText(group.description, 500), itemIds, originalIndex: index };
      });
      const groupIdSet = new Set(groups.map(group => group.id));
      const referencedIds = groups.flatMap(group => group.itemIds);
      const pageUrl = safeUrl(source.url);
      if (!pageUrl || groupIdSet.size !== groups.length || referencedIds.length !== items.length || new Set(referencedIds).size !== ids.size || items.some(item => !groups.some(group => group.id === item.sectionId && group.itemIds.includes(item.id)))) return res.status(400).json({ error: 'Inventory relationships do not match.' });
      const inventory: PageInventory = { url: pageUrl, title: cleanText(source.title, 200), mode: 'content', sections: groups, categories: [], items, primarySectionId: groups[0].id };
      const profile: Profile = { id: 'extension', name: 'Extension preference', description: preference, interests: [], avoid: '', feedback: [], reading: 'auto', density: 'auto' };
      const semanticRank = await rankStories(model, items, profile);
      if (abort.signal.aborted) return;
      const inference = await planner.decide(inventory, profile, semanticRank.map(item => item.id), () => !abort.signal.aborted);
      if (abort.signal.aborted) return;
      const selected = inference.decision.products.map(index => items[index]?.id).filter((id): id is string => !!id);
      const itemRank = [...new Set([...selected, ...semanticRank.map(item => item.id)])];
      const orderedGroups = inference.decision.sections.map(index => groups[index]?.id).filter((id): id is string => !!id);
      const sectionOrder = [...new Set([...orderedGroups, ...groups.map(group => group.id)])];
      const groupOrders = Object.fromEntries(groups.map(group => [group.id, [...itemRank.filter(id => group.itemIds.includes(id)), ...group.itemIds.filter(id => !itemRank.includes(id))]]));
      res.json({ inventoryUrl: inventory.url, sectionOrder, groupOrders, selectedIds: selected, source: { planner: PLANNER_MODEL, semantic: MODEL, cached: inference.cached }, generatedAt: inference.generatedAt });
    } catch (error) {
      if (abort.signal.aborted) return;
      res.status(400).json({ error: cleanText((error as Error).message, 240) || 'Could not create a validated page plan.' });
    } finally { active--; }
  });
  return app;
}
