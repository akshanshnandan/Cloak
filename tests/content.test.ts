import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installDomEngine } from '../src/engine/dom.ts';
import { installAppleContent } from '../src/adapters/apple-content.ts';

test('discovered native groups preserve links, scripts, focus disclosure and exact original styles', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><h1>Apple</h1><section><h2>Family</h2><ul>${Array.from({length:6},(_,i)=>`<li><h3>Device ${i}</h3><p style="font-size:16px">Family calls</p><a href="https://www.apple.com/ipad/">Explore ${i}</a></li>`).join('')}</ul></section><section><h2>Performance</h2><p>Development tools.</p><a href="https://www.apple.com/mac/">Explore Mac</a></section><ol><li>First step</li><li>Second step</li></ol></main>`);
    await page.evaluate(() => { (window as any).__name = (v: unknown) => v; });
    await page.evaluate(installDomEngine); await page.evaluate(installAppleContent);
    const result = await page.evaluate(() => {
      const win=window as any, adapter=win.__cloakAdapter, inv=adapter.inventory;
      const originals=Array.from(document.querySelectorAll('main a,main li,main p'));
      const html=document.querySelector('main')!.innerHTML;
      const plan={id:'test',sectionOrder:inv.sections.map((s:any)=>s.id).reverse(),categoryOrder:[],itemOrders:Object.fromEntries(inv.sections.map((s:any)=>[s.id,[...s.itemIds].reverse()])),presentation:{reading:'larger',density:'focused'}};
      adapter.apply(plan);
      const changed=adapter.diagnostics().groups['page:sections'][0]===inv.sections[1].id;
      const enlarged=getComputedStyle(document.querySelector('li p')!).fontSize==='18.9px';
      const disclosure=document.querySelector<HTMLButtonElement>('[data-cloak-disclosure] button')!;
      const hidden=document.querySelectorAll('li[hidden]').length;
      disclosure.click();const revealed=document.querySelectorAll('li[hidden]').length===0;
      adapter.restore();
      return {changed,enlarged,hidden,revealed,exact:document.querySelector('main')!.innerHTML===html,identity:originals.every(n=>n.isConnected),steps:Array.from(document.querySelectorAll('ol li')).map(n=>n.textContent)};
    });
    assert.deepEqual(result,{changed:true,enlarged:true,hidden:2,revealed:true,exact:true,identity:true,steps:['First step','Second step']});
  } finally { await browser.close(); }
});
