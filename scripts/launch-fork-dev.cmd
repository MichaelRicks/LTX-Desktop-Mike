@echo off
title LTX Desktop Studio Pro
cd /d "C:\Dev\LTX-Desktop"
echo ============================================================
echo   Launching LTX Desktop Studio Pro (Dev fork)...
echo   First launch takes ~15-30s (Vite + Electron + backend).
echo   The app window will open shortly. Keep this window open;
echo   closing it stops the app.
echo ============================================================
echo.
set "PATH=C:\Program Files\nodejs;%PATH%"
set "LTX_MODELS_DIR=E:\LTXDesktop\models"
"C:\Program Files\nodejs\node.exe" "C:\Dev\LTX-Desktop\node_modules\vite\bin\vite.js"
echo.
echo (LTX Desktop Studio Pro has stopped. Press any key to close.)
pause >nul
