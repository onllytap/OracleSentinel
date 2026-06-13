@echo off
setlocal EnableExtensions
chcp 65001 >nul
:: ==========================================
::  OracleSentinel / AI Chat Agent - Starter
:: ==========================================
title OracleSentinel Launcher

set "ROOT_DIR=%~dp0"
set "ORACLE_DIR=%ROOT_DIR%Chatbot"

echo.
echo ==========================================
echo  OracleSentinel - Lanceur
echo ==========================================
echo.

if exist "%ORACLE_DIR%\start.bat" (
    if exist "%ORACLE_DIR%\config\oraclesentinel.env" (
        echo [INFO] Projet OracleSentinel detecte : %ORACLE_DIR%
        echo [INFO] Configuration detectee : Chatbot\config\oraclesentinel.env
        echo [INFO] Delegation au demarrage du projet OracleSentinel...
        echo.
        cd /d "%ORACLE_DIR%"
        call start.bat
        exit /b %ERRORLEVEL%
    )
)

echo [WARN] Projet OracleSentinel complet non detecte dans .\Chatbot.
echo [INFO] Fallback sur le projet racine : %ROOT_DIR%
echo.

cd /d "%ROOT_DIR%"
if errorlevel 1 (
    echo [ERREUR] Impossible d'ouvrir le dossier racine.
    pause
    exit /b 1
)

if not exist "server\package.json" (
    echo [ERREUR] Backend introuvable : server\package.json
    pause
    exit /b 1
)

if not exist "server\.env" (
    echo [ERREUR] Configuration manquante : server\.env
    echo.
    echo Le backend racine charge uniquement server\.env.
    echo Si vous voulez lancer OracleSentinel, verifiez que .\Chatbot\config\oraclesentinel.env existe.
    echo.
    pause
    exit /b 1
)

echo [INFO] Verification base de donnees du backend racine...
npm --prefix .\server run ensure-db
if errorlevel 1 (
    echo.
    echo [ERREUR] Base de donnees inaccessible ou DATABASE_URL incorrect dans server\.env.
    echo Verifiez que PostgreSQL tourne et que DATABASE_URL pointe vers la bonne base.
    echo.
    pause
    exit /b 1
)

echo [INFO] Launching Backend Server (Port 3001)...
start "Backend Server" cmd /k "cd /d ""%ROOT_DIR%server"" && npm run dev"

echo [INFO] Waiting for backend initialization...
timeout /t 3 /nobreak >nul

echo [INFO] Launching Frontend Interface...
echo [INFO] Access the app at http://localhost:3000
npm run dev
