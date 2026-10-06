@echo off
cd /d "%~dp0"
copy /Y ..\index.html hub.html >nul
start "" pythonw alumni_hub.py
