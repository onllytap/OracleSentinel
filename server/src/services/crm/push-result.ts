// ============================================================================
// CRM Push Result Validation — Strict Contract Enforcement
// ============================================================================
//
// This module enforces the CRM sync contract:
// - SUCCESS = personId + verification (if strict)
// - FAIL = explicit error with reason
// - WARNING = success but degraded
//
// ============================================================================

import { CrmConfig } from './config';

/**
 * Validated push result with strict contract enforcement.
 */
export interface ValidatedPushResult {
    /** Final success status after validation */
    success: boolean;
    /** Person ID from CRM (null if not returned) */
    personId: string | null;
    /** Operation mode */
    mode: 'create' | 'update' | 'duplicate' | 'skip' | 'fail' | 'noop';
    /** Whether read-after-write verification passed */
    verified: boolean;
    /** Warnings (success but degraded) */
    warnings: string[];
    /** Error message if failed */
    error: string | null;
    /** Duration in milliseconds */
    durationMs: number;
    /** Unique request ID for tracing */
    requestId: string;
    /** Whether custom fields were written */
    customFieldsWritten: boolean;
}

/**
 * Raw push result before validation.
 */
export interface RawPushResult {
    success: boolean;
    personId: string | null;
    mode: ValidatedPushResult['mode'];
    verified: boolean;
    durationMs: number;
    requestId: string;
    customFieldsWritten: boolean;
    error?: string;
    warnings?: string[];
}

/**
 * Validate push result against CRM strict mode configuration.
 * This applies the sync contract rules.
 */
export function validatePushResult(
    raw: RawPushResult,
    config: CrmConfig
): ValidatedPushResult {
    const warnings: string[] = [...(raw.warnings || [])];
    let success = raw.success;
    let error = raw.error || null;

    // ── Rule 1: No personId = fail if strict ──────────────────────────────
    if (success && !raw.personId && config.strict.requireId) {
        success = false;
        error = 'STRICT_REQUIRE_ID: personId is null - enable CRM_STRICT_REQUIRE_ID=false to allow';
    }

    // ── Rule 2: Not verified = fail if strict ─────────────────────────────
    if (success && !raw.verified && config.strict.verifyWrite) {
        success = false;
        error = 'STRICT_VERIFY_WRITE: read-after-write failed - enable CRM_STRICT_VERIFY_WRITE=false to allow';
    }

    // ── Rule 3: Custom fields not written = fail if strict ────────────────
    if (success && !raw.customFieldsWritten && config.strict.customFields) {
        success = false;
        error = 'STRICT_CUSTOM_FIELDS: custom fields not written - enable CRM_STRICT_CUSTOM_FIELDS=false to allow';
    }

    // ── Warnings (success but degraded) ───────────────────────────────────
    if (success && !raw.personId && !config.strict.requireId) {
        warnings.push('DEGRADED: personId not returned (CRM_STRICT_REQUIRE_ID=false)');
    }

    if (success && !raw.verified && !config.strict.verifyWrite) {
        warnings.push('DEGRADED: read-after-write skipped (CRM_STRICT_VERIFY_WRITE=false)');
    }

    if (success && !raw.customFieldsWritten && !config.strict.customFields) {
        warnings.push('DEGRADED: custom fields not written (fallback to base fields)');
    }

    return {
        success,
        personId: raw.personId,
        mode: success ? raw.mode : 'fail',
        verified: raw.verified,
        warnings,
        error,
        durationMs: raw.durationMs,
        requestId: raw.requestId,
        customFieldsWritten: raw.customFieldsWritten,
    };
}

/**
 * Log validated push result in structured format.
 */
export function logPushResult(result: ValidatedPushResult, config: CrmConfig): void {
    if (config.logLevel === 'silent') return;

    const emoji = result.success
        ? (result.warnings.length > 0 ? '⚠️' : '✅')
        : '❌';

    const status = result.success
        ? (result.warnings.length > 0 ? 'SUCCESS_DEGRADED' : 'SUCCESS')
        : 'FAIL';

    console.log(`${emoji} CRM Push ${status}:`);
    console.log(`   requestId: ${result.requestId}`);
    console.log(`   personId: ${result.personId || 'null'}`);
    console.log(`   mode: ${result.mode}`);
    console.log(`   verified: ${result.verified}`);
    console.log(`   customFieldsWritten: ${result.customFieldsWritten}`);
    console.log(`   durationMs: ${result.durationMs}`);

    if (result.warnings.length > 0) {
        console.log(`   warnings: ${result.warnings.join(', ')}`);
    }

    if (result.error) {
        console.log(`   error: ${result.error}`);
    }

    // Structured JSON log for observability
    console.log(JSON.stringify({
        event: 'crm.push.result',
        ts: new Date().toISOString(),
        ...result,
    }));
}
