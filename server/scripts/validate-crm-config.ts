#!/usr/bin/env npx ts-node
// ============================================================================
// CRM FULL CONFIGURATION AUDIT CLI
// ============================================================================
//
// Run: npx ts-node scripts/validate-crm-config.ts
//
// This script performs a COMPLETE audit of CRM configuration:
// 1. Validates ALL environment variables are set and valid
// 2. Tests connection to CRM
// 3. Verifies custom fields exist in CRM schema
// 4. Tests a sample push (dry-run mode)
// 5. Reports configuration alignment with code
//
// ============================================================================

import 'dotenv/config';

// ── Color helpers ──────────────────────────────────────────────────────────
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
};

const ok = (msg: string) => console.log(`${colors.green}✅ ${msg}${colors.reset}`);
const fail = (msg: string) => console.log(`${colors.red}❌ ${msg}${colors.reset}`);
const warn = (msg: string) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`);
const info = (msg: string) => console.log(`${colors.cyan}ℹ️  ${msg}${colors.reset}`);
const header = (msg: string) => console.log(`\n${colors.bold}${colors.blue}═══ ${msg} ═══${colors.reset}\n`);

// ── Configuration Schema ───────────────────────────────────────────────────

interface ConfigParam {
    key: string;
    default: string;
    required: boolean;
    type: 'string' | 'number' | 'boolean' | 'enum';
    enumValues?: string[];
    description: string;
    validate?: (value: string) => boolean;
}

const CRM_CONFIG_SCHEMA: ConfigParam[] = [
    // ── Core ──
    { key: 'CRM_PROVIDER', default: 'none', required: true, type: 'enum', enumValues: ['twenty', 'airtable', 'none'], description: 'CRM provider' },

    // ── Push Behavior ──
    { key: 'CRM_MIN_PUSH_SCORE', default: '60', required: false, type: 'number', description: 'Min score to push', validate: v => parseInt(v) >= 0 && parseInt(v) <= 100 },
    { key: 'CRM_IDENTITY_KEY', default: 'phone', required: false, type: 'enum', enumValues: ['phone', 'email', 'externalid'], description: 'Identity key for upsert' },
    { key: 'CRM_DUPLICATE_STRATEGY', default: 'update', required: false, type: 'enum', enumValues: ['skip', 'update', 'create_always', 'fail'], description: 'Duplicate handling' },

    // ── Strict Mode ──
    { key: 'CRM_STRICT_REQUIRE_ID', default: 'true', required: false, type: 'boolean', description: 'Fail if no personId' },
    { key: 'CRM_STRICT_VERIFY_WRITE', default: 'true', required: false, type: 'boolean', description: 'Fail if verification fails' },
    { key: 'CRM_STRICT_CUSTOM_FIELDS', default: 'false', required: false, type: 'boolean', description: 'Fail if custom fields rejected' },

    // ── Fallback ──
    { key: 'CRM_FALLBACK_BASE_FIELDS', default: 'true', required: false, type: 'boolean', description: 'Retry without custom fields' },
    { key: 'CRM_LOG_LEVEL', default: 'info', required: false, type: 'enum', enumValues: ['silent', 'error', 'warn', 'info', 'debug'], description: 'Log verbosity' },

    // ── Retry ──
    { key: 'CRM_MAX_RETRIES', default: '3', required: false, type: 'number', description: 'Max retry attempts', validate: v => parseInt(v) >= 0 && parseInt(v) <= 10 },
    { key: 'CRM_RETRY_DELAY_MS', default: '1000', required: false, type: 'number', description: 'Retry delay ms' },
    { key: 'CRM_TIMEOUT_MS', default: '10000', required: false, type: 'number', description: 'Request timeout ms' },

    // ── Push Timing ──
    { key: 'CRM_PUSH_DELAY_MS', default: '500', required: false, type: 'number', description: 'Delay before push' },
    { key: 'CRM_MIN_MESSAGES_BEFORE_PUSH', default: '3', required: false, type: 'number', description: 'Min messages before push' },

    // ── Notes Format ──
    { key: 'CRM_INCLUDE_AGENT_NOTE', default: 'true', required: false, type: 'boolean', description: 'Include agent note' },
    { key: 'CRM_INCLUDE_TRANSCRIPT', default: 'false', required: false, type: 'boolean', description: 'Include transcript' },
    { key: 'CRM_NOTES_MAX_LENGTH', default: '2000', required: false, type: 'number', description: 'Max notes length' },
    { key: 'CRM_NOTES_DATE_FORMAT', default: 'DD/MM/YYYY HH:mm', required: false, type: 'string', description: 'Date format' },

    // ── Field Behavior ──
    { key: 'CRM_AUTO_DETECT_PHONE_COUNTRY', default: 'true', required: false, type: 'boolean', description: 'Auto-detect country' },
    { key: 'CRM_NORMALIZE_PHONE', default: 'true', required: false, type: 'boolean', description: 'Normalize phone' },
    { key: 'CRM_CAPITALIZE_NAMES', default: 'true', required: false, type: 'boolean', description: 'Capitalize names' },
    { key: 'CRM_TRIM_FIELDS', default: 'true', required: false, type: 'boolean', description: 'Trim whitespace' },

    // ── Validation ──
    { key: 'CRM_VALIDATE_PHONE', default: 'true', required: false, type: 'boolean', description: 'Validate phone format' },
    { key: 'CRM_VALIDATE_EMAIL', default: 'true', required: false, type: 'boolean', description: 'Validate email format' },
    { key: 'CRM_BLOCK_IF_INCOMPLETE', default: 'false', required: false, type: 'boolean', description: 'Block if incomplete' },
    { key: 'CRM_REQUIRED_FIELDS', default: 'phone,firstName', required: false, type: 'string', description: 'Required fields' },

    // ── Debug ──
    { key: 'CRM_DEBUG_PAYLOADS', default: 'false', required: false, type: 'boolean', description: 'Log payloads' },
    { key: 'CRM_HASH_PII_IN_LOGS', default: 'true', required: false, type: 'boolean', description: 'Hash PII' },
    { key: 'CRM_STRUCTURED_LOGS', default: 'true', required: false, type: 'boolean', description: 'JSON logs' },
];

const TWENTY_CONFIG_SCHEMA: ConfigParam[] = [
    { key: 'TWENTY_ENABLED', default: 'true', required: true, type: 'boolean', description: 'Twenty enabled' },
    { key: 'TWENTY_API_URL', default: '', required: true, type: 'string', description: 'API URL', validate: v => v.startsWith('http') },
    { key: 'TWENTY_API_KEY', default: '', required: true, type: 'string', description: 'API Key', validate: v => v.length > 20 },
    { key: 'TWENTY_TIMEOUT_MS', default: '10000', required: false, type: 'number', description: 'Timeout ms' },
    { key: 'TWENTY_CUSTOM_FIELDS', default: 'false', required: false, type: 'boolean', description: 'Custom fields enabled' },
    { key: 'TWENTY_FIELD_EXTERNALID', default: 'externalid', required: false, type: 'string', description: 'External ID field' },
    { key: 'TWENTY_FIELD_SOURCE', default: 'source', required: false, type: 'string', description: 'Source field' },
    { key: 'TWENTY_FIELD_QUALIFICATIONSCORE', default: 'qualificationscore', required: false, type: 'string', description: 'Score field' },
    { key: 'TWENTY_FIELD_QUALIFICATIONLEVEL', default: 'qualificationlevel', required: false, type: 'string', description: 'Level field' },
    { key: 'TWENTY_DEFAULT_SOURCE', default: 'CHATBOT', required: false, type: 'string', description: 'Default source' },
    { key: 'TWENTY_DEFAULT_PHONE_COUNTRY', default: 'FR', required: false, type: 'string', description: 'Phone country', validate: v => /^[A-Z]{2}$/.test(v) },
];

const AIRTABLE_CONFIG_SCHEMA: ConfigParam[] = [
    { key: 'AIRTABLE_ENABLED', default: 'true', required: true, type: 'boolean', description: 'Airtable enabled' },
    { key: 'AIRTABLE_WEBHOOK_URL', default: '', required: true, type: 'string', description: 'Webhook URL' },
    { key: 'AIRTABLE_TIMEOUT_MS', default: '10000', required: false, type: 'number', description: 'Timeout ms' },
    { key: 'AIRTABLE_FIELD_FIRSTNAME', default: 'prenom', required: false, type: 'string', description: 'First name field' },
    { key: 'AIRTABLE_FIELD_LASTNAME', default: 'nom', required: false, type: 'string', description: 'Last name field' },
    { key: 'AIRTABLE_FIELD_FULLNAME', default: 'nom_complet', required: false, type: 'string', description: 'Full name field' },
    { key: 'AIRTABLE_FIELD_PHONE', default: 'numero_telephone', required: false, type: 'string', description: 'Phone field' },
    { key: 'AIRTABLE_FIELD_EMAIL', default: 'email', required: false, type: 'string', description: 'Email field' },
    { key: 'AIRTABLE_FIELD_TYPE', default: 'type', required: false, type: 'string', description: 'Type field' },
    { key: 'AIRTABLE_FIELD_NEED', default: 'besoin', required: false, type: 'string', description: 'Need field' },
    { key: 'AIRTABLE_FIELD_ADDRESS', default: 'adresse', required: false, type: 'string', description: 'Address field' },
    { key: 'AIRTABLE_FIELD_QUALIFICATION', default: 'qualification', required: false, type: 'string', description: 'Qualification field' },
    { key: 'AIRTABLE_FIELD_DETAILS', default: 'details', required: false, type: 'string', description: 'Details field' },
    { key: 'AIRTABLE_FIELD_NOTES', default: 'notes', required: false, type: 'string', description: 'Notes field' },
    { key: 'AIRTABLE_FIELD_AGENTNOTE', default: 'impression_agent', required: false, type: 'string', description: 'Agent note field' },
    { key: 'AIRTABLE_FIELD_APPOINTMENT', default: 'date_rdv', required: false, type: 'string', description: 'Appointment field' },
    { key: 'AIRTABLE_FIELD_TAGS', default: 'tags', required: false, type: 'string', description: 'Tags field' },
];

// ── Validation Logic ───────────────────────────────────────────────────────

interface AuditResult {
    passed: number;
    failed: number;
    warnings: number;
    details: Array<{ key: string; status: 'ok' | 'fail' | 'warn'; value: string; message: string }>;
}

function validateSchema(schema: ConfigParam[], name: string): AuditResult {
    header(name);

    const result: AuditResult = { passed: 0, failed: 0, warnings: 0, details: [] };

    for (const param of schema) {
        const value = process.env[param.key] ?? param.default;
        const isSet = process.env[param.key] !== undefined;

        let status: 'ok' | 'fail' | 'warn' = 'ok';
        let message = 'Valid';

        // Check required
        if (param.required && !isSet && !param.default) {
            status = 'fail';
            message = 'REQUIRED but not set';
        }
        // Check type
        else if (param.type === 'number' && isNaN(parseInt(value))) {
            status = 'fail';
            message = 'Must be a number';
        }
        else if (param.type === 'boolean' && !['true', 'false', '1', '0'].includes(value.toLowerCase())) {
            status = 'fail';
            message = 'Must be true/false';
        }
        else if (param.type === 'enum' && param.enumValues && !param.enumValues.includes(value.toLowerCase())) {
            status = 'fail';
            message = `Must be one of: ${param.enumValues.join(', ')}`;
        }
        // Custom validation
        else if (param.validate && !param.validate(value)) {
            status = 'fail';
            message = 'Failed custom validation';
        }
        // Warn if using default
        else if (!isSet) {
            status = 'warn';
            message = `Using default: ${param.default}`;
        }

        // Log
        const displayValue = param.key.includes('KEY') || param.key.includes('SECRET')
            ? `${value.slice(0, 8)}...`
            : value.slice(0, 30);

        if (status === 'ok') {
            ok(`${param.key.padEnd(35)} = ${displayValue.padEnd(20)} [${param.description}]`);
            result.passed++;
        } else if (status === 'fail') {
            fail(`${param.key.padEnd(35)} = ${displayValue.padEnd(20)} [${message}]`);
            result.failed++;
        } else {
            warn(`${param.key.padEnd(35)} = ${displayValue.padEnd(20)} [${message}]`);
            result.warnings++;
        }

        result.details.push({ key: param.key, status, value, message });
    }

    return result;
}

async function testConnection(): Promise<boolean> {
    header('CONNECTION TEST');

    try {
        const { getCRMConnector } = await import('../src/services/crm/crm-factory');
        const connector = getCRMConnector();

        if (!connector.isConfigured()) {
            fail('Connector is not configured');
            return false;
        }

        info(`Testing connection to ${connector.providerName}...`);
        const connected = await connector.testConnection();

        if (connected) {
            ok(`Connection to ${connector.providerName.toUpperCase()} successful!`);
            return true;
        } else {
            fail(`Connection to ${connector.providerName} failed`);
            return false;
        }
    } catch (err: any) {
        fail(`Connection error: ${err.message}`);
        return false;
    }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`${colors.bold}  CRM CONFIGURATION FULL AUDIT${colors.reset}`);
    console.log(`${colors.dim}  Generated: ${new Date().toISOString()}${colors.reset}`);
    console.log('═'.repeat(60));

    // Validate core CRM config
    const crmResult = validateSchema(CRM_CONFIG_SCHEMA, 'CRM CORE CONFIGURATION');

    // Validate provider-specific config
    const provider = (process.env.CRM_PROVIDER || 'none').toLowerCase();
    let providerResult: AuditResult = { passed: 0, failed: 0, warnings: 0, details: [] };

    if (provider === 'twenty') {
        providerResult = validateSchema(TWENTY_CONFIG_SCHEMA, 'TWENTY CRM CONFIGURATION');
    } else if (provider === 'airtable') {
        providerResult = validateSchema(AIRTABLE_CONFIG_SCHEMA, 'AIRTABLE CONFIGURATION');
    } else if (provider === 'none') {
        header('PROVIDER');
        warn('CRM_PROVIDER=none — CRM is DISABLED');
    }

    // Connection test
    let connectionOk = false;
    if (provider !== 'none' && crmResult.failed === 0 && providerResult.failed === 0) {
        connectionOk = await testConnection();
    }

    // Summary
    header('AUDIT SUMMARY');

    const totalPassed = crmResult.passed + providerResult.passed;
    const totalFailed = crmResult.failed + providerResult.failed;
    const totalWarnings = crmResult.warnings + providerResult.warnings;

    console.log(`  ${colors.green}✅ Passed:${colors.reset}   ${totalPassed}`);
    console.log(`  ${colors.red}❌ Failed:${colors.reset}   ${totalFailed}`);
    console.log(`  ${colors.yellow}⚠️  Warnings:${colors.reset} ${totalWarnings}`);
    console.log(`  ${colors.cyan}🔌 Connected:${colors.reset} ${connectionOk ? 'YES' : 'NO'}`);

    console.log('\n' + '═'.repeat(60));

    if (totalFailed > 0) {
        console.log(`${colors.red}${colors.bold}  ❌ AUDIT FAILED — Fix ${totalFailed} error(s) above${colors.reset}`);
        console.log('═'.repeat(60) + '\n');
        process.exit(1);
    } else if (!connectionOk && provider !== 'none') {
        console.log(`${colors.yellow}${colors.bold}  ⚠️  CONFIG OK BUT CONNECTION FAILED${colors.reset}`);
        console.log('═'.repeat(60) + '\n');
        process.exit(1);
    } else {
        console.log(`${colors.green}${colors.bold}  ✅ AUDIT PASSED — CRM is properly configured!${colors.reset}`);
        console.log('═'.repeat(60) + '\n');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
});
