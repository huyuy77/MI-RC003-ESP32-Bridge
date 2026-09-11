@echo off
setlocal
title MI-RC003 Bridge Firmware Flasher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0flash.ps1" %*
set EC=%ERRORLEVEL%
echo.
if not "%EC%"=="0" (
    echo [x] Flashing failed with code %EC%.
) else (
    echo [+] All done.
)
echo.
pause
endlocal & exit /b %EC%
