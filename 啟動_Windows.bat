@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

title Nigiro Pro Launcher

echo.
echo ==========================================
echo   Nigiro Pro - Launcher
echo ==========================================
echo.

REM ── 尋找 Python ──────────────────────────────────────────────────────────────
set "PYTHON="

py --version >nul 2>&1
if %errorlevel%==0 set "PYTHON=py"

if not defined PYTHON (
    python --version >nul 2>&1
    if %errorlevel%==0 set "PYTHON=python"
)

if not defined PYTHON (
    if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
        set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    )
)
if not defined PYTHON (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    )
)
if not defined PYTHON (
    if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
        set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    )
)
if not defined PYTHON (
    if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
        set "PYTHON=%LOCALAPPDATA%\Python\bin\python.exe"
    )
)

if not defined PYTHON (
    echo [錯誤] 找不到 Python。
    echo 請先安裝 Python（https://www.python.org/downloads/），
    echo 安裝時勾選 "Add Python to PATH"，然後重新執行「安裝套件.bat」。
    echo.
    pause
    exit /b 1
)

echo [OK] 找到 Python：%PYTHON%

REM ── 確認 Streamlit 已安裝 ──────────────────────────────────────────────────
echo [1/3] 確認 Streamlit 是否已安裝...
%PYTHON% -m streamlit --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [錯誤] Streamlit 未安裝。
    echo 請先雙擊執行「安裝套件.bat」，安裝完成後再啟動。
    echo.
    pause
    exit /b 1
)
echo [OK] Streamlit 已安裝。

REM ── 停止舊 Streamlit 程序 ────────────────────────────────────────────────
echo [2/3] 關閉舊的 Streamlit 程序（如有）...
for %%P in (8501 8502 8503 8504 8505) do (
    for /f "tokens=5" %%A in ('netstat -ano 2^>nul ^| findstr ":%%P "') do (
        taskkill /PID %%A /F >nul 2>&1
    )
)

set "APP_PORT=8501"
set "APP_URL=http://localhost:%APP_PORT%"

REM ── 啟動 Streamlit（保留視窗，若失敗可看到錯誤訊息）──────────────────────
echo [3/3] 啟動 Streamlit，網址：%APP_URL%
echo.
echo ── 請保留此視窗，關閉此視窗會停止程式 ──
echo.
start "Nigiro Pro - Server" /min "%PYTHON%" -m streamlit run app.py --server.port %APP_PORT% --server.headless true

REM ── 等待 Streamlit 啟動 ────────────────────────────────────────────────────
echo 等待啟動中...
timeout /t 5 /nobreak >nul

REM ── 確認服務是否啟動，最多再等 10 秒 ─────────────────────────────────────
set "READY=0"
for /l %%i in (1,1,5) do (
    if "!READY!"=="0" (
        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
            "try { Invoke-WebRequest -Uri '%APP_URL%/healthz' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
        if !errorlevel!==0 set "READY=1"
        if "!READY!"=="0" timeout /t 2 /nobreak >nul
    )
)

if "!READY!"=="1" (
    echo [OK] Streamlit 已啟動，正在開啟瀏覽器...
    start "" "%APP_URL%"
    echo.
    echo 瀏覽器已開啟：%APP_URL%
    echo 可以最小化此視窗（不要關閉）。
) else (
    echo.
    echo [警告] 無法確認 Streamlit 是否成功啟動。
    echo 嘗試開啟瀏覽器，若頁面無法載入請參考以下步驟：
    echo   1. 確認「安裝套件.bat」已執行成功
    echo   2. 確認防火牆沒有封鎖 port 8501
    echo   3. 查看「Nigiro Pro - Server」視窗的錯誤訊息
    echo.
    start "" "%APP_URL%"
)

echo.
pause
