@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo  Spectroscopy Data Processing GUI - Install
echo ================================================
echo.

py --version >nul 2>&1
if %errorlevel% == 0 (
    set PYTHON=py
    goto INSTALL
)

python --version >nul 2>&1
if %errorlevel% == 0 (
    set PYTHON=python
    goto INSTALL
)

echo [Error] Python not found!
echo Please install Python from https://www.python.org/downloads/
echo Make sure to check "Add Python to PATH" during installation.
echo Then restart your computer and run this file again.
echo.
pause
exit /b 1

:INSTALL
echo Installing packages...
echo.
%PYTHON% -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [Error] Installation failed. Please screenshot this window and report.
    pause
    exit /b 1
)

echo.
echo ================================================
echo  Done! Close this window.
echo  Then double-click [Start_Windows.bat] to launch.
echo ================================================
pause
