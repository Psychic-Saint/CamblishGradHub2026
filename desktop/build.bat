@echo off
rem Builds the desktop app into desktop\dist\Camblish Alumni Hub (folder version, used by the installer)
cd /d "%~dp0"
copy /Y ..\index.html hub.html >nul
python -m pip install --quiet --upgrade pywebview pillow pywin32 pyinstaller
python -m PyInstaller --noconfirm --clean --onedir --windowed --name "Camblish Alumni Hub" --icon app_gold.ico --version-file version_info.txt --hidden-import win32gui --hidden-import win32con --add-data "hub.html;." --add-data "app.ico;." --add-data "app_gold.ico;." alumni_hub.py
echo Done. The app is in desktop\dist\Camblish Alumni Hub
