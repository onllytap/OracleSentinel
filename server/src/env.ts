import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
    path: path.join(__dirname, '../.env'),
    override: process.env.NODE_ENV !== 'production',
});
