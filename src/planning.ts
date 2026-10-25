import { createHash } from 'node:crypto';
import type { IntentDecision, LayoutStrategy, PageInventory, PersonalizationPlan, Profile, RankedStory } from './types.ts';

export function inventoryKey(inventory: PageInventory) { return createHash('sha256').update(JSON.stringify(inventory)).digest('hex').slice(0, 20); }
export function completeOrder(preferred: string[], existing: string[]) { return [...new Set(preferred.filter(id => existing.includes(id))), ...existing.filter(id => !preferred.includes(id))]; }
export function parseDecision(raw: string, inventory: PageInventory): IntentDecision {
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The local model did not return a JSON plan');
  const decision = JSON.parse(raw.slice(start, end + 1));
  const indexes = (value: unknown, length: number, name: string) => {
    if (!Array.isArray(value) || value.some(i => !Number.isInteger(i) || i < 0 || i >= length)) throw new Error(`The local model returned invalid ${name}`);
    return [...new Set(value as number[])];
  };
  if (typeof decision.title !== 'string' || decision.title.length < 2 || decision.title.length > 80 || typeof decision.query !== 'string' || decision.query.length > 800) throw new Error('The local model returned an invalid intent');
  const products = indexes(decision.products, inventory.items.length, 'products');
  if (!products.length && inventory.items.length) throw new Error('The local model did not select existing content');
  if (decision.budget !== null && (!Number.isFinite(decision.budget) || decision.budget <= 0)) throw new Error('The local model returned an invalid budget');
  if (decision.reading !== undefined && !['standard', 'larger'].includes(decision.reading)) throw new Error('Invalid reading preference');
  if (decision.density !== undefined && !['all', 'focused'].includes(decision.density)) throw new Error('Invalid browsing preference');
  if (decision.layout !== undefined && !['guided', 'compare', 'immersive', 'balanced'].includes(decision.layout)) throw new Error('Invalid layout strategy');
  return { title: decision.title, query: decision.query, budget: decision.budget, products, sections: indexes(decision.sections, inventory.sections.length, 'sections'), categories: indexes(decision.categories, inventory.categories.length, 'categories'), reading: decision.reading, density: decision.density, layout: decision.layout };
}

const requestsFocusedBrowsing = (needs: string) => /(?:fewer|less|only\s+(?:two|a few))\s+(?:choices|options)|(?:simple|simpler|simplify|guided|step[- ]by[- ]step)\s+(?:browsing|layout|experience|choices|shopping)|(?:layout|browsing)\s+(?:should\s+be\s+)?(?:simple|guided)/i.test(needs);
const requestsLargerReading = (needs: string) => /(?:larger|bigger|large|enlarged)\s+(?:reading\s+)?(?:text|type|font)|(?:enlarge|increase)\s+(?:the\s+)?(?:text|type|font)(?:\s+size)?/i.test(needs);

// Model decisions remain bounded by the person's actual preferences. Folding
// content or enlarging text needs an explicit request, including on cached plans.
export function layoutForNeeds(profile: Profile, modelLayout?: LayoutStrategy): LayoutStrategy {
  const needs = profile.description.toLowerCase();
  if (requestsFocusedBrowsing(needs)) return 'guided';
  if (/(?:side[- ]by[- ]side|comparison[- ](?:first|focused))|(?:dense|compact|comparison)\s+(?:layout|grid|view)|(?:compare|comparing)\s+(?:the\s+)?(?:options|products|specifications|specs)/i.test(needs)) return 'compare';
  if (/(?:immersive|visually\s+rich|image[- ]led|editorial)\s+(?:layout|experience|browsing|view)|(?:large|larger|big)\s+(?:product\s+)?(?:images|photographs|imagery)/i.test(needs)) return 'immersive';
  if (/(?:balanced|standard)\s+(?:layout|view|browsing)/i.test(needs)) return 'balanced';
  if (modelLayout && modelLayout !== 'balanced' && (modelLayout !== 'guided' || profile.density === 'focused')) return modelLayout;
  if (profile.density === 'focused') return 'guided';
  const context = `${needs} ${profile.interests.join(' ')}`;
  if (/(?:video\s+editing|edit(?:ing)?\s+(?:4k|films?|videos?)|professional\s+photography|illustration|creative\s+(?:workflows?|workstations?))/.test(context)) return 'immersive';
  if (/(?:programming|coding|engineering|technical\s+(?:research|specifications)|data\s+analysis|spreadsheets|research|compar(?:e|ison))/.test(context)) return 'compare';
  return 'balanced';
}

export function compilePlan(decision: IntentDecision, inventory: PageInventory, ranked: RankedStory[], profile: Profile, source: PersonalizationPlan['source'], categoryScores: Record<string, number> = {}, sectionScores: Record<string, number> = {}): PersonalizationPlan {
  const budget = profile.budget ?? decision.budget;
  const eligible = (id: string) => { const item = inventory.items.find(i => i.id === id)!; return !budget || item.price == null || item.price <= budget; };
  const contentPage = inventory.mode === 'content' || inventory.mode === 'transaction';
  const selected = decision.products.map(index => inventory.items[index]).filter(item => (contentPage || item.sectionId === inventory.primarySectionId && item.kind === 'product') && eligible(item.id)).map(item => item.id);
  const primaryIds = inventory.sections.find(s => s.id === inventory.primarySectionId)?.itemIds || [];
  const primaryRanked = ranked.filter(item => primaryIds.includes(item.id));
  const prioritized = [...primaryRanked].sort((a, b) => {
    const score = (item: RankedStory) => item.score + (selected.includes(item.id) ? 0.24 * (1 - selected.indexOf(item.id) / Math.max(selected.length, 1)) : 0);
    return score(b) - score(a);
  });
  const primaryOrder = completeOrder([...prioritized.filter(item => item.kind === 'product' && eligible(item.id)).map(item => item.id), ...prioritized.map(item => item.id)], primaryIds);
  const contentScore = (item: RankedStory) => item.score + (selected.includes(item.id) ? .24 : 0) - (eligible(item.id) ? 0 : .8);
  const itemOrders = Object.fromEntries(inventory.sections.map(section => [section.id, !contentPage && section.id === inventory.primarySectionId ? primaryOrder : completeOrder([...ranked.filter(item => section.itemIds.includes(item.id))].sort((a, b) => contentScore(b) - contentScore(a)).map(item => item.id), section.itemIds)]));
  const modelSections = completeOrder(decision.sections.map(i => inventory.sections[i].id), inventory.sections.map(s => s.id));
  const prioritizedSections = [...modelSections].sort((a, b) => {
    const score = (id: string) => (sectionScores[id] || 0) + .12 * (1 - modelSections.indexOf(id) / Math.max(1, modelSections.length));
    return score(b) - score(a);
  });
  const sectionOrder = completeOrder([...(contentPage ? [] : [inventory.primarySectionId]), ...prioritizedSections], inventory.sections.map(s => s.id));
  const modelCategories = completeOrder(decision.categories.map(i => inventory.categories[i].id), inventory.categories.map(c => c.id));
  const normalize = (text: string) => text.toLowerCase().replace(/apple|[^a-z0-9]/g, '');
  const affinity = (id: string) => {
    const category = normalize(inventory.categories.find(category => category.id === id)?.title || '');
    if (!category) return 0;
    return primaryOrder.slice(0, 4).reduce((sum, id, index) => sum + (normalize(inventory.items.find(item => item.id === id)?.title || '').includes(category) ? 0.45 / (index + 1) : 0), 0);
  };
  const categoryOrder = [...modelCategories].sort((a, b) => {
    const priority = (id: string) => (categoryScores[id] || 0) + affinity(id) + 0.06 * (1 - modelCategories.indexOf(id) / modelCategories.length);
    return priority(b) - priority(a);
  });
  const key = inventoryKey(inventory);
  const collection = { sectionId: inventory.primarySectionId, title: decision.title, itemIds: (contentPage ? completeOrder(selected, ranked.map(item => item.id)) : primaryOrder.filter(id => inventory.items.find(i => i.id === id)?.kind === 'product' && eligible(id))).slice(0, 5) };
  const presentation: NonNullable<PersonalizationPlan['presentation']> = {
    reading: profile.reading && profile.reading !== 'auto' ? profile.reading : requestsLargerReading(profile.description) ? 'larger' : 'standard',
    density: profile.density && profile.density !== 'auto' ? profile.density : requestsFocusedBrowsing(profile.description) ? 'focused' : 'all',
    layout: layoutForNeeds(profile, decision.layout)
  };
  const visibleByLayout = { guided: 2, compare: 6, immersive: 4, balanced: 4 };
  presentation.maxVisible = profile.density === 'all' ? null : Math.min(visibleByLayout[presentation.layout], presentation.density === 'focused' ? (presentation.layout === 'guided' ? 2 : 4) : Infinity);
  const intent = { title: decision.title, query: decision.query, budget };
  const id = createHash('sha256').update(JSON.stringify([profile.id, key, intent, sectionOrder, categoryOrder, itemOrders, collection, presentation])).digest('hex').slice(0, 20);
  return { id, profileId: profile.id, inventoryKey: key, source, intent, sectionOrder, categoryOrder, itemOrders, collection, presentation };
}
