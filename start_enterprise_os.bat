@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0scripts\enterprise-os.ps1" -Action Start
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
exit /b 0
