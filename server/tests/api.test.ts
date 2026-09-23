import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import catalog from '../demo-catalog.json' with {type:'json'};
import type { SqlPool } from '../db.js';
import type { ServerConfig } from '../config.js';
import { PeredaiService } from '../service.js';
import { createPeredaiServer } from '../http.js';
import { createStaticHandler } from '../static.js';
import { readConfig } from '../config.js';

function request(base:string,session:{cookie:string;csrf:string}|null=null) {
  return async (method:string,path:string,body?:unknown,key?:string) => {
    const response=await fetch(base+path,{method,
      headers:{...(method==='POST'?{'Origin':base,'Content-Type':'application/json'}:{}),
        ...(session?{'Cookie':session.cookie,'X-CSRF-Token':session.csrf}:{}),
        ...(key?{'Idempotency-Key':key}:{})},
      ...(method==='POST'?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json() as any,cookie:response.headers.get('set-cookie')};
  };
}
async function setup(overrides:Partial<ServerConfig>={},staticHandler?:Awaited<ReturnType<typeof createStaticHandler>>) {
  const db=new PGlite();
  await db.exec(await readFile(new URL('../migrations/001_init.sql',import.meta.url),'utf8'));
  const pool:SqlPool={query:(sql,params)=>db.query(sql,params) as any,
    connect:async()=>({query:(sql,params)=>db.query(sql,params) as any,release(){}})};
  const campaignId=randomUUID();
  await db.query('INSERT INTO catalog_version(version,manifest,published) VALUES($1,$2::jsonb,true)',
    [catalog.version,JSON.stringify(catalog)]);
  await db.query(`INSERT INTO campaign(id,slug,brand,offer,cta_target,active_catalog_version,
    accepts_contributions,max_creatures) VALUES($1,'peredai','Test brand','Test offer',NULL,$2,true,20)`,
    [campaignId,catalog.version]);
  const config:ServerConfig={origin:'http://127.0.0.1',campaignSlug:'peredai',
    cookieName:'peredai_sid',sessionTtlSeconds:86400,maxBodyBytes:16384,pageLimit:10,
    rateWindowSeconds:60,sessionRateLimit:10,writeRateLimit:120,
    rateLimitMode:'socket',trustedProxyAddresses:[],
    cursorSecret:'cursor-test-secret',csrfSecret:'csrf-test-secret',...overrides};
  const server=createPeredaiServer(new PeredaiService(pool,config),config,staticHandler);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  assert(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  config.origin=base;
  const guest=request(base);
  async function person() {
    const started=await guest('POST','/api/v1/session',{});
    assert.equal(started.status,200);
    const cookie=started.cookie!.split(';')[0];
    const auth=await request(base,{cookie,csrf:''})('GET','/api/v1/session');
    assert.equal(auth.status,200);
    return {client:request(base,{cookie,csrf:auth.body.csrf_token}),cookie,profile:auth.body.profile_id};
  }
  return {db,server,config,guest,person,base,close:async()=>{
    await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();
  }};
}
test('HTTP contract, immutable branches, receipts, scopes, events and unfinished artwork',async()=>{
  const app=await setup();
  try {
    const owner=await app.person(),second=await app.person(),third=await app.person();
    const initial=await app.db.query('SELECT count(*)::integer AS total FROM creature');
    assert.equal(initial.rows[0].total,0);
    assert.equal((await app.guest('GET','/api/v1/campaigns/peredai')).body.contributions_available,true);
    assert.equal((await app.guest('GET','/api/v1/catalogs/demo-artwork-v1')).body.steps.length,3);
    const malformed=await app.guest('GET','/api/v1/campaigns/%GG');
    assert.equal(malformed.status,422);
    assert.equal(malformed.body.error.code,'INVALID_REQUEST');
    assert.equal((await app.guest('GET','/api/v1/session')).status,401);
    const rootBody={campaign_slug:'peredai',catalog_version:catalog.version,base_id:'B01'};
    const rootKey=randomUUID();
    const root=await owner.client('POST','/api/v1/creatures',rootBody,rootKey);
    assert.equal(root.status,201,JSON.stringify(root.body));
    assert.deepEqual(root.body.creature.appearance,{base_id:'B01',choices:[]});
    const rootId=root.body.creature.id;
    assert.deepEqual((await owner.client('POST','/api/v1/creatures',rootBody,rootKey)).body,root.body);
    assert.equal((await owner.client('POST','/api/v1/creatures',{...rootBody,base_id:'B02'},rootKey)).body.error.code,'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await app.guest('GET',`/api/v1/creatures/${rootId}`)).status,401);
    assert.equal((await second.client('GET',`/api/v1/creatures/${rootId}`)).status,404);
    assert.equal((await owner.client('POST',`/api/v1/creatures/${rootId}/shares`,{},randomUUID())).status,201);
    const link=await owner.client('POST',`/api/v1/creatures/${rootId}/shares`,{},randomUUID());
    assert.equal(link.status,200);
    const token=link.body.token;
    const preview=await app.guest('GET',`/api/v1/shares/${token}`);
    assert.equal(preview.body.viewer.state,'needs_session');
    assert.equal(preview.body.options.length,3);
    assert.equal((await owner.client('GET',`/api/v1/shares/${token}`)).body.viewer.state,'self');
    assert.equal((await owner.client('POST',`/api/v1/shares/${token}/offspring`,
      {expected_source_revision_id:root.body.creature.revision_id,choice_id:'02A'},randomUUID())).body.error.code,
      'SELF_CONTRIBUTION');
    const addition={expected_source_revision_id:root.body.creature.revision_id,choice_id:'02B'};
    const childKey=randomUUID();
    const child=await second.client('POST',`/api/v1/shares/${token}/offspring`,addition,childKey);
    assert.equal(child.status,201,JSON.stringify(child.body));
    assert.equal(child.body.creature.step,2);
    assert.deepEqual(child.body.creature.appearance.choices,[{step:2,choice_id:'02B'}]);
    assert.deepEqual((await second.client('POST',`/api/v1/shares/${token}/offspring`,addition,childKey)).body,child.body);
    assert.equal((await second.client('POST',`/api/v1/shares/${token}/offspring`,
      {...addition,expected_source_revision_id:randomUUID()},randomUUID())).body.error.code,'SOURCE_MISMATCH');
    assert.equal((await second.client('POST',`/api/v1/shares/${token}/offspring`,
      {...addition,choice_id:'05C'},randomUUID())).body.error.code,'INVALID_CHOICE');
    const existing=await second.client('POST',`/api/v1/shares/${token}/offspring`,
      {...addition,choice_id:'02C'},randomUUID());
    assert.equal(existing.status,200);
    assert.equal(existing.body.existing,true);
    assert.equal(existing.body.creature.id,child.body.creature.id);
    assert.equal(existing.body.creature.appearance.choices[0].choice_id,'02B');
    assert.equal((await second.client('GET',`/api/v1/shares/${token}`)).body.viewer.existing_creature_id,child.body.creature.id);
    const sibling=await third.client('POST',`/api/v1/shares/${token}/offspring`,
      {...addition,choice_id:'02A'},randomUUID());
    assert.equal(sibling.status,201);
    assert.notEqual(sibling.body.creature.id,child.body.creature.id);
    const family=await app.guest('GET',`/api/v1/shares/${token}/family?limit=1`);
    assert.equal(family.body.items.length,1);
    assert.ok(family.body.next_cursor);
    const family2=await app.guest('GET',`/api/v1/shares/${token}/family?limit=1&cursor=${family.body.next_cursor}`);
    assert.equal(family2.body.items.length,1);
    assert.notEqual(family2.body.items[0].creature.id,family.body.items[0].creature.id);
    const childShare=await second.client('POST',`/api/v1/creatures/${child.body.creature.id}/shares`,{},randomUUID());
    assert.equal((await app.guest('GET',`/api/v1/shares/${childShare.body.token}/family?parent_id=${sibling.body.creature.id}`)).status,404);
    assert.equal((await app.guest('GET',`/api/v1/shares/${childShare.body.token}/family?cursor=${family.body.next_cursor}`)).status,422);
    assert.equal((await owner.client('GET',`/api/v1/shares/${childShare.body.token}`)).body.viewer.reason,'D01');
    assert.equal((await owner.client('POST',`/api/v1/shares/${childShare.body.token}/offspring`,
      {expected_source_revision_id:child.body.creature.revision_id,choice_id:'03A'},randomUUID())).body.error.code,
      'ANCESTOR_POLICY_UNRESOLVED');
    const ev={event_id:randomUUID(),kind:'cta_click_reported',share_token:token};
    assert.equal((await second.client('POST','/api/v1/events',ev)).status,202);
    assert.equal((await second.client('POST','/api/v1/events',ev)).status,200);
    assert.equal((await second.client('POST','/api/v1/events',{...ev,share_token:childShare.body.token})).status,409);
    assert.equal((await third.client('POST','/api/v1/events',ev)).status,202);
    const mine=await second.client('GET','/api/v1/me/creatures?limit=1');
    assert.equal(mine.body.items.length,1);
    assert.equal(mine.body.items[0].id,child.body.creature.id);
    assert.equal((await app.db.query('SELECT count(*)::integer AS total FROM creature')).rows[0].total,3);
    assert.equal((await app.db.query('SELECT count(*)::integer AS total FROM creature_revision')).rows[0].total,3);
    assert.equal((await app.db.query('SELECT count(*)::integer AS total FROM share_link')).rows[0].total,2);
  } finally {await app.close();}
});

test('one HTTP port serves SPA, immutable assets and JSON API without exposing files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'peredai-one-app-'));
  const outside=await mkdtemp(join(tmpdir(),'peredai-private-'));
  await mkdir(join(root,'assets','demo-artwork-v1'),{recursive:true});
  await writeFile(join(root,'index.html'),'<html>SPA</html>');
  await writeFile(join(root,'assets','index-Abcdef12.js'),'window.app=true');
  await writeFile(join(root,'assets','demo-artwork-v1','B01.png'),Buffer.from([137,80,78,71]));
  await writeFile(join(outside,'secret.js'),'do not expose');
  await symlink(join(outside,'secret.js'),join(root,'assets','secret.js'));
  const app=await setup({},await createStaticHandler(root));
  try {
    for(const path of ['/','/mine',`/c/${randomUUID()}`,'/s/test_token-123']) {
      const result=await fetch(app.base+path);
      assert.equal(result.status,200,path);
      assert.equal(result.headers.get('content-type'),'text/html; charset=utf-8');
      assert.equal(result.headers.get('cache-control'),'no-store');
      assert.equal(result.headers.get('referrer-policy'),'no-referrer');
      assert.equal(await result.text(),'<html>SPA</html>');
    }
    const js=await fetch(app.base+'/assets/index-Abcdef12.js');
    assert.equal(js.status,200);
    assert.equal(js.headers.get('content-type'),'text/javascript; charset=utf-8');
    assert.match(js.headers.get('cache-control')??'',/immutable/);
    assert.equal(await js.text(),'window.app=true');
    const head=await fetch(app.base+'/assets/demo-artwork-v1/B01.png',{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(head.headers.get('content-type'),'image/png');
    assert.equal(head.headers.get('content-length'),'4');
    assert.equal(await head.text(),'');
    assert.equal((await app.guest('GET','/api/v1/health')).body.status,'ok');
    const unknown=await app.guest('GET','/api/v1/no-route');
    assert.equal(unknown.status,404);
    assert.equal(unknown.body.error.code,'NOT_FOUND');
    const unknownPost=await app.guest('POST','/api/v1/no-route',{});
    assert.equal(unknownPost.status,404);
    assert.equal(unknownPost.body.error.code,'NOT_FOUND');
    const person=await app.person();
    assert.equal((await person.client('POST','/api/v1/creatures',
      {campaign_slug:'peredai',catalog_version:catalog.version,base_id:'B01'},randomUUID())).status,201);
    for(const path of ['/assets/no.png','/assets/secret.js','/server/production.ts',
      '/assets/%2e%2e/secret.js','/assets/%252e%252e/secret.js','/c/%2Fhidden']) {
      const result=await new Promise<{status:number;body:string}>(resolve=>{
        httpRequest(app.base,{path},response=>{
          let body='';response.on('data',chunk=>body+=chunk);
          response.on('end',()=>resolve({status:response.statusCode??0,body}));
        }).end();
      });
      assert.equal(result.status,404,path);
      assert.ok(!result.body.includes('SPA')&&!result.body.includes('do not expose'),path);
    }
    assert.equal((await fetch(app.base+'/mine',{method:'POST'})).status,405);
  } finally {await app.close();await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('trusted proxy separates visitors sharing one socket and rejects untrusted headers',async()=>{
  const app=await setup({rateLimitMode:'trusted-proxy',trustedProxyAddresses:['127.0.0.1'],sessionRateLimit:1});
  async function bootstrap(header?:string) {
    return fetch(app.base+'/api/v1/session',{method:'POST',headers:{Origin:app.base,'Content-Type':'application/json',
      ...(header===undefined?{}:{'X-Forwarded-For':header})},body:'{}'});
  }
  try {
    assert.equal((await bootstrap('198.51.100.7')).status,200);
    const throttled=await bootstrap('198.51.100.7');
    assert.equal(throttled.status,429);
    assert.ok(Number(throttled.headers.get('retry-after'))>=1);
    assert.equal((await bootstrap('203.0.113.19')).status,200);
    assert.equal((await bootstrap('198.51.100.7, 203.0.113.19')).status,422);
    assert.equal((await bootstrap()).status,422);
    assert.equal((await app.db.query('SELECT count(*)::integer AS total FROM anonymous_profile')).rows[0].total,2);
  } finally {await app.close();}
  const direct=await setup({rateLimitMode:'trusted-proxy',trustedProxyAddresses:['192.0.2.1']});
  try {
    const res=await fetch(direct.base+'/api/v1/session',{method:'POST',headers:{Origin:direct.base,
      'Content-Type':'application/json','X-Forwarded-For':'198.51.100.7'},body:'{}'});
    assert.equal(res.status,403);
    assert.equal((await fetch(direct.base+'/api/v1/health')).status,403);
  } finally {await direct.close();}
});

test('HTTPS origin keeps host-only secure cookie and refuses cross-origin POST',async()=>{
  const app=await setup();
  app.config.origin='https://staging.example';
  app.config.cookieName='__Host-peredai_sid';
  try {
    const started=await fetch(app.base+'/api/v1/session',{method:'POST',headers:{Origin:app.config.origin,
      'Content-Type':'application/json'},body:'{}'});
    assert.equal(started.status,200);
    const setCookie=started.headers.get('set-cookie')??'';
    assert.match(setCookie,/^__Host-peredai_sid=/);
    assert.match(setCookie,/; Secure/);
    assert.match(setCookie,/; HttpOnly/);
    assert.match(setCookie,/; Path=\//);
    assert.ok(!/; Domain=/i.test(setCookie));
    const wrong=await fetch(app.base+'/api/v1/session',{method:'POST',headers:{Origin:'https://other.example',
      'Content-Type':'application/json'},body:'{}'});
    assert.equal(wrong.status,403);
    assert.equal((await app.db.query('SELECT count(*)::integer AS total FROM anonymous_profile')).rows[0].total,1);
  } finally {await app.close();}
});

test('static handler rejects a missing production build before binding a port',async()=>{
  await assert.rejects(()=>createStaticHandler(join(tmpdir(),'nonexistent-peredai-dist')));
});

test('HTTPS configuration requires a verified edge limit and consistent port',()=>{
  const env={DATABASE_URL:'postgresql://app@localhost/db',PEREDAI_PUBLIC_ORIGIN:'https://stage.example',
    PEREDAI_CURSOR_SECRET:'c'.repeat(32),PEREDAI_CSRF_SECRET:'s'.repeat(32),
    PEREDAI_SESSION_TTL_SECONDS:'900',PEREDAI_MAX_BODY_BYTES:'16384',PEREDAI_PAGE_LIMIT:'20',
    PEREDAI_RATE_WINDOW_SECONDS:'60',PEREDAI_SESSION_RATE_LIMIT:'10',PEREDAI_WRITE_RATE_LIMIT:'120',
    PEREDAI_SHUTDOWN_GRACE_SECONDS:'10'};
  assert.throws(()=>readConfig(env),/PEREDAI_RATE_LIMIT_MODE/);
  const configured=readConfig({...env,PEREDAI_RATE_LIMIT_MODE:'ingress',PORT:'9090'});
  assert.equal(configured.port,9090);
  assert.equal(configured.bindHost,'0.0.0.0');
  assert.equal(configured.cookieName,'__Host-peredai_sid');
  assert.throws(()=>readConfig({...env,PEREDAI_RATE_LIMIT_MODE:'trusted-proxy'}),/TRUSTED_PROXY/);
  assert.throws(()=>readConfig({...env,PEREDAI_RATE_LIMIT_MODE:'ingress',PEREDAI_PORT:'8787',PORT:'9090'}),/must match/);
});

test('bootstrap throttling rejects excess requests without creating profiles',async()=>{
  const app=await setup({sessionRateLimit:3});
  try {
    for(let i=0;i<3;i++) assert.equal((await app.guest('POST','/api/v1/session',{})).status,200);
    const extra=await app.guest('POST','/api/v1/session',{});
    assert.equal(extra.status,429);
    assert.equal(extra.body.error.code,'RATE_LIMITED');
    const count=await app.db.query('SELECT count(*)::integer AS total FROM anonymous_profile');
    assert.equal(count.rows[0].total,3);
  } finally {await app.close();}
});

test('write throttling rejects new commands without changing creature count',async()=>{
  const app=await setup({writeRateLimit:1});
  try {
    const actor=await app.person();
    const body={campaign_slug:'peredai',catalog_version:catalog.version,base_id:'B01'};
    assert.equal((await actor.client('POST','/api/v1/creatures',body,randomUUID())).status,201);
    const blocked=await actor.client('POST','/api/v1/creatures',body,randomUUID());
    assert.equal(blocked.status,429);
    assert.equal(blocked.body.error.code,'RATE_LIMITED');
    const count=await app.db.query('SELECT count(*)::integer AS total FROM creature');
    assert.equal(count.rows[0].total,1);
  } finally {await app.close();}
});

test('database rejects invalid snapshot; quota and CSRF stop effects',async()=>{
  const app=await setup();
  try {
    const person=await app.person();
    const rootBody={campaign_slug:'peredai',catalog_version:catalog.version,base_id:'B02'};
    const invalid=await app.guest('POST','/api/v1/creatures',rootBody,randomUUID());
    assert.equal(invalid.status,401);
    const wrongOrigin=await fetch(app.base+'/api/v1/creatures',{method:'POST',
      headers:{'Origin':'https://another.example','Content-Type':'application/json',
        'Cookie':person.cookie,'Idempotency-Key':randomUUID(),'X-CSRF-Token':'wrong'},
      body:JSON.stringify(rootBody)});
    assert.equal(wrongOrigin.status,403);
    await app.db.query(`UPDATE campaign SET max_creatures=1 WHERE slug='peredai'`);
    const one=await person.client('POST','/api/v1/creatures',rootBody,randomUUID());
    assert.equal(one.status,201);
    assert.equal((await person.client('POST','/api/v1/creatures',rootBody,randomUUID())).body.error.code,'CAMPAIGN_LIMIT');
    await assert.rejects(()=>app.db.query('UPDATE creature SET owner_profile_id=$1 WHERE id=$2',
      [randomUUID(),one.body.creature.id]),/immutable business record/);
    await app.db.query('SET ROLE peredai_runtime');
    try {
      await assert.rejects(()=>app.db.query('UPDATE catalog_version SET manifest=$1::jsonb WHERE version=$2',
        [JSON.stringify(catalog),catalog.version]),/permission denied|immutable business record/);
      await assert.rejects(()=>app.db.query('UPDATE campaign SET max_creatures=2 WHERE slug=$1',['peredai']),
        /runtime cannot change campaign configuration/);
      await assert.rejects(()=>app.db.query(`INSERT INTO creature(id,campaign_id,owner_profile_id,revision_id)
        SELECT $1,id,$2,$3 FROM campaign WHERE slug='peredai'`,
        [randomUUID(),person.profile,randomUUID()]),/campaign quota exceeded/);
    } finally { await app.db.query('RESET ROLE'); }
    assert.equal((await app.db.query('SELECT count(*)::integer AS total FROM operation_receipt')).rows[0].total,1);
  } finally {await app.close();}
});
