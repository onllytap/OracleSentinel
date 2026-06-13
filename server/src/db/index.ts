import { assertDatabaseConnection, pool } from './pool';

export { pool };

export const initDb = async () => {
    const connected = await assertDatabaseConnection();
    if (!connected) {
        console.error('[db] Database is unavailable; server will start in degraded mode');
        return false;
    }

    console.log('✅ Connected to Database');
    return true;
};
