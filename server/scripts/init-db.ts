import fs from 'fs';
import path from 'path';
import { pool } from '../src/db/pool';

async function initDb() {
    try {
        const schemaPath = path.join(__dirname, '../src/db/schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Running schema.sql...');
        await pool.query(schemaSql);
        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database:', error);
    } finally {
        await pool.end();
    }
}

initDb();
