@echo off
cd /d "%~dp0"
title Cloak - Your internet, your way
if not exist node_modules (
  echo Installing Cloak...
  call npm install
  if errorlevel 1 goto failed
  call npm run setup
  if errorlevel 1 goto failed
)
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Cloak could not start. See the message above.
pause
