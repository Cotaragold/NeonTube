@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск NeonTube на http://127.0.0.1:8765 ...
start "" http://127.0.0.1:8765
python app.py
pause
