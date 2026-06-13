# ============================================================================
# P0 Validation Script — Verify domain change correctness
# ============================================================================
# Usage: .\scripts\validate-p0.ps1
# ============================================================================

Write-Host "🔍 P0 VALIDATION — Domain Change Correctness" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"
$failed = $false

function Test-Pass {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Test-Fail {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
    $script:failed = $true
}

function Test-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Yellow
}

# ── Test 1: BOT_DOMAIN exists ───────────────────────────────────────────────

Write-Host "📋 Test 1: BOT_DOMAIN configuration..." -ForegroundColor Cyan

if (Test-Path "server\.env") {
    $envContent = Get-Content "server\.env" -Raw
    if ($envContent -match "BOT_DOMAIN\s*=\s*(\w+)") {
        $domain = $matches[1]
        Test-Pass "BOT_DOMAIN found: $domain"

        if ($domain -in @("immobilier", "garage", "generic")) {
            Test-Pass "BOT_DOMAIN value is valid"
        } else {
            Test-Fail "BOT_DOMAIN='$domain' is not a valid domain (immobilier|garage|generic)"
        }
    } else {
        Test-Fail "BOT_DOMAIN not found in server\.env"
    }
} else {
    Test-Fail "server\.env not found"
}

Write-Host ""

# ── Test 2: AIRTABLE_MIN_SCORE valid ────────────────────────────────────────

Write-Host "📋 Test 2: AIRTABLE_MIN_SCORE..." -ForegroundColor Cyan

if (Test-Path "server\.env") {
    $envContent = Get-Content "server\.env" -Raw
    if ($envContent -match "AIRTABLE_MIN_SCORE\s*=\s*(\d+)") {
        $score = [int]$matches[1]
        if ($score -ge 40) {
            Test-Pass "AIRTABLE_MIN_SCORE=$score (>= 40)"
        } else {
            Test-Fail "AIRTABLE_MIN_SCORE=$score is too low (minimum 40)"
        }
    } else {
        Test-Info "AIRTABLE_MIN_SCORE not set (will use default)"
    }
}

Write-Host ""

# ── Test 3: Domain Contract exists ──────────────────────────────────────────

Write-Host "📋 Test 3: Domain Contract existence..." -ForegroundColor Cyan

if (Test-Path "server\src\services\qualification.service.ts") {
    $qualContent = Get-Content "server\src\services\qualification.service.ts" -Raw

    if ($qualContent -match 'immobilier:\s*\{') {
        Test-Pass "Domain Contract 'immobilier' exists"
    } else {
        Test-Fail "Domain Contract 'immobilier' not found"
    }

    if ($qualContent -match 'garage:\s*\{') {
        Test-Pass "Domain Contract 'garage' exists"
    } else {
        Test-Fail "Domain Contract 'garage' not found"
    }
} else {
    Test-Fail "qualification.service.ts not found"
}

Write-Host ""

# ── Test 4: Placeholders in prompts.ts ──────────────────────────────────────

Write-Host "📋 Test 4: System Prompt placeholders..." -ForegroundColor Cyan

if (Test-Path "server\src\core\prompts.ts") {
    $promptContent = Get-Content "server\src\core\prompts.ts" -Raw

    if ($promptContent -match '\{DYNAMIC_VARIABLES\}') {
        Test-Pass "{DYNAMIC_VARIABLES} placeholder present"
    } else {
        Test-Fail "{DYNAMIC_VARIABLES} placeholder MISSING"
    }

    if ($promptContent -match '\{CHAT_TURN_HINT\}') {
        Test-Pass "{CHAT_TURN_HINT} placeholder present"
    } else {
        Test-Fail "{CHAT_TURN_HINT} placeholder MISSING"
    }

    if ($promptContent -match 'ANTI-HALLUCINATION.*RENDEZ-VOUS') {
        Test-Pass "Anti-hallucination RDV section present"
    } else {
        Test-Fail "Anti-hallucination RDV section MISSING"
    }
} else {
    Test-Fail "prompts.ts not found"
}

Write-Host ""

# ── Test 5: TypeScript compilation ──────────────────────────────────────────

Write-Host "📋 Test 5: TypeScript compilation..." -ForegroundColor Cyan

try {
    Push-Location "server"
    $output = & npx tsc --noEmit 2>&1
    if ($LASTEXITCODE -eq 0) {
        Test-Pass "TypeScript compiles without errors"
    } else {
        Test-Fail "TypeScript compilation failed:`n$output"
    }
    Pop-Location
} catch {
    Test-Fail "Failed to run tsc: $_"
    Pop-Location
}

Write-Host ""

# ── Test 6: No silent catch on buildQualificationHint ───────────────────────

Write-Host "📋 Test 6: buildQualificationHint error handling..." -ForegroundColor Cyan

if (Test-Path "server\src\services\chat.service.ts") {
    $chatContent = Get-Content "server\src\services\chat.service.ts" -Raw

    # Look for the catch block around buildQualificationHint
    if ($chatContent -match 'catch\s*\([^)]*\)\s*\{\s*\/\/\s*Non-blocking') {
        Test-Fail "Silent catch found on buildQualificationHint (CRITICAL BUG)"
    } elseif ($chatContent -match 'catch\s*\([^)]*\)\s*\{\s*\/\/\s*CRITICAL') {
        Test-Pass "buildQualificationHint has proper error handling"
    } else {
        Test-Info "Could not verify buildQualificationHint error handling (manual check required)"
    }
} else {
    Test-Fail "chat.service.ts not found"
}

Write-Host ""

# ── Final Summary ───────────────────────────────────────────────────────────

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
if ($failed) {
    Write-Host "❌ P0 VALIDATION FAILED" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please fix the issues above before proceeding." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "✅ P0 VALIDATION PASSED" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Start server: cd server && npm run dev"
    Write-Host "  2. Test conversation (see GUIDE_CHANGEMENT_DOMAINE.md)"
    Write-Host "  3. Verify logs show correct Domain"
}
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
