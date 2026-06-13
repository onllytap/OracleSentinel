// ============================================================================
// Runtime Behavior Matrix — Deterministic scenario outcomes
// ============================================================================
// This matrix defines EXACTLY what happens in every scenario.
// No ambiguity. No "it depends". Every path is documented.
// ============================================================================

import type { RuntimeScenario } from './types';

export const RUNTIME_BEHAVIOR_MATRIX: RuntimeScenario[] = [
    // ── CRM Push Scenarios ─────────────────────────────────────────
    {
        scenario: 'Lead qualifies (score >= minPushScore)',
        condition: 'score >= CRM_MIN_PUSH_SCORE AND requiredFields present',
        strictBehavior: 'Push to CRM. Verify recordId returned. Read-after-write check.',
        permissiveBehavior: 'Push to CRM. Queue on failure. Continue conversation.',
        outcome: 'SUCCESS',
    },
    {
        scenario: 'Lead qualifies but phone missing',
        condition: 'score >= CRM_MIN_PUSH_SCORE AND phone NOT in extracted data',
        strictBehavior: 'BLOCK push. Log error. Return missingFields to frontend.',
        permissiveBehavior: 'Attempt push with partial data. Queue if rejected.',
        outcome: 'FAILURE',
    },
    {
        scenario: 'CRM push returns success but NO recordId',
        condition: 'API returns 200 but response body has no id/recordId',
        strictBehavior: 'Mark as FAILURE. Log critical. Do NOT mark as synced.',
        permissiveBehavior: 'Mark as WARNING. Log. Assume success tentatively.',
        outcome: 'FAILURE',
    },
    {
        scenario: 'CRM push succeeds, read-after-write FAILS',
        condition: 'Write OK, but GET /person/{id} returns different data or 404',
        strictBehavior: 'Mark as FAILURE. Alert. Retry from retry queue.',
        permissiveBehavior: 'Mark as WARNING. Log mismatch details. Continue.',
        outcome: 'FAILURE',
    },
    {
        scenario: 'CRM push succeeds, read-after-write PASSES',
        condition: 'Write OK, GET confirms all fields match',
        strictBehavior: 'Mark as SUCCESS. Log verified. Update session dedup.',
        permissiveBehavior: 'Same as strict.',
        outcome: 'SUCCESS',
    },
    {
        scenario: 'Duplicate contact detected',
        condition: 'Phone/email already exists in CRM',
        strictBehavior: 'Follow CRM_DUPLICATE_STRATEGY: skip|update|create_always|fail',
        permissiveBehavior: 'Same as strict (strategy-driven).',
        outcome: 'WARNING',
    },
    {
        scenario: 'Custom fields rejected by CRM schema',
        condition: 'Twenty API returns 400 for custom field payload',
        strictBehavior: 'If CRM_FALLBACK_BASE_FIELDS=true: retry with base fields. Else FAIL.',
        permissiveBehavior: 'Retry with base fields. Log dropped fields.',
        outcome: 'WARNING',
    },
    {
        scenario: 'CRM API timeout',
        condition: 'Request exceeds CRM_TIMEOUT_MS',
        strictBehavior: 'Retry up to CRM_MAX_RETRIES. Then FAIL and queue.',
        permissiveBehavior: 'Retry up to CRM_MAX_RETRIES. Then queue silently.',
        outcome: 'FAILURE',
    },
    {
        scenario: 'CRM API auth failure (401/403)',
        condition: 'API key expired or invalid',
        strictBehavior: 'FAIL immediately. Alert via CRM_NOTIFY_CHANNEL. Block further pushes.',
        permissiveBehavior: 'FAIL and queue. Alert. Continue conversation without CRM.',
        outcome: 'FAILURE',
    },
    {
        scenario: 'Rate limit exceeded (429)',
        condition: 'CRM_RATE_LIMIT_PER_MINUTE exceeded',
        strictBehavior: 'Queue push. Retry after cooldown. Log rate limit event.',
        permissiveBehavior: 'Same (rate limiting is always respected).',
        outcome: 'WARNING',
    },

    // ── Qualification Scenarios ────────────────────────────────────
    {
        scenario: 'Conversation too short for push',
        condition: 'messageCount < CRM_MIN_MESSAGES_BEFORE_PUSH',
        strictBehavior: 'Do not push. Wait for more conversation.',
        permissiveBehavior: 'Same.',
        outcome: 'SUCCESS',
    },
    {
        scenario: 'Score below threshold',
        condition: 'score < CRM_MIN_PUSH_SCORE',
        strictBehavior: 'Do not push. Return qualification status to frontend.',
        permissiveBehavior: 'Same.',
        outcome: 'SUCCESS',
    },
    {
        scenario: 'All fields collected, score = 100',
        condition: 'missingFields.length === 0 AND score === 100',
        strictBehavior: 'Push immediately. Full verification.',
        permissiveBehavior: 'Same.',
        outcome: 'SUCCESS',
    },
    {
        scenario: 'Partial data, CRM_BLOCK_IF_INCOMPLETE=true',
        condition: 'Some required fields missing AND blockIfIncomplete=true',
        strictBehavior: 'BLOCK push. Return missingFields list.',
        permissiveBehavior: 'Push with available data.',
        outcome: 'BLOCKED',
    },

    // ── Build Pipeline Scenarios ───────────────────────────────────
    {
        scenario: 'Build with missing API keys',
        condition: 'CRM provider set but API key empty',
        strictBehavior: 'BLOCK BUILD. Schema validation fails.',
        permissiveBehavior: 'N/A (build always uses strict validation).',
        outcome: 'BLOCKED',
    },
    {
        scenario: 'Build with CRM connection failure',
        condition: 'API key valid but CRM unreachable',
        strictBehavior: 'BLOCK BUILD. Connection proof fails.',
        permissiveBehavior: 'N/A.',
        outcome: 'BLOCKED',
    },
    {
        scenario: 'Build with warnings only',
        condition: 'All critical checks pass but warnings exist',
        strictBehavior: 'Allow build. Mark as READY with warnings.',
        permissiveBehavior: 'Same.',
        outcome: 'WARNING',
    },
    {
        scenario: 'Build with provider=none',
        condition: 'CRM disabled by configuration',
        strictBehavior: 'Allow build. Skip CRM checks. Mark as READY.',
        permissiveBehavior: 'Same.',
        outcome: 'SUCCESS',
    },

    // ── Identity Resolution Scenarios ──────────────────────────────
    {
        scenario: 'Phone identity with invalid format',
        condition: 'CRM_VALIDATE_PHONE=true AND phone fails regex',
        strictBehavior: 'BLOCK push. Return validation error.',
        permissiveBehavior: 'Attempt normalization. Push if fixable.',
        outcome: 'FAILURE',
    },
    {
        scenario: 'Email identity with no email collected',
        condition: 'CRM_IDENTITY_KEY=email AND email is null',
        strictBehavior: 'BLOCK push. Cannot identify contact without email.',
        permissiveBehavior: 'Fall back to phone if available.',
        outcome: 'FAILURE',
    },
    {
        scenario: 'ExternalId identity',
        condition: 'CRM_IDENTITY_KEY=externalid',
        strictBehavior: 'Use sessionId as externalId. Deterministic upsert.',
        permissiveBehavior: 'Same.',
        outcome: 'SUCCESS',
    },
];

// ── Get scenarios by outcome ───────────────────────────────────────────────

export function getScenariosByOutcome(outcome: RuntimeScenario['outcome']): RuntimeScenario[] {
    return RUNTIME_BEHAVIOR_MATRIX.filter(s => s.outcome === outcome);
}

export function getBlockingScenarios(): RuntimeScenario[] {
    return RUNTIME_BEHAVIOR_MATRIX.filter(s => s.outcome === 'BLOCKED' || s.outcome === 'FAILURE');
}
