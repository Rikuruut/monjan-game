@echo off
rem Monjan: start the exhibition server (double-click, or type .\start in a terminal)
cd /d "%~dp0generator"
".venv\Scripts\python.exe" -m app.main
pause
