@echo off
setlocal
title Package MI-RC003 Bridge Release
rem Package the Windows standalone flasher into dist\ (zip + SHA256).
rem Run build-firmware.bat first to generate build\merged-flash.bin.
rem Usage: package-release.bat [-Version 1.0.0] [-SkipZip]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\package-release.ps1" %*
set EC=%ERRORLEVEL%
echo.
pause
endlocal & exit /b %EC%
