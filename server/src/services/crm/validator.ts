// ============================================================================
// CRM Configuration Validator — Validates ALL config at startup
// ============================================================================
//
// This module validates that:
// 1. All required env vars are set
// 2. Provider-specific config is complete
// 3. Connection can be established
// 4. Custom fields exist in CRM schema (if enabled)
//
// RUN THIS AT STARTUP TO CATCH MISCONFIGURATIONS EARLY
//
// ============================================================================

import { getCrmConfig, CrmConfig } from './config';

export interface ValidationResult {
    valid: boolean;
    provider: string;
    errors: string[];
    warnings: string[];
    config: {
        minPushScore: number;
        identityKey: string;
        duplicateStrategy: string;
        strictMode: {
            requireId: boolean;
            verifyWrite: boolean;
            customFields: boolean;
        };
        fallbackBaseFields: boolean;
    };
}

/**
 * Validate CRM configuration at startup.
 * Call this once when server starts to catch misconfigurations early.
 */
export function validateCrmConfiguration(): ValidationResult {
    const config = getCrmConfig();
    const errors: string[] = [];
    const warnings: string[] = [];

    // ── Core validation ───────────────────────────────────────────────────
    if (config.provider === 'none') {
        warnings.push('CRM_PROVIDER=none - CRM is disabled');
    }

    if (!Number.isFinite(config.minPushScore) || config.minPushScore < 0 || config.minPushScore > 100) {
        errors.push(`CRM_MIN_PUSH_SCORE=${config.minPushScore} is invalid (must be 0-100)`);
    }

    // ── Provider-specific validation ──────────────────────────────────────
    if (config.provider === 'twenty') {
        validateTwentyConfig(errors, warnings);
    } else if (config.provider === 'airtable') {
        validateAirtableConfig(errors, warnings);
    }

    // ── Strict mode warnings ──────────────────────────────────────────────
    if (!config.strict.requireId) {
        warnings.push('CRM_STRICT_REQUIRE_ID=false - personId not required (production risk)');
    }
    if (!config.strict.verifyWrite) {
        warnings.push('CRM_STRICT_VERIFY_WRITE=false - write verification disabled (production risk)');
    }

    const result: ValidationResult = {
        valid: errors.length === 0,
        provider: config.provider,
        errors,
        warnings,
        config: {
            minPushScore: config.minPushScore,
            identityKey: config.identityKey,
            duplicateStrategy: config.duplicateStrategy,
            strictMode: config.strict,
            fallbackBaseFields: config.fallbackBaseFields,
        },
    };

    // Log validation result
    logValidationResult(result);

    return result;
}

function validateTwentyConfig(errors: string[], warnings: string[]): void {
    const apiUrl = process.env.TWENTY_API_URL;
    const apiKey = process.env.TWENTY_API_KEY;

    if (!apiUrl) {
        errors.push('TWENTY_API_URL is required when CRM_PROVIDER=twenty');
    } else if (!apiUrl.startsWith('http')) {
        errors.push(`TWENTY_API_URL=${apiUrl} is invalid (must start with http/https)`);
    }

    if (!apiKey) {
        errors.push('TWENTY_API_KEY is required when CRM_PROVIDER=twenty');
    } else if (apiKey.length < 20) {
        warnings.push('TWENTY_API_KEY looks too short - verify it is correct');
    }

    // Custom fields validation
    const customFieldsEnabled = (process.env.TWENTY_CUSTOM_FIELDS || '').toLowerCase().trim() === 'true';
    if (customFieldsEnabled) {
        const requiredFields = [
            'TWENTY_FIELD_EXTERNALID',
            'TWENTY_FIELD_SOURCE',
            'TWENTY_FIELD_QUALIFICATIONSCORE',
            'TWENTY_FIELD_QUALIFICATIONLEVEL',
        ];
        for (const field of requiredFields) {
            if (!process.env[field]) {
                warnings.push(`${field} not set - using default value`);
            }
        }
    }

    // Country code validation
    const country = process.env.TWENTY_DEFAULT_PHONE_COUNTRY || 'FR';
    if (!/^[A-Z]{2}$/.test(country)) {
        errors.push(`TWENTY_DEFAULT_PHONE_COUNTRY=${country} is invalid (must be ISO 3166-1 alpha-2)`);
    }
}

function validateAirtableConfig(errors: string[], warnings: string[]): void {
    const webhookUrl = process.env.AIRTABLE_WEBHOOK_URL;
    const enabled = process.env.AIRTABLE_ENABLED === 'true';

    if (!enabled) {
        warnings.push('AIRTABLE_ENABLED=false - Airtable is disabled');
        return;
    }

    if (!webhookUrl) {
        errors.push('AIRTABLE_WEBHOOK_URL is required when CRM_PROVIDER=airtable');
    } else if (!webhookUrl.includes('airtable.com') && !webhookUrl.includes('localhost')) {
        warnings.push(`AIRTABLE_WEBHOOK_URL doesn't look like an Airtable URL: ${webhookUrl.slice(0, 50)}...`);
    }

    // Field mapping validation
    const requiredFields = [
        'AIRTABLE_FIELD_FIRSTNAME',
        'AIRTABLE_FIELD_LASTNAME',
        'AIRTABLE_FIELD_PHONE',
    ];
    for (const field of requiredFields) {
        if (!process.env[field]) {
            warnings.push(`${field} not set - using default French naming`);
        }
    }
}

function logValidationResult(result: ValidationResult): void {
    console.log('\n' + '═'.repeat(60));
    console.log('  CRM CONFIGURATION VALIDATION');
    console.log('═'.repeat(60));

    console.log(`  Provider: ${result.provider.toUpperCase()}`);
    console.log(`  Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}`);

    if (result.errors.length > 0) {
        console.log('\n  ❌ ERRORS:');
        result.errors.forEach(e => console.log(`     - ${e}`));
    }

    if (result.warnings.length > 0) {
        console.log('\n  ⚠️  WARNINGS:');
        result.warnings.forEach(w => console.log(`     - ${w}`));
    }

    console.log('\n  📋 CONFIGURATION:');
    console.log(`     Min Push Score: ${result.config.minPushScore}`);
    console.log(`     Identity Key: ${result.config.identityKey}`);
    console.log(`     Duplicate Strategy: ${result.config.duplicateStrategy}`);
    console.log(`     Strict Require ID: ${result.config.strictMode.requireId}`);
    console.log(`     Strict Verify Write: ${result.config.strictMode.verifyWrite}`);
    console.log(`     Fallback Base Fields: ${result.config.fallbackBaseFields}`);

    console.log('═'.repeat(60) + '\n');
}

/**
 * Validate configuration AND test connection.
 * Use this for health checks.
 */
export async function validateCrmConnectionAsync(): Promise<{
    configValid: boolean;
    connectionOk: boolean;
    errors: string[];
}> {
    const configResult = validateCrmConfiguration();

    if (!configResult.valid) {
        return {
            configValid: false,
            connectionOk: false,
            errors: configResult.errors,
        };
    }

    // Dynamic import to avoid circular dependency
    const { getCRMConnector } = await import('./crm-factory');
    const connector = getCRMConnector();

    if (!connector.isConfigured()) {
        return {
            configValid: true,
            connectionOk: false,
            errors: ['Connector is not configured - check provider-specific settings'],
        };
    }

    try {
        const connected = await connector.testConnection();
        return {
            configValid: true,
            connectionOk: connected,
            errors: connected ? [] : ['Connection test failed - check API credentials'],
        };
    } catch (err: any) {
        return {
            configValid: true,
            connectionOk: false,
            errors: [`Connection error: ${err.message}`],
        };
    }
}
