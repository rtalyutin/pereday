import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { postgresPool } from './db.js';

const url=process.env.DATABASE_URL;
if(!url) throw new Error('Missing DATABASE_URL');
const pool=postgresPool(url);
try {
  const sql=await readFile(resolve('server/migrations/001_init.sql'),'utf8');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('PEREDAI_MIGRATION_001_APPLIED');
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
