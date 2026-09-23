import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>({
  plugins:[react(),{
    name:'peredai-deployment-metadata',apply:'build',
    async closeBundle(){
      const values=loadEnv(mode,process.cwd(),'VITE_');
      const directory=resolve('server-dist');
      await mkdir(directory,{recursive:true});
      await writeFile(resolve(directory,'build-meta.json'),JSON.stringify({
        api_mode:values.VITE_API_MODE??'demo',campaign_slug:values.VITE_CAMPAIGN_SLUG??'peredai'
      })+'\n');
    }
  }],
  server:{host:'127.0.0.1',port:5173,proxy:{'/api/v1':{target:'http://127.0.0.1:8787',changeOrigin:false}}},
  build:{target:'es2022'},
}));
