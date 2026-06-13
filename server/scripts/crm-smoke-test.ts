// ============================================================================
// CRM Smoke Test — Diagnoses CRM push pipeline end-to-end
// ============================================================================
// Usage: cd server && npx ts-node scripts/crm-smoke-test.ts
//
// This script checks:
//   1. Environment configuration (CRM_PROVIDER, TWENTY_* vars)
//   2. Twenty API connectivity (auth + reachability)
//   3. Qualification gating logic (complete vs incomplete lead)
//   4. Simulated push with a test lead (optional, --push flag)
//
// Exit codes:
//   0 = all checks passed
//   1 = at least one check failed
// ============================================================================

import dotenv from 'dotenv';
import path from 'path';

// Load env BEFORE any other imports that depend on process.env
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

// ── Types ──────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function redact(value: string | undefined, visibleChars = 8): string {
  if (!value) return '(not set)';
  if (value.length <= visibleChars + 4) return '***';
  return value.slice(0, visibleChars) + '...' + value.slice(-4);
}

function icon(passed: boolean): string {
  return passed ? '✅' : '❌';
}

function printResult(r: CheckResult): void {
  console.log(`  ${icon(r.passed)} ${r.name}: ${r.message}`);
  if (r.details && Object.keys(r.details).length > 0) {
    for (const [k, v] of Object.entries(r.details)) {
      console.log(`      ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
}

// ── Check 1: Environment Configuration ─────────────────────────────────────

function checkEnvConfig(): CheckResult {
  const provider = (process.env.CRM_PROVIDER || '').trim().toLowerCase();
  const twentyEnabled = (process.env.TWENTY_ENABLED || '').trim().toLowerCase();
  const twentyApiUrl = (process.env.TWENTY_API_URL || '').trim();
  const twentyApiKey = (process.env.TWENTY_API_KEY || '').trim();
  const minScore = process.env.CRM_MIN_PUSH_SCORE || process.env.AIRTABLE_MIN_SCORE || '60';
  const botDomain = (process.env.BOT_DOMAIN || '').trim();
  const customFields = (process.env.TWENTY_CUSTOM_FIELDS || '').trim().toLowerCase();

  const issues: string[] = [];

  if (!provider) {
    issues.push('CRM_PROVIDER is not set (defaults to "none" = disabled)');
  } else if (provider === 'none') {
    issues.push('CRM_PROVIDER=none → CRM is DISABLED, no push will ever happen');
  } else if (provider !== 'twenty' && provider !== 'airtable') {
    issues.push(`CRM_PROVIDER="${provider}" is not a recognized value (expected: twenty|airtable|none)`);
  }

  if (provider === 'twenty') {
    if (twentyEnabled === 'false') {
      issues.push('TWENTY_ENABLED=false → Twenty connector is disabled even though CRM_PROVIDER=twenty');
    }
    if (!twentyApiUrl) {
      issues.push('TWENTY_API_URL is not set');
    } else if (!twentyApiUrl.startsWith('http')) {
      issues.push(`TWENTY_API_URL="${twentyApiUrl}" does not start with http/https`);
    }
    if (!twentyApiKey) {
      issues.push('TWENTY_API_KEY is not set');
    } else if (twentyApiKey.length < 20) {
      issues.push('TWENTY_API_KEY looks too short');
    } else if (twentyApiKey.includes('...') || twentyApiKey.includes('•••') || twentyApiKey === '***') {
      issues.push('TWENTY_API_KEY contains a REDACTED placeholder — not a real key');
    }
  }

  if (!botDomain) {
    issues.push('BOT_DOMAIN is not set (will default to "immobilier")');
  }

  const passed = issues.length === 0;

  return {
    name: 'Environment Configuration',
    passed,
    message: passed
      ? `CRM_PROVIDER=${provider}, BOT_DOMAIN=${botDomain || '(default:immobilier)'}, minScore=${minScore}`
      : `${issues.length} issue(s) found`,
    details: {
      CRM_PROVIDER: provider || '(not set → defaults to none)',
      BOT_DOMAIN: botDomain || '(not set → defaults to immobilier)',
      CRM_MIN_PUSH_SCORE: minScore,
      TWENTY_ENABLED: twentyEnabled || '(not set)',
      TWENTY_API_URL: twentyApiUrl ? redact(twentyApiUrl, 30) : '(not set)',
      TWENTY_API_KEY: redact(twentyApiKey),
      TWENTY_CUSTOM_FIELDS: customFields || '(not set)',
      ...(issues.length > 0 ? { ISSUES: issues.join('; ') } : {}),
    },
  };
}

// ── Check 2: Twenty API Connectivity ───────────────────────────────────────

async function checkTwentyConnection(): Promise<CheckResult> {
  const provider = (process.env.CRM_PROVIDER || 'none').trim().toLowerCase();

  if (provider !== 'twenty') {
    return {
      name: 'Twenty API Connectivity',
      passed: false,
      message: `Skipped — CRM_PROVIDER="${provider}" (not twenty)`,
    };
  }

  const baseUrl = (process.env.TWENTY_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.TWENTY_API_KEY || '';

  if (!baseUrl || !apiKey) {
    return {
      name: 'Twenty API Connectivity',
      passed: false,
      message: 'Cannot test — TWENTY_API_URL or TWENTY_API_KEY missing',
    };
  }

  const url = `${baseUrl}/rest/people?limit=1`;
  const t0 = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const ms = Date.now() - t0;
    const body = await res.text();

    let recordCount = 0;
    try {
      const json = JSON.parse(body);
      if (json?.data?.people) {
        recordCount = Array.isArray(json.data.people) ? json.data.people.length : 0;
      } else if (Array.isArray(json?.data)) {
        recordCount = json.data.length;
      }
    } catch { /* ignore parse errors */ }

    if (res.ok) {
      return {
        name: 'Twenty API Connectivity',
        passed: true,
        message: `HTTP ${res.status} OK in ${ms}ms (${recordCount} record(s) sampled)`,
        details: { url: redact(url, 40), responseTimeMs: ms },
      };
    }

    // Auth / permission errors
    const statusMessages: Record<number, string> = {
      401: 'UNAUTHORIZED — API key is invalid or expired',
      403: 'FORBIDDEN — API key lacks permissions for this workspace',
      404: 'NOT FOUND — base URL may be wrong (check TWENTY_API_URL)',
      422: 'UNPROCESSABLE — API URL may point to wrong endpoint',
    };

    return {
      name: 'Twenty API Connectivity',
      passed: false,
      message: statusMessages[res.status] || `HTTP ${res.status}: ${body.slice(0, 200)}`,
      details: { url: redact(url, 40), status: res.status, responseTimeMs: ms },
    };
  } catch (err: any) {
    const ms = Date.now() - t0;
    const msg = err.name === 'AbortError'
      ? 'Request timed out after 10s'
      : err.message || String(err);

    return {
      name: 'Twenty API Connectivity',
      passed: false,
      message: `Connection failed: ${msg}`,
      details: { url: redact(url, 40), responseTimeMs: ms },
    };
  }
}

// ── Check 3: CRM Factory Instantiation ─────────────────────────────────────

function checkCrmFactory(): CheckResult {
  try {
    // Dynamic import to get fresh singleton after env is loaded
    const { getCRMConnector, getProviderName } = require('../src/services/crm');
    const providerName = getProviderName();
    const connector = getCRMConnector();

    const configured = connector.isConfigured();

    if (providerName === 'none') {
      return {
        name: 'CRM Factory',
        passed: false,
        message: 'Provider is "none" — CRM is fully disabled. No push possible.',
        details: { providerName, isConfigured: configured },
      };
    }

    if (!configured) {
      return {
        name: 'CRM Factory',
        passed: false,
        message: `Provider "${connector.providerName}" is loaded but NOT configured (missing API key/URL?)`,
        details: { providerName: connector.providerName, isConfigured: false },
      };
    }

    return {
      name: 'CRM Factory',
      passed: true,
      message: `Provider "${connector.providerName}" loaded and configured`,
      details: { providerName: connector.providerName, isConfigured: true },
    };
  } catch (err: any) {
    return {
      name: 'CRM Factory',
      passed: false,
      message: `Failed to instantiate CRM connector: ${err.message}`,
    };
  }
}

// ── Check 4: Qualification Gating Logic ────────────────────────────────────

function checkGatingLogic(): CheckResult {
  try {
    const { QualificationService } = require('../src/services/qualification.service');

    const domain = QualificationService.getDomain();
    const contract = QualificationService.getContract();
    const minScore = parseInt(
      process.env.CRM_MIN_PUSH_SCORE || process.env.AIRTABLE_MIN_SCORE || '60',
      10,
    );

    // Simulate INCOMPLETE lead (like the bug symptom: only prenom, nom, phone)
    const incompleteLead = {
      prenom: 'Test',
      nom: 'Incomplete',
      numero_telephone: '0600000000',
    };
    const incompleteMissing = QualificationService.getMissingFields(incompleteLead);
    const incompleteScore = QualificationService.calculateScore(incompleteLead);
    const incompleteWouldPush = incompleteMissing.length === 0 && incompleteScore >= minScore;

    // Simulate COMPLETE lead (all required fields filled)
    const completeLead: Record<string, string> = {
      prenom: 'Test',
      nom: 'Complete',
      numero_telephone: '0600000000',
      email: 'test@example.com',
      type: domain === 'garage' ? 'Entretien' : 'Achat immobilier',
      besoin: domain === 'garage' ? 'Vidange + contrôle freins' : 'T3 centre-ville',
      adresse: 'Chartres',
      date_rdv: '2025-07-20',
    };
    const completeMissing = QualificationService.getMissingFields(completeLead);
    const completeScore = QualificationService.calculateScore(completeLead);
    const completeWouldPush = completeMissing.length === 0 && completeScore >= minScore;

    const passed = !incompleteWouldPush && completeWouldPush;

    return {
      name: 'Qualification Gating',
      passed,
      message: passed
        ? `Domain="${domain}" (${contract.name}) — gating works correctly`
        : `Gating issue: incomplete=${incompleteWouldPush ? 'WOULD PUSH (BAD)' : 'blocked (OK)'}, complete=${completeWouldPush ? 'would push (OK)' : 'BLOCKED (BAD)'}`,
      details: {
        domain,
        contractName: contract.name,
        requiredFields: contract.requiredFields.join(', '),
        minScore,
        'incomplete.score': `${incompleteScore}/100`,
        'incomplete.missing': incompleteMissing.join(', ') || 'none',
        'incomplete.wouldPush': incompleteWouldPush,
        'complete.score': `${completeScore}/100`,
        'complete.missing': completeMissing.join(', ') || 'none',
        'complete.wouldPush': completeWouldPush,
      },
    };
  } catch (err: any) {
    return {
      name: 'Qualification Gating',
      passed: false,
      message: `Failed: ${err.message}`,
    };
  }
}

// ── Check 5: Secret Integrity ──────────────────────────────────────────────

function checkSecretIntegrity(): CheckResult {
  const secrets: Record<string, string | undefined> = {
    TWENTY_API_KEY: process.env.TWENTY_API_KEY,
    TWENTY_API_URL: process.env.TWENTY_API_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  const issues: string[] = [];

  for (const [key, value] of Object.entries(secrets)) {
    if (!value) continue; // not set = OK (might not be needed)

    // Check for redacted placeholders
    if (/^.{2,}\.\.\..{2,}$/.test(value)) {
      issues.push(`${key} contains a redacted value (pattern: "xxx...yyy")`);
    }
    if (/^[•]{3,}$/.test(value)) {
      issues.push(`${key} contains bullet placeholder (•••)`);
    }
    if (/^\*{3,}$/.test(value)) {
      issues.push(`${key} contains asterisk placeholder (***)`);
    }
    if (value === '<webhook-secret-if-needed>' || value.startsWith('<') && value.endsWith('>')) {
      issues.push(`${key} contains a template placeholder: "${value}"`);
    }
  }

  const passed = issues.length === 0;
  return {
    name: 'Secret Integrity',
    passed,
    message: passed
      ? 'No redacted or placeholder secrets detected'
      : `${issues.length} issue(s): ${issues.join('; ')}`,
  };
}

// ── Check 6 (optional): Live Push Test ─────────────────────────────────────

async function checkLivePush(): Promise<CheckResult> {
  const provider = (process.env.CRM_PROVIDER || 'none').trim().toLowerCase();

  if (provider === 'none') {
    return {
      name: 'Live Push Test',
      passed: false,
      message: 'Skipped — CRM_PROVIDER=none',
    };
  }

  try {
    const { getCRMConnector } = require('../src/services/crm');
    const crm = getCRMConnector();

    if (!crm.isConfigured()) {
      return {
        name: 'Live Push Test',
        passed: false,
        message: `CRM connector "${crm.providerName}" is not configured`,
      };
    }

    // Build a test lead with clear test markers
    const testSessionId = `smoke-test-${Date.now()}`;
    const testPhone = `06${String(Date.now()).slice(-8)}`;

    const { QualificationService } = require('../src/services/qualification.service');
    const domain = QualificationService.getDomain();

    const testLead = {
      person: {
        externalId: `smoke-${testSessionId}`,
        firstName: 'SmokeTest',
        lastName: 'CRM',
        fullName: 'SmokeTest CRM',
        phone: testPhone,
        email: `smoke.test.${Date.now()}@test.local`,
        qualificationScore: 85,
        qualificationLevel: 'HOT' as const,
        source: 'CHATBOT' as const,
      },
      projectType: domain === 'garage' ? 'Diagnostic' : 'Achat immobilier',
      need: domain === 'garage' ? 'Test smoke CRM - vidange' : 'Test smoke CRM - T3',
      location: 'Chartres (SMOKE TEST)',
      qualificationScore: 85,
      summary: `[SMOKE TEST] CRM push verification at ${new Date().toISOString()}`,
      notes: 'This is an automated smoke test record. Safe to delete.',
      agentNote: 'Lead de test automatique — diagnostic CRM.',
    };

    const t0 = Date.now();
    const result = await crm.pushLead(testLead, testSessionId);
    const ms = Date.now() - t0;

    if (result.success) {
      return {
        name: 'Live Push Test',
        passed: true,
        message: `Push SUCCESS in ${ms}ms — recordId=${result.recordId?.slice(0, 12) || 'N/A'}`,
        details: {
          recordId: result.recordId || 'N/A',
          durationMs: ms,
          provider: crm.providerName,
          testPhone,
        },
      };
    }

    return {
      name: 'Live Push Test',
      passed: false,
      message: `Push FAILED in ${ms}ms — ${result.error || 'unknown error'}`,
      details: {
        error: result.error,
        duplicate: result.duplicate,
        durationMs: ms,
        provider: crm.providerName,
      },
    };
  } catch (err: any) {
    return {
      name: 'Live Push Test',
      passed: false,
      message: `Exception: ${err.message}`,
    };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doPush = args.includes('--push');

  console.log('');
  console.log('═'.repeat(60));
  console.log('  CRM SMOKE TEST — OracleSentinel');
  console.log('═'.repeat(60));
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Mode: ${doPush ? 'FULL (with live push)' : 'DRY RUN (add --push to test live push)'}`);
  console.log('═'.repeat(60));
  console.log('');

  const results: CheckResult[] = [];

  // Synchronous checks
  console.log('─── 1/5 Environment Configuration ───────────────────────');
  const envResult = checkEnvConfig();
  results.push(envResult);
  printResult(envResult);
  console.log('');

  console.log('─── 2/5 Twenty API Connectivity ─────────────────────────');
  const connResult = await checkTwentyConnection();
  results.push(connResult);
  printResult(connResult);
  console.log('');

  console.log('─── 3/5 CRM Factory Instantiation ──────────────────────');
  const factoryResult = checkCrmFactory();
  results.push(factoryResult);
  printResult(factoryResult);
  console.log('');

  console.log('─── 4/5 Qualification Gating Logic ─────────────────────');
  const gatingResult = checkGatingLogic();
  results.push(gatingResult);
  printResult(gatingResult);
  console.log('');

  console.log('─── 5/5 Secret Integrity ───────────────────────────────');
  const secretResult = checkSecretIntegrity();
  results.push(secretResult);
  printResult(secretResult);
  console.log('');

  // Optional live push
  if (doPush) {
    console.log('─── 6/6 Live Push Test (--push) ────────────────────────');
    const pushResult = await checkLivePush();
    results.push(pushResult);
    printResult(pushResult);
    console.log('');
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log('═'.repeat(60));
  if (failed === 0) {
    console.log(`  ✅ ALL ${total} CHECKS PASSED`);
  } else {
    console.log(`  ❌ ${failed}/${total} CHECKS FAILED:`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`     • ${r.name}: ${r.message}`);
    }
  }
  console.log('═'.repeat(60));
  console.log('');

  // Actionable fix suggestions
  if (failed > 0) {
    console.log('💡 SUGGESTED FIXES:');
    console.log('');

    if (!envResult.passed) {
      const provider = (process.env.CRM_PROVIDER || '').trim().toLowerCase();
      if (!provider || provider === 'none') {
        console.log('  1. Set CRM_PROVIDER=twenty in server/.env (line ~64)');
        console.log('     Current: CRM_PROVIDER=' + (provider || '(not set)'));
        console.log('     Fix:     CRM_PROVIDER=twenty');
        console.log('');
      }
    }

    if (!connResult.passed && connResult.message.includes('401')) {
      console.log('  2. TWENTY_API_KEY is invalid or expired.');
      console.log('     Generate a new one at: Settings > API Keys in your Twenty instance.');
      console.log('');
    }

    if (!factoryResult.passed) {
      console.log('  3. CRM Factory failed to instantiate. Check:');
      console.log('     - CRM_PROVIDER is set to "twenty" or "airtable"');
      console.log('     - TWENTY_API_KEY and TWENTY_API_URL are valid');
      console.log('     - Run: npx ts-node scripts/validate-crm-config.ts');
      console.log('');
    }

    if (!gatingResult.passed) {
      console.log('  4. Qualification gating is misconfigured. Check:');
      console.log('     - BOT_DOMAIN matches the domain contract in qualification.service.ts');
      console.log('     - requiredFields in the contract match what the bot actually collects');
      console.log('     - CRM_MIN_PUSH_SCORE is reasonable (default: 60)');
      console.log('');
    }

    if (!secretResult.passed) {
      console.log('  5. Secret integrity issue detected. The Factory UI may have');
      console.log('     overwritten real secrets with redacted placeholders.');
      console.log('     Restore from backup: cp server/.env.backup.<timestamp> server/.env');
      console.log('');
    }

    console.log('After fixing, re-run: npx ts-node scripts/crm-smoke-test.ts');
    if (!doPush) {
      console.log('To also test a live push: npx ts-node scripts/crm-smoke-test.ts --push');
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in CRM smoke test:', err);
  process.exit(1);
});
