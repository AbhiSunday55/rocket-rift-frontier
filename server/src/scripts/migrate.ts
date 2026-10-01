import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pool, closePool } from '../db.js';

/**
 * Migration runner.
 *
 * Applies database/schema.sql. The schema is written to be idempotent
 * (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS), so running this
 * repeatedly is safe.
 */

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../../database/schema.sql');

async function main(): Promise<void> {
  console.log(`[migrate] applying ${schemaPath}`);

  const sql = await readFile(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[migrate] schema applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] failed — rolled back');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
