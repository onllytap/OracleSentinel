# ============================================================================
# Factory + CRM Smoke Test — Windows PowerShell
# ============================================================================
# Tests the full Factory pipeline AND CRM push pipeline
#
# Usage:
#   .\scripts\factory-smoke.ps1              # Basic checks
#   .\scripts\factory-smoke.ps1 -LivePush    # Also push a test lead to CRM
#
# Exit codes:
#   0 = all checks passed
#   1 = at least one check failed
# ============================================================================

param(
    [switch]$LivePush,
    [string]$BaseUrl = "http://localhost:3001"
)

Write-Host ""
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host "  FACTORY + CRM SMOKE TEST — OracleSentinel" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host "  Date: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
Write-Host "  Mode: $(if ($LivePush) { 'FULL (with live push)' } else { 'DRY RUN (add -LivePush for live test)' })"
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"
$TestsPassed = 0
$TestsFailed = 0
$TestsSkipped = 0
$FailedNames = @()

# ── Helper Functions ────────────────────────────────────────────────────────

function Log-Pass {
    param([string]$Name, [string]$Message)
    Write-Host "  ✅ ${Name}: $Message" -ForegroundColor Green
    $script:TestsPassed++
}

function Log-Fail {
    param([string]$Name, [string]$Message)
    Write-Host "  ❌ ${Name}: $Message" -ForegroundColor Red
    $script:TestsFailed++
    $script:FailedNames += $Name
}

function Log-Skip {
    param([string]$Name, [string]$Message)
    Write-Host "  ⏭️  ${Name}: $Message" -ForegroundColor Yellow
    $script:TestsSkipped++
}

function Log-Info {
    param([string]$Message)
    Write-Host "      $Message" -ForegroundColor DarkGray
}

function Test-ServerRunning {
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-EnvValue {
    param([string]$Key, [string]$EnvContent)
    $pattern = "(?m)^${Key}=(.+)$"
    if ($EnvContent -match $pattern) {
        return $matches[1].Trim().Trim('"').Trim("'")
    }
    return $null
}

# ── Load server/.env ────────────────────────────────────────────────────────

$envPath = "server\.env"
$envContent = ""

if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw -ErrorAction SilentlyContinue
} else {
    Write-Host "⚠️  server\.env not found! Most checks will fail." -ForegroundColor Red
    Write-Host ""
}

# ════════════════════════════════════════════════════════════════════════════
# SECTION 1: PREREQUISITES
# ════════════════════════════════════════════════════════════════════════════

Write-Host "─── 1/7 Prerequisites ──────────────────────────────────" -ForegroundColor Cyan

# Node.js
try {
    $nodeVersion = (node --version 2>&1).ToString().Trim()
    Log-Pass "Node.js" "Installed ($nodeVersion)"
} catch {
    Log-Fail "Node.js" "Not found. Install from https://nodejs.org"
}

# server/.env exists
if (Test-Path $envPath) {
    $envSize = (Get-Item $envPath).Length
    $lineCount = ($envContent -split "`n").Count
    Log-Pass "server/.env" "Found (${lineCount} lines, ${envSize} bytes)"
} else {
    Log-Fail "server/.env" "File not found"
}

Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# SECTION 2: DOMAIN CONFIGURATION
# ════════════════════════════════════════════════════════════════════════════

Write-Host "─── 2/7 Domain Configuration ───────────────────────────" -ForegroundColor Cyan

$botDomain = Get-EnvValue "BOT_DOMAIN" $envContent

if ($botDomain) {
    $validDomains = @("immobilier", "immo", "garage", "automobile", "auto", "generic")
    if ($validDomains -contains $botDomain.ToLower()) {
        Log-Pass "BOT_DOMAIN" "Set to '$botDomain'"
    } else {
        Log-Fail "BOT_DOMAIN" "Value '$botDomain' is not recognized (expected: immobilier|garage|generic)"
    }
} else {
    Log-Fail "BOT_DOMAIN" "Not set — will default to 'immobilier'. Set BOT_DOMAIN=garage (or other) explicitly."
}

Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# SECTION 3: CRM PROVIDER CONFIGURATION (P0 CHECK)
# ════════════════════════════════════════════════════════════════════════════

Write-Host "─── 3/7 CRM Provider Configuration (P0) ────────────────" -ForegroundColor Cyan

$crmProvider = Get-EnvValue "CRM_PROVIDER" $envContent
$twentyEnabled = Get-EnvValue "TWENTY_ENABLED" $envContent
$twentyApiUrl = Get-EnvValue "TWENTY_API_URL" $envContent
$twentyApiKey = Get-EnvValue "TWENTY_API_KEY" $envContent
$minPushScore = Get-EnvValue "CRM_MIN_PUSH_SCORE" $envContent
$airtableMinScore = Get-EnvValue "AIRTABLE_MIN_SCORE" $envContent
$twentyCustomFields = Get-EnvValue "TWENTY_CUSTOM_FIELDS" $envContent

# CRM_PROVIDER
if (-not $crmProvider) {
    Log-Fail "CRM_PROVIDER" "NOT SET — defaults to 'none' (CRM disabled). Set CRM_PROVIDER=twenty"
} elseif ($crmProvider -eq "none") {
    Log-Fail "CRM_PROVIDER" "Set to 'none' — CRM is DISABLED. No push will ever happen. FIX: CRM_PROVIDER=twenty"
} elseif ($crmProvider -eq "twenty") {
    Log-Pass "CRM_PROVIDER" "Set to 'twenty'"
} elseif ($crmProvider -eq "airtable") {
    Log-Pass "CRM_PROVIDER" "Set to 'airtable'"
} else {
    Log-Fail "CRM_PROVIDER" "Unknown value '$crmProvider' (expected: twenty|airtable|none)"
}

# TWENTY_API_URL
if ($crmProvider -eq "twenty") {
    if ($twentyApiUrl -and $twentyApiUrl.StartsWith("http")) {
        Log-Pass "TWENTY_API_URL" "Set ($($twentyApiUrl.Substring(0, [Math]::Min(40, $twentyApiUrl.Length)))...)"
    } elseif ($twentyApiUrl) {
        Log-Fail "TWENTY_API_URL" "Value '$twentyApiUrl' does not start with http/https"
    } else {
        Log-Fail "TWENTY_API_URL" "Not set (required when CRM_PROVIDER=twenty)"
    }

    # TWENTY_API_KEY
    if ($twentyApiKey -and $twentyApiKey.Length -gt 20) {
        $keyPreview = $twentyApiKey.Substring(0, 8) + "..." + $twentyApiKey.Substring($twentyApiKey.Length - 4)
        Log-Pass "TWENTY_API_KEY" "Set ($keyPreview)"

        # Check for redacted values
        if ($twentyApiKey -match '\.\.\.') {
            Log-Fail "TWENTY_API_KEY (integrity)" "Contains '...' — looks like a REDACTED placeholder, not a real key"
        }
    } elseif ($twentyApiKey) {
        Log-Fail "TWENTY_API_KEY" "Set but looks too short ($($twentyApiKey.Length) chars)"
    } else {
        Log-Fail "TWENTY_API_KEY" "Not set (required when CRM_PROVIDER=twenty)"
    }

    # TWENTY_ENABLED
    if ($twentyEnabled -eq "false") {
        Log-Fail "TWENTY_ENABLED" "Set to 'false' — Twenty connector is disabled despite CRM_PROVIDER=twenty"
    } else {
        Log-Pass "TWENTY_ENABLED" "OK ($($twentyEnabled ?? 'true (default)'))"
    }

    # TWENTY_CUSTOM_FIELDS
    if ($twentyCustomFields) {
        Log-Info "TWENTY_CUSTOM_FIELDS=$twentyCustomFields"
    }
} else {
    Log-Skip "TWENTY_*" "Skipped — CRM_PROVIDER is not 'twenty'"
}

# Min push score
$effectiveMinScore = if ($minPushScore) { $minPushScore } elseif ($airtableMinScore) { $airtableMinScore } else { "60 (default)" }
Log-Info "Effective min push score: $effectiveMinScore"

Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# SECTION 4: TWENTY API CONNECTIVITY
# ════════════════════════════════════════════════════════════════════════════

Write-Host "─── 4/7 Twenty API Connectivity ────────────────────────" -ForegroundColor Cyan

if ($crmProvider -eq "twenty" -and $twentyApiUrl -and $twentyApiKey) {
    $testUrl = "$($twentyApiUrl.TrimEnd('/'))/rest/people?limit=1"
    try {
        $headers = @{
            "Authorization" = "Bearer $twentyApiKey"
            "Content-Type" = "application/json"
        }
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $response = Invoke-WebRequest -Uri $testUrl -Method GET -Headers $headers -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        $stopwatch.Stop()
        $ms = $stopwatch.ElapsedMilliseconds

        if ($response.StatusCode -eq 200) {
            Log-Pass "Twenty API" "HTTP 200 OK in ${ms}ms"

            # Try to parse the response to check for records
            try {
                $json = $response.Content | ConvertFrom-Json
                $recordCount = 0
                if ($json.data.people) {
                    $recordCount = @($json.data.people).Count
                }
                Log-Info "Response contains $recordCount record(s)"
            } catch {
                Log-Info "Response received but could not parse JSON"
            }
        } else {
            Log-Fail "Twenty API" "HTTP $($response.StatusCode)"
        }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }

        if ($statusCode -eq 401) {
            Log-Fail "Twenty API" "HTTP 401 UNAUTHORIZED — API key is invalid or expired"
        } elseif ($statusCode -eq 403) {
            Log-Fail "Twenty API" "HTTP 403 FORBIDDEN — API key lacks permissions"
        } elseif ($statusCode -eq 404) {
            Log-Fail "Twenty API" "HTTP 404 NOT FOUND — check TWENTY_API_URL"
        } else {
            Log-Fail "Twenty API" "Connection failed: $($_.Exception.Message)"
        }
    }
} else {
    Log-Skip "Twenty API" "Skipped — CRM_PROVIDER is not 'twenty' or missing URL/key"
}

Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# SECTION 5: SECRET INTEGRITY
# ════════════════════════════════════════════════════════════════════════════

Write-Host "─── 5/7 Secret Integrity ───────────────────────────────" -ForegroundColor Cyan

$secretKeys = @("TWENTY_API_KEY", "DATABASE_URL", "GROQ_API_KEY", "JWT_SECRET", "ADMIN_API_KEY")
$secretIssues = 0

foreach ($key in $secretKeys) {
    $val = Get-EnvValue $key $envContent
    if (-not $val) { continue }

    $isRedacted = $false
    if ($val -match '^.{2,}\.\.\..{2,}$') { $isRedacted = $true }
    if ($val -match '^\*{3,}$') { $isRedacted = $true }
    if ($val -match '^[•]{3,}$') { $isRedacted = $true }
    if ($val -match '^<.+>$') { $isRedacted = $true }

    if ($isRedacted) {
        Log-Fail "$key integrity" "Contains a REDACTED or placeholder value — Factory may have overwritten it"
        $secretIssues++
    }
}

if ($secretIssues -eq 0) {
    Log-Pass "Secret Integrity" "No redacted or placeholder secrets detected"
}

Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# SECTION 6: SERVER + FACTORY ENDPOINTS
# ════════════════════════════════════════════════════════════════════════════

Write-Host "─── 6/7 Server + Factory Endpoints ─────────────────────" -ForegroundColor Cyan

if (Test-ServerRunning) {
    Log-Pass "Server Health" "Running at $BaseUrl"

    # Test /factory
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/factory" -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Log-Pass "GET /factory" "HTTP 200 OK"
        } else {
            Log-Fail "GET /factory" "HTTP $($response.StatusCode)"
        }
    } catch {
        $sc = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "N/A" }
        if ($sc -eq 401 -or $sc -eq 403) {
            Log-Pass "GET /factory" "HTTP $sc (endpoint exists, auth required)"
        } else {
            Log-Fail "GET /factory" "Failed: $($_.Exception.Message)"
        }
    }

    # Test chat endpoint
    try {
        $chatBody = @{
            message = "test smoke"
            sessionId = "smoke-ps1-$(Get-Date -Format 'yyyyMMddHHmmss')"
        } | ConvertTo-Json

        $response = Invoke-WebRequest -Uri "$BaseUrl/api/chat" -Method POST `
            -Body $chatBody `
            -ContentType "application/json" `
            -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop

        if ($response.StatusCode -eq 200) {
            Log-Pass "POST /api/chat" "HTTP 200 OK (bot responds)"
            try {
                $chatJson = $response.Content | ConvertFrom-Json
                if ($chatJson.qualification) {
                    Log-Info "Qualification: score=$($chatJson.qualification.score), isComplete=$($chatJson.qualification.isComplete), pushedToCRM=$($chatJson.qualification.pushedToCRM)"
                }
            } catch { }
        } else {
            Log-Fail "POST /api/chat" "HTTP $($response.StatusCode)"
        }
    } catch {
        Log-Fail "POST /api/chat" "Failed: $($_.Exception.Message)"
    }
} else {
    Log-Skip "Server Endpoints" "Server not running at $BaseUrl. Start with: cd server && npm run dev"
}

Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# SECTION 7: LIVE CRM PUSH TEST (optional)
# ════════════════════════════════════════════════════════════════════════════

Write-Host "─── 7/7 Live CRM Push Test ─────────────────────────────" -ForegroundColor Cyan

if ($LivePush) {
    if ($crmProvider -ne "twenty") {
        Log-Skip "Live Push" "CRM_PROVIDER is not 'twenty'"
    } elseif (-not $twentyApiUrl -or -not $twentyApiKey) {
        Log-Fail "Live Push" "Missing TWENTY_API_URL or TWENTY_API_KEY"
    } else {
        $pushUrl = "$($twentyApiUrl.TrimEnd('/'))/rest/people"
        $testTimestamp = Get-Date -Format 'yyyyMMddHHmmss'
        $testPhone = "06$($testTimestamp.Substring($testTimestamp.Length - 8))"

        $pushPayload = @{
            name = @{
                firstName = "SmokeTest"
                lastName = "PowerShell"
            }
            phones = @{
                primaryPhoneNumber = $testPhone
                primaryPhoneCountryCode = "FR"
            }
            emails = @{
                primaryEmail = "smoke.test.ps1.$testTimestamp@test.local"
            }
        } | ConvertTo-Json -Depth 5

        try {
            $headers = @{
                "Authorization" = "Bearer $twentyApiKey"
                "Content-Type" = "application/json"
            }
            $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            $response = Invoke-WebRequest -Uri $pushUrl -Method POST -Headers $headers -Body $pushPayload -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
            $stopwatch.Stop()
            $ms = $stopwatch.ElapsedMilliseconds

            if ($response.StatusCode -in @(200, 201)) {
                try {
                    $json = $response.Content | ConvertFrom-Json
                    $recordId = if ($json.data.id) { $json.data.id } elseif ($json.id) { $json.id } else { "N/A" }
                    Log-Pass "Live Push" "HTTP $($response.StatusCode) in ${ms}ms — recordId=$($recordId.Substring(0, [Math]::Min(12, $recordId.Length)))..."
                } catch {
                    Log-Pass "Live Push" "HTTP $($response.StatusCode) in ${ms}ms (could not parse recordId)"
                }
            } else {
                Log-Fail "Live Push" "HTTP $($response.StatusCode) in ${ms}ms"
            }
        } catch {
            $sc = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "N/A" }
            Log-Fail "Live Push" "Failed (HTTP $sc): $($_.Exception.Message)"
        }
    }
} else {
    Log-Skip "Live Push" "Add -LivePush flag to test: .\scripts\factory-smoke.ps1 -LivePush"
}

Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════════════════════

$total = $TestsPassed + $TestsFailed
Write-Host ("=" * 60) -ForegroundColor Cyan

if ($TestsFailed -eq 0) {
    Write-Host "  ✅ ALL $TestsPassed/$total CHECKS PASSED ($TestsSkipped skipped)" -ForegroundColor Green
} else {
    Write-Host "  ❌ $TestsFailed/$total CHECKS FAILED ($TestsPassed passed, $TestsSkipped skipped)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Failed checks:" -ForegroundColor Red
    foreach ($name in $FailedNames) {
        Write-Host "    • $name" -ForegroundColor Red
    }
}

Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host ""

# ── Actionable Fix Suggestions ──────────────────────────────────────────────

if ($TestsFailed -gt 0) {
    Write-Host "💡 SUGGESTED FIXES:" -ForegroundColor Yellow
    Write-Host ""

    if ($crmProvider -ne "twenty") {
        Write-Host "  ► CRM_PROVIDER: Change 'CRM_PROVIDER=none' to 'CRM_PROVIDER=twenty' in server\.env" -ForegroundColor Yellow
    }

    if (-not $botDomain) {
        Write-Host "  ► BOT_DOMAIN: Add 'BOT_DOMAIN=garage' (or other domain) in server\.env" -ForegroundColor Yellow
    }

    if ($FailedNames -contains "Twenty API") {
        Write-Host "  ► Twenty API: Verify TWENTY_API_URL and TWENTY_API_KEY in server\.env" -ForegroundColor Yellow
        Write-Host "    Generate a new API key at: Settings > API Keys in your Twenty instance" -ForegroundColor Yellow
    }

    if ($secretIssues -gt 0) {
        Write-Host "  ► Secrets: Restore from backup: copy server\.env.backup.<timestamp> server\.env" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  After fixing, re-run: .\scripts\factory-smoke.ps1" -ForegroundColor Yellow
    Write-Host "  For Node.js smoke test: cd server && npx ts-node scripts/crm-smoke-test.ts" -ForegroundColor Yellow
    Write-Host ""
}

exit $(if ($TestsFailed -gt 0) { 1 } else { 0 })
