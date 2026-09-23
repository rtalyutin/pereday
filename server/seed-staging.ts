import { randomUUID } from 'node:crypto';
import catalog from './demo-catalog.json' with {type:'json'};
import { postgresPool, one, transaction } from './db.js';

if(process.env.PEREDAI_STAGING!=='1') throw new Error('PEREDAI_STAGING=1 is required');
const connection=process.env.DATABASE_URL;
if(!connection) throw new Error('Missing DATABASE_URL');
const database=decodeURIComponent(new URL(connection).pathname.slice(1));
if(!/(?:^|[_-])staging(?:[_-]|$)/i.test(database))
  throw new Error('Use an isolated database with staging in its name');
const origin=new URL(process.env.PEREDAI_PUBLIC_ORIGIN??'');
if(origin.protocol!=='https:'||origin.origin!==origin.href.replace(/\/$/,''))
  throw new Error('PEREDAI_PUBLIC_ORIGIN must be a staging HTTPS origin');
const slug=process.env.PEREDAI_CAMPAIGN_SLUG;
const brand=process.env.PEREDAI_BRAND,offer=process.env.PEREDAI_OFFER;
const quota=Number(process.env.PEREDAI_MAX_CREATURES);
if(!slug||!brand||!offer||!Number.isSafeInteger(quota)||quota<1)
  throw new Error('Explicit campaign slug, test brand, offer and positive quota are required');
const pool=postgresPool(connection);
try {
  await transaction(pool,async client=>{
    const previous=await one<{matches:boolean}>(client,
      'SELECT manifest=$2::jsonb AS matches FROM catalog_version WHERE version=$1',
      [catalog.version,JSON.stringify(catalog)]);
    if(previous&&!previous.matches) throw new Error('Existing catalog differs; use a new version');
    if(!previous) await client.query('INSERT INTO catalog_version(version,manifest,published) VALUES($1,$2::jsonb,true)',
      [catalog.version,JSON.stringify(catalog)]);
    if(await one(client,'SELECT id FROM campaign WHERE slug=$1',[slug]))
      throw new Error('Staging campaign already exists');
    await client.query(`INSERT INTO campaign(id,slug,brand,offer,cta_target,active_catalog_version,
      accepts_contributions,max_creatures) VALUES($1,$2,$3,$4,NULL,$5,true,$6)`,
      [randomUUID(),slug,brand,offer,catalog.version,quota]);
  });
  console.log('PEREDAI_STAGING_FIXTURE_READY');
} finally { await pool.end(); }
