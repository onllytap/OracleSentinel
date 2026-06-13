@echo off
cls
echo ========================================
echo   CHATBOT - TESTS AUTOMATISES COMPLETS
echo ========================================
echo.
echo Ce script va :
echo 1. Verifier la configuration
echo 2. Compiler le serveur
echo 3. Lancer les tests automatises
echo.
echo Assurez-vous que le serveur tourne dans un autre terminal !
echo (cd server ^&^& npm run dev)
echo.
pause
echo.

echo ========================================
echo   ETAPE 1/3 : Pre-Flight Check
echo ========================================
echo.
cd server
call npx ts-node test/pre-flight-check.ts
if errorlevel 1 (
    echo.
    echo ERREUR : Pre-flight check a echoue !
    echo Corrigez les erreurs ci-dessus avant de continuer.
    pause
    exit /b 1
)
echo.
echo Pre-flight check OK !
echo.
pause

echo ========================================
echo   ETAPE 2/3 : Compilation TypeScript
echo ========================================
echo.
call npm run build
if errorlevel 1 (
    echo.
    echo ERREUR : Compilation a echoue !
    pause
    exit /b 1
)
echo.
echo Compilation OK !
echo.
pause

echo ========================================
echo   ETAPE 3/3 : Tests Automatises
echo ========================================
echo.
call npx ts-node test/automated-bot-testing.ts
if errorlevel 1 (
    echo.
    echo ATTENTION : Certains tests ont echoue !
    echo Consultez les resultats ci-dessus.
) else (
    echo.
    echo ========================================
    echo   SUCCES : Tous les tests sont passes !
    echo ========================================
)
echo.
pause
