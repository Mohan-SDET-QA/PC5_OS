@echo off
title PC5 OS - Build the installer
setlocal
cd /d "%~dp0shell"
echo.
echo   PC5 OS - building PC5-OS-Setup.exe
echo   ----------------------------------
echo.

where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Installing it now with winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js installed. Close this window and double-click "Build Installer.cmd" again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/2] Installing build tools ^(first time only, a few minutes^)...
  call npm install
  if errorlevel 1 goto fail
)

echo [2/2] Building the controller service and the installer...
call npm run installer
if errorlevel 1 goto fail

echo.
echo   Done: shell\dist\PC5-OS-Setup.exe
echo   Or let GitHub build it: push a tag like v0.1.0 (see README).
explorer "%cd%\dist"
pause
exit /b 0

:fail
echo.
echo   The build failed. Copy the messages above and send them over.
pause
exit /b 1
