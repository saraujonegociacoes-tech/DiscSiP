# Configura os hooks de evento do MicroSIP (cmdCallStart/End/Busy) num caminho SEM espacos
# (C:\Users\Public\discsip-helper). Isso contorna um bug do MicroSIP: ele guarda o valor do
# hook entre aspas no ini, mas ao ler com GetPrivateProfileString as aspas sao removidas e, se o
# caminho tiver espaco (ex: "Filipe Crepaldi"), CommandLineToArgvW quebra no espaco e o hook
# nunca roda. Caminho sem espaco resolve em qualquer maquina/usuario.
$ErrorActionPreference = 'Stop'

$src  = $PSScriptRoot
$dest = 'C:\Users\Public\discsip-helper'
$bats = 'on-call-start.bat', 'on-call-end.bat', 'on-call-busy.bat'

New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($b in $bats) { Copy-Item (Join-Path $src $b) (Join-Path $dest $b) -Force }
Write-Host "Hooks copiados para $dest"

$ini = Join-Path $env:APPDATA 'MicroSIP\microsip.ini'
if (-not (Test-Path $ini)) {
  Write-Warning "microsip.ini nao encontrado em $ini. Abra o MicroSIP uma vez e rode de novo."
  exit 1
}

if (Get-Process microsip -ErrorAction SilentlyContinue) {
  Write-Warning 'MicroSIP esta ABERTO. Feche-o (ele reescreve o ini ao sair) e rode este script de novo.'
  exit 1
}

# Le preservando UTF-16 LE
$content = Get-Content -Raw -Encoding Unicode $ini
$map = [ordered]@{
  cmdCallStart = "$dest\on-call-start.bat"
  cmdCallEnd   = "$dest\on-call-end.bat"
  cmdCallBusy  = "$dest\on-call-busy.bat"
}
foreach ($k in $map.Keys) {
  $line = "$k=`"$($map[$k])`""
  # MatchEvaluator (scriptblock) evita qualquer interpretacao de $ / \ na string de replacement
  $repl = [System.Text.RegularExpressions.MatchEvaluator] { param($m) $line }.GetNewClosure()
  if ($content -match "(?m)^$k=[^\r\n]*") {
    $content = [regex]::Replace($content, "(?m)^$k=[^\r\n]*", $repl)
  } else {
    $addSection = [System.Text.RegularExpressions.MatchEvaluator] { param($m) "$($m.Value)`r`n$line" }.GetNewClosure()
    $content = [regex]::Replace($content, "(?m)^\[Settings\][^\r\n]*", $addSection)
  }
}
# Regrava como UTF-16 LE (com BOM), igual o MicroSIP espera
Set-Content -Path $ini -Value $content -Encoding Unicode -NoNewline
Write-Host "ini atualizado: cmdCallStart/cmdCallEnd/cmdCallBusy apontando para $dest"
Write-Host "Reabra o MicroSIP para carregar os hooks."
