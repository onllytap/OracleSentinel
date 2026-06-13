#!/usr/bin/env ts-node
// ============================================================================
// Debug CRM Dispatch Script — Test lead push to Twenty/Airtable
// ============================================================================
//
// Usage: npx ts-node scripts/debug-crm-dispatch.ts
//
// This script:
// 1. Loads environment configuration
// 2. Creates a test CDM lead (with generated PII)
// 3. Calls dispatchLeadToCRM via the connector
// 4. Reports success/failure with structured logs
// 5. Exit code: 0 = success, 1 = failure
// ============================================================================

import dotenv from 'dotenv';
import path from 'path';

// Load environment
dotenv.config({ path: path.join(__dirname, '../.env') });

import { getCRMConnector } from '../src/services/crm/crm-factory';
import type { CdmLead, CdmPerson } from '../src/services/crm/types';

// ---------------------------------------------------------------------------
// Test Data (No real PII)
// ---------------------------------------------------------------------------

function generateTestLead(): { lead: CdmLead; sessionId: string } {
    const timestamp = Date.now();
    const sessionId = `debug-${timestamp}`;

    const person: CdmPerson = {
        externalId: sessionId,
        firstName: 'Test',
        lastName: `Debug${timestamp % 1000}`,
        fullName: `Test Debug${timestamp % 1000}`,
        phone: `06${String(timestamp).slice(-8)}`, // Generated test phone
        email: `test.debug.${timestamp}@test.local`, // Generated test email
        qualificationScore: 75,
        qualificationLevel: 'WARM',
        source: 'CHATBOT',
    };

    const lead: CdmLead = {
        person,
        projectType: 'Debug Test',
        need: 'Testing CRM dispatch',
        location: 'Test Location',
        qualificationScore: 75,
        summary: 'Debug script test - this lead should be visible in CRM',
        notes: `Created by debug-crm-dispatch.ts at ${new Date().toISOString()}`,
    };

    return { lead, sessionId };
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     CRM Dispatch Debug Script                              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Get provider from env
    const provider = process.env.CRM_PROVIDER || 'airtable';
    console.log(`📋 Provider: ${provider}`);
    console.log(`📋 Base URL: ${process.env.TWENTY_API_URL || 'N/A'}`);
    console.log('');

    // Get connector
    let connector;
    try {
        connector = getCRMConnector();
        console.log(`✅ Connector loaded: ${connector.providerName}`);
    } catch (err) {
        console.error('❌ Failed to get CRM connector:', err);
        process.exit(1);
    }

    // Check configuration
    if (!connector.isConfigured()) {
        console.error('❌ CRM connector is not configured. Check environment variables.');
        process.exit(1);
    }
    console.log('✅ Connector is configured');

    // Test connection
    console.log('\n🔌 Testing connection...');
    const connected = await connector.testConnection();
    if (!connected) {
        console.error('❌ Connection test failed');
        process.exit(1);
    }
    console.log('✅ Connection test passed\n');

    // Generate test lead
    const { lead, sessionId } = generateTestLead();
    console.log('📝 Test lead generated:');
    console.log(`   sessionId: ${sessionId}`);
    console.log(`   phone: ${lead.person.phone?.slice(0, 4)}****`);
    console.log(`   score: ${lead.qualificationScore}`);
    console.log(`   level: ${lead.person.qualificationLevel}`);
    console.log('');

    // Push lead
    console.log('🚀 Pushing lead to CRM...\n');
    const startTime = Date.now();

    try {
        const result = await connector.pushLead(lead, sessionId);
        const durationMs = Date.now() - startTime;

        console.log('\n═══════════════════════════════════════════════════════════════');
        if (result.success) {
            console.log('✅ PUSH RESULT: SUCCESS');
            console.log(`   recordId: ${result.recordId || 'N/A'}`);
            console.log(`   duplicate: ${result.duplicate || false}`);
            console.log(`   duration: ${durationMs}ms`);
            console.log('\n🎉 Lead should now be visible in CRM People!');
            console.log('═══════════════════════════════════════════════════════════════\n');
            process.exit(0);
        } else {
            console.log('❌ PUSH RESULT: FAILED');
            console.log(`   error: ${result.error || 'Unknown'}`);
            console.log(`   duplicate: ${result.duplicate || false}`);
            console.log(`   duration: ${durationMs}ms`);
            console.log('\n⚠️ Check the structured logs above for details.');
            console.log('═══════════════════════════════════════════════════════════════\n');
            process.exit(1);
        }
    } catch (err) {
        console.error('\n❌ EXCEPTION during push:', err);
        process.exit(1);
    }
}

// Run
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
