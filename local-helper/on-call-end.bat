@echo off
rem Chamado pelo MicroSIP quando a chamada termina (cmdCallEnd no microsip.ini).
rem O MicroSIP passa o numero como parametro (%~1). Dispara o curl e sai na hora
rem (start /b) para nao segurar o MicroSIP.
start "" /b curl -s -m 2 "http://localhost:3001/event/call-end?number=%~1" >nul 2>&1
