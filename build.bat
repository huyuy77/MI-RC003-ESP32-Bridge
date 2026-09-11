@echo off
setlocal
rem MI-RC003-ESP32-Bridge build helper (ESP-IDF)
rem Activate your ESP-IDF environment first, or let this script try the EIM profile.

where idf.py >nul 2>nul
if errorlevel 1 (
    if exist "C:\Espressif\tools\Microsoft.v6.1.PowerShell_profile.ps1" (
        echo [i] idf.py not found in PATH. Please run this from an ESP-IDF terminal.
        echo     PowerShell: . "C:\Espressif\tools\Microsoft.v6.1.PowerShell_profile.ps1"
    ) else (
        echo [!] idf.py not found. Activate the ESP-IDF environment first.
    )
    exit /b 1
)

if "%1"=="" (
    idf.py build
) else (
    idf.py -DIDF_TARGET=%1 build
)
endlocal
