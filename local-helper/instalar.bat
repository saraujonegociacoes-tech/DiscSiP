@echo off
title Instalacao Blue Desk Helper
cd /d "%~dp0"

echo Blue Desk Helper - Instalacao
echo ============================
echo.

echo [1/5] Instalando dependencias Node.js...
call npm install
if errorlevel 1 (
  echo ERRO: npm install falhou. Node.js esta instalado?
  pause
  exit /b 1
)
echo OK.
echo.

echo [2/5] Configurando o MicroSIP (hooks de evento + modo multi-chamada)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-hooks.ps1"
if errorlevel 1 (
  echo AVISO: nao foi possivel aplicar as mudancas no microsip.ini agora.
  echo Feche o MicroSIP e rode novamente: powershell -File "%~dp0setup-hooks.ps1"
)
echo.

echo [3/5] Criando atalho na inicializacao do Windows (helper oculto)...
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

echo [4/5] Registrando o protocolo bluedesk-helper:// (botao "Ligar helper" no site)...
REM Uma pagina web nao pode iniciar um processo — e a protecao do navegador. O caminho
REM suportado e um protocolo registrado no Windows: o site abre "bluedesk-helper://start"
REM e quem executa o launcher e o proprio Windows. HKCU: nao precisa de administrador.
reg add "HKCU\Software\Classes\bluedesk-helper" /ve /d "URL:Blue Desk Helper" /f >nul
reg add "HKCU\Software\Classes\bluedesk-helper" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\bluedesk-helper\shell\open\command" /ve /d "wscript.exe \"%~dp0start-hidden.vbs\"" /f >nul
if errorlevel 1 (
  echo AVISO: nao foi possivel registrar o protocolo. O botao "Ligar helper" nao vai funcionar,
  echo mas o helper continua subindo com o Windows normalmente.
) else (
  echo OK.
)
echo.

echo [5/5] Encerrando helper antigo (se houver) e subindo o atual (oculto)...
REM Mata so o node do helper (filtra index.js na linha de comando), para nao
REM conflitar na porta 3001 com a instancia que vamos abrir agora.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul
wscript "%~dp0start-hidden.vbs"
echo.
echo ============================
echo Instalacao concluida! O helper esta rodando oculto.
echo ============================
echo.
echo Para conferir, abra no navegador:  http://localhost:3001/ping
echo Pode fechar esta janela.
pause
