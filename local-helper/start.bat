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
REM Lancado oculto (start-hidden.vbs passa "hidden"): nao da pause, so encerra —
REM senao sobraria um cmd invisivel preso. Rodado a mao (sem arg): pausa para ler.
if /i "%~1"=="hidden" exit /b
pause
