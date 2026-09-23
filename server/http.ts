import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { ServerConfig } from './config.js';
import { ApiError, PeredaiService } from './service.js';

type StaticHandler = (req: IncomingMessage, res: ServerResponse, rawPath: string) => Promise<void>;

function fail(status: number, code: string): never { throw new ApiError(status, code); }
function cookie(req: IncomingMessage, name: string): string | null {
  const parts=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
  return parts.length===1?parts[0].slice(name.length+1):null;
}
async function json(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[]=[];let bytes=0;
  for await (const part of req) {
    const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);
    bytes+=chunk.length;
    if (bytes>max) fail(413,'INVALID_REQUEST');
    chunks.push(chunk);
  }
  if (req.headers['content-type']?.split(';')[0]?.trim()!=='application/json') fail(415,'INVALID_REQUEST');
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {return fail(422,'INVALID_REQUEST');}
}
function params(url:URL, allowed:string[]): Record<string,unknown> {
  const result: Record<string,unknown>={};
  for(const [key,value] of url.searchParams) {
    if (!allowed.includes(key) || key in result) fail(422,'INVALID_REQUEST');
    result[key]=value;
  }
  return result;
}
function origin(req: IncomingMessage, expected:string) {
  if (req.headers.origin!==expected) fail(403,'CSRF_REJECTED');
}
function key(req: IncomingMessage):string {
  const value=req.headers['idempotency-key'];
  if(typeof value!=='string'||!(/^[A-Za-z0-9_-]{1,120}$/).test(value)) fail(422,'INVALID_REQUEST');
  return value;
}
function segment(raw:string):string {
  try { return decodeURIComponent(raw); }
  catch { return fail(422,'INVALID_REQUEST'); }
}
function send(res:ServerResponse,status:number,body:unknown) {
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function trustedPeer(req:IncomingMessage,config:ServerConfig):boolean {
  const peer=req.socket.remoteAddress??'';
  const normalized=peer.startsWith('::ffff:')?peer.slice(7):peer;
  return config.trustedProxyAddresses.includes(peer)||config.trustedProxyAddresses.includes(normalized);
}
function clientAddress(req:IncomingMessage,config:ServerConfig):string {
  const peer=req.socket.remoteAddress??'';
  if (config.rateLimitMode==='socket') return peer || 'unknown';
  if (config.rateLimitMode==='ingress') return '';
  if(!trustedPeer(req,config)) return fail(403,'PROXY_REJECTED');
  const forwarded=req.headers['x-forwarded-for'];
  if(typeof forwarded!=='string'||forwarded!==forwarded.trim()||!isIP(forwarded))
    return fail(422,'INVALID_REQUEST');
  return forwarded;
}
export function createPeredaiServer(service:PeredaiService,config:ServerConfig,staticHandler?:StaticHandler) {
  // Local process protection. A multi-instance deployment also needs a shared edge limit.
  const buckets=new Map<string,{start:number;count:number}>();
  return createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Request-Id',requestId);
    try {
      if(config.rateLimitMode==='trusted-proxy'&&!trustedPeer(req,config)) fail(403,'PROXY_REJECTED');
      const rawPath=(req.url??'/').split('?',1)[0];
      if (staticHandler && rawPath !== '/api/v1' && !rawPath.startsWith('/api/')) {
        await staticHandler(req,res,rawPath);return;
      }
      const url=new URL(req.url??'/',config.origin),path=url.pathname,method=req.method??'GET';
      if (!path.startsWith('/api/v1/')) fail(404,'NOT_FOUND');
      if(method==='POST' && !['/api/v1/session','/api/v1/creatures','/api/v1/events'].includes(path)
        && !/^\/api\/v1\/creatures\/[^/]+\/shares$/.test(path)
        && !/^\/api\/v1\/shares\/[^/]+\/offspring$/.test(path)) fail(404,'NOT_FOUND');
      if(method==='POST') origin(req,config.origin);
      const group=method==='POST'&&path==='/api/v1/session'?'session':method==='POST'?'write':null;
      if (group && config.rateLimitMode!=='ingress') {
        const now=Date.now(),windowMs=config.rateWindowSeconds*1000;
        const identity=clientAddress(req,config);
        const bucketKey=`${group}:${identity}`;
        let bucket=buckets.get(bucketKey);
        if (!bucket||now-bucket.start>=windowMs) {
          bucket={start:now,count:0};
          buckets.delete(bucketKey);
          if(buckets.size>=10000) buckets.delete(buckets.keys().next().value!);
          buckets.set(bucketKey,bucket);
        }
        if (++bucket.count > (group==='session'?config.sessionRateLimit:config.writeRateLimit)) {
          res.setHeader('Retry-After',String(Math.max(1,Math.ceil((bucket.start+windowMs-now)/1000))));
          fail(429,'RATE_LIMITED');
        }
      }
      const actor=await service.session(cookie(req,config.cookieName));
      if (method==='GET'&&path==='/api/v1/health') {
        await service.db.query('SELECT 1');
        send(res,200,{status:'ok'});return;
      }
      const body=method==='POST'?await json(req,config.maxBodyBytes):undefined;
      if(method==='POST'&&path==='/api/v1/session') {
        if (!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==0) fail(422,'INVALID_REQUEST');
        const session=await service.bootstrap(actor?.secret??null);
        const secure=config.origin.startsWith('https:')?'; Secure':'';
        res.setHeader('Set-Cookie',
          `${config.cookieName}=${session.secret}; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=${config.sessionTtlSeconds}`);
        send(res,200,{ok:true});return;
      }
      if(method==='GET'&&path==='/api/v1/session') {
        if(!actor) fail(401,'SESSION_REQUIRED');
        send(res,200,{csrf_token:actor.csrf_token,profile_id:actor.profile_id});return;
      }
      const campaign=path.match(/^\/api\/v1\/campaigns\/([^/]+)$/);
      if(method==='GET'&&campaign) {send(res,200,await service.campaign(segment(campaign[1])));return;}
      const catalog=path.match(/^\/api\/v1\/catalogs\/([^/]+)$/);
      if(method==='GET'&&catalog) {send(res,200,await service.catalog(segment(catalog[1])));return;}
      if(method==='POST') {
        const session=service.requireActor(actor,req.headers['x-csrf-token'] as string|null);
        if(path==='/api/v1/creatures') {
          const answer=await service.root(session.profile_id,key(req),body);
          send(res,answer.status,answer.body);return;
        }
        const share=path.match(/^\/api\/v1\/creatures\/([^/]+)\/shares$/);
        if(share) {
          const answer=await service.createShare(session.profile_id,key(req),segment(share[1]),body);
          send(res,answer.status,answer.body);return;
        }
        const offspring=path.match(/^\/api\/v1\/shares\/([^/]+)\/offspring$/);
        if(offspring) {
          const answer=await service.offspring(session.profile_id,key(req),segment(offspring[1]),body);
          send(res,answer.status,answer.body);return;
        }
        if(path==='/api/v1/events') {
          const answer=await service.event(session.profile_id,body);
          send(res,answer.status,answer.body);return;
        }
      }
      if(method==='GET') {
        if(path==='/api/v1/me/creatures') {
          if(!actor) fail(401,'SESSION_REQUIRED');
          send(res,200,await service.mine(actor.profile_id,params(url,['cursor','limit'])));return;
        }
        const creature=path.match(/^\/api\/v1\/creatures\/([^/]+)$/);
        if(creature) {
          if(!actor) fail(401,'SESSION_REQUIRED');
          send(res,200,await service.creature(actor.profile_id,segment(creature[1])));return;
        }
        const preview=path.match(/^\/api\/v1\/shares\/([^/]+)$/);
        if(preview) {send(res,200,await service.preview(segment(preview[1]),actor?.profile_id??null));return;}
        const sharedFamily=path.match(/^\/api\/v1\/shares\/([^/]+)\/family$/);
        if(sharedFamily) {
          send(res,200,await service.family({kind:'share',token:segment(sharedFamily[1])},
            actor?.profile_id??null,params(url,['parent_id','cursor','limit'])));return;
        }
        const ownFamily=path.match(/^\/api\/v1\/creatures\/([^/]+)\/family$/);
        if(ownFamily) {
          if(!actor) fail(401,'SESSION_REQUIRED');
          send(res,200,await service.family({kind:'creature',id:segment(ownFamily[1])},
            actor.profile_id,params(url,['parent_id','cursor','limit'])));return;
        }
      }
      fail(404,'NOT_FOUND');
    } catch(error) {
      const expected=error instanceof ApiError;
      const code=expected?error.code:'TEMPORARILY_UNAVAILABLE';
      send(res,expected?error.status:503,{error:{code,message:expected?error.message:'Сервис временно недоступен.',request_id:requestId}});
      if(!expected) {
        // No cookie, token, request body, SQL text or secret in diagnostic output.
        console.error(JSON.stringify({request_id:requestId,code,kind:error instanceof Error?error.name:'unknown'}));
      }
    }
  });
}
