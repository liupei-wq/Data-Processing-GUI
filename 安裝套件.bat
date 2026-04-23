@echo off
cd /d "%~dp0"
echo ================================================
echo  Spectroscopy Data Processing GUI - 套件安裝
echo ================================================
echo.

:: 優先用 py 啟動器（Windows 內建，不需設定 PATH）
py --version >nul 2>&1
if %errorlevel% == 0 (
    set PYTHON=py
    goto INSTALL
)

:: 備用：python 指令
python --version >nul 2>&1
if %errorlevel% == 0 (
    set PYTHON=python
    goto INSTALL
)

echo [錯誤] 找不到 Python！
echo.
echo 請先安裝 Python：
echo   1. 前往 https://www.python.org/downloads/
echo   2. 下載並安裝 Python
echo   3. 安裝時勾選 "Add Python to PATH"
echo   4. 安裝完後重新開機，再雙擊此檔案
echo.
pause
exit /b 1

:INSTALL
echo 正在安裝必要套件，請稍候...
echo.
%PYTHON% -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [錯誤] 安裝失敗，請截圖以上訊息回報。
    pause
    exit /b 1
)

echo.
echo ================================================
echo  安裝完成！可以關閉此視窗。
echo  之後雙擊「啟動_Windows.bat」使用程式。
echo ================================================
pause
