#!/usr/bin/env ts-node
// ============================================================================
// Twenty CRM Authentication Diagnostic Script
// ============================================================================
//
// Usage: npx ts-node server/test/diagnose-twenty.ts
//
// This script diagnoses Twenty CRM authentication issues by:
// 1. Checking environment variables
// 2. Testing multiple endpoint paths
// 3. Testing auth header formats
// 4. Reporting the working configuration
// ============================================================================

import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config({ path: path.join(__dirname, '../.env') });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskKey(key: string): string {
    if (!key || key.length < 8) return '****INVALID****';
    return `****${key.slice(-4)}`;
}

function hashEmail(email: string): string {
    return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 8);
}

function decodeJwtPayload(token: string): any | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
        return JSON.parse(payload);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface TwentyConfig {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
}

function getConfig(): TwentyConfig {
    return {
        baseUrl: (process.env.TWENTY_API_URL || 'https://api.twenty.com').replace(/\/+$/, ''),
        apiKey: process.env.TWENTY_API_KEY || '',
        timeoutMs: parseInt(process.env.TWENTY_TIMEOUT_MS || '10000', 10) || 10000,
    };
}

// ---------------------------------------------------------------------------
// Diagnostic Tests
// ---------------------------------------------------------------------------

interface DiagResult {
    test: string;
    status: 'PASS' | 'FAIL' | 'WARN';
    message: string;
    details?: any;
}

const results: DiagResult[] = [];

function log(test: string, status: 'PASS' | 'FAIL' | 'WARN', message: string, details?: any): void {
    results.push({ test, status, message, details });
    const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
    console.log(`  ${icon} ${test}: ${message}`);
    if (details && process.env.TWENTY_DEBUG) {
        console.log(`     └─ Details:`, details);
    }
}

async function testEndpoint(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });
        const text = await res.text();
        let data: any = null;
        try { data = JSON.parse(text); } catch { data = text; }
        return { ok: res.ok, status: res.status, data };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, data: null, error: msg };
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Main Diagnostics
// ---------------------------------------------------------------------------

async function diagnose(): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     Twenty CRM Authentication Diagnostic                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const config = getConfig();

    // ── A) Check TWENTY_API_KEY ────────────────────────────────────────
    console.log('🔑 Checking API Key...\n');

    if (!config.apiKey) {
        log('API_KEY', 'FAIL', 'TWENTY_API_KEY is not set or empty');
        return;
    }

    if (config.apiKey.length < 20) {
        log('API_KEY', 'FAIL', `TWENTY_API_KEY too short (${config.apiKey.length} chars)`);
        return;
    }

    if (['undefined', 'null', 'YOUR_API_KEY'].includes(config.apiKey)) {
        log('API_KEY', 'FAIL', 'TWENTY_API_KEY has placeholder value');
        return;
    }

    log('API_KEY', 'PASS', `Key loaded (${config.apiKey.length} chars, ends with ${maskKey(config.apiKey)})`);

    // Check if it's a JWT and extract info
    const jwtPayload = decodeJwtPayload(config.apiKey);
    if (jwtPayload) {
        log('API_KEY_FORMAT', 'PASS', 'API key is a valid JWT token');
        console.log(`     └─ Workspace ID: ${jwtPayload.workspaceId || 'N/A'}`);
        console.log(`     └─ Type: ${jwtPayload.type || 'N/A'}`);
        if (jwtPayload.exp) {
            const expDate = new Date(jwtPayload.exp * 1000);
            const isExpired = expDate < new Date();
            if (isExpired) {
                log('API_KEY_EXPIRY', 'FAIL', `Token EXPIRED on ${expDate.toISOString()}`);
            } else {
                log('API_KEY_EXPIRY', 'PASS', `Token valid until ${expDate.toISOString()}`);
            }
        }
    } else {
        log('API_KEY_FORMAT', 'WARN', 'API key is not a JWT (may be simple token)');
    }

    // ── B) Check TWENTY_API_URL ────────────────────────────────────────
    console.log('\n🌐 Checking Base URL...\n');

    log('BASE_URL', 'PASS', `Using: ${config.baseUrl}`);

    // Warn if using cloud URL with self-hosted token
    if (config.baseUrl.includes('api.twenty.com') && jwtPayload?.workspaceId) {
        log('BASE_URL_MISMATCH', 'WARN',
            'You are using cloud URL but have a JWT with workspaceId. ' +
            'If this is a self-hosted instance, update TWENTY_API_URL to your domain.');
    }

    // ── C) Test Auth Headers ───────────────────────────────────────────
    console.log('\n🔒 Testing Authentication...\n');

    const authFormats: Array<{ name: string; headers: Record<string, string> }> = [
        { name: 'Bearer Token', headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' } },
        { name: 'Direct Auth', headers: { 'Authorization': config.apiKey, 'Content-Type': 'application/json' } },
        { name: 'X-Api-Key', headers: { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' } },
    ];

    const endpointPaths = [
        '/rest/people?limit=1',
        '/people?limit=1',
        '/api/rest/people?limit=1',
    ];

    let workingConfig: { authFormat: string; endpoint: string; status: number } | null = null;

    for (const authFmt of authFormats) {
        if (workingConfig) break;

        for (const endpointPath of endpointPaths) {
            const url = `${config.baseUrl}${endpointPath}`;
            const result = await testEndpoint(url, authFmt.headers, config.timeoutMs);

            if (result.status === 200 || result.status === 204) {
                log(`AUTH_${authFmt.name.toUpperCase().replace(/\s/g, '_')}`, 'PASS',
                    `${endpointPath} → HTTP ${result.status}`);
                workingConfig = { authFormat: authFmt.name, endpoint: endpointPath, status: result.status };
                break;
            } else if (result.status === 401) {
                log(`AUTH_${authFmt.name.toUpperCase().replace(/\s/g, '_')}`, 'FAIL',
                    `${endpointPath} → HTTP 401 (Unauthorized)`);
            } else if (result.status === 404) {
                log(`AUTH_${authFmt.name.toUpperCase().replace(/\s/g, '_')}`, 'WARN',
                    `${endpointPath} → HTTP 404 (Not Found)`);
            } else if (result.error) {
                log(`AUTH_${authFmt.name.toUpperCase().replace(/\s/g, '_')}`, 'FAIL',
                    `${endpointPath} → Error: ${result.error}`);
            } else {
                log(`AUTH_${authFmt.name.toUpperCase().replace(/\s/g, '_')}`, 'FAIL',
                    `${endpointPath} → HTTP ${result.status}`);
            }
        }
    }

    // ── D) Test Metadata API ───────────────────────────────────────────
    console.log('\n📊 Testing Metadata API...\n');

    const metadataPaths = [
        '/rest/metadata/objects',
        '/metadata/objects',
        '/api/rest/metadata/objects',
    ];

    for (const metaPath of metadataPaths) {
        const url = `${config.baseUrl}${metaPath}`;
        const result = await testEndpoint(url, authFormats[0].headers, config.timeoutMs);

        if (result.status === 200) {
            log('METADATA_API', 'PASS', `${metaPath} → HTTP 200`);
            break;
        } else {
            log('METADATA_API', 'FAIL', `${metaPath} → HTTP ${result.status || result.error}`);
        }
    }

    // ── Summary ────────────────────────────────────────────────────────
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     DIAGNOSTIC SUMMARY                                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;
    const warnCount = results.filter(r => r.status === 'WARN').length;

    console.log(`  Results: ${passCount} passed, ${warnCount} warnings, ${failCount} failed\n`);

    if (workingConfig) {
        console.log('  ✅ WORKING CONFIGURATION FOUND:');
        console.log(`     • Auth Format: ${workingConfig.authFormat}`);
        console.log(`     • Endpoint: ${workingConfig.endpoint}`);
        console.log(`     • Base URL: ${config.baseUrl}`);
    } else {
        console.log('  ❌ NO WORKING CONFIGURATION FOUND');
        console.log('\n  TROUBLESHOOTING STEPS:');
        console.log('  1. Verify TWENTY_API_URL points to your actual Twenty instance');
        console.log('     - Cloud: https://api.twenty.com');
        console.log('     - Self-hosted: https://your-domain.com');
        console.log('  2. Verify TWENTY_API_KEY is a valid API key from Settings > API & Webhooks');
        console.log('  3. Check if the API key has expired');
        console.log('  4. Ensure your Twenty instance is accessible from this network');
    }

    console.log('\n');
    process.exit(failCount > 0 ? 1 : 0);
}

diagnose().catch((err) => {
    console.error('Diagnostic error:', err);
    process.exit(1);
});
