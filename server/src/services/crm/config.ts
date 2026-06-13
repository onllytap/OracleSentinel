// ============================================================================
// CRM Sync Configuration Module — Platform-Level Config Loader
// ============================================================================
// 
// This module centralizes ALL CRM behavior configuration.
// PRINCIPLE: Zero logic changes required when switching clients/providers.
// ALL behavior is controlled via environment variables.
//
// ============================================================================

export type CrmProvider = 'twenty' | 'airtable' | 'none';
export type DuplicateStrategy = 'skip' | 'update' | 'create_always' | 'fail';
export type IdentityKey = 'phone' | 'email' | 'externalid';
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/**
 * Centralized CRM configuration interface.
 * Every field maps to an environment variable.
 */
export interface CrmConfig {
    // Provider selection
    provider: CrmProvider;

    // Push behavior
    minPushScore: number;
    identityKey: IdentityKey;
    duplicateStrategy: DuplicateStrategy;

    // Strict mode (production recommended)
    strict: {
        /** If true: push fails if personId not returned */
        requireId: boolean;
        /** If true: push fails if read-after-write verification fails */
        verifyWrite: boolean;
        /** If true: push fails if custom fields not written (when enabled) */
        customFields: boolean;
    };

    // Fallback behavior
    fallbackBaseFields: boolean;

    // Logging
    logLevel: LogLevel;

    // Retry configuration
    retry: {
        maxRetries: number;
        delayMs: number;
        timeoutMs: number;
    };
}

/**
 * Load CRM configuration from environment variables.
 * All values have sensible defaults for production use.
 */
export function loadCrmConfig(): CrmConfig {
    return {
        // Provider: default to none (explicit activation required)
        provider: parseProvider(process.env.CRM_PROVIDER),

        // Push behavior
        minPushScore: parseInt(process.env.CRM_MIN_PUSH_SCORE || '60', 10),
        identityKey: parseIdentityKey(process.env.CRM_IDENTITY_KEY),
        duplicateStrategy: parseDuplicateStrategy(process.env.CRM_DUPLICATE_STRATEGY),

        // Strict mode (default: strict for production safety)
        strict: {
            requireId: process.env.CRM_STRICT_REQUIRE_ID !== 'false',
            verifyWrite: process.env.CRM_STRICT_VERIFY_WRITE !== 'false',
            customFields: process.env.CRM_STRICT_CUSTOM_FIELDS === 'true',
        },

        // Fallback: default true for resilience
        fallbackBaseFields: process.env.CRM_FALLBACK_BASE_FIELDS !== 'false',

        // Logging
        logLevel: parseLogLevel(process.env.CRM_LOG_LEVEL),

        // Retry
        retry: {
            maxRetries: parseInt(process.env.CRM_MAX_RETRIES || '3', 10),
            delayMs: parseInt(process.env.CRM_RETRY_DELAY_MS || '1000', 10),
            timeoutMs: parseInt(process.env.CRM_TIMEOUT_MS || '10000', 10),
        },
    };
}

// ── Parsers with validation ───────────────────────────────────────────────

function parseProvider(value: string | undefined): CrmProvider {
    const valid: CrmProvider[] = ['twenty', 'airtable', 'none'];
    const normalized = (value || 'none').toLowerCase().trim() as CrmProvider;
    return valid.includes(normalized) ? normalized : 'none';
}

function parseIdentityKey(value: string | undefined): IdentityKey {
    const valid: IdentityKey[] = ['phone', 'email', 'externalid'];
    const normalized = (value || 'phone').toLowerCase().trim() as IdentityKey;
    return valid.includes(normalized) ? normalized : 'phone';
}

function parseDuplicateStrategy(value: string | undefined): DuplicateStrategy {
    const valid: DuplicateStrategy[] = ['skip', 'update', 'create_always', 'fail'];
    const normalized = (value || 'update').toLowerCase().trim() as DuplicateStrategy;
    return valid.includes(normalized) ? normalized : 'update';
}

function parseLogLevel(value: string | undefined): LogLevel {
    const valid: LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug'];
    const normalized = (value || 'info').toLowerCase().trim() as LogLevel;
    return valid.includes(normalized) ? normalized : 'info';
}

// ── Singleton instance ────────────────────────────────────────────────────

let _config: CrmConfig | null = null;

/**
 * Get the CRM configuration singleton.
 * Configuration is loaded once and cached for the lifetime of the process.
 */
export function getCrmConfig(): CrmConfig {
    if (!_config) {
        _config = loadCrmConfig();
        logConfig(_config);
    }
    return _config;
}

/**
 * Reset configuration cache (for testing only).
 */
export function resetCrmConfig(): void {
    _config = null;
}

function logConfig(config: CrmConfig): void {
    if (config.logLevel === 'silent') return;

    console.log('[CRM] Configuration loaded:');
    console.log(`  Provider: ${config.provider}`);
    console.log(`  Min push score: ${config.minPushScore}`);
    console.log(`  Identity key: ${config.identityKey}`);
    console.log(`  Duplicate strategy: ${config.duplicateStrategy}`);
    console.log(`  Strict mode: requireId=${config.strict.requireId}, verifyWrite=${config.strict.verifyWrite}, customFields=${config.strict.customFields}`);
    console.log(`  Fallback base fields: ${config.fallbackBaseFields}`);
}
