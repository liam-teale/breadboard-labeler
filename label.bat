@echo off
rem Double-click: pick the photos in a file dialog. Or drop photos / a folder onto this file.
python "%~dp0label_images.py" %*
if errorlevel 1 pause
