import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoHarness } from '../src/core/demo';
import { OperationManager } from '../src/core/operations';
import { createRestApi, parsePreview, parseShare } from '../src/core/api';
import { demoCatalog } from '../src/catalog';
import { CoreError } from '../src/core/types';
import type { LockProvider, OperationResult, PeredaiApi, StorageLike } from '../src/core/types';

class Memory implements StorageLike { data = new Map<string,string>(); getItem(k:string){return this.data.get(k)??null} setItem(k:string,v:string){this.data.set(k,v)} removeItem(k:string){this.data.delete(k)} }
class Locks implements LockProvider {
  queues = new Map<string,Promise<unknown>>();
  request<T>(name:string,run:()=>T|Promise<T>):Promise<T> { const next=(this.queues.get(name)??Promise.resolve()).catch(()=>{}).then(run);this.queues.set(name,next);return next; }
}
function setup(){const storage=new Memory(),locks=new Locks(), harness=createDemoHarness({storage,origin:'https://demo.example',catalog:demoCatalog});
  const actor=(id:string)=>{const api=harness.forProfile(id);return {api,manager:new OperationManager(api,storage,{namespace:id,locks})}}; return {storage,locks,actor}; }
function creature(r:OperationResult){assert.equal(r.kind,'contribution');if(r.kind!=='contribution')throw Error();return r.value.creature}
function share(r:OperationResult){assert.equal(r.kind,'share');if(r.kind!=='share')throw Error();return r.value}
const rootBody={campaign_slug:'peredai',catalog_version:demoCatalog.version,base_id:'B01' as const};

test('author confirms exactly one base; own share refuses next contribution',async()=>{
 const {actor}=setup(),a=actor('author');const c=creature(await a.manager.submit({kind:'create_root',body:rootBody}));assert.equal(c.step,1);assert.deepEqual(c.appearance.choices,[]);
 const s=share(await a.manager.submit({kind:'create_share',creature_id:c.id,body:{}}));assert.equal(new URL(s.url).pathname,`/s/${s.token}`);
 assert.equal((await a.api.getShare(s.token)).viewer.state,'self');
 await assert.rejects(a.manager.submit({kind:'create_offspring',token:s.token,body:{choice_id:'02A',expected_source_revision_id:c.revision_id}}),{code:'SELF_CONTRIBUTION'});
 assert.equal((await a.api.getMine()).items.length,1);
});
test('two receivers create independent children; source immutable; repeat returns existing',async()=>{
 const {actor}=setup(),a=actor('a'),b=actor('b'),d=actor('d'); const c=creature(await a.manager.submit({kind:'create_root',body:rootBody}));
 const s=share(await a.manager.submit({kind:'create_share',creature_id:c.id,body:{}}));
 const input=(choice_id:string)=>({kind:'create_offspring' as const,token:s.token,body:{choice_id,expected_source_revision_id:c.revision_id}});
 const b1=creature(await b.manager.submit(input('02A'))),d1=creature(await d.manager.submit(input('02C')));
 assert.notEqual(b1.id,d1.id);assert.equal(b1.step,2);assert.deepEqual(b1.appearance.choices,[{step:2,choice_id:'02A'}]);
 assert.deepEqual(await a.api.getCreature(c.id),c);await b.manager.clearResolved();const repeat=creature(await b.manager.submit(input('02B')));assert.equal(repeat.id,b1.id);
 const tree=await a.api.getFamily({kind:'creature',id:c.id},{limit:1});assert.equal(tree.items.length,1);assert.ok(tree.next_cursor);
 const next=await a.api.getFamily({kind:'creature',id:c.id},{cursor:tree.next_cursor,limit:1});assert.equal(next.items.length,1);assert.notEqual(tree.items[0].creature.id,next.items[0].creature.id);
 assert.equal(JSON.stringify(tree).includes('owner_id'),false);
});
test('unknown outcome after commit replays exact key and body after manager reload',async()=>{
 const {storage,locks,actor}=setup(),a=actor('a');let first=true;const sent:string[]=[];
 const api:PeredaiApi={...a.api,execute:async(c,s)=>{sent.push(JSON.stringify([c.key,c.body_json,c.target]));const r=await a.api.execute(c,s);if(first){first=false;throw Error('lost response')}return r}};
 const manager=new OperationManager(api,storage,{namespace:'uncertain',locks});await assert.rejects(manager.submit({kind:'create_root',body:rootBody}));assert.equal(manager.readPending()?.status,'unknown');
 const resumed=new OperationManager(api,storage,{namespace:'uncertain',locks});const c=creature(await resumed.resume());assert.equal(c.step,1);assert.equal(sent[0],sent[1]);assert.equal((await a.api.getMine()).items.length,1);
});
test('lost profile while pending never bootstraps or executes under new profile',async()=>{
 const {storage,locks,actor}=setup(),a=actor('a');let bootstrap=0,execute=0;let fail=false;
 const api:PeredaiApi={...a.api,bootstrapSession:async()=>{bootstrap++;await a.api.bootstrapSession()},getSession:async()=>{if(fail)throw new CoreError('SESSION_REQUIRED','lost',401);return a.api.getSession()},execute:async()=>{execute++;throw Error('timeout')}};
 const m=new OperationManager(api,storage,{namespace:'pending',locks});await assert.rejects(m.submit({kind:'create_root',body:rootBody}));assert.equal(bootstrap,1);fail=true;
 await assert.rejects(m.resume(),{code:'PENDING_ACCESS_LOST'});assert.equal(m.readPending()?.status,'access_lost');await assert.rejects(m.ensureSession());assert.equal(bootstrap,1);assert.equal(execute,1);
});
test('changing profile after unknown outcome blocks replay',async()=>{
 const {storage,locks,actor}=setup(),a=actor('a');let changed=false,executions=0;
 const api:PeredaiApi={...a.api,getSession:async()=>{const s=await a.api.getSession();return changed?{...s,profile_id:'other'}:s},execute:async()=>{executions++;throw Error('timeout')}};
 const m=new OperationManager(api,storage,{locks});await assert.rejects(m.submit({kind:'create_root',body:rootBody}));changed=true;await assert.rejects(m.resume(),{code:'PROFILE_CHANGED'});assert.equal(executions,1);
});
test('double click and two concurrent managers keep one command',async()=>{
 const {storage,locks,actor}=setup(),a=actor('a');const m2=new OperationManager(a.api,storage,{namespace:'a',locks});
 const result=await Promise.all([a.manager.submit({kind:'create_root',body:rootBody}),m2.submit({kind:'create_root',body:rootBody})]);assert.equal(creature(result[0]).id,creature(result[1]).id);assert.equal((await a.api.getMine()).items.length,1);
});
test('all 16 steps preserve prefix; step 17 is refused; ancestor rule stays unresolved',async()=>{
 const {actor}=setup(),author=actor('author');let c=creature(await author.manager.submit({kind:'create_root',body:rootBody}));let previous=author;
 for(let step=2;step<=16;step++){const s=share(await previous.manager.submit({kind:'create_share',creature_id:c.id,body:{}}));const receiver=actor(`p${step}`);const child=creature(await receiver.manager.submit({kind:'create_offspring',token:s.token,body:{choice_id:`${String(step).padStart(2,'0')}A`,expected_source_revision_id:c.revision_id}}));assert.deepEqual(child.appearance.choices.slice(0,-1),c.appearance.choices);assert.equal(child.step,step);c=child;previous=receiver;
 if(step===3){const third=share(await receiver.manager.submit({kind:'create_share',creature_id:c.id,body:{}}));assert.equal((await author.api.getShare(third.token)).viewer.state,'unresolved');}}
 assert.equal(c.is_complete,true);const final=share(await previous.manager.submit({kind:'create_share',creature_id:c.id,body:{}}));const last=actor('last');await last.manager.ensureSession();const preview=await last.api.getShare(final.token);assert.equal(preview.viewer.state,'complete');assert.equal(preview.next_step,null);assert.deepEqual(preview.options,[]);
 await assert.rejects(last.manager.submit({kind:'create_offspring',token:final.token,body:{choice_id:'17A',expected_source_revision_id:c.revision_id}}),{code:'CHAIN_COMPLETE'});
});
test('public demo token works in separate storage without leaking owner profile',async()=>{
 const {actor}=setup(),a=actor('a');const c=creature(await a.manager.submit({kind:'create_root',body:rootBody}));const s=share(await a.manager.submit({kind:'create_share',creature_id:c.id,body:{}}));const foreign=setup().actor('visitor');await foreign.manager.ensureSession();const p=await foreign.api.getShare(s.token);assert.equal(p.viewer.state,'choose');assert.deepEqual(p.creature,c);assert.equal(s.token.includes((await a.api.getSession()).profile_id),false);
});
test('mine is scoped to browser profile and paginated',async()=>{
 const {actor}=setup(),a=actor('a'),b=actor('b');for(let i=0;i<3;i++){await a.manager.clearResolved();await a.manager.submit({kind:'create_root',body:rootBody})}await b.manager.ensureSession();assert.equal((await b.api.getMine()).items.length,0);const p=await a.api.getMine({limit:2});assert.equal(p.items.length,2);assert.ok(p.next_cursor);assert.equal((await a.api.getMine({limit:2,cursor:p.next_cursor})).items.length,1);
});
test('unsupported lock/storage block before any business command',async()=>{
 const {actor,storage}=setup(),a=actor('a');const m=new OperationManager(a.api,storage,{locks:null});await assert.rejects(m.submit({kind:'create_root',body:rootBody}),{code:'SESSION_COORDINATION_UNSUPPORTED'});assert.equal(storage.data.size,0);
});
test('REST sends credentials, CSRF and exact idempotency body; no demo fallback',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];const api=createRestApi({fetch:async(input,init)=>{calls.push({url:String(input),init:init!});return new Response(JSON.stringify({url:'https://app.example/s/opaque',token:'opaque',source_revision_id:'r1'}),{status:201})}});
 const body='{ }';await api.execute({version:1,mode:'live',key:'exact-key',profile_id:'p1',kind:'create_share',target:'c1',body_json:body,created_at:'2026-09-22',status:'sending'},{profile_id:'p1',csrf_token:'csrf'});
 assert.equal(calls[0].url,'/api/v1/creatures/c1/shares');assert.equal(calls[0].init.body,body);assert.equal(calls[0].init.credentials,'same-origin');assert.deepEqual(calls[0].init.headers,{'Accept':'application/json','Content-Type':'application/json','X-CSRF-Token':'csrf','Idempotency-Key':'exact-key'});
 await assert.rejects(api.getShare('demo.fake'),{code:'DEMO_TOKEN_NOT_LIVE'});assert.equal(calls.length,1);assert.throws(()=>parseShare({url:'javascript:alert(1)',token:'x',source_revision_id:'r'}));assert.throws(()=>parsePreview({}));
});
