' Inicia o DiscSiP Helper SEM janela (console oculto).
' Use este no lugar do start.bat para rodar o helper invisivel (ex: no startup do Windows).
' O start.bat (com console) continua existindo para debug.
Dim sh, fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
' 0 = janela oculta ; False = nao espera o processo terminar
sh.Run "cmd /c node index.js", 0, False
