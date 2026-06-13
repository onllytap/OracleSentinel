import { pool } from '../src/db/pool';
import { ensureDbSchema } from '../src/db/ensure-db';

async function ensureDb() {
  try {
    console.log('Ensuring database schema (non-destructive)...');
    await ensureDbSchema();
    console.log('Database schema ensured successfully');
  } catch (error) {
    console.error('Error ensuring database schema:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

ensureDb();
