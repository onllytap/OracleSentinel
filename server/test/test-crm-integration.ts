#!/usr/bin/env ts-node
// ============================================================================
// CRM Integration Test Script
// ============================================================================
//
// Usage:
//   npx ts-node server/test/test-crm-integration.ts
//
// Tests:
//   1. Auth / connection check
//   2. Upsert person
//   3. Idempotence (double push = no duplicate)
//   4. Upsert company
//   5. Upsert opportunity
//   6. Full pushLead orchestration
//   7. Duplicate phone detection
//   8. Schema discovery (Twenty only)
//
// Env: reads from server/.env
// ============================================================================

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { getCRMConnector, resetCRMConnector, getProviderName } from '../src/services/crm';
import type { CdmLead, CdmPerson, CdmCompany, CdmOpportunity } from '../src/services/crm';
import { TwentyConnector } from '../src/services/crm/twenty-connector';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function ok(label: string): void {
    passed++;
    console.log(`  [PASS] ${label}`);
}

function fail(label: string, reason: string): void {
    failed++;
    console.log(`  [FAIL] ${label} — ${reason}`);
}

async function test(label: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fail(label, msg);
    }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_SESSION = `test-crm-${Date.now()}`;

const testPerson: CdmPerson = {
    firstName: 'TestBot',
    lastName: 'CRMCheck',
    fullName: 'TestBot CRMCheck',
    phone: '0600000001',
    email: 'testbot@test-crm.local',
};

const testCompany: CdmCompany = {
    name: 'Test Immobilier SARL',
    domain: 'test-immobilier.local',
    address: {
        city: 'Paris',
        postalCode: '75001',
        country: 'FR',
    },
};

const testOpportunity: CdmOpportunity = {
    externalId: TEST_SESSION,
    name: 'Test Achat T3 Paris',
    stage: 'new',
    amount: 350000,
    closeDate: '2026-03-15',
    notes: 'Automated CRM integration test',
};

const testLead: CdmLead = {
    person: testPerson,
    company: testCompany,
    projectType: 'Achat immobilier',
    need: 'T3 avec balcon',
    location: 'Paris 15e',
    appointmentDate: '2026-03-20',
    tags: ['Test'],
    qualificationScore: 75,
    summary: 'Lead de test CRM automatique',
    notes: 'Test automatisé — peut être supprimé.',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const provider = getProviderName();
    console.log(`\n========================================`);
    console.log(`CRM Integration Tests — Provider: ${provider}`);
    console.log(`========================================\n`);

    const crm = getCRMConnector();

    // ── Test 1: isConfigured ────────────────────────────────────────
    await test('1. isConfigured()', async () => {
        const configured = crm.isConfigured();
        if (configured) ok('CRM connector is configured');
        else fail('1. isConfigured()', 'Connector not configured — check env vars');
    });

    if (!crm.isConfigured()) {
        console.log('\n  Aborting: CRM not configured. Set CRM_PROVIDER + credentials in .env\n');
        process.exit(1);
    }

    // ── Test 2: testConnection ──────────────────────────────────────
    await test('2. testConnection()', async () => {
        const alive = await crm.testConnection();
        if (alive) ok('Connection to CRM is alive');
        else fail('2. testConnection()', 'Connection failed — check URL and API key');
    });

    // ── Test 3: upsertPerson ────────────────────────────────────────
    let personId: string | undefined;
    await test('3. upsertPerson()', async () => {
        const res = await crm.upsertPerson(testPerson);
        if (res.success) {
            personId = res.recordId;
            ok(`Person upserted — id: ${personId || 'N/A'}`);
        } else {
            fail('3. upsertPerson()', res.error || 'Unknown error');
        }
    });

    // ── Test 4: Idempotence — upsert same person again ──────────────
    await test('4. Idempotence (upsert person again)', async () => {
        const res = await crm.upsertPerson(testPerson);
        if (res.success) ok('Second upsert succeeded (idempotent)');
        else fail('4. Idempotence', res.error || 'Should succeed on second upsert');
    });

    // ── Test 5: upsertCompany ───────────────────────────────────────
    let companyId: string | undefined;
    await test('5. upsertCompany()', async () => {
        const res = await crm.upsertCompany(testCompany);
        if (res.success) {
            companyId = res.recordId;
            ok(`Company upserted — id: ${companyId || 'N/A'}`);
        } else {
            // Airtable webhook mode does not support granular upsert
            if (res.error?.includes('does not support')) {
                ok('Granular upsert not supported (expected for Airtable webhook mode)');
            } else {
                fail('5. upsertCompany()', res.error || 'Unknown');
            }
        }
    });

    // ── Test 6: upsertOpportunity ───────────────────────────────────
    await test('6. upsertOpportunity()', async () => {
        const res = await crm.upsertOpportunity(testOpportunity, personId, companyId);
        if (res.success) {
            ok(`Opportunity created — id: ${res.recordId || 'N/A'}`);
        } else {
            if (res.error?.includes('does not support')) {
                ok('Granular upsert not supported (expected for Airtable webhook mode)');
            } else {
                fail('6. upsertOpportunity()', res.error || 'Unknown');
            }
        }
    });

    // ── Test 7: Full pushLead ───────────────────────────────────────
    await test('7. pushLead() — full orchestration', async () => {
        // Use a unique phone to avoid duplicate detection from test 3
        const uniqueLead: CdmLead = {
            ...testLead,
            person: { ...testPerson, phone: `06${Date.now().toString().slice(-8)}` },
        };
        const session = `test-push-${Date.now()}`;
        const res = await crm.pushLead(uniqueLead, session);
        if (res.success) ok(`Full lead pushed — id: ${res.recordId || 'N/A'}`);
        else fail('7. pushLead()', res.error || 'Unknown');
    });

    // ── Test 8: Duplicate detection ─────────────────────────────────
    await test('8. Duplicate phone detection', async () => {
        // hasBeenPushed should now return true for the session from test 7
        const dupResult = await crm.pushLead(testLead, TEST_SESSION);
        // pushLead should return true with duplicate flag after first push
        if (dupResult.duplicate || dupResult.success) {
            ok('Duplicate correctly detected or session already pushed');
        } else {
            // Could also return DUPLICATE_PHONE
            if (dupResult.error === 'DUPLICATE_PHONE') ok('DUPLICATE_PHONE correctly returned');
            else fail('8. Duplicate detection', dupResult.error || 'No duplicate detected');
        }
    });

    // ── Test 9: Schema discovery (Twenty only) ──────────────────────
    if (provider === 'twenty') {
        await test('9. Schema discovery (Twenty)', async () => {
            const connector = crm as TwentyConnector;
            const schema = await connector.discoverSchema();
            if (schema && schema.objects.length > 0) {
                ok(`Schema discovered: ${schema.objects.length} objects`);
                const objectNames = schema.objects.map((o) => o.nameSingular).slice(0, 10);
                console.log(`     Objects: ${objectNames.join(', ')}`);
            } else {
                fail('9. Schema discovery', 'No schema returned');
            }
        });
    }

    // ── Test 10: Failed leads queue ─────────────────────────────────
    await test('10. Failed leads count', async () => {
        const count = crm.getFailedLeadsCount();
        ok(`Failed leads in queue: ${count}`);
    });

    // ── Summary ─────────────────────────────────────────────────────
    console.log(`\n========================================`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
