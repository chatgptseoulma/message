@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 공유본을 만듭니다 (docs\kb 의 지금 내용 기준)...
python build.py
echo.
echo dist 폴더를 엽니다.
start "" "%~dp0dist"
pause
