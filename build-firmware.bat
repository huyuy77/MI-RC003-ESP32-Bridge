@echo off
setlocal
title Build MI-RC003 Bridge Firmware
rem One-click firmware build: compiles every hardware profile and generates
rem firmware for BOTH the Windows standalone flasher (build\firmware\*.bin)
rem and the web flasher (webusb-config\flash\firmware\*.bin + manifest-*.json).
rem Usage: build-firmware.bat [-Profile n16r8,n8r2,n4r2] [-NoBuild] [-FlashMode dio] [-FlashFreq 80m]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build-firmware.ps1" %*
set EC=%ERRORLEVEL%
echo.
pause
endlocal & exit /b %EC%
