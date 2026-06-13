@echo off
REM ============================================================================
REM OracleSentinel — Create VPS Upload Package
REM ============================================================================
REM This script creates a clean folder with only the files needed for VPS
REM No node_modules, no IDE configs, no test files
REM ============================================================================

echo ================================================
echo Creating VPS Upload Package...
echo ================================================

REM Clean previous package
if exist "D:\Chatbot\vps-upload" rmdir /s /q "D:\Chatbot\vps-upload"

REM Create directory structure
mkdir "D:\Chatbot\vps-upload"
mkdir "D:\Chatbot\vps-upload\server"
mkdir "D:\Chatbot\vps-upload\server\src"
mkdir "D:\Chatbot\vps-upload\src"
mkdir "D:\Chatbot\vps-upload\public"

REM Copy root files
copy "D:\Chatbot\Dockerfile.production" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\docker-compose.production.yml" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\deploy.sh" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\package.json" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\package-lock.json" "D:\Chatbot\vps-upload\" 2>nul
copy "D:\Chatbot\vite.config.ts" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\tailwind.config.ts" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\postcss.config.js" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\tsconfig.json" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\index.html" "D:\Chatbot\vps-upload\"
copy "D:\Chatbot\factory-dashboard.html" "D:\Chatbot\vps-upload\"

REM Copy server folder (excluding node_modules)
xcopy "D:\Chatbot\server\src" "D:\Chatbot\vps-upload\server\src" /E /I /Y
copy "D:\Chatbot\server\package.json" "D:\Chatbot\vps-upload\server\"
copy "D:\Chatbot\server\package-lock.json" "D:\Chatbot\vps-upload\server\" 2>nul
copy "D:\Chatbot\server\tsconfig.json" "D:\Chatbot\vps-upload\server\"
copy "D:\Chatbot\server\.env" "D:\Chatbot\vps-upload\server\"
copy "D:\Chatbot\server\.dockerignore" "D:\Chatbot\vps-upload\server\" 2>nul

REM Copy frontend src folder
xcopy "D:\Chatbot\src" "D:\Chatbot\vps-upload\src" /E /I /Y

REM Copy public folder
xcopy "D:\Chatbot\public" "D:\Chatbot\vps-upload\public" /E /I /Y

echo.
echo ================================================
echo Package created at: D:\Chatbot\vps-upload
echo ================================================
echo.
echo Files included:
echo   - Dockerfile.production
echo   - docker-compose.production.yml
echo   - deploy.sh
echo   - package.json (root + server)
echo   - All source files (server/src, src, public)
echo   - server/.env (production config)
echo.
echo Upload this entire folder to /opt/oraclesentinel on VPS
echo Then run: chmod +x deploy.sh ^&^& ./deploy.sh
echo.
pause
