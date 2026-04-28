@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Nigiro Pro

echo.
echo ==========================================
echo   Nigiro Pro - Starting...
echo ==========================================
echo.

rem Find Python
set "PY="
py --version >nul 2>nul
if not errorlevel 1 set "PY=py"

if not defined PY (
    python --version >nul 2>nul
    if not errorlevel 1 set "PY=python"
)

if not defined PY (
    for %%V in (314 313 312 311 310) do (
        if not defined PY (
            if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" (
                set "PY=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
            )
        )
    )
)

if not defined PY (
    echo [ERROR] Python not found.
    echo Please install Python and check "Add Python to PATH".
    echo.
    pause
    exit /b 1
)
echo [OK] Python found.

if "%~1"=="--check" (
    echo [OK] Batch syntax check passed.
    exit /b 0
)

rem Install requirements when Streamlit or Excel support is missing.
"%PY%" -m streamlit --version >nul 2>nul
if errorlevel 1 goto INSTALL_REQUIREMENTS

"%PY%" -c "import openpyxl" >nul 2>nul
if errorlevel 1 goto INSTALL_REQUIREMENTS

goto START_APP

:INSTALL_REQUIREMENTS
echo [INFO] Installing or updating required packages...
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ERROR] Could not install required packages.
    echo Please run install_packages.bat or install.bat manually, then start again.
    echo.
    pause
    exit /b 1
)

:START_APP
echo [OK] Required packages ready.

rem Kill old Streamlit processes on common ports.
for %%P in (8501 8502 8503 8504 8505) do (
    for /f "tokens=5" %%A in ('netstat -ano 2^>nul ^| findstr /R /C:":%%P .*LISTENING"') do (
        taskkill /PID %%A /F >nul 2>nul
    )
)

set "PORT=8501"
set "URL=http://localhost:%PORT%"

echo.
echo [Starting] %URL%
echo [Note] Keep this window open. Close it to stop the server.
echo.

start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$u='%URL%'; for($i=0;$i -lt 30;$i++){Start-Sleep 1; try{ if((Invoke-WebRequest ($u + '/_stcore/health') -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200){ Start-Process $u; break } } catch{} }"

"%PY%" -m streamlit run app.py --server.port %PORT% --server.headless true

echo.
echo [STOPPED] Streamlit has stopped. Check above for errors.
pause
