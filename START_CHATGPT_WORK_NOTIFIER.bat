@echo off
setlocal EnableExtensions
title ChatGPT Work Notifier - Advanced Logger
cd /d "%~dp0"

echo.
echo ============================================================
echo  ChatGPT Work Notifier - Advanced Logger startup
echo ============================================================
echo.

if not exist "%~dp0Maintenance\LAUNCH_NOTIFIER_ONLY.bat" goto :NOT_EXTRACTED
if not exist "%~dp0ADVANCED_LOGGER\flight-recorder.ps1" goto :NOT_EXTRACTED
if not exist "%~dp0ADVANCED_LOGGER\start-advanced-logger.ps1" goto :NOT_EXTRACTED

if not exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" goto :NO_POWERSHELL

echo [1/3] Checking and starting the flight recorder...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0ADVANCED_LOGGER\start-advanced-logger.ps1"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" goto :FAILED

echo [2/3] Flight recorder confirmed running.
echo [3/3] v2.4.0 notifier launch command sent.
echo.
echo Startup successful.
echo Diagnostic data:
echo   %%LOCALAPPDATA%%\ChatGPT Work Notifier\AdvancedLogger
echo.
timeout /t 3 /nobreak >nul 2>&1
exit /b 0

:NOT_EXTRACTED
echo ERROR: Required program files are missing beside this BAT file.
echo.
echo Extract the ENTIRE ZIP to a normal folder first.
echo Do not run this BAT from inside the ZIP preview.
echo Then run START_CHATGPT_WORK_NOTIFIER.bat again.
echo.
pause
exit /b 2

:NO_POWERSHELL
echo ERROR: Windows PowerShell could not be found.
echo Expected executable: "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
echo.
pause
exit /b 3

:FAILED
echo.
echo ERROR: Advanced logger startup failed. Exit code: %RC%
echo.
echo The exact startup failure is saved in:
echo   %%LOCALAPPDATA%%\ChatGPT Work Notifier\AdvancedLogger\bootstrap.log
echo.
echo The v2.4.0 release remains unchanged by this failed logger startup.
echo.
pause
exit /b %RC%
