import { Pool } from 'pg';

export interface Rows<T> { rows: T[]; rowCount: number | null }
export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string, values?: unknown[]
  ): Promise<Rows<T>>;
  release(): void;
}
export interface SqlPool {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string, values?: unknown[]
  ): Promise<Rows<T>>;
  connect(): Promise<SqlClient>;
}

export function postgresPool(url: string): SqlPool & { end(): Promise<void> } {
  const pool = new Pool({ connectionString: url, max: 10 });
  return pool as unknown as SqlPool & { end(): Promise<void> };
}

export async function transaction<T>(pool: SqlPool, work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Original error and outcome stay unknown to caller. */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends Record<string, unknown>>(client: Pick<SqlClient, 'query'>,
  statement: string, values: unknown[] = []): Promise<T | null> {
  return (await client.query<T>(statement, values)).rows[0] ?? null;
}
