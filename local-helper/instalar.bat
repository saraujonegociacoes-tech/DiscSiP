@echo off
title Instalacao Blue Desk Helper
cd /d "%~dp0"

echo Blue Desk Helper - Instalacao
echo ============================
echo.

echo [1/4] Instalando dependencias Node.js...
call npm install
if errorlevel 1 (
  echo ERRO: npm install falhou. Node.js esta instalado?
  pause
  exit /b 1
)
echo OK.
echo.

echo [2/4] Configurando hooks de evento do MicroSIP...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-hooks.ps1"
if errorlevel 1 (
  echo AVISO: nao foi possivel aplicar os hooks no microsip.ini agora.
  echo Feche o MicroSIP e rode novamente: powershell -File "%~dp0setup-hooks.ps1"
)
echo.

echo [3/4] Criando atalho na inicializacao do Windows (helper oculto)...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
REM IMPORTANTE: apaga QUALQUER atalho antigo do helper antes de criar o novo.
REM Versoes anteriores criavam nomes diferentes ("DiscSiP Helper.lnk" com espaco,
REM apontando para start.bat). Se ambos existissem, DOIS helpers subiam no boot e
REM brigavam pela porta 3001 (EADDRINUSE) — fonte de "helper offline" intermitente.
REM Apaga tambem os atalhos do nome antigo (DiscSiP) ao migrar para Blue Desk.
del "%STARTUP%\DiscSiP-Helper.lnk" 2>nul
del "%STARTUP%\DiscSiP Helper.lnk" 2>nul
del "%STARTUP%\BlueDesk-Helper.lnk" 2>nul
del "%STARTUP%\BlueDesk Helper.lnk" 2>nul
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTUP%\BlueDesk-Helper.lnk'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%~dp0start-hidden.vbs\"'; $s.WindowStyle = 7; $s.WorkingDirectory = '%~dp0'; $s.Save()"
echo OK. O helper vai iniciar automaticamente com o Windows, sem janela.
echo.

echo [4/4] Encerrando helper antigo (se houver) e subindo o atual (oculto)...
REM Mata so o node do helper (filtra index.js na linha de comando), para nao
REM conflitar na porta 3001 com a instancia que vamos abrir agora.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul
wscript "%~dp0start-hidden.vbs"
echo.
echo ============================
echo Instalacao concluida! O helper esta rodando oculto.
echo ============================
echo.
echo Pode fechar esta janela.
pause
