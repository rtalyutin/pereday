import { postgresPool } from './db.js';
import { readConfig } from './config.js';
import { PeredaiService } from './service.js';
import { createPeredaiServer } from './http.js';

const config=readConfig();
const pool=postgresPool(config.databaseUrl);
const server=createPeredaiServer(new PeredaiService(pool,config),config);
server.listen(config.port,'127.0.0.1',()=>{
  console.log(JSON.stringify({event:'PEREDAI_API_STARTED',port:config.port}));
});
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{
  server.close(()=>void pool.end().then(()=>process.exit(0)));
});
