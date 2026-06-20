import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from server/.env
dotenv.config({ path: path.join(__dirname, '../../.env') });

class DatabaseUnavailableError extends Error {
    constructor(message = 'Database is not configured or temporarily unavailable') {
        super(message);
        this.name = 'DatabaseUnavailableError';
    }
}

// Primary: Neon cloud DB (real production data). Fallback: generic DATABASE_URL.
const databaseUrl =
    process.env.NEXT_PRIVATE_DATABASE_URL || process.env.DATABASE_URL;

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

export type DbSslConfig = false | { rejectUnauthorized: boolean; ca?: string };

/**
 * Resolve the PostgreSQL TLS configuration in an environment-driven,
 * backward-compatible way (security finding F12).
 *
 * Defaults preserve the EXACT current behaviour so production connectivity to
 * Neon is never broken by this change:
 *   - Remote host / sslmode=require  -> TLS on, rejectUnauthorized=false (+ warn)
 *   - Local host (localhost/127.0.0.1) -> no TLS (undefined)
 *
 * Opt-in hardening (set in prod AFTER validating Neon connectivity):
 *   - DB_SSL_REJECT_UNAUTHORIZED=true -> validate the server certificate chain
 *   - DB_SSL_CA=<path|PEM>            -> pin a specific CA (path to a .pem file
 *                                        OR the inline PEM contents)
 *
 * Nothing changes unless these env vars are set, so the default carries zero
 * risk of cutting the database connection.
 */
export function resolveDbSslConfig(
    databaseUrl: string,
    env: NodeJS.ProcessEnv = process.env,
): DbSslConfig | undefined {
    // Explicit opt-out: honour libpq's sslmode=disable. Needed for a local
    // Docker Postgres reached via a non-localhost service hostname (e.g.
    // "oraclesentinel-db") that does not speak TLS — otherwise the non-localhost
    // heuristic below would wrongly force TLS and break the connection.
    if (/sslmode=disable/i.test(databaseUrl)) {
        return undefined;
    }

    const tlsRequired =
        /sslmode=require/i.test(databaseUrl) ||
        !/localhost|127\.0\.0\.1/.test(databaseUrl);

    if (!tlsRequired) {
        // Local Postgres without TLS — unchanged behaviour.
        return undefined;
    }

    const rejectRaw = (env.DB_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase();
    const rejectUnauthorized = rejectRaw === 'true' || rejectRaw === '1';

    // Optional CA pinning. Accepts an inline PEM (contains "-----BEGIN") or a
    // filesystem path to a PEM file. A read failure never breaks startup.
    let ca: string | undefined;
    const caRaw = (env.DB_SSL_CA || '').trim();
    if (caRaw) {
        if (/-----BEGIN/.test(caRaw)) {
            ca = caRaw;
        } else {
            try {
                ca = fs.readFileSync(path.resolve(caRaw), 'utf8');
            } catch (err) {
                console.error(
                    '[db] DB_SSL_CA could not be read; continuing without CA pin',
                    { path: caRaw, message: (err as Error).message },
                );
            }
        }
    }

    if (!rejectUnauthorized) {
        // Single boot-time warning. We keep the historical default (chain
        // validation off) to guarantee Neon connectivity; this nudges operators
        // to harden once connectivity is confirmed.
        console.warn(
            '[db] TLS certificate chain validation is DISABLED ' +
                '(rejectUnauthorized=false, the current default for managed Postgres/Neon). ' +
                'Set DB_SSL_REJECT_UNAUTHORIZED=true (optionally DB_SSL_CA to pin the CA) ' +
                'in production after validating Neon connectivity.',
        );
    }

    return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
}

export const pool = databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        // TLS is environment-driven (see resolveDbSslConfig). Default behaviour
        // is preserved: TLS on for remote/sslmode=require with chain validation
        // disabled, no TLS for local. Hardening is opt-in via env (F12).
        ssl: resolveDbSslConfig(databaseUrl),
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
