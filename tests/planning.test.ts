import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan, completeOrder, layoutForNeeds, parseDecision } from '../src/planning.ts';
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
  assert.throws(() => parseDecision(JSON.stringify({ ...valid, layout: 'position:fixed; display:none' }), inventory));
  assert.equal(parseDecision(JSON.stringify({ ...valid, layout: 'compare' }), inventory).layout, 'compare');
  assert.equal(parseDecision(JSON.stringify(valid), inventory).layout, undefined, 'Older cached decisions remain readable');
  assert.throws(() => parseDecision('Not a structured plan', inventory));
});
test('budget constraints outrank the model while retaining every native item', () => {
  const ranked = inventory.items.map((item, i) => ({ ...item, score: 1 - i / 10, reason: '', movement: 0 })) as RankedStory[];
  const decision = { title: 'Your study setup.', query: 'Coding on a budget', budget: 1200, products: [0, 1], sections: [1, 0], categories: [0] };
  const plan = compilePlan(decision, inventory, ranked, { ...defaults().profiles[0], budget: 1200 }, { model: 'real-model', generatedAt: '', cached: false });
  assert.equal(plan.itemOrders.products[0], 'air');
  assert.deepEqual(new Set(plan.itemOrders.products), new Set(['air', 'pro', 'phone']));
  assert.equal(plan.collection.itemIds.includes('pro'), false);
  assert.equal(plan.sectionOrder[0], 'products');
  assert.equal(plan.sectionOrder[1], 'offers');
  assert.deepEqual(completeOrder(['unknown', 'air', 'air'], ['pro', 'air']), ['air', 'pro']);
});

test('content pages prioritize relevant sections and honor explicit reading needs without an age assumption', () => {
  const page = { ...inventory, mode: 'content' as const, categories: [] };
  const decision = parseDecision(JSON.stringify({ title: 'Family and setup', query: 'Family calls', budget: null, products: [3], sections: [1, 0], categories: [], reading: 'standard', density: 'all' }), page);
  const ranked = page.items.map(item => ({ ...item, score: .5, reason: '', movement: 0 }));
  const source = { model: 'local', generatedAt: '', cached: false };
  const grandma = defaults().profiles.find(profile => profile.id === 'grandma')!;
  const plan = compilePlan(decision, page, ranked, grandma, source);
  assert.deepEqual(plan.sectionOrder, ['offers', 'products']);
  assert.equal(plan.presentation?.reading, 'larger'); assert.equal(plan.presentation?.density, 'focused');
  const standard = compilePlan(decision, page, ranked, { ...grandma, description: 'I am a grandmother. I edit films.', reading: 'standard', density: 'all' }, source);
  assert.deepEqual(standard.presentation, { reading: 'standard', density: 'all', layout: 'immersive', maxVisible: null });
  assert.equal(plan.itemOrders.products[0], 'air', 'Affordable products precede expensive items');
});

test('layout strategies follow browsing needs across arbitrary people and custom profiles', () => {
  const custom = { ...defaults().profiles[0], id: 'custom-person', name: 'A person', interests: [] };
  assert.equal(layoutForNeeds({ ...custom, description: 'I need a simple shopping experience with fewer choices and help setting up family calls.' }), 'guided');
  assert.equal(layoutForNeeds({ ...custom, description: 'I program and need a good value portable computer for coding and research.' }), 'compare');
  assert.equal(layoutForNeeds({ ...custom, description: 'I edit 4K films and create professional photography and illustration.' }), 'immersive');
  assert.equal(layoutForNeeds({ ...custom, description: 'I want headphones for my commute and music.' }), 'balanced');
  assert.equal(layoutForNeeds({ ...custom, description: 'I am a grandmother who does programming and technical research.' }), 'compare', 'Age does not choose the layout');
  assert.equal(layoutForNeeds({ ...custom, description: 'I am a student editing films. Use an immersive layout with large product images.' }), 'immersive');
  assert.equal(layoutForNeeds({ ...custom, description: 'I edit films but compare options side by side in a compact layout.' }, 'immersive'), 'compare', 'Explicit browsing instructions override a conflicting model decision');
  assert.equal(layoutForNeeds({ ...custom, description: 'I edit films but want only two options and simpler browsing.' }, 'immersive'), 'guided');
  assert.equal(layoutForNeeds({ ...custom, description: 'I want headphones for my commute.' }, 'immersive'), 'immersive', 'The model can select a layout beyond keyword inference');
});

test('layout decisions preserve native content and changing actual ranking changes the plan identity', () => {
  const profile = { ...defaults().profiles[0], id: 'custom', description: 'Help me compare products side by side.', interests: [], budget: null };
  const ranked = inventory.items.map(item => ({ ...item, score: .5, reason: '', movement: 0 }));
  const decision = { title: 'Compare your options', query: 'Portable products', budget: null, products: [1], sections: [1, 0], categories: [0], layout: 'compare' as const };
  const source = { model: 'local', generatedAt: 'now', cached: false };
  const first = compilePlan(decision, inventory, ranked, profile, source);
  assert.equal(first.presentation?.layout, 'compare');
  assert.equal(first.presentation?.maxVisible, 6, 'Comparison starts with a scannable native product grid');
  for (const section of inventory.sections) assert.deepEqual(new Set(first.itemOrders[section.id]), new Set(section.itemIds));
  assert.deepEqual(new Set(first.sectionOrder), new Set(inventory.sections.map(section => section.id)));
  const reranked = ranked.map(item => ({ ...item, score: item.id === 'phone' ? 1 : .1 }));
  const next = compilePlan(decision, inventory, reranked, profile, source);
  assert.notDeepEqual(first.itemOrders.products, next.itemOrders.products);
  assert.notEqual(first.id, next.id, 'A changed DOM operation must not be skipped as an already applied plan');
  assert.equal(first.id, compilePlan(decision, inventory, ranked, profile, { ...source, cached: true, generatedAt: 'later' }).id, 'Cache metadata alone does not invalidate an identical DOM plan');
  assert.equal(compilePlan(decision, inventory, ranked, { ...profile, density: 'focused' }, source).presentation?.maxVisible, 4);
  assert.equal(compilePlan(decision, inventory, ranked, { ...profile, density: 'all' }, source).presentation?.maxVisible, null, 'Explicit Show all keeps every choice expanded');
  const guided = compilePlan({ ...decision, layout: 'guided' }, inventory, ranked, { ...profile, description: 'Show fewer choices at once.' }, source);
  assert.equal(guided.presentation?.maxVisible, 2);
});

test('unsupported model simplification cannot flatten technical and creative browsing into the same guided layout', () => {
  const ranked = inventory.items.map(item => ({ ...item, score: .5, reason: '', movement: 0 }));
  const decision = { title: 'Your Apple setup', query: 'Useful products', budget: null, products: [1], sections: [0, 1], categories: [0], layout: 'guided' as const, density: 'focused' as const, reading: 'larger' as const };
  const source = { model: 'local', generatedAt: '', cached: true };
  const custom = { ...defaults().profiles[0], id: 'any-person', interests: [] };
  for (const mode of ['store', 'content'] as const) {
    for (const layout of ['guided', 'balanced'] as const) {
      const engineering = compilePlan({ ...decision, layout }, { ...inventory, mode }, ranked, { ...custom, description: 'I need a portable computer for coding, engineering coursework and budget research.' }, source);
      assert.deepEqual(engineering.presentation, { layout: 'compare', density: 'all', reading: 'standard', maxVisible: 6 });
      const creative = compilePlan({ ...decision, layout }, { ...inventory, mode }, ranked, { ...custom, description: 'I edit 4K films and work in professional photography and illustration.' }, source);
      assert.deepEqual(creative.presentation, { layout: 'immersive', density: 'all', reading: 'standard', maxVisible: 4 });
    }
    const general = compilePlan(decision, { ...inventory, mode }, ranked, { ...custom, description: 'I listen to music on my commute.' }, source);
    assert.equal(general.presentation?.layout, 'balanced');
    const requested = compilePlan(decision, { ...inventory, mode }, ranked, { ...custom, description: 'Show fewer choices and larger reading text for family video calls.' }, source);
    assert.deepEqual(requested.presentation, { layout: 'guided', density: 'focused', reading: 'larger', maxVisible: 2 });
  }
  assert.equal(layoutForNeeds({ ...custom, description: 'I listen to music.', density: 'focused' }, 'guided'), 'guided', 'An explicit control preference permits guided browsing');
  assert.equal(layoutForNeeds({ ...custom, description: 'I edit films but prefer a balanced layout.' }, 'immersive'), 'balanced', 'An explicit balanced request takes priority over semantic and model strategies');
  assert.equal(layoutForNeeds({ ...custom, description: 'I research coding equipment.' }, 'immersive'), 'immersive', 'Specific model strategies remain available beyond the generic fallback');
});
