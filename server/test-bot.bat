@echo off
echo ========================================
echo   AUTOMATED BOT TESTING SUITE
echo ========================================
echo.
echo Starting tests...
echo.

cd server
call npx ts-node test/automated-bot-testing.ts

pause
