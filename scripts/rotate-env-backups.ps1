<#
.SYNOPSIS
    Retention helper for .env.backup.* files (security findings F5 / F14).

.DESCRIPTION
    The factory writes timestamped .env.backup.* files to the project root.
    They are gitignored (never pushed) but live in CLEARTEXT on disk and are a
    secret-leak surface if the VPS/backup is compromised.

    This script keeps the N most recent backups and lists the older ones for
    purge. It is SAFE BY DEFAULT:

        * Without -Force it runs a DRY-RUN (Remove-Item -WhatIf): it only shows
          what WOULD be removed and deletes NOTHING.
        * It NEVER deletes the N most recent backups.
        * Real deletion happens only when you pass -Force explicitly.

    This is a deliberate operator decision (handoff rule: no automatic
    deletion). Prefer moving secrets to a vault over keeping disk backups.

.PARAMETER Path
    Directory containing the .env.backup.* files. Defaults to the repo root
    (the parent of this scripts/ folder).

.PARAMETER KeepCount
    Number of most-recent backups to keep. Default: 3.

.PARAMETER Force
    Actually delete the older backups. Omit for a dry-run (default).

.EXAMPLE
    # Dry-run (default) - shows what would be purged, deletes nothing:
    .\scripts\rotate-env-backups.ps1

.EXAMPLE
    # Keep the 5 most recent, preview only:
    .\scripts\rotate-env-backups.ps1 -KeepCount 5

.EXAMPLE
    # Actually purge older backups (keeps the 3 most recent):
    .\scripts\rotate-env-backups.ps1 -Force

.NOTES
    Hardening recommendations for the VPS (not performed by this script):
      * Store secrets in a vault (e.g. SOPS/age, HashiCorp Vault, 1Password) and
        stop writing plaintext backups to the web root.
      * Keep the live .env outside the web-served directory.
      * Restrict permissions to the owner only:  chmod 600 .env .env.backup.*
      * Rotate credentials periodically; deleting an old backup does NOT rotate
        the secrets it contained.
#>

[CmdletBinding()]
param(
    [string]$Path = (Split-Path -Parent $PSScriptRoot),
    [int]$KeepCount = 3,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Title($m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m)    { Write-Host "OK   $m" -ForegroundColor Green }
function Write-Note($m)  { Write-Host "..   $m" -ForegroundColor Yellow }

Write-Title "env-backup retention"
Write-Host  "Path      : $Path"
Write-Host  "KeepCount : $KeepCount"
if ($Force) { $modeText = "DELETE (-Force)" } else { $modeText = "DRY-RUN (default, nothing is deleted)" }
Write-Host  "Mode      : $modeText"
Write-Host  ""

if ($KeepCount -lt 1) {
    throw "KeepCount must be >= 1 (refusing to delete every backup)."
}
if (-not (Test-Path -LiteralPath $Path)) {
    throw "Path not found: $Path"
}

# Match .env.backup.<timestamp> and *.env.backup* variants, files only.
$backups = Get-ChildItem -LiteralPath $Path -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like ".env.backup.*" -or $_.Name -like "*.env.backup*" } |
    Sort-Object LastWriteTime -Descending

if (-not $backups -or @($backups).Count -eq 0) {
    Write-Ok "No .env.backup.* files found. Nothing to do."
    return
}

Write-Host "Found $(@($backups).Count) backup file(s):" -ForegroundColor Cyan
$index = 0
foreach ($b in $backups) {
    $index++
    if ($index -le $KeepCount) { $tag = "KEEP "; $color = "Green" } else { $tag = "PURGE"; $color = "Red" }
    $line = "  [{0}] {1}  ({2} bytes, {3:yyyy-MM-dd HH:mm})" -f $tag, $b.Name, $b.Length, $b.LastWriteTime
    Write-Host $line -ForegroundColor $color
}
Write-Host ""

$toPurge = $backups | Select-Object -Skip $KeepCount
if (-not $toPurge -or @($toPurge).Count -eq 0) {
    Write-Ok "Only $(@($backups).Count) backup(s) present; within KeepCount ($KeepCount). Nothing to purge."
    return
}

Write-Host "Candidates for purge: $(@($toPurge).Count)" -ForegroundColor Yellow
foreach ($f in $toPurge) {
    if ($Force) {
        Remove-Item -LiteralPath $f.FullName -Force
        Write-Host "  deleted: $($f.Name)" -ForegroundColor Red
    } else {
        # Dry-run: -WhatIf simulates and deletes nothing.
        Remove-Item -LiteralPath $f.FullName -WhatIf
    }
}

Write-Host ""
if ($Force) {
    Write-Ok "Purge complete. Kept the $KeepCount most recent backup(s)."
} else {
    Write-Note "DRY-RUN only - nothing was deleted. Re-run with -Force to purge."
}
Write-Host ""
Write-Note "Reminder: deleting backups does NOT rotate the secrets they held."
Write-Note "Move secrets to a vault and keep live .env at chmod 600, outside the web root."
