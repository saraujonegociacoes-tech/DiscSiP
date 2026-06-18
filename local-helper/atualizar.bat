@echo off
title Atualizar Blue Line Helper
cd /d "%~dp0"

echo Blue Line Helper - Atualizacao
echo ============================
echo.

REM [1/4] Se esta pasta for um repositorio git, puxa a versao mais nova.
REM       Senao, usa os arquivos que ja estao aqui (copie o index.js novo antes).
if exist ".git" (
  echo [1/4] Atualizando arquivos via git pull...
  git pull
) else (
  echo [1/4] Pasta nao e repositorio git. Usando os arquivos ja presentes nesta pasta.
  echo       Se precisar, copie o index.js novo para ca antes de rodar este .bat.
)
echo.

echo [2/4] Parando o helper em execucao...
REM Mata so o node que esta rodando o index.js do helper (nao mexe em outros node).
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo OK.
echo.

echo [3/4] Atualizando dependencias Node.js...
call npm install
if errorlevel 1 (
  echo AVISO: npm install falhou. Node.js esta instalado?
)
echo.

echo [4/4] Subindo o helper novamente (oculto)...
wscript "%~dp0start-hidden.vbs"
echo.
echo ============================
echo Atualizacao concluida! O helper esta rodando oculto.
echo ============================
echo.
echo Pode fechar esta janela.
pause
