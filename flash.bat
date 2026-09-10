@echo off
setlocal
rem Flash the firmware. Usage: flash.bat [COMx]
set PORT=%1
if "%PORT%"=="" (
    idf.py flash monitor
) else (
    idf.py -p %PORT% flash monitor
)
endlocal
