@echo off
cd /d "%~dp0"
echo Starting NeonTube at http://127.0.0.1:8765 ...
start "" http://127.0.0.1:8765
python app.py
pause
