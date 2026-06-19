import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// ── Layered env loading ──────────────────────────────────────────────────────
// 1. Repo-root .env  → shared infra config (DATABASE_URL, SMTP, Twenty, …).
//    Loaded as the BASE layer; never overrides anything already in process.env.
// 2. server/.env     → server-specific overrides. Wins in non-production.
//
// This makes the server resilient whether config lives in the repo-root .env
// or in a dedicated server/.env, without leaking secrets into source control.
const rootEnv = path.join(__dirname, '../../.env');
const serverEnv = path.join(__dirname, '../.env');

if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
}

dotenv.config({
    path: serverEnv,
    override: process.env.NODE_ENV !== 'production',
});
