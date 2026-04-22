@echo off
cd /d "%~dp0"
echo 正在安裝必要套件，請稍候...
pip install -r requirements.txt
echo.
echo 安裝完成！可以關閉此視窗，之後雙擊「啟動_Windows.bat」使用程式。
pause
