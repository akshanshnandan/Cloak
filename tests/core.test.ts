import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PreferenceStore, defaults } from '../src/store.ts';
import { rankStories } from '../src/ranking.ts';
import { BrowserManager } from '../src/browser.ts';

test('preferences persist profile-specific feedback across restarts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cloak-test-'));
  try {
    const first = new PreferenceStore(directory); await first.load();
    first.active.feedback.push({ id: '1', title: 'Robots', value: 1, at: new Date().toISOString() });
    await first.save(); first.value.activeProfileId = 'finance'; await first.save();
    const second = new PreferenceStore(directory); await second.load();
    assert.equal(second.active.id, 'finance'); assert.equal(second.active.feedback.length, 0);
    assert.equal(second.value.profiles[0].feedback.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('semantic feedback changes ranking and ties remain stable', async () => {
  const model = { embed: async (texts: string[]) => texts.map(t => /robot/i.test(t) ? [1, 0] : /bank/i.test(t) ? [0, 1] : [0.707, 0.707]) };
  const stories = [
    { id: '1', title: 'Bank earnings', description: '', url: 'https://example.com/1', originalIndex: 0 },
    { id: '2', title: 'Robotics research', description: '', url: 'https://example.com/2', originalIndex: 1 }
  ];
  const profile = { ...defaults().profiles[0], description: 'Interesting research', interests: [], avoid: '', feedback: [] };
  assert.equal((await rankStories(model, stories, profile))[0].id, '1');
  const positive = await rankStories(model, stories, { ...profile, feedback: [{ id: '2', title: 'Robotics research', value: 1, at: '' }] });
  assert.equal(positive[0].id, '2'); assert.equal(positive[0].movement, 1);
  const negative = await rankStories(model, stories, { ...profile, feedback: [{ id: '2', title: 'Robotics research', value: -1, at: '' }] });
  assert.equal(negative[0].id, '1');
});

test('adaptation is restricted to tested HTTPS hosts', () => {
  assert.equal(BrowserManager.supported('https://news.ycombinator.com/newest'), true);
  assert.equal(BrowserManager.supported('https://en.wikipedia.org/wiki/Robotics'), true);
  for (const url of ['http://news.ycombinator.com', 'https://news.ycombinator.com.evil.test', 'file:///C:/private', 'https://example.com', 'https://en.wikipedia.org/w/index.php']) assert.equal(BrowserManager.supported(url), false);
});
