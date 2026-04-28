@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Nigiro Pro Installer

echo.
echo ================================================
echo  Nigiro Pro - Install Packages
echo ================================================
echo.

set "PY="
py --version >nul 2>nul
if not errorlevel 1 set "PY=py"

if not defined PY (
    python --version >nul 2>nul
    if not errorlevel 1 set "PY=python"
)

if not defined PY (
    echo [ERROR] Python not found.
    echo Please install Python from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

echo [INFO] Installing packages from requirements.txt...
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ERROR] Installation failed. Please screenshot this window and report.
    echo.
    pause
    exit /b 1
)

echo.
echo ================================================
echo  Done. Double-click start_windows.bat or the
echo  Chinese-named Windows startup file to launch.
echo ================================================
pause
