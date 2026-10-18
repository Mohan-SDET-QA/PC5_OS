@echo off
rem Run by Windows Setup as SYSTEM after installation, before first logon.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%WINDIR%\Setup\Scripts\firstboot.ps1" > "%WINDIR%\Setup\Scripts\firstboot.log" 2>&1
exit /b 0
