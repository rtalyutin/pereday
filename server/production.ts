import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { postgresPool } from './db.js';
import { readConfig } from './config.js';
import { PeredaiService } from './service.js';
import { createPeredaiServer } from './http.js';
import { createStaticHandler } from './static.js';

if(!process.env.PEREDAI_PUBLIC_ORIGIN) throw new Error('Production requires explicit PEREDAI_PUBLIC_ORIGIN');
const config=readConfig();
if(config.origin.startsWith('http:') && Number(new URL(config.origin).port || '80') !== config.port)
  throw new Error('Local public origin port must match the production listener port');
const metadata=JSON.parse(await readFile(new URL('./build-meta.json',import.meta.url),'utf8')) as {
  api_mode?:unknown; campaign_slug?:unknown;
};
if(metadata.api_mode!=='live'||metadata.campaign_slug!==config.campaignSlug)
  throw new Error('Production build must use VITE_API_MODE=live and matching VITE_CAMPAIGN_SLUG');
const staticHandler=await createStaticHandler(fileURLToPath(new URL('../dist/',import.meta.url)));
const pool=postgresPool(config.databaseUrl);
try {
  const campaign=await pool.query('SELECT 1 FROM campaign WHERE slug=$1',[config.campaignSlug]);
  if(!campaign.rows.length) throw new Error('Configured campaign is absent from database');
  const server=createPeredaiServer(new PeredaiService(pool,config),config,staticHandler);
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(config.port,config.bindHost,()=>{
      server.off('error',reject);resolve();
    });
  });
  console.log(JSON.stringify({event:'PEREDAI_APP_STARTED',port:config.port}));
  let stopping=false;
  for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{
    if(stopping) return;
    stopping=true;
    server.closeIdleConnections();
    const timer=setTimeout(()=>server.closeAllConnections(),config.shutdownGraceSeconds*1000);
    timer.unref();
    server.close(()=>{
      clearTimeout(timer);
      void pool.end().then(()=>process.exit(0),()=>process.exit(1));
    });
  });
} catch(error) {
  await pool.end();
  throw error;
}
