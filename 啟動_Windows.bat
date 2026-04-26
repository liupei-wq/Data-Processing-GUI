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

echo [1/4] Checking Python packages...
if "%PYTHON%"=="py" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "py -c \"import streamlit\"" >nul 2>&1
) else (
    "%PYTHON%" -c "import streamlit" >nul 2>&1
)
if not "%errorlevel%"=="0" (
    echo [Error] Streamlit is not installed.
    echo Please run the package installer first.
    pause
    exit /b 1
)

echo [2/4] Finding an available local port...
set "APP_PORT="
for %%P in (8511 8512 8513 8514 8515 8516 8517 8518 8519 8520) do (
    curl.exe -s --max-time 1 http://localhost:%%P/_stcore/health >nul 2>&1
    if not "!errorlevel!"=="0" (
        if not defined APP_PORT set "APP_PORT=%%P"
    )
)

if not defined APP_PORT (
    echo [Error] Ports 8511-8520 all look busy.
    echo Close old Streamlit windows or restart Windows, then try again.
    pause
    exit /b 1
)

set "APP_URL=http://localhost:%APP_PORT%"
set "HEALTH_URL=%APP_URL%/_stcore/health"
set "LOG_FILE=%~dp0streamlit_launcher.log"

echo [3/4] Starting Streamlit on %APP_URL% ...
echo Launching %APP_URL% > "%LOG_FILE%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath '%PYTHONW%' -ArgumentList @('-m','streamlit','run','app.py','--server.port','%APP_PORT%','--server.headless','true','--server.fileWatcherType','none','--server.runOnSave','false','--browser.gatherUsageStats','false') -WorkingDirectory '%CD%'" >nul 2>&1
if not "%errorlevel%"=="0" (
    echo [Warning] Detached launch failed; trying fallback start...
    start "Streamlit Server %APP_PORT%" /min "%PYTHON%" -m streamlit run app.py --server.port %APP_PORT% --server.headless true --server.fileWatcherType none --server.runOnSave false --browser.gatherUsageStats false
)

set /a COUNT=0
:WAIT
curl.exe -s --max-time 1 %HEALTH_URL% >nul 2>&1
if "%errorlevel%"=="0" goto OPEN
set /a COUNT+=1
if %COUNT% geq 30 goto FAILED
timeout /t 1 /nobreak >nul
goto WAIT

:OPEN
echo [4/4] Opening browser...
echo URL: %APP_URL%
if "%NO_BROWSER%"=="1" exit /b 0
start "" "%APP_URL%"
exit /b 0

:FAILED
echo [Error] Streamlit did not respond in time.
echo See log file:
echo %LOG_FILE%
echo Try running this command manually:
echo "%PYTHON%" -m streamlit run app.py --server.port %APP_PORT%
pause
exit /b 1
