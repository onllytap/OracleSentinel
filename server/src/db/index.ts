import { pool } from './pool';

export { pool };

export const initDb = async () => {
    try {
        const client = await pool.connect();
        console.log('✅ Connected to Database');
        client.release();
    } catch (error) {
        console.error('❌ Failed to connect to Database:', error);
        throw error;
    }
};
