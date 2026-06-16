' Inicia o DiscSiP Helper SEM janela (console oculto), porem ATRAVES do start.bat.
' Isto e essencial: o start.bat tem o loop que reinicia o node quando ele sai com
' codigo 42 (auto-atualizacao). Chamar "node index.js" direto aqui mataria o
' auto-update — o helper baixaria a versao nova, sairia com 42 e nunca voltaria.
' O start.bat (com console) continua existindo para debug.
Dim sh, fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
' 0 = janela oculta ; False = nao espera o processo terminar.
' "hidden" diz ao start.bat para nao dar pause ao encerrar (senao sobraria um cmd
' invisivel preso esperando tecla). O proprio start.bat faz cd para a pasta certa.
sh.Run "cmd /c start.bat hidden", 0, False
