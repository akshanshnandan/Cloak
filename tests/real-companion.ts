import assert from 'node:assert/strict';

const pairingCode = process.argv[2];
if (!pairingCode) throw new Error('Pass the current one-time code printed by npm run companion.');
const base = 'http://127.0.0.1:4319';
const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const headers = { Origin: extensionOrigin, 'X-Cloak-Extension-Origin': extensionOrigin, 'Content-Type': 'application/json' };
const pairingStatus = await fetch(`${base}/api/extension/pair-status`, { headers: { Origin: extensionOrigin } });
assert.equal(pairingStatus.status, 200);
assert.equal((await pairingStatus.json() as any).paired, false);
const pair = await fetch(`${base}/api/extension/pair`, { method: 'POST', headers, body: JSON.stringify({ code: pairingCode }) });
assert.equal(pair.status, 200, 'the live companion accepts the current one-time pairing code');
const { token } = await pair.json() as any;
const inventory = {
  url: 'https://fixture.invalid/news', title: 'News',
  groups: [{ id: 'news', title: 'Latest stories', description: '', ids: ['story-ai', 'story-sports', 'story-food'] }],
  items: [
    { id: 'story-ai', title: 'AI helps scientists discover new treatments', description: 'Researchers use machine learning to accelerate scientific discovery.', url: 'https://fixture.invalid/ai', sectionId: 'news' },
    { id: 'story-sports', title: 'Championship final ends in overtime', description: 'A close match decides this year’s national sports title.', url: 'https://fixture.invalid/sports', sectionId: 'news' },
    { id: 'story-food', title: 'Seasonal recipes for early summer', description: 'Fresh produce and easy meals for warm weather.', url: 'https://fixture.invalid/food', sectionId: 'news' }
  ]
};
const response = await fetch(`${base}/api/extension/plan`, {
  method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` },
  body: JSON.stringify({ preference: 'Prioritize artificial intelligence and science coverage', inventory }),
  signal: AbortSignal.timeout(180000)
});
const body = await response.json() as any;
assert.equal(response.status, 200, JSON.stringify(body));
assert.ok(Object.values(body.groupOrders).flat().every((id: any) => inventory.items.some(item => item.id === id)), 'the real companion returns only supplied inventory IDs');
assert.equal(body.source.planner, 'ggml-org/Qwen3-1.7B-GGUF:Q4_K_M');
assert.equal(body.source.semantic, 'Xenova/all-MiniLM-L6-v2');
assert.ok(body.groupOrders.news.indexOf('story-ai') < body.groupOrders.news.indexOf('story-sports'));
const denied = await fetch(`${base}/api/extension/health`, { headers: { Origin: 'https://attacker.invalid', Authorization: `Bearer ${token}` } });
assert.equal(denied.status, 403, 'untrusted websites cannot use the live local companion');
console.log(JSON.stringify({ status: 'real-companion-pass', returnedIds: body.groupOrders.news, selectedIds: body.selectedIds, provenance: body.source, generatedAt: body.generatedAt }, null, 2));
