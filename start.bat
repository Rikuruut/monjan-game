@echo off
rem Monjan: start the exhibition server (double-click, or type .\start in a terminal)
rem Closing the kiosk browser (Alt + F4) also stops the server. Pause only when it ended with an error.
cd /d "%~dp0generator"
".venv\Scripts\python.exe" -m app.main
if errorlevel 1 pause
