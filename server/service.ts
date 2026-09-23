import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ServerConfig } from './config.js';
import { one, transaction } from './db.js';
import type { SqlClient, SqlPool } from './db.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}
export interface Reply { status: number; body: unknown }
type Json = Record<string, unknown>;
type Session = { profile_id: string; csrf_token: string };
type Actor = Session & { secret: string };
type Campaign = { id: string; slug: string; brand: string; offer: string; cta_target: string | null;
  active_catalog_version: string; accepts_contributions: boolean; max_creatures: string | number };
type Node = { id: string; campaign_id: string; campaign_slug: string; owner_profile_id: string;
  origin_share_id: string | null; revision_id: string; catalog_version: string;
  appearance: { base_id: string; choices: Array<{ step: number; choice_id: string }> }; created_at: Date | string };
type Source = { share_id: string; token: string; node: Node; campaign: Campaign; manifest: Json };
const miss = () => new ApiError(404, 'NOT_FOUND');
const invalid = () => new ApiError(422, 'INVALID_REQUEST');

function strict(body: unknown, keys: string[]): Json {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).length !== keys.length || keys.some(k => !Object.hasOwn(body, k))) throw invalid();
  return body as Json;
}
function safeText(value: unknown, max = 120): string {
  if (typeof value !== 'string' || !value || value.length > max) throw invalid();
  return value;
}
function uuid(value: unknown): string {
  const text = safeText(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text))
    throw invalid();
  return text.toLowerCase();
}
function view(n: Node) {
  const step = n.appearance.choices.length + 1;
  return { id: n.id, campaign_slug: n.campaign_slug, revision_id: n.revision_id,
    step, total_steps: 16, catalog_version: n.catalog_version, appearance: n.appearance, is_complete: step === 16 };
}
function fingerprint(value: string) { return createHash('sha256').update(value).digest(); }
function matchMac(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class PeredaiService {
  constructor(readonly db: SqlPool, readonly config: ServerConfig) {}

  private async getNode(client: Pick<SqlPool, 'query'>, id: string): Promise<Node | null> {
    return one<Node>(client, `SELECT n.id,n.campaign_id,c.slug AS campaign_slug,n.owner_profile_id,
      n.origin_share_id,n.revision_id,r.catalog_version,r.appearance,n.created_at
      FROM creature n JOIN creature_revision r ON r.id=n.revision_id
      JOIN campaign c ON c.id=n.campaign_id WHERE n.id=$1`, [id]);
  }
  private async source(token: string): Promise<Source> {
    if (!/^[A-Za-z0-9_-]{32,80}$/.test(token)) throw miss();
    const result = await one<{ share_id: string; node_id: string; manifest: Json }>(this.db,
      `SELECT s.id AS share_id,n.id AS node_id,v.manifest
       FROM share_link s JOIN creature_revision r ON r.id=s.source_revision_id
       JOIN creature n ON n.id=r.creature_id JOIN catalog_version v ON v.version=r.catalog_version
       WHERE s.public_token=$1`, [token]);
    if (!result) throw miss();
    const node = await this.getNode(this.db, result.node_id);
    if (!node) throw miss();
    const campaign = await one<Campaign>(this.db, 'SELECT * FROM campaign WHERE id=$1', [node.campaign_id]);
    if (!campaign) throw miss();
    return { share_id: result.share_id, token, node, campaign, manifest: result.manifest };
  }
  private async own(profile: string, id: string): Promise<Node> {
    const n = await this.getNode(this.db, uuid(id));
    if (!n || n.owner_profile_id !== profile) throw miss();
    return n;
  }
  private async ancestorOwned(node: Node, profile: string): Promise<boolean> {
    let current = node;
    for (let i = 0; current.origin_share_id && i < 15; i++) {
      const row = await one<{ parent_id: string; owner_profile_id: string }>(this.db,
        `SELECT n.id AS parent_id,n.owner_profile_id
         FROM share_link s JOIN creature_revision r ON r.id=s.source_revision_id
         JOIN creature n ON n.id=r.creature_id WHERE s.id=$1`, [current.origin_share_id]);
      if (!row) throw miss();
      if (row.owner_profile_id === profile) return true;
      const parent = await this.getNode(this.db, row.parent_id);
      if (!parent) throw miss();
      current = parent;
    }
    return false;
  }
  async session(secret: string | null): Promise<Actor | null> {
    if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    const row = await one<{ id: string }>(this.db,
      'SELECT id FROM anonymous_profile WHERE session_secret_hash=$1 AND expires_at>now()',
      [fingerprint(secret)]);
    if (!row) return null;
    const csrf_token = createHmac('sha256', this.config.csrfSecret).update(secret).digest('base64url');
    return { profile_id: row.id, csrf_token, secret };
  }
  async bootstrap(secret: string | null): Promise<Actor> {
    const existing = await this.session(secret);
    if (existing) return existing;
    const fresh = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await this.db.query(`INSERT INTO anonymous_profile(id,session_secret_hash,expires_at)
      VALUES($1,$2,now()+($3::integer * interval '1 second'))`,
      [id, fingerprint(fresh), this.config.sessionTtlSeconds]);
    return (await this.session(fresh))!;
  }
  requireActor(actor: Actor | null, csrf: string | null): Actor {
    if (!actor) throw new ApiError(401, 'SESSION_REQUIRED');
    if (!csrf || !matchMac(csrf, actor.csrf_token)) throw new ApiError(403, 'CSRF_REJECTED');
    return actor;
  }
  async campaign(slug: string) {
    const c = await one<Campaign>(this.db, 'SELECT * FROM campaign WHERE slug=$1', [safeText(slug)]);
    if (!c) throw miss();
    return { slug:c.slug, brand:c.brand, offer:c.offer, cta_target:c.cta_target,
      active_catalog_version:c.active_catalog_version, accepts_contributions:c.accepts_contributions,
      contributions_available:c.accepts_contributions };
  }
  async catalog(version: string) {
    const row = await one<{ manifest: Json }>(this.db,
      'SELECT manifest FROM catalog_version WHERE version=$1 AND published', [safeText(version)]);
    if (!row) throw miss();
    return row.manifest;
  }
  private async receipt(profile: string, kind: string, key: string, target: Json, body: Json,
    client: Pick<SqlPool,'query'> = this.db): Promise<Reply | null> {
    const row = await one<{ http_status: number; response_body: unknown; matches: boolean }>(client,
      `SELECT http_status,response_body,
        (normalized_target=$4::jsonb AND normalized_body=$5::jsonb) AS matches
        FROM operation_receipt WHERE profile_id=$1 AND operation_type=$2 AND idempotency_key=$3`,
      [profile,kind,key,JSON.stringify(target),JSON.stringify(body)]);
    if (!row) return null;
    if (!row.matches) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED');
    return { status:row.http_status, body:row.response_body };
  }
  private async command(profile: string, kind: string, key: string, target: Json, body: Json,
    campaignId: string, work: (client: SqlClient) => Promise<Reply>): Promise<Reply> {
    const repeat = await this.receipt(profile,kind,key,target,body);
    if (repeat) return repeat;
    try {
      return await transaction(this.db, async client => {
        const campaign = await one<Campaign>(client, 'SELECT * FROM campaign WHERE id=$1 FOR UPDATE', [campaignId]);
        if (!campaign) throw miss();
        const replay = await this.receipt(profile,kind,key,target,body,client);
        if (replay) return replay;
        const result = await work(client);
        await client.query(`INSERT INTO operation_receipt
          (profile_id,operation_type,idempotency_key,normalized_target,normalized_body,http_status,response_body)
          VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb)`,
          [profile,kind,key,JSON.stringify(target),JSON.stringify(body),result.status,JSON.stringify(result.body)]);
        return result;
      });
    } catch (error) {
      // A concurrent transaction in another campaign may win the same key.
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        const completed = await this.receipt(profile,kind,key,target,body);
        if (completed) return completed;
      }
      throw error;
    }
  }
  async root(profile: string, key: string, raw: unknown): Promise<Reply> {
    const b = strict(raw,['campaign_slug','catalog_version','base_id']);
    const slug = safeText(b.campaign_slug), version = safeText(b.catalog_version);
    const base = safeText(b.base_id);
    if (!['B01','B02','B03'].includes(base)) throw new ApiError(422,'INVALID_CHOICE');
    const c = await one<Campaign>(this.db,'SELECT * FROM campaign WHERE slug=$1',[slug]);
    if (!c) throw miss();
    const body = {campaign_slug:slug,catalog_version:version,base_id:base};
    return this.command(profile,'create_root',key,{campaign_slug:slug},body,c.id,async client => {
      const fresh = await one<Campaign>(client,'SELECT * FROM campaign WHERE id=$1',[c.id]);
      if (!fresh) throw miss();
      if (!fresh.accepts_contributions) throw new ApiError(409,'CAMPAIGN_CLOSED');
      if (fresh.active_catalog_version !== version) throw new ApiError(409,'CATALOG_CHANGED');
      const manifest = await this.catalog(version);
      if (!(manifest.bases as Json[]).some(b => b.base_id===base)) throw new ApiError(422,'INVALID_CHOICE');
      await this.checkQuota(client,c.id,fresh.max_creatures);
      const id=randomUUID(), revision=randomUUID();
      await client.query(`INSERT INTO creature(id,campaign_id,owner_profile_id,revision_id)
        VALUES($1,$2,$3,$4)`,[id,c.id,profile,revision]);
      const appearance={base_id:base,choices:[]};
      await client.query(`INSERT INTO creature_revision(id,creature_id,catalog_version,appearance)
        VALUES($1,$2,$3,$4::jsonb)`,[revision,id,version,JSON.stringify(appearance)]);
      return {status:201,body:{creature:view((await this.getNode(client,id))!),existing:false}};
    });
  }
  private async checkQuota(client:SqlClient,campaignId:string,max:string|number) {
    const count=await one<{count:string}>(client,'SELECT count(*)::text AS count FROM creature WHERE campaign_id=$1',[campaignId]);
    if (BigInt(count?.count ?? '0') >= BigInt(max)) throw new ApiError(429,'CAMPAIGN_LIMIT');
  }
  async offspring(profile:string,key:string,token:string,raw:unknown):Promise<Reply> {
    const b=strict(raw,['expected_source_revision_id','choice_id']);
    const expected=uuid(b.expected_source_revision_id), choice=safeText(b.choice_id,3);
    const s=await this.source(token);
    const body={expected_source_revision_id:expected,choice_id:choice};
    return this.command(profile,'create_offspring',key,{share_token:token},body,s.node.campaign_id,async client=>{
      const current=await this.getNode(client,s.node.id);
      if (!current) throw miss();
      if (current.revision_id !== expected) throw new ApiError(409,'SOURCE_MISMATCH');
      const next=current.appearance.choices.length+2;
      if (next>16) throw new ApiError(409,'CHAIN_COMPLETE');
      const manifest=s.manifest;
      const options=((manifest.steps as Json[])??[]).find(st=>st.step===next)?.options as Json[]|undefined;
      const selected=options?.find(o=>o.choice_id===choice);
      if (!selected) throw new ApiError(422,'INVALID_CHOICE');
      const asset=(manifest.assets as Json)?.[String(selected.asset_id)];
      if (!asset) throw new ApiError(409,'ARTWORK_UNAVAILABLE');
      const prior=await one<{id:string}>(client,
        'SELECT id FROM creature WHERE origin_share_id=$1 AND owner_profile_id=$2',[s.share_id,profile]);
      if (prior) return {status:200,body:{creature:view((await this.getNode(client,prior.id))!),existing:true}};
      if (current.owner_profile_id===profile) throw new ApiError(409,'SELF_CONTRIBUTION');
      if (await this.ancestorOwned(current,profile)) throw new ApiError(409,'ANCESTOR_POLICY_UNRESOLVED');
      const fresh=await one<Campaign>(client,'SELECT * FROM campaign WHERE id=$1',[s.node.campaign_id]);
      if (!fresh?.accepts_contributions) throw new ApiError(409,'CAMPAIGN_CLOSED');
      await this.checkQuota(client,s.node.campaign_id,fresh.max_creatures);
      const id=randomUUID(),revision=randomUUID();
      const appearance={base_id:current.appearance.base_id,choices:[...current.appearance.choices,{step:next,choice_id:choice}]};
      await client.query(`INSERT INTO creature(id,campaign_id,owner_profile_id,origin_share_id,revision_id)
        VALUES($1,$2,$3,$4,$5)`,[id,current.campaign_id,profile,s.share_id,revision]);
      await client.query(`INSERT INTO creature_revision(id,creature_id,catalog_version,appearance)
        VALUES($1,$2,$3,$4::jsonb)`,[revision,id,current.catalog_version,JSON.stringify(appearance)]);
      return {status:201,body:{creature:view((await this.getNode(client,id))!),existing:false}};
    });
  }
  async createShare(profile:string,key:string,id:string,raw:unknown):Promise<Reply> {
    strict(raw,[]);
    const n=await this.own(profile,id);
    return this.command(profile,'create_share',key,{creature_id:n.id},{},n.campaign_id,async client=>{
      for (let attempt=0;attempt<4;attempt++) {
        const existing=await one<{public_token:string}>(client,
          'SELECT public_token FROM share_link WHERE source_revision_id=$1',[n.revision_id]);
        if (existing) return {status:200,body:this.shareView(existing.public_token,n.revision_id)};
        const token=randomBytes(32).toString('base64url');
        const inserted=await one<{public_token:string}>(client,
          `INSERT INTO share_link(id,public_token,source_revision_id) VALUES($1,$2,$3)
           ON CONFLICT DO NOTHING RETURNING public_token`,[randomUUID(),token,n.revision_id]);
        if (inserted) return {status:201,body:this.shareView(token,n.revision_id)};
      }
      throw new ApiError(503,'TEMPORARILY_UNAVAILABLE');
    });
  }
  private shareView(token:string,revision:string) {
    return {url:`${this.config.origin}/s/${token}`,token,source_revision_id:revision};
  }
  async creature(profile:string,id:string) { return view(await this.own(profile,id)); }
  async preview(token:string,profile:string|null) {
    const s=await this.source(token), n=s.node, c=s.campaign;
    const step=n.appearance.choices.length+1,next=step===16?null:step+1;
    const options=next?(((s.manifest.steps as Json[])??[]).find(st=>st.step===next)?.options as Json[]|undefined):undefined;
    const usable=options?.length===3 && options.every(opt=>(s.manifest.assets as Json)?.[String(opt.asset_id)]);
    let state='choose', existing_creature_id:null|string=null, reason:undefined|'D01';
    if (next===null) state='complete';
    else if (!usable) state='unavailable';
    else if (!profile) state='needs_session';
    else if (n.owner_profile_id===profile) state='self';
    else {
      const prior=await one<{id:string}>(this.db,
        'SELECT id FROM creature WHERE origin_share_id=$1 AND owner_profile_id=$2',[s.share_id,profile]);
      if (prior) {state='already_contributed';existing_creature_id=prior.id;}
      else if (await this.ancestorOwned(n,profile)) {state='unresolved';reason='D01';}
      else if (!c.accepts_contributions) state='unavailable';
    }
    if (next!==null && !c.accepts_contributions && state==='choose') state='unavailable';
    return {creature:view(n),brand:c.brand,offer:c.offer,cta_target:c.cta_target,next_step:next,
      options:usable ? options!.map(opt=>({choice_id:opt.choice_id,label:opt.label,
        preview_asset:(s.manifest.assets as Json)[String(opt.asset_id)] &&
          ((s.manifest.assets as Json)[String(opt.asset_id)] as Json).src,artwork_supported:true})) : [],
      viewer:{state,existing_creature_id,...(reason?{reason}:{})}};
  }
  private cursor(value:unknown,scope:Json):{time:string;id:string}|null {
    if (value===undefined) return null;
    const raw=safeText(value,1000);
    const [encoded,mac,extra]=raw.split('.');
    if (extra!==undefined || !encoded || !mac ||
      !matchMac(mac,createHmac('sha256',this.config.cursorSecret).update(encoded).digest('base64url'))) throw invalid();
    try {
      const x=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
      if (JSON.stringify(x.scope)!==JSON.stringify(scope) || !Number.isFinite(Date.parse(x.time)) ||
        uuid(x.id)!==x.id) throw invalid();
      return {time:x.time,id:x.id};
    } catch { throw invalid(); }
  }
  private signCursor(scope:Json,time:Date|string,id:string) {
    const encoded=Buffer.from(JSON.stringify({scope,time:new Date(time).toISOString(),id})).toString('base64url');
    return `${encoded}.${createHmac('sha256',this.config.cursorSecret).update(encoded).digest('base64url')}`;
  }
  private pageLimit(value:unknown) {
    if (value===undefined) return Math.min(10,this.config.pageLimit);
    const number=Number(value);
    if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(number) || number>this.config.pageLimit) throw invalid();
    return number;
  }
  async mine(profile:string,query:Json) {
    const limit=this.pageLimit(query.limit), scope={kind:'mine',profile}, after=this.cursor(query.cursor,scope);
    const rows=await this.db.query<Node>(`SELECT n.id,n.campaign_id,c.slug AS campaign_slug,n.owner_profile_id,
      n.origin_share_id,n.revision_id,r.catalog_version,r.appearance,n.created_at
      FROM creature n JOIN creature_revision r ON r.id=n.revision_id
      JOIN campaign c ON c.id=n.campaign_id
      WHERE n.owner_profile_id=$1 AND ($2::timestamptz IS NULL OR (n.created_at,n.id)>($2::timestamptz,$3::uuid))
      ORDER BY n.created_at,n.id LIMIT $4`,
      [profile,after?.time??null,after?.id??null,limit+1]);
    const batch=rows.rows.slice(0,limit),last=batch.at(-1);
    return {items:batch.map(view),next_cursor:rows.rows.length>limit&&last?
      this.signCursor(scope,last.created_at,last.id):null};
  }
  async family(root: {kind:'share';token:string}|{kind:'creature';id:string},
    profile:string|null,query:Json) {
    const rootNode=root.kind==='share'?(await this.source(root.token)).node:
      await this.own(profile??'',root.id);
    const parentId=query.parent_id===undefined?rootNode.id:uuid(query.parent_id);
    let p=await this.getNode(this.db,parentId);
    if (!p) throw miss();
    let inScope=false;
    for (let i=0;i<=15;i++) {
      if (p.id===rootNode.id) {inScope=true;break;}
      if (!p.origin_share_id) break;
      const parent=await one<{id:string}>(this.db,`SELECT n.id FROM share_link s
        JOIN creature_revision r ON r.id=s.source_revision_id
        JOIN creature n ON n.id=r.creature_id WHERE s.id=$1`,[p.origin_share_id]);
      if (!parent) break;
      const next=await this.getNode(this.db,parent.id);
      if (!next) break;
      p=next;
    }
    if (!inScope) throw miss();
    const limit=this.pageLimit(query.limit),scope={kind:'family',root:rootNode.id,parent:parentId};
    const after=this.cursor(query.cursor,scope);
    const rows=await this.db.query<Node & {has_children:boolean}>(`SELECT n.id,n.campaign_id,c.slug AS campaign_slug,
      n.owner_profile_id,n.origin_share_id,n.revision_id,r.catalog_version,r.appearance,n.created_at,
      EXISTS(SELECT 1 FROM share_link s2 JOIN creature child ON child.origin_share_id=s2.id
        WHERE s2.source_revision_id=n.revision_id) AS has_children
      FROM share_link parent_share JOIN creature n ON n.origin_share_id=parent_share.id
      JOIN creature_revision r ON r.id=n.revision_id JOIN campaign c ON c.id=n.campaign_id
      WHERE parent_share.source_revision_id=(SELECT revision_id FROM creature WHERE id=$1)
        AND ($2::timestamptz IS NULL OR (n.created_at,n.id)>($2::timestamptz,$3::uuid))
      ORDER BY n.created_at,n.id LIMIT $4`,[parentId,after?.time??null,after?.id??null,limit+1]);
    const batch=rows.rows.slice(0,limit),last=batch.at(-1);
    return {root_id:rootNode.id,parent_id:parentId,
      items:batch.map(n=>({creature:view(n),has_children:n.has_children})),
      next_cursor:rows.rows.length>limit&&last?this.signCursor(scope,last.created_at,last.id):null};
  }
  async event(profile:string,raw:unknown):Promise<Reply> {
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw invalid();
    const b=raw as Json, share=Object.hasOwn(b,'share_token'),creature=Object.hasOwn(b,'creature_id');
    if (share===creature) throw invalid();
    strict(b,share?['event_id','kind','share_token']:['event_id','kind','creature_id']);
    const eventId=uuid(b.event_id);
    if (b.kind!=='cta_click_reported') throw invalid();
    const context=share?(await this.source(safeText(b.share_token))).node:
      await this.own(profile,uuid(b.creature_id));
    const result=await this.db.query(`INSERT INTO client_event(profile_id,event_id,creature_id,kind)
      VALUES($1,$2,$3,'cta_click_reported') ON CONFLICT DO NOTHING RETURNING event_id`,
      [profile,eventId,context.id]);
    if (result.rows.length) return {status:202,body:{accepted:true}};
    const prev=await one<{creature_id:string;kind:string}>(this.db,
      'SELECT creature_id,kind FROM client_event WHERE profile_id=$1 AND event_id=$2',[profile,eventId]);
    if (!prev || prev.creature_id!==context.id || prev.kind!=='cta_click_reported')
      throw new ApiError(409,'IDEMPOTENCY_KEY_REUSED');
    return {status:200,body:{accepted:true,duplicate:true}};
  }
}
