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
rem Load the Qwen Multi-Angle HuggingFace cache from E: (USB SSD, ~450MB/s) instead
rem of the user HF_HOME=D:\hf-cache (SATA HDD) that pins that drive at 99% and makes
rem cold Qwen loads take minutes. E: already holds an identical copy of the cache.
set "LTX_HF_HOME=E:\hf-cache"
"C:\Program Files\nodejs\node.exe" "C:\Dev\LTX-Desktop\node_modules\vite\bin\vite.js"
echo.
echo (LTX Desktop Studio Pro has stopped. Press any key to close.)
pause >nul
