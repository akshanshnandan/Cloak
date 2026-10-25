import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installDomEngine } from '../src/engine/dom.ts';

test('native DOM transactions reorder existing nodes and restore exact markup and identity', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<main><section id="a"><h2>Native <em>heading</em></h2><div><a id="one" href="/one">One</a><a id="two" href="/two">Two</a></div></section><script type="application/json">{}</script><section id="b">B</section></main>');
    await page.evaluate(() => { (window as any).__name = (value: unknown) => value; });
    await page.evaluate(installDomEngine);
    const result = await page.evaluate(() => {
      const engine = (window as any).__cloakDom;
      const a = document.querySelector('#a')!, b = document.querySelector('#b')!, one = document.querySelector('#one')!, two = document.querySelector('#two')!, heading = document.querySelector('h2')!;
      const originalNodes = [a, b, one, two, ...heading.childNodes];
      engine.register('sections', [{ id: 'a', node: a }, { id: 'b', node: b }]);
      engine.register('cards', [{ id: 'one', node: one }, { id: 'two', node: two }]); engine.registerText('heading', heading);
      const before = document.querySelector('main')!.innerHTML;
      engine.capture([]); engine.apply([{ group: 'sections', order: ['b', 'a'] }, { group: 'cards', order: ['two', 'one'] }], [{ id: 'heading', text: 'Your collection.' }]);
      const reordered = Array.from(document.querySelectorAll('section')).map(n => n.id).join(',') === 'b,a' && Array.from(document.querySelectorAll('a')).map(n => n.id).join(',') === 'two,one';
      engine.restore();
      let invalidRejected = false;
      try { engine.apply([{ group: 'sections', order: ['b', 'a'] }, { group: 'cards', order: ['missing', 'one'] }], []); } catch { invalidRejected = true; }
      return { reordered, exact: document.querySelector('main')!.innerHTML === before, identity: originalNodes.every(n => n.isConnected), invalidRejected, href: document.querySelector('#one')!.getAttribute('href') };
    });
    assert.deepEqual(result, { reordered: true, exact: true, identity: true, invalidRejected: true, href: '/one' });
  } finally { await browser.close(); }
});
