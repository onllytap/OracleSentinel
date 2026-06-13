// ============================================================================
// CRM Dispatch Instrumentation — Structured Logging for Multi-Provider CRM
// ============================================================================
// Provides non-PII structured logs for CRM dispatch operations.
// All personally identifiable information (email, phone, name) is hashed.

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchContext {
    requestId: string;
    provider: string;
    sessionId: string;
    score: number;
    missingCount: number;
}

export interface DispatchResult {
    ok: boolean;
    personId?: string;
    mode: 'create' | 'update' | 'duplicate' | 'noop' | 'error';
    error?: string;
    statusCode?: number;
    durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a short hash for PII redaction (never log raw PII)
 */
export function hashPII(value: string | undefined): string {
    if (!value) return 'null';
    return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex').slice(0, 12);
}

/**
 * Generate a lead key for tracking (externalId > email hash > phone hash)
 */
export function getLeadKey(externalId?: string, email?: string, phone?: string): string {
    if (externalId) return `ext:${externalId.slice(0, 16)}`;
    if (email) return `email:${hashPII(email)}`;
    if (phone) return `phone:${hashPII(phone)}`;
    return 'unknown';
}

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
    return `crm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Structured Logging
// ---------------------------------------------------------------------------

/**
 * Log CRM dispatch start event
 */
export function logDispatchStart(ctx: DispatchContext, leadKey: string): void {
    console.log(JSON.stringify({
        event: 'crm.dispatch.start',
        ts: new Date().toISOString(),
        requestId: ctx.requestId,
        provider: ctx.provider,
        sessionId: ctx.sessionId.slice(0, 16),
        leadKey,
        score: ctx.score,
        missingCount: ctx.missingCount,
    }));
}

/**
 * Log CRM dispatch result event
 */
export function logDispatchResult(ctx: DispatchContext, result: DispatchResult): void {
    console.log(JSON.stringify({
        event: 'crm.dispatch.result',
        ts: new Date().toISOString(),
        requestId: ctx.requestId,
        provider: ctx.provider,
        ok: result.ok,
        mode: result.mode,
        personId: result.personId?.slice(0, 12) || null,
        durationMs: result.durationMs,
    }));
}

/**
 * Log CRM dispatch error event
 */
export function logDispatchError(ctx: DispatchContext, error: Error | string, statusCode?: number): void {
    const errorName = error instanceof Error ? error.name : 'Error';
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Redact any potential PII from error message
    const redactedMessage = errorMessage
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
        .replace(/\b\d{10,}\b/g, '[PHONE_REDACTED]')
        .slice(0, 200);

    console.error(JSON.stringify({
        event: 'crm.dispatch.error',
        ts: new Date().toISOString(),
        requestId: ctx.requestId,
        provider: ctx.provider,
        errorName,
        statusCode: statusCode || null,
        message: redactedMessage,
    }));
}

/**
 * Log read-after-write verification result
 */
export function logReadAfterWrite(
    ctx: DispatchContext,
    personId: string,
    verified: boolean,
    mismatches?: string[]
): void {
    console.log(JSON.stringify({
        event: 'crm.readAfterWrite',
        ts: new Date().toISOString(),
        requestId: ctx.requestId,
        provider: ctx.provider,
        personId: personId.slice(0, 12),
        verified,
        mismatches: mismatches || [],
    }));
}
