import assert from 'node:assert/strict';
import { SemanticModel } from '../src/model.ts';
import { LocalPlanner, PLANNER_MODEL } from '../src/planner.ts';
import { rankStories } from '../src/ranking.ts';
import type { PageInventory, Profile, Story } from '../src/types.ts';

const stories: Story[] = [
  { id: 'story-ai', title: 'New AI system improves scientific discovery', description: 'Researchers use artificial intelligence to analyze protein structures and accelerate science.', url: 'https://fixture.invalid/ai', originalIndex: 0, sectionId: 'stories', kind: 'content' },
  { id: 'story-sports', title: 'Championship final ends in overtime', description: 'A close match decides this year’s national sports title.', url: 'https://fixture.invalid/sports', originalIndex: 1, sectionId: 'stories', kind: 'content' },
  { id: 'story-food', title: 'Seasonal recipes for early summer', description: 'Fresh produce and easy meals for warm weather.', url: 'https://fixture.invalid/food', originalIndex: 2, sectionId: 'stories', kind: 'content' }
];
const inventory: PageInventory = {
  url: 'https://fixture.invalid/news', title: 'News', mode: 'content', primarySectionId: 'stories',
  sections: [{ id: 'stories', title: 'Latest stories', description: 'News articles', itemIds: stories.map(story => story.id), originalIndex: 0 }],
  categories: [], items: stories,
  groups: [{ id: 'stories', type: 'items', ids: stories.map(story => story.id) }]
};
const profile: Profile = { id: 'verification', name: 'Verification', description: 'Prioritize artificial intelligence and science coverage', interests: ['AI research', 'science'], avoid: '', feedback: [], reading: 'auto', density: 'auto' };
const semantic = new SemanticModel('.cache/models');
const planner = new LocalPlanner('.cache');
try {
  const embeddings = await semantic.embed([profile.description, ...stories.map(story => `${story.title}. ${story.description}`)]);
  assert.equal(embeddings.length, stories.length + 1);
  assert.ok(embeddings[0].length > 100, 'real MiniLM embedding vector is returned');
  assert.ok(embeddings.every(vector => vector.every(Number.isFinite)));
  const ranked = await rankStories(semantic, stories, profile);
  assert.equal(ranked[0].id, 'story-ai', 'real MiniLM places semantically relevant reporting first');
  const inference = await planner.decide(inventory, profile, ranked.map(story => story.id));
  const decision = inference.decision;
  assert.ok(decision.products.length > 0);
  assert.ok(decision.products.every(index => Number.isInteger(index) && index >= 0 && index < stories.length));
  assert.ok(decision.sections.every(index => index === 0));
  const ids = decision.products.map(index => stories[index].id);
  assert.ok(ids.includes('story-ai'), `Qwen3 selects relevant inventory IDs; selected: ${ids.join(', ')}`);
  console.log(JSON.stringify({ status: 'real-inference-pass', planner: PLANNER_MODEL, semantic: 'Xenova/all-MiniLM-L6-v2', embeddingDimensions: embeddings[0].length, rankedIds: ranked.map(story => story.id), qwenSelectedIds: ids, validatedDecision: decision, cacheHit: inference.cached }, null, 2));
} finally {
  planner.close();
}
