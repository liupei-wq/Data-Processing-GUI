@echo off
cd /d "%~dp0"

:: 關掉舊的 streamlit（避免衝突）
taskkill /F /IM python.exe /FI "WINDOWTITLE eq streamlit*" >nul 2>&1

echo 啟動 Spectroscopy Data Processing GUI...
start /B "" python -m streamlit run app.py --server.port 8501

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
