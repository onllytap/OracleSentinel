@echo off
setlocal EnableExtensions
chcp 65001 >nul
title OracleSentinel V2 - Launcher

:: ============================================================================
::  OracleSentinel V2 - Lanceur (serveur RACINE = la bonne version)
::  NOTE: ce script ne lance PLUS la V1 du dossier .\Chatbot (obsolete).
::        Config = .env a la RACINE (charge par le backend via env.ts + le front).
:: ============================================================================

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
cd /d "%ROOT_DIR%"

echo.
echo ==========================================
echo   OracleSentinel V2 - Lanceur
echo ==========================================
echo.

if not exist "server\package.json" (
  echo [ERREUR] Backend introuvable : server\package.json
  pause
  exit /b 1
)

if not exist ".env" (
  echo [ERREUR] Configuration manquante : .env  ^(a la racine^)
  echo          Copiez .env.example vers .env et renseignez vos cles
  echo          ^(DATABASE_URL, GROQ_API_KEY, ADMIN_API_KEY, JWT_SECRET, ...^).
  echo.
  pause
  exit /b 1
)

if not exist "build\dashboard.html" (
  echo [INFO] build\ absent : le QG /qg ne sera servi qu'apres un build.
  echo        Lancez une fois :   npm run build    ^(a la racine^)
  echo.
)

:: ----------------------------------------------------------------------------
:: Liberer le port 3001 avant de lancer la V2.
:: Une ancienne V1 (.\Chatbot\server) ou un process tsx obsolete peut squatter
:: le port 3001 et repondre a la place de la V2 (=> /qg et /priv en 404).
:: On tue donc tout process LISTENING sur 3001 avant de demarrer le backend.
:: ----------------------------------------------------------------------------
echo [INFO] Verification du port 3001...
set "PORT_BUSY="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3001 "') do (
  set "PORT_BUSY=1"
  echo [INFO] Port 3001 occupe par PID %%P ^(process obsolete^) -- arret en cours
  taskkill /F /PID %%P >nul 2>&1
)
if defined PORT_BUSY (
  echo [INFO] Port 3001 libere.
  timeout /t 2 /nobreak >nul
) else (
  echo [INFO] Port 3001 libre.
)

echo [1/2] Backend  -^> http://localhost:3001
start "OracleSentinel Backend (3001)" /D "%ROOT_DIR%\server" cmd /k "npm run dev"

echo [INFO] Initialisation du backend (4s)...
timeout /t 4 /nobreak >nul

echo [2/2] Frontend (widget dev) -^> http://localhost:3000
start "OracleSentinel Frontend (3000)" /D "%ROOT_DIR%" cmd /k "npm run dev"

echo.
echo ==========================================
echo   ACCES
echo ------------------------------------------
echo   QG (Command Center) : http://localhost:3001/qg
echo   Infra / Flotte      : http://localhost:3001/priv
echo   Admin (DB)          : http://localhost:3001/admin
echo   Factory             : http://localhost:3001/factory
echo   Widget (dev Vite)   : http://localhost:3000
echo ------------------------------------------
echo   Connexion QG : colle la valeur de ADMIN_API_KEY (voir .env)
echo ==========================================
echo.
echo Deux fenetres ouvertes (backend + frontend). Fermez-les pour tout arreter.
pause
