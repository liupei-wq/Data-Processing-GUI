@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

title Spectroscopy Data Processing Launcher

echo.
echo ==========================================
echo   Spectroscopy Data Processing GUI
echo ==========================================
echo.

set "PYTHON="
set "PYTHONW="
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "py --version" >nul 2>&1
if "%errorlevel%"=="0" set "PYTHON=py"

if not defined PYTHON (
    python --version >nul 2>&1
    if "%errorlevel%"=="0" set "PYTHON=python"
)

if not defined PYTHON (
    if exist "%LOCALAPPDATA%\Python\bin\python.exe" set "PYTHON=%LOCALAPPDATA%\Python\bin\python.exe"
)

if not defined PYTHON (
    if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" set "PYTHON=%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe"
)

if exist "%LOCALAPPDATA%\Python\bin\pythonw.exe" set "PYTHONW=%LOCALAPPDATA%\Python\bin\pythonw.exe"
if not defined PYTHONW (
    if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\pythonw.exe" set "PYTHONW=%LOCALAPPDATA%\Python\pythoncore-3.14-64\pythonw.exe"
)
if not defined PYTHONW set "PYTHONW=%PYTHON%"

if not defined PYTHON (
    echo [Error] Python not found.
    echo Please run the package installer first.
    pause
    exit /b 1
)

echo [1/3] Stopping old Streamlit sessions...
for %%P in (8501 8502 8503 8504 8505 8506 8507 8508 8509 8510) do (
    for /f "tokens=5" %%A in ('netstat -ano 2^>nul ^| findstr ":%%P "') do (
        taskkill /PID %%A /F >nul 2>&1
    )
)
set "APP_PORT=8501"

set "APP_URL=http://localhost:%APP_PORT%"

echo [2/3] Starting Streamlit on %APP_URL% ...
REM Launch in background with optimized settings
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath '%PYTHONW%' -ArgumentList @('-m','streamlit','run','app.py','--server.port','%APP_PORT%') -WorkingDirectory '%CD%'" >nul 2>&1
if "%errorlevel%"=="0" goto QUICK_OPEN

echo [Warning] PowerShell launch failed; trying direct start...
start "Streamlit" /min "%PYTHONW%" -m streamlit run app.py --server.port %APP_PORT%

:QUICK_OPEN
echo [3/3] Opening browser...
echo URL: %APP_URL%
if "%NO_BROWSER%"=="1" exit /b 0
start "" "%APP_URL%"
exit /b 0
