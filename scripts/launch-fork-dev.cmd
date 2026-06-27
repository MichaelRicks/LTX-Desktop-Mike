@echo off
title LTX Desktop Mike (Dev)
cd /d "D:\Dev\LTX-Desktop"
set "PATH=%APPDATA%\npm;%ProgramFiles%\nodejs;%PATH%"
echo Launching LTX Desktop Mike (Dev fork)...
call pnpm dev
