@echo off
title Reiniciar Blue Desk Helper
cd /d "%~dp0"

echo Blue Desk Helper - Reiniciar / atualizar dependencias
echo =====================================================
echo.
echo O CODIGO do helper se atualiza sozinho contra o Blue Desk (auto-update no
echo start e botao "Atualizar" no site). Use este .bat so para REINICIAR o helper
echo ou atualizar as dependencias Node. Nao mexe nos hooks do MicroSIP, entao
echo pode rodar com o MicroSIP aberto (ao contrario do instalar.bat).
echo.

echo [1/3] Parando o helper em execucao...
REM Mata so o node que esta rodando o index.js do helper (nao mexe em outros node).
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo OK.
echo.

echo [2/3] Atualizando dependencias Node.js...
call npm install
if errorlevel 1 (
  echo AVISO: npm install falhou. Node.js esta instalado?
)
echo.

echo [3/3] Subindo o helper novamente (oculto)...
wscript "%~dp0start-hidden.vbs"
echo.
echo ============================
echo Pronto! O helper esta rodando oculto.
echo ============================
echo.
echo Pode fechar esta janela.
pause
