@echo off
cd /d "%~dp0"
echo ================================================
echo  Spectroscopy Data Processing GUI
echo ================================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Python！
    echo 請先雙擊「安裝套件.bat」完成安裝。
    echo.
    pause
    exit /b 1
)

python -c "import streamlit" >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 尚未安裝套件！
    echo 請先雙擊「安裝套件.bat」完成安裝。
    echo.
    pause
    exit /b 1
)

echo 啟動中，請稍候...
start /B "" python -m streamlit run app.py --server.port 8501

set /a COUNT=0
:WAIT
timeout /t 1 /nobreak >nul
curl -s --max-time 1 http://localhost:8501/_stcore/health >nul 2>&1
if %errorlevel% == 0 goto OPEN
set /a COUNT+=1
if %COUNT% lss 30 goto WAIT

:OPEN
echo 開啟瀏覽器...
start http://localhost:8501
