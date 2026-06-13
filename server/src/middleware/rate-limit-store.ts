import { pool } from '../db/pool';
import { Store, Options, IncrementResponse } from 'express-rate-limit';
import { createChildLogger } from '../utils/logger';

const log = createChildLogger('rate-limit-store');
const RATE_LIMIT_TABLE = '"rate_limits"';
const RATE_LIMIT_INDEX = '"idx_rate_limits_reset"';

export class PostgresRateLimitStore implements Store {
    private windowMs: number;
    private tableName: string = RATE_LIMIT_TABLE;
    private initialized: boolean = false;

    constructor(windowMs: number) {
        this.windowMs = windowMs;
        this.initTable();
    }

    private async initTable(): Promise<void> {
        if (this.initialized) return;
        
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS ${this.tableName} (
                    key VARCHAR(255) PRIMARY KEY,
                    hits INTEGER NOT NULL DEFAULT 0,
                    reset_at TIMESTAMP NOT NULL
                )
            `);
            
            await pool.query(`
                CREATE INDEX IF NOT EXISTS ${RATE_LIMIT_INDEX} 
                ON ${this.tableName} (reset_at)
            `);
            
            this.initialized = true;
            log.info('Rate limit table initialized');
        } catch (error) {
            log.error({ err: error }, 'Failed to initialize rate limit table');
        }
    }

    async init(_options: Options): Promise<void> {
        await this.initTable();
    }

    async increment(key: string): Promise<IncrementResponse> {
        const now = new Date();
        const resetAt = new Date(now.getTime() + this.windowMs);

        try {
            const result = await pool.query(`
                INSERT INTO ${this.tableName} (key, hits, reset_at)
                VALUES ($1, 1, $2)
                ON CONFLICT (key) DO UPDATE SET
                    hits = CASE 
                        WHEN ${this.tableName}.reset_at <= NOW() THEN 1
                        ELSE ${this.tableName}.hits + 1
                    END,
                    reset_at = CASE 
                        WHEN ${this.tableName}.reset_at <= NOW() THEN $2
                        ELSE ${this.tableName}.reset_at
                    END
                RETURNING hits, reset_at
            `, [key, resetAt]);

            const row = result.rows[0];
            return {
                totalHits: row.hits,
                resetTime: new Date(row.reset_at),
            };
        } catch (error) {
            log.error({ err: error, key }, 'Rate limit increment failed');
            return { totalHits: 1, resetTime: resetAt };
        }
    }

    async decrement(key: string): Promise<void> {
        try {
            await pool.query(`
                UPDATE ${this.tableName} 
                SET hits = GREATEST(hits - 1, 0)
                WHERE key = $1 AND reset_at > NOW()
            `, [key]);
        } catch (error) {
            log.error({ err: error, key }, 'Rate limit decrement failed');
        }
    }

    async resetKey(key: string): Promise<void> {
        try {
            await pool.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [key]);
        } catch (error) {
            log.error({ err: error, key }, 'Rate limit reset key failed');
        }
    }

    async resetAll(): Promise<void> {
        try {
            await pool.query(`DELETE FROM ${this.tableName}`);
        } catch (error) {
            log.error({ err: error }, 'Rate limit reset all failed');
        }
    }

    async cleanup(): Promise<void> {
        try {
            await pool.query(`DELETE FROM ${this.tableName} WHERE reset_at <= NOW()`);
        } catch (error) {
            log.error({ err: error }, 'Rate limit cleanup failed');
        }
    }
}

export function createPostgresStore(windowMs: number): PostgresRateLimitStore {
    const store = new PostgresRateLimitStore(windowMs);
    
    setInterval(() => {
        store.cleanup();
    }, windowMs);

    return store;
}
