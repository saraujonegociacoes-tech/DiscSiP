@echo off
title Instalacao DiscSiP Helper
cd /d "%~dp0"

echo DiscSiP Helper - Instalacao
echo ============================
echo.

echo [1/3] Instalando dependencias Node.js...
call npm install
if errorlevel 1 (
  echo ERRO: npm install falhou. Node.js esta instalado?
  pause
  exit /b 1
)
echo OK.
echo.

echo [2/3] Configurando hooks de evento do MicroSIP...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-hooks.ps1"
if errorlevel 1 (
  echo AVISO: nao foi possivel aplicar os hooks no microsip.ini agora.
  echo Feche o MicroSIP e rode novamente: powershell -File "%~dp0setup-hooks.ps1"
)
echo.

echo [3/3] Criando atalho na inicializacao do Windows (helper oculto)...
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_PATH=%~dp0start-hidden.vbs

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTUP%\DiscSiP-Helper.lnk'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_PATH%\"'; $s.WindowStyle = 7; $s.WorkingDirectory = '%~dp0'; $s.Save()"

echo OK. O helper vai iniciar automaticamente com o Windows, sem janela.
echo.
echo ============================
echo Instalacao concluida!
echo ============================
echo.
echo Iniciando o helper agora (oculto)...
wscript "%~dp0start-hidden.vbs"
echo.
echo Pode fechar esta janela.
pause
