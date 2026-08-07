' Inicia o Blue Desk Helper SEM janela (console oculto).
'
' Este e o UNICO launcher do helper. Antes existia um start.bat com um loop que reabria o
' node quando ele saia com codigo 42 (auto-atualizacao), e este .vbs so servia para esconder
' o console desse .bat. O loop foi para dentro do proprio helper (restartSelf no index.js):
' ao se atualizar, ele mesmo spawna a versao nova e encerra. Sem loop externo, sem .bat.
'
' Usado em tres situacoes:
'   1. atalho na pasta Inicializar do Windows (criado pelo instalar.bat)
'   2. protocolo bluedesk-helper:// (botao "Ligar helper" no Blue Desk)
'   3. duplo-clique, quando o agente precisa subir na mao
'
' Para VER o log (depuracao), nao use este arquivo: abra um terminal na pasta e rode
'   node index.js
Dim sh, fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
' 0 = janela oculta ; False = nao espera o processo terminar.
sh.Run "node index.js", 0, False
