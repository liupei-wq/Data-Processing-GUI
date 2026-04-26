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

echo [1/3] Finding an available local port...
REM Try default Streamlit port first for faster startup
set "APP_PORT=8501"
for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":8501 "') do set "APP_PORT="
if not defined APP_PORT (
    echo [Info] Using port 8501 (Streamlit default)
    set "APP_PORT=8501"
) else (
    REM If 8501 is busy, find next available
    for %%P in (8502 8503 8504 8505 8506 8507 8508 8509 8510) do (
        set "FOUND="
        for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P "') do set "FOUND=1"
        if not defined FOUND (
            set "APP_PORT=%%P"
            goto PORT_FOUND
        )
    )
    if not defined APP_PORT (
        echo [Error] Ports 8501-8510 all look busy.
        echo Close old Streamlit windows or restart, then try again.
        pause
        exit /b 1
    )
)
:PORT_FOUND

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
