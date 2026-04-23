@echo off
cd /d "%~dp0"

set STREAMLIT=C:\Users\peili\AppData\Local\Python\pythoncore-3.14-64\Scripts\streamlit.exe

:: 直接背景啟動，不經過 PowerShell 包裝層
start /B "" "%STREAMLIT%" run app.py

:: 輪詢健康端點，伺服器一就緒立刻開瀏覽器（最多等 30 秒）
set /a COUNT=0
:WAIT
timeout /t 1 /nobreak >nul
curl -s --max-time 1 http://localhost:8501/_stcore/health >nul 2>&1
if %errorlevel% == 0 goto OPEN
set /a COUNT+=1
if %COUNT% lss 30 goto WAIT

:OPEN
start http://localhost:8501
