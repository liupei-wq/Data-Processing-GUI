@echo off
chcp 65001 >nul
cd /d "%~dp0"

py --version >nul 2>&1
if %errorlevel% == 0 (
    set PYTHON=py
    goto CHECK
)

python --version >nul 2>&1
if %errorlevel% == 0 (
    set PYTHON=python
    goto CHECK
)

echo [Error] Python not found!
echo Please run [Install_Packages.bat] first.
pause
exit /b 1

:CHECK
%PYTHON% -c "import streamlit" >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Packages not installed!
    echo Please run [Install_Packages.bat] first.
    pause
    exit /b 1
)

echo Starting server, please wait...
start "Streamlit Server" %PYTHON% -m streamlit run app.py --server.port 8501

timeout /t 5 /nobreak >nul

set /a COUNT=0
:WAIT
timeout /t 1 /nobreak >nul
curl -s --max-time 1 http://localhost:8501/_stcore/health >nul 2>&1
if %errorlevel% == 0 goto OPEN
set /a COUNT+=1
if %COUNT% lss 25 goto WAIT

:OPEN
start http://localhost:8501
