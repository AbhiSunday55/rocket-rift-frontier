import pg from 'pg';
import { config } from './config.js';

/**
 * PostgreSQL pool.
 *
 * A single shared pool for the process. `query` is a thin wrapper that logs slow
 * queries in development so performance regressions are visible early.
 */

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  const started = Date.now();
  const result = await pool.query<T>(text, params as never[]);
  const elapsed = Date.now() - started;
  if (!config.isProd && elapsed > 200) {
    console.warn(`[db] slow query (${elapsed}ms): ${text.slice(0, 120)}`);
  }
  return result;
}

/** Runs a callback inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
