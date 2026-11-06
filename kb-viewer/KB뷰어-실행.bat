@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo KB 뷰어를 시작합니다. 이 창을 닫으면 뷰어도 꺼집니다.
start "" http://127.0.0.1:8765
python server.py
pause
