import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from server/.env
dotenv.config({ path: path.join(__dirname, '../../.env') });

class DatabaseUnavailableError extends Error {
    constructor(message = 'Database is not configured or temporarily unavailable') {
        super(message);
        this.name = 'DatabaseUnavailableError';
    }
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('[db] DATABASE_URL is missing. Database features will be unavailable.');
}

const disabledPool = {
    query: async () => {
        throw new DatabaseUnavailableError();
    },
    connect: async () => {
        throw new DatabaseUnavailableError();
    },
    end: async () => undefined,
    on: () => disabledPool,
} as unknown as Pool;

export const isDatabaseConfigured = Boolean(databaseUrl);

export const pool = databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        max: Number(process.env.DB_POOL_MAX ?? process.env.PG_POOL_MAX ?? 20),
        idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
        connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? process.env.PG_CONNECTION_TIMEOUT_MS ?? 5000),
    })
    : disabledPool;

pool.on('error', (err) => {
    console.error('[db] Unexpected idle client error', {
        message: err.message,
        stack: err.stack,
    });
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export async function assertDatabaseConnection(): Promise<boolean> {
    if (!isDatabaseConfigured) {
        return false;
    }

    try {
        await pool.query('SELECT 1');
        return true;
    } catch (error) {
        console.error('[db] Healthcheck failed', error);
        return false;
    }
}
