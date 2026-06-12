@echo off
title Instalacao DiscSiP Helper
cd /d "%~dp0"

echo DiscSiP Helper - Instalacao
echo ============================
echo.

echo [1/2] Instalando dependencias Node.js...
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

echo [3/3] Criando atalho na inicializacao do Windows...
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set BAT_PATH=%~dp0start.bat

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTUP%\DiscSiP-Helper.lnk'); $s.TargetPath = 'cmd.exe'; $s.Arguments = '/c \"%BAT_PATH%\"'; $s.WindowStyle = 7; $s.WorkingDirectory = '%~dp0'; $s.Save()"

echo OK. O helper vai iniciar automaticamente com o Windows.
echo.
echo ============================
echo Instalacao concluida!
echo ============================
echo.
echo Iniciando o helper agora (janela minimizada)...
start /min "DiscSiP Helper" cmd /c "%~dp0start.bat"
echo.
echo Pode fechar esta janela.
pause
