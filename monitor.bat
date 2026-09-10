@echo off
setlocal
rem Open the serial monitor. Usage: monitor.bat [COMx]
set PORT=%1
if "%PORT%"=="" (
    idf.py monitor
) else (
    idf.py -p %PORT% monitor
)
endlocal
