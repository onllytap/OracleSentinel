@echo off
setlocal EnableDelayedExpansion

:: Vérifier les privilèges administrateur
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARNING] Ce script n'est pas execute en tant qu'administrateur.
    echo [WARNING] Certains processus pourraient ne pas etre tues.
    echo [WARNING] Faites clic droit et "Executer en tant qu'administrateur" pour de meilleurs resultats.
    echo.
    pause
)

echo ========================================================
echo        KILLER DE PORTS - VERSION PUISSANTE
echo ========================================================
echo.

:: Liste des ports à tuer
set "PORTS=3000 3001 5173 8080 4000"

:: Tuer tous les processus Node.js et ts-node d'abord
echo [STEP 1] Tuage de tous les processus Node.js et ts-node...
echo ---------------------------------------------------
taskkill /F /IM node.exe 2>nul
if %errorLevel% equ 0 (
    echo [OK] Processus node.exe tues
) else (
    echo [INFO] Aucun processus node.exe trouve
)

taskkill /F /IM ts-node.exe 2>nul
if %errorLevel% equ 0 (
    echo [OK] Processus ts-node.exe tues
) else (
    echo [INFO] Aucun processus ts-node.exe trouve
)

echo.
echo [STEP 2] Verification et nettoyage des ports specifiques...
echo ---------------------------------------------------

:: Pour chaque port
for %%P in (%PORTS%) do (
    echo [CHECKING] Port %%P...
    
    :: Méthode 1: PowerShell Get-NetTCPConnection
    powershell -Command "$pids = Get-NetTCPConnection -LocalPort %%P -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique; if ($pids) { $pids | ForEach-Object { Write-Host '  [KILL] PID' $_ -ForegroundColor Yellow; Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } else { Write-Host '  [OK] Port %%P libre' -ForegroundColor Green }"
    
    :: Méthode 2: netstat (backup au cas où)
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%%P') do (
        set "pid=%%a"
        if "!pid!" neq "0" (
            taskkill /F /PID !pid! 2>nul
        )
    )
)

echo.
echo [STEP 3] Verification finale des processus nodemon...
echo ---------------------------------------------------
taskkill /F /IM nodemon.exe 2>nul
if %errorLevel% equ 0 (
    echo [OK] Processus nodemon.exe tues
) else (
    echo [INFO] Aucun processus nodemon.exe trouve
)

echo.
echo [STEP 4] Nettoyage des processus zombies...
echo ---------------------------------------------------
:: Tuer tous les processus Node en attente
wmic process where "name='node.exe'" delete 2>nul

echo.
echo ========================================================
echo                   NETTOYAGE TERMINE
echo ========================================================
echo.
echo Tous les ports devraient etre liberes maintenant.
echo Vous pouvez relancer votre serveur.
echo.
echo Si le probleme persiste:
echo 1. Redemarrez votre terminal/IDE
echo 2. Redemarrez votre PC (cas extreme)
echo.
pause