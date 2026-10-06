@echo off
cd /d "%~dp0"
copy /Y ..\index.html hub.html >nul
python -m pip install --quiet --upgrade pywebview pillow pywin32 pyinstaller
python -m PyInstaller --noconfirm --onefile --windowed --name "Camblish Alumni Hub" --icon crest.ico --add-data "hub.html;." --add-data "crest.ico;." alumni_hub.py
echo Done. The app is in desktop\dist.
