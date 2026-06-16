@echo off
title DiscSiP Helper
cd /d "%~dp0"

:loop
node index.js
if %errorlevel%==42 (
  echo.
  echo Helper atualizado. Reiniciando no codigo novo...
  echo.
  goto loop
)

echo.
echo O helper foi encerrado. Veja a mensagem acima.
pause
