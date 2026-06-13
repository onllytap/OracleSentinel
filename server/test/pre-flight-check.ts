/**
 * ═══════════════════════════════════════════════════════════════════════
 * PRE-FLIGHT CHECK - Verify system is ready for testing
 * ═══════════════════════════════════════════════════════════════════════
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

interface CheckResult {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
}

async function checkHealth(): Promise<CheckResult> {
    try {
        const response = await fetch(`${API_BASE_URL}/health`, {
            signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
            return {
                name: 'API Health',
                status: 'pass',
                message: 'Server is running'
            };
        } else {
            return {
                name: 'API Health',
                status: 'fail',
                message: `Server returned ${response.status}`
            };
        }
    } catch (error) {
        return {
            name: 'API Health',
            status: 'fail',
            message: `Cannot connect to ${API_BASE_URL}`
        };
    }
}

function checkEnvVars(): CheckResult[] {
    const results: CheckResult[] = [];
    
    const required = [
        'GROQ_API_KEY',
        'DATABASE_URL',
        'AIRTABLE_WEBHOOK_URL'
    ];
    
    const optional = [
        'GROQ_MODEL',
        'AIRTABLE_ENABLED',
        'AIRTABLE_MIN_SCORE'
    ];
    
    for (const key of required) {
        if (process.env[key]) {
            results.push({
                name: key,
                status: 'pass',
                message: 'Set'
            });
        } else {
            results.push({
                name: key,
                status: 'fail',
                message: 'Missing (REQUIRED)'
            });
        }
    }
    
    for (const key of optional) {
        if (process.env[key]) {
            results.push({
                name: key,
                status: 'pass',
                message: `Set (${process.env[key]})`
            });
        } else {
            results.push({
                name: key,
                status: 'warn',
                message: 'Not set (using default)'
            });
        }
    }
    
    return results;
}

async function runPreFlightCheck(): Promise<void> {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🔍 PRE-FLIGHT CHECK`);
    console.log(`${'═'.repeat(80)}\n`);
    
    // Check API Health
    console.log(`Checking API health...`);
    const healthCheck = await checkHealth();
    printResult(healthCheck);
    console.log();
    
    // Check Environment Variables
    console.log(`Checking environment variables...`);
    const envChecks = checkEnvVars();
    envChecks.forEach(check => printResult(check));
    console.log();
    
    // Summary
    const allChecks = [healthCheck, ...envChecks];
    const failures = allChecks.filter(c => c.status === 'fail');
    const warnings = allChecks.filter(c => c.status === 'warn');
    
    console.log(`${'═'.repeat(80)}`);
    console.log(`📊 SUMMARY`);
    console.log(`${'═'.repeat(80)}\n`);
    
    console.log(`Total Checks: ${allChecks.length}`);
    console.log(`✅ Passed: ${allChecks.length - failures.length - warnings.length}`);
    console.log(`⚠️  Warnings: ${warnings.length}`);
    console.log(`❌ Failed: ${failures.length}`);
    console.log();
    
    if (failures.length > 0) {
        console.error(`❌ Pre-flight check FAILED`);
        console.error(`\nPlease fix the following issues:\n`);
        failures.forEach(f => {
            console.error(`  - ${f.name}: ${f.message}`);
        });
        console.log();
        process.exit(1);
    } else if (warnings.length > 0) {
        console.warn(`⚠️  Pre-flight check passed with warnings`);
        console.warn(`\nConsider addressing:\n`);
        warnings.forEach(w => {
            console.warn(`  - ${w.name}: ${w.message}`);
        });
        console.log();
        console.log(`✅ System is ready for testing (with warnings)`);
    } else {
        console.log(`✅ All checks passed! System is ready for testing.`);
    }
    
    console.log(`\n${'═'.repeat(80)}\n`);
}

function printResult(result: CheckResult): void {
    const icon = result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
    console.log(`${icon} ${result.name}: ${result.message}`);
}

if (require.main === module) {
    runPreFlightCheck().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { runPreFlightCheck };
