
const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Load .env explicitly
const envPath = path.join(__dirname, '../server/.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

async function testConnection() {
    console.log('Testing connection with string:', process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':****@'));

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('✅ Connection successful!');
        const res = await client.query('SELECT NOW()');
        console.log('Server time:', res.rows[0].now);
        await client.end();
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
        if (err.code === '28P01') {
            console.error('👉 Cause: Invalid password for user "postgres".');
        } else if (err.code === 'ECONNREFUSED') {
            console.error('👉 Cause: Database server is not running on port 5432.');
        }
        process.exit(1);
    }
}

testConnection();
