@echo off
setlocal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
if exist "dist\win-unpacked\UpdatePilot.exe" (
    start "" "dist\win-unpacked\UpdatePilot.exe"
    exit /b 0
)
if exist "node_modules\electron\dist\electron.exe" (
    start "" "node_modules\electron\dist\electron.exe" .
    exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js 22 veya ustunu kurun, ardindan bu dosyayi yeniden acin.
    pause
    exit /b 1
)
echo Electron bagimliliklari kuruluyor...
call npm.cmd ci --cache .npm-cache
if errorlevel 1 (
    echo Kurulum tamamlanamadi. Internet baglantisini kontrol edin.
    pause
    exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
