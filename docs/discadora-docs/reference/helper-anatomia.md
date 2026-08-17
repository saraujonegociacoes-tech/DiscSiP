# Anatomia do local-helper — o que cada arquivo faz

> Criado em 2026-08-14. Mapa do `local-helper/`: para que serve cada arquivo, o que é
> essencial, o que é histórico e o que pode ser apagado. Escrito porque "não dá para saber o
> que é útil e o que não é útil dentro daquele helper".
>
> Versão coberta: **v1.15**. Correções desta versão em
> [`../fixes/correcao-modal-ini-e-janela-visivel.md`](../fixes/correcao-modal-ini-e-janela-visivel.md).

---

## Os 9 arquivos

| Arquivo | Roda quando | Essencial? |
|---|---|---|
| `index.js` | sempre (é o helper) | ✅ **O helper inteiro.** Único arquivo com lógica |
| `package.json` | `npm install` | ✅ Só declara o `express` |
| `start-hidden.vbs` | boot, protocolo, duplo-clique | ✅ **Único launcher.** Sobe o node sem janela |
| `instalar.bat` | 1× por máquina | ✅ Instalação completa (5 passos) |
| `setup-hooks.ps1` | dentro do `instalar.bat` | ✅ Configura o `microsip.ini` |
| `on-call-start.bat` | o MicroSIP dispara | ✅ Avisa o helper que a chamada conectou |
| `on-call-end.bat` | o MicroSIP dispara | ✅ Avisa que encerrou |
| `on-call-busy.bat` | o MicroSIP dispara | ✅ Avisa que deu ocupado |
| `index.bak` / `helper.log` | gerados em runtime | ⚪ Backup do update e log. Não versionados |

**Não há arquivo morto.** A sensação de redundância vem de outro lugar: o `index.js` tem 1145
linhas, e **a maior parte não é discagem** — é contorno de comportamento do MicroSIP e do
Windows. É isso que está mapeado abaixo.

---

## `index.js` — as 9 responsabilidades

Ordem de leitura útil, não ordem do arquivo:

### 1. Servidor HTTP (essencial)
Express em `localhost:3001`. Escuta em **IPv4 e IPv6** de propósito: um `next dev` que acha a
3000 ocupada pula para a 3001, e como o Windows resolve `localhost` para IPv6 primeiro, o
navegador passava a conversar com o Next em vez do helper — "helper offline" sem erro nenhum.

### 2. Normalização de número (essencial)
`formatNumber` (CSP `021` + DDD + número), `digitsOf`, `sameNumber`. O `sameNumber` casa por
**sufixo de 8 dígitos** porque o MicroSIP devolve o número em formato diferente do discado —
evento que não casa deixava a linha presa em "Discando…" para sempre.

### 3. Fila única de `microsip.exe` (essencial — e é a proteção principal)
`queueMsip` / `MSIP_MIN_GAP_MS = 300ms`.

**Toda** conversa com o MicroSIP nasce um `microsip.exe` novo, que entrega a mensagem e sai. Ao
subir e sair, esse processo **toca no `microsip.ini`** (histórico de discados) — e a instância
principal também escreve lá. Dois ao mesmo tempo = modal *"Failed to open file for writing"*,
que **congela a fila de comandos do MicroSIP**.

> ⚠️ **Nada pode chamar o `microsip.exe` fora desta fila.** Foi exatamente esse o bug da v1.15:
> o `POST /call` spawnava direto.

### 4. Discagem paralela / preditiva (essencial para campanhas com `parallel_lines ≥ 2`)
`parallelSession`, `handleParallelAnswer`, `handleParallelEnd`, `/dial-parallel`,
`/parallel-status`. O 1º que atende vence e derruba os outros com `/hangupcalling` (que poupa a
chamada já atendida).

### 5. Corte de toque + watchdog (essencial — regra de negócio)
- `RING_CUTOFF_MS = 20s` — derruba a linha que **ainda toca**, antes de a caixa postal atender.
- `PARALLEL_TIMEOUT_MS = 90s` — watchdog: evento perdido travaria o lote para sempre.
- `MIN_ANSWER_MS = 0` — **desligado**. Existe, mas a medição provou que tempo não separa
  bloqueio de spam (8,9s) de humano. Não ligue por palpite.

### 6. Eventos do MicroSIP (essencial)
`/event/call-start|end|busy` recebem os `.bat`; `/events` é lido pelo app em polling. É assim
que o app sabe que a chamada acabou.

### 7. Patch do `microsip.ini` (essencial, mas é a parte perigosa)
`readIni` / `patchIni` / `enableMultiCall` / `ensureMultiCallAtStartup`.

Existe só para garantir `singleMode=0` (multi-chamada), sem o qual a preditiva vira power dialer
disfarçado. O ini é **UTF-16 LE com BOM** — gravar em UTF-8 faz o MicroSIP perder as
configurações, inclusive a conta SIP.

> Desligável com **`HELPER_NO_INI_FIX=1`** (só a correção automática no boot; o botão "Preparar
> MicroSIP" continua funcionando).

### 8. Contornos de Windows (não é discagem — é sobrevivência)
- **Mute do alto-falante** — via sessão de áudio do Windows (Core Audio + PowerShell), porque o
  `msip:speakmute` interno **não cala o ringback** do "discando N".
- **Hider da janela do MicroSIP** — loop PowerShell escondendo a janela a cada ~250ms, porque em
  multi-call o MicroSIP **reexibe a janela a cada evento**. Ligado por padrão desde a v1.15;
  desligue com **`HELPER_NO_HIDE=1`** para configurar o softphone.

### 9. Auto-atualização (essencial para operar 26 máquinas)
`maybeAutoUpdate` (no boot) / `POST /update` (botão no app) / `restartSelf`. Baixa
`/helper/index.js` do site, valida que é mesmo o helper, faz backup em `index.bak`, sobrescreve
a si mesmo e **respawna sozinho**. O código de saída 42 é resquício do `start.bat` antigo.

---

## As variáveis de ambiente

| Variável | Efeito |
|---|---|
| `HELPER_NO_HIDE=1` | **Mostra** a janela do MicroSIP (padrão é esconder, desde v1.15) |
| `HELPER_NO_INI_FIX=1` | Não corrige o `singleMode` no boot |
| `HELPER_NO_UPDATE=1` | Não se auto-atualiza no boot (para rodar versão local) |
| `HELPER_DEBUG_MSIP=1` | Loga o intervalo real entre `microsip.exe` — confere a fila |
| `MSIP_MIN_GAP_MS` | Gap da fila (default 300) |
| `RING_CUTOFF_MS` | Corte de toque (default 20000) |
| `MIN_ANSWER_MS` | Piso de atendimento (default 0 = desligado) |
| `DIAL_PREFIX` | CSP (default `021`) |
| `MICROSIP_PATH` · `MICROSIP_INI` | Caminhos, quando a busca automática falha |

---

## Por que "start-hidden existe mas não funciona"

São **duas janelas diferentes**, e só uma é do helper:

1. **Console do node (o helper).** Escondido pelo `start-hidden.vbs` (`sh.Run "node index.js", 0`).
   Isso funciona — o atalho de startup, o protocolo e o duplo-clique passam por ele.
2. **Janela do MicroSIP.** Nunca foi responsabilidade do `.vbs`. Quem cuida dela é o hider
   (item 8), que ficou **opt-in entre a v1.9 e a v1.14** — nesse período ela aparecia.
3. **Piscadas de `cmd.exe`.** Os `exec()` sem `windowsHide` abriam console visível. Corrigido na
   v1.15.

Ou seja: o `.vbs` está certo e sempre esteve. O que aparecia era (2) e (3).

---

## Como depurar

```powershell
# ver o log ao vivo (NÃO use o .vbs — ele esconde tudo)
cd local-helper ; node index.js

# de qual pasta o helper subiu (crítico com vários worktrees)
(Invoke-WebRequest http://localhost:3001/ping -UseBasicParsing).Content

# conferir que dois microsip.exe não nascem juntos
$env:HELPER_DEBUG_MSIP=1 ; node index.js
```

O `helper.log` fica em `local-helper/helper.log`, com timestamp em **milissegundos** (o log de
tela tem resolução de segundo, inútil para corrida entre chamadas). Rotaciona em 2 MB.

> 💡 O `/ping` devolve `dir` e `pid` desde a v1.11 porque "o helper está no ar" não diz nada
> quando existem várias cópias do repo. **Confira sempre de qual pasta subiu.**
