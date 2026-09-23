import { randomUUID } from 'node:crypto';
import catalog from './demo-catalog.json' with {type:'json'};
import { postgresPool, one, transaction } from './db.js';

const url=process.env.DATABASE_URL;
if(!url) throw new Error('Missing DATABASE_URL');
const origin=new URL(process.env.PEREDAI_PUBLIC_ORIGIN??'http://127.0.0.1:5173');
if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1') throw new Error('Partial demo may be seeded only for loopback');
const quota=Number(process.env.PEREDAI_MAX_CREATURES);
if(!Number.isSafeInteger(quota)||quota<1) throw new Error('PEREDAI_MAX_CREATURES must be a positive integer');
const brand=process.env.PEREDAI_BRAND,offer=process.env.PEREDAI_OFFER;
if(!brand||!offer) throw new Error('Explicit PEREDAI_BRAND and PEREDAI_OFFER are required');
const cta=process.env.PEREDAI_CTA_TARGET??null;
if(cta && new URL(cta).protocol!=='https:') throw new Error('CTA target must be HTTPS');
const accepts=process.env.PEREDAI_ALLOW_PARTIAL_DEMO==='1';
const slug=process.env.PEREDAI_CAMPAIGN_SLUG??'peredai';
const pool=postgresPool(url);
try {
  await transaction(pool,async client=>{
    const previous=await one<{matches:boolean}>(client,
      'SELECT manifest=$2::jsonb AS matches FROM catalog_version WHERE version=$1',
      [catalog.version,JSON.stringify(catalog)]);
    if(previous && !previous.matches)
      throw new Error('Existing catalog version differs; publish a new version');
    if(!previous) await client.query(`INSERT INTO catalog_version(version,manifest,published)
      VALUES($1,$2::jsonb,true)`,[catalog.version,JSON.stringify(catalog)]);
    const campaign=await one<{id:string}>(client,'SELECT id FROM campaign WHERE slug=$1',[slug]);
    if(campaign) throw new Error('Campaign already exists; this script does not alter campaign settings');
    await client.query(`INSERT INTO campaign(id,slug,brand,offer,cta_target,active_catalog_version,
      accepts_contributions,max_creatures) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(),slug,brand,offer,cta,catalog.version,accepts,quota]);
  });
  console.log(accepts?'PEREDAI_PARTIAL_DEMO_ENABLED':'PEREDAI_PARTIAL_DEMO_READ_ONLY');
} finally {await pool.end();}
