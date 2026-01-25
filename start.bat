@echo off
:: ==========================================
::  AI Chat Agent - Full Stack Starter
:: ==========================================
title AI Chat Agent System
echo [INFO] Starting Ecosystem...

:: 1. Start Backend
echo [INFO] Launching Backend Server (Port 3001)...
start "Backend Server" cmd /k "cd server && npm run dev"

:: 2. Wait a moment
echo [INFO] Waiting for backend initialization...
timeout /t 3 /nobreak >nul

:: 3. Start Frontend
echo [INFO] Launching Frontend Interface...
echo [INFO] Access the app at http://localhost:5173
npm run dev
