import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App';
import { demoCatalog } from '../src/catalog';
import { createDemoHarness } from '../src/core/demo';
import { OperationManager } from '../src/core/operations';

test('DOM acceptance: author preview → confirmation → share; receiver one immutable addition', async () => {
 const dom = new JSDOM('<div id="root"></div>', { url: 'https://demo.example/' });
 const w = dom.window;
 for (const key of ['window','document','navigator','location','history','localStorage','HTMLElement','Event','MouseEvent','DOMException']) {
   Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?w:(w as any)[key]});
 }
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
 const locks={request:async<T>(_name:string,run:()=>T|Promise<T>)=>run()};
 Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});
 Object.defineProperty(globalThis,'addEventListener',{value:w.addEventListener.bind(w),configurable:true});
 Object.defineProperty(globalThis,'removeEventListener',{value:w.removeEventListener.bind(w),configurable:true});
 class ImageMock {onload:(()=>void)|null=null;onerror:(()=>void)|null=null;set src(_value:string){queueMicrotask(()=>this.onload?.())}}
 Object.defineProperty(globalThis,'Image',{value:ImageMock,configurable:true});
 const container=w.document.getElementById('root')!;
 let root=createRoot(container);
 const settle=async()=>{await act(async()=>{for(let i=0;i<30;i++)await Promise.resolve()})};
 const button=(name:string)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent?.includes(name))!;
 const click=async(el:HTMLElement)=>{assert.ok(el);await act(async()=>el.click());await settle()};
 await act(async()=>root.render(React.createElement(App)));await settle();
 assert.equal(w.document.querySelectorAll('input[type=radio]').length,3);
 assert.deepEqual([...w.document.querySelectorAll('input[type=radio]')].map(e=>(e as HTMLInputElement).value),['B01','B02','B03']);
 assert.equal(button('Сохранить мой вклад').disabled,true);
 await click(w.document.querySelector('input[value=B02]')!);assert.equal(button('Сохранить мой вклад').disabled,false);
 assert.equal(w.document.querySelector('.progress-label strong')?.textContent,'0 / 16');
 await click(button('Сохранить мой вклад'));assert.equal(w.document.querySelector('.progress-label strong')?.textContent,'1 / 16');
 assert.equal(w.document.querySelectorAll('input[type=radio]').length,0);
 await click(button('Получить ссылку'));const url=(w.document.getElementById('share-url') as HTMLInputElement).value;assert.ok(url.startsWith('https://demo.example/s/demo.'));
 assert.equal(container.textContent?.includes('друг получил'),false);
 await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(React.createElement(App)));await settle();assert.equal(w.document.querySelector('.progress-label strong')?.textContent,'1 / 16');
 await act(async()=>root.unmount());
 // A fixture author is separate from the product's browser profile. No UI identity switch.
 const fixture=createDemoHarness({storage:w.localStorage,origin:w.location.origin,catalog:demoCatalog}).forProfile('fixture-author');
 const manager=new OperationManager(fixture,w.localStorage,{namespace:'fixture-author',locks});
 const r=await manager.submit({kind:'create_root',body:{base_id:'B01',campaign_slug:'peredai',catalog_version:demoCatalog.version}});assert.equal(r.kind,'contribution');if(r.kind!=='contribution')throw Error();
 const s=await manager.submit({kind:'create_share',creature_id:r.value.creature.id,body:{}});if(s.kind!=='share')throw Error();
 w.history.replaceState({},'',s.value.url);root=createRoot(container);await act(async()=>root.render(React.createElement(App)));await settle();
 assert.deepEqual([...w.document.querySelectorAll('input[type=radio]')].map(e=>(e as HTMLInputElement).value),['02A','02B','02C']);
 await click(w.document.querySelector('input[value="02C"]')!);assert.equal(w.document.querySelector('.progress-label strong')?.textContent,'1 / 16');
 await click(button('Сохранить мой вклад'));assert.equal(w.document.querySelector('.progress-label strong')?.textContent,'2 / 16');assert.equal(w.document.querySelectorAll('input[type=radio]').length,0);
 assert.equal((await fixture.getCreature(r.value.creature.id)).step,1);
 await act(async()=>root.unmount());w.history.replaceState({},'',s.value.url);root=createRoot(container);await act(async()=>root.render(React.createElement(App)));await settle();
 assert.ok(container.textContent?.includes('Вы уже добавили деталь'));assert.equal(w.document.querySelectorAll('input[type=radio]').length,0);
 await act(async()=>root.unmount());w.close();
});
