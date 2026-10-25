import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan, completeOrder, parseDecision } from '../src/planning.ts';
import { defaults } from '../src/store.ts';
import type { PageInventory, RankedStory } from '../src/types.ts';
const inventory: PageInventory = { url: 'https://www.apple.com/store', primarySectionId: 'products', categories: [{ id: 'mac', title: 'Mac', url: 'https://www.apple.com/mac/', originalIndex: 0 }], sections: [
  { id: 'products', title: 'The latest.', description: '', itemIds: ['pro', 'air', 'phone'], originalIndex: 0 },
  { id: 'offers', title: 'Offers', description: '', itemIds: ['education'], originalIndex: 1 }
], items: [
  { id: 'pro', title: 'MacBook Pro', description: 'Video editing', url: 'https://www.apple.com/shop/buy-mac/macbook-pro', originalIndex: 0, sectionId: 'products', kind: 'product', price: 1999 },
  { id: 'air', title: 'MacBook Air', description: 'Portable Mac', url: 'https://www.apple.com/shop/buy-mac/macbook-air', originalIndex: 1, sectionId: 'products', kind: 'product', price: 999 },
  { id: 'phone', title: 'iPhone', description: 'Camera', url: 'https://www.apple.com/shop/buy-iphone', originalIndex: 2, sectionId: 'products', kind: 'product', price: 1199 },
  { id: 'education', title: 'Education pricing', description: 'For eligible students', url: 'https://www.apple.com/us-edu/store', originalIndex: 3, sectionId: 'offers', kind: 'content', education: true, price: null }
] };
test('a local LLM plan can only reference IDs from the current page', () => {
  const valid = { title: 'Your study setup.', query: 'Portable computer for coding', budget: 1200, products: [1], sections: [0, 1], categories: [0] };
  assert.equal(parseDecision(JSON.stringify(valid), inventory).products[0], 1);
  assert.throws(() => parseDecision(JSON.stringify({ ...valid, products: [999] }), inventory));
  assert.throws(() => parseDecision(JSON.stringify({ ...valid, sections: ['run arbitrary code'] }), inventory));
  assert.throws(() => parseDecision('Not a structured plan', inventory));
});
test('budget constraints outrank the model while retaining every native item', () => {
  const ranked = inventory.items.map((item, i) => ({ ...item, score: 1 - i / 10, reason: '', movement: 0 })) as RankedStory[];
  const decision = { title: 'Your study setup.', query: 'Coding on a budget', budget: 1200, products: [0, 1], sections: [1, 0], categories: [0] };
  const plan = compilePlan(decision, inventory, ranked, { ...defaults().profiles[0], budget: 1200 }, { model: 'real-model', generatedAt: '', cached: false });
  assert.equal(plan.itemOrders.products[0], 'air');
  assert.deepEqual(new Set(plan.itemOrders.products), new Set(['air', 'pro', 'phone']));
  assert.equal(plan.collection.itemIds.includes('pro'), false);
  assert.equal(plan.sectionOrder[0], 'offers');
  assert.deepEqual(completeOrder(['unknown', 'air', 'air'], ['pro', 'air']), ['air', 'pro']);
});
