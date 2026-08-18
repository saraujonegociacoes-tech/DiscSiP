# Update — Preditiva funcionando de verdade + Discagem manual

> Criado em 2026-08-06, atualizado em 2026-08-07. Duas mudanças no discador: (1) fazer a
> **discagem preditiva** realmente acontecer nas máquinas dos agentes e (2) criar a **discagem
> manual** (o agente digita o número e liga). Helper **1.7 → 1.14**.
>
> ⚠️ **Este doc cobre até a v1.14.** O helper está na **v1.15** — ver
> [`../fixes/correcao-modal-ini-e-janela-visivel.md`](../fixes/correcao-modal-ini-e-janela-visivel.md)
> (modal do `microsip.ini` corrigido na raiz, janela do softphone escondida de novo) e
> [`../reference/helper-anatomia.md`](../reference/helper-anatomia.md) (o que cada arquivo faz).
> E o discador está migrando para **softphone WebRTC no navegador**:
> [`softphone-webrtc-navegador.md`](softphone-webrtc-navegador.md).
> Fonte da feature preditiva: [`discagem-paralela-preditiva.md`](discagem-paralela-preditiva.md).

---

## 0. Onde paramos (leia isto primeiro)

### ✅ Validado em ligação real (07/ago)
- **Preditiva funciona**: 3 linhas simultâneas; a que atende vira a do agente e as outras
  aparecem como **"Cancelada"** no histórico do softphone.
- **Corte de toque de 20s** age (log do MicroSIP: `12:02:57 Chamando` → `12:03:17 encerrada`).
- **Sem o modal do `.ini`** depois da fila serializada (v1.12).
- **Discagem manual** (aba nova), **helper com launcher único** e **self-restart** no update.

### ⏳ Pendente do dono (bloqueia operação)
1. **Ligar "Abandonada"** na reciclagem de cada lista já existente (Campanha → Listas → ícone de
   reciclagem). Sem isso o corte de toque **e** a tabulação "Caixa postal / Bloqueio" tiram
   contatos da fila **para sempre** — as duas gravam `abandoned`.
2. **Campanhas sem departamento** ("Campanha Teste", "Campanha Rafael"): supervisor nunca escreve
   nelas (`campaign_dept = NULL` nunca casa). Definir departamento se um supervisor for operar.

> ✅ **Resolvido em 07/ago:** a migration `20260807_tester_rls_effective_role.sql` foi aplicada no
> SQL Editor — o papel `tester` volta a escrever no banco. Detalhe em
> [`../../rbac-docs/updates/acessos-e-papel-tester.md`](../../rbac-docs/updates/acessos-e-papel-tester.md).

### ✅ Decisão tomada (07/ago) — bloqueio de spam
Número com bloqueio de spam "atende" em **8,9s** (medido), vence a corrida e derruba as outras
linhas. **Não tem solução por tempo** — 8,9s é indistinguível de humano.

**Decidido: conviver com o problema e resolver pela tabulação do agente.** As opções A (janela de
carência antes de derrubar as outras linhas) e B (auto-tabular ligação curta como `failed`) foram
avaliadas e **descartadas por ora**: as duas erram em conversa real curta e custam mais do que
devolvem enquanto a frequência do problema é desconhecida. O lote sequestrado é perdido, e os
contatos voltam pela reciclagem.

O que **foi** implementado: a tabulação **"Caixa postal / Bloqueio"** (`value: 'voicemail'`,
status `abandoned`) em `src/lib/dispositions.ts`. A razão é que o agente **ouve a gravação** — ele
é o único classificador confiável que existe hoje, e nenhum algoritmo baseado em tempo bate isso.
De quebra ela entrega a opção C sozinha: `where disposition = 'voicemail'` passa a acumular a
frequência real, que é o dado que faltava para decidir se um dia vale investir em AMD.

> ⚠️ Essa tabulação grava `abandoned`. Sem a pendência 1 acima resolvida, ela **para o contato**
> em vez de devolvê-lo à fila — o oposto da intenção.

**Não confundir com auto-tabulação:** lote em que *ninguém* atendeu **já não pede tabulação
nenhuma** ao agente, e emenda no próximo lote sozinho. Verificado em `usePowerDialer.ts:229-264`
(marca cada linha por `cut`/`busy`/`machine`/`no_answer` e faz `setCallStatus('idle')`) e em
`usePowerDialer.ts:344-352` (o painel só aparece com `ended` + `currentContact`, que só existem
quando houve vencedor). O agente só tabula quem atendeu.

Discriminador confiável mesmo: **AMD no PABX** ou **áudio no navegador (WebRTC)** — ver §6 e
`../reference/perguntas-intelbras-widevoice.md` §Sondagem técnica.

### 📐 Tempos medidos (base para qualquer limiar futuro)
| Caso | Tempo-até-atender |
|---|---|
| Bloqueio de spam / anúncio da operadora | **8,9 s** |
| Caixa postal depois do toque | **27 s** |
| Humano | ~5-15 s (sobrepõe o spam block) |

Fonte viva: `GET http://localhost:3001/answer-times` (mediana, p90, `perdidasPeloCorte`,
`atendimentosAte3s`). **Consultar antes de criar qualquer regra de tempo** — a v1.13 foi feita
sobre suposição e o dado a desmentiu.

### 🔧 Como subir o ambiente
```powershell
# 1) helper PRIMEIRO (garante a 3001), 2) dev server depois
wscript "local-helper\start-hidden.vbs"
npm run dev                                   # aborta sozinho se a 3000 estiver ocupada
(Invoke-WebRequest http://localhost:3001/ping -UseBasicParsing).Content   # confira version/dir
```
Testar **sempre em `localhost:3000`** (o site publicado tem o front antigo). Log do helper em
`local-helper/helper.log` (timestamp em ms).

---

## 1. Por que a preditiva não funcionava

O código da preditiva estava inteiro (helper + front + banco). O que faltava era **o
MicroSIP estar em modo multi-chamada**.

- A preditiva depende de `singleMode=0` no `microsip.ini` — está registrado em
  `discagem-paralela-preditiva.md` §7 como fato do ambiente **de teste**.
- O `setup-hooks.ps1` (rodado pelo `instalar.bat` em toda máquina) **nunca escreveu essa
  chave**. Ele configurava hooks, `minimized` e `bringToFrontOnIncoming`, e o comentário
  dizia "com singleMode=1 (ja ativo)".
- Com `singleMode=1` o MicroSIP aceita **uma chamada por vez**: das N discadas em rajada,
  só a primeira vira ligação. A tela mostrava "Discando 3…" e a operação inteira se
  comportava como um power dialer 1-a-1 disfarçado.

Ou seja: funcionava na máquina de teste (onde a chave tinha sido mudada na mão) e não
funcionava em produção. Junto com esse bloqueio principal, três fragilidades derrubavam
o lote quando ele chegava a sair:

| # | Problema | Efeito |
|---|---|---|
| A | Match do número do evento era **igualdade exata** de dígitos | Um `call-start`/`call-end` em formato diferente do discado não casava → a linha ficava `calling` para sempre → **lote nunca resolvia** |
| B | Nenhum timeout de lote | Evento perdido (curl que não rodou) = fila **travada** até o agente reiniciar |
| C | O front lia `/parallel-status` **sem saber de qual lote** | Podia resolver o lote novo com o resultado do anterior → contatos que ainda tocavam viravam `abandoned` |

---

## 2. O que mudou (preditiva)

### 2.1. Helper (`local-helper/index.js`, v1.8)
- **Leitura/patch do `microsip.ini`** (UTF-16 LE com BOM preservado, backup `.bak` antes de
  gravar). `GET /ping` passa a devolver `multiCall: true | false | null`
  (`null` = ini ilegível/inexistente → não afirmamos nada).
- **`POST /microsip-multicall`**: liga o `singleMode=0`. Se o MicroSIP estiver aberto, ele é
  fechado (`/exit`), o ini é corrigido e o MicroSIP reabre — nessa ordem, porque o MicroSIP
  **regrava o ini ao sair** e um patch feito antes seria perdido. Recusa se houver lote em
  andamento.
- **Correção silenciosa no boot** (`ensureMultiCallAtStartup`): se o MicroSIP ainda **não**
  está aberto, o helper acerta o ini sozinho — o caso comum, já que o helper sobe com o
  Windows. Desligável com `HELPER_NO_INI_FIX=1`.
- **`POST /dial-parallel` recusa com 409** quando o MicroSIP está em chamada única, em vez de
  discar 1 número fingindo que discou N.
- **Match tolerante** do número do evento: igualdade exata e, se falhar, sufixo dos últimos
  8 dígitos (resolve o problema A).
- **Watchdog de 90s por lote**: linhas ainda `calling` são encerradas e o lote é fechado
  (`timedOut: true`), usando `/hangupcalling` — nunca `/hangupall`, para não derrubar uma
  conversa em curso (problema B).
- **Sessão fantasma eliminada**: no caminho "ninguém atendeu" a sessão agora vira
  `resolved`, e qualquer `/call` avulso zera a `parallelSession`. Antes, o `call-start` de
  uma ligação 1-a-1 podia cair na sessão morta e disparar `/hangupcalling`.
- `/parallel-status` devolve também `resolved`, `finished` e `timedOut`.
- **`POST /call` aceita `raw: true`** — disca os dígitos sem o CSP `021` (usado pela discagem
  manual para ligar para ramal interno).

### 2.2. Instalador (`setup-hooks.ps1`)
Passa a gravar `singleMode=0` junto com os hooks. Máquina nova já nasce apta à preditiva.

### 2.3. Front-end
- `softphoneStore`: novo `multiCall` (vem do `/ping`) e `manualActive`.
- `dialerStore`: novos `parallelSessionId` (id do lote no helper) e `dialerError`.
- `usePowerDialer`:
  - o lote só vira estado da UI **depois** que o helper confirma o disparo, e o
    `/parallel-status` só é aceito quando o `id` bate (problema C);
  - erro no disparo → contatos **devolvidos à fila**, discador pausado e o motivo exibido
    (antes o erro era engolido);
  - **pausar com o lote tocando** derruba as linhas e devolve os contatos (antes ficavam
    presos em `dialing` para sempre — a reciclagem não pega esse status);
  - o polling do 1-a-1 passou a exigir `dialerStatus === 'running'`, para não se misturar
    com a discagem manual.
- `DialerTab`: aviso **"MicroSIP em modo de chamada única"** com botão **Preparar MicroSIP**
  (bloqueia Iniciar/Retomar enquanto não resolver) e banner do último erro de discagem.
- `campaigns.ts`: nova action `releaseContacts` (devolve `dialing → pending`; **não** mexe em
  `attempts`, para não abrir laço infinito em número problemático).

---

## 3. Discagem manual (novo)

Aba **"Discagem manual"** no `/softphone` ([`ManualDialTab.tsx`](../../../src/app/softphone/ManualDialTab.tsx)):
teclado + campo de número, **Ligar** e **Desligar**, cronômetro e tabulação opcional.

- **Fora de campanha:** não consome mailing, não mexe em `campaign_contacts`.
- **Ramal interno:** até 6 dígitos disca cru (`raw: true`, sem o `021`); 10 ou 11 dígitos
  disca como fixo/celular com DDD. A tela mostra **o que vai ser discado** antes de ligar.
- **Estado da ligação** vem dos eventos do MicroSIP (`/events`), com linha de base capturada
  **antes** de discar — nenhum evento se perde entre o disparo e o primeiro polling.
- **Histórico:** grava em `call_logs` com `campaign_id` nulo. O `status` é o que aconteceu na
  linha (atendida/ocupado/não atendeu) e a **disposição é opcional** — `call_logs` é imutável
  por RLS (só admin dá UPDATE), então o registro é gravado **uma única vez**, no fim.
- **Não concorre com a campanha:** fica bloqueada enquanto o discador está `running`/`paused`
  — os dois disputariam o mesmo MicroSIP.
- O painel de áudio (`CallControls`) agora também aparece durante a ligação manual.

---

## 4. Rollout

1. **Deploy do site** — o `prebuild` publica o helper novo em `/helper/index.js` +
   `/helper/version.json` (v1.8).
2. **Helper nos agentes:** cada máquina vira 1.8 pelo botão **"Atualizar v1.8"** no
   `/softphone` ou sozinha ao reiniciar o helper/Windows. Enquanto convivem 1.7 e 1.8, o site
   funciona com os dois: em 1.7 o `/ping` não devolve `multiCall`, então o aviso não aparece
   (`null` = desconhecido) e a discagem manual para ramal interno não pega o `raw`.
3. **MicroSIP:** na primeira subida do helper 1.8 com o MicroSIP fechado, o ini é corrigido
   sozinho. Se estiver aberto, o agente clica em **Preparar MicroSIP** (fora de ligação).
4. **Sem migration.**

---

## 5. Testado

Helper exercitado de ponta a ponta com `microsip.ini` de teste (UTF-16 LE) e eventos
simulados nos endpoints `/event/*`:

- `singleMode=1` → `/ping` devolve `multiCall:false`; `/dial-parallel` responde **409**
  sem criar sessão.
- `POST /microsip-multicall` → grava `singleMode=0` **preservando BOM, codificação e as
  demais chaves**, com `.bak`. Vale para chave existente e para chave ausente (inserida
  logo após `[Settings]`).
- Lote de 3 com `call-start` chegando **sem o prefixo 021** → vencedor reconhecido pelo
  sufixo (com o match antigo o lote travaria).
- "Ninguém atendeu" → `resolved: true` (sem sessão fantasma), linhas `busy`/`ended`.
- Watchdog → linhas penduradas encerradas, `timedOut: true`.
- Conversa em curso → `finished: false`, o "Preparar MicroSIP" é recusado.
- `/call` avulso → zera a sessão paralela.

`tsc --noEmit` e `eslint src` limpos. Os erros de `require()` em `local-helper/index.js`
são pré-existentes (arquivo CommonJS, fora do escopo do Next).

**Falta testar com telefonia real** (não é reproduzível fora da máquina do agente): rodar
uma campanha com `parallel_lines = 3` num ramal real e confirmar que as 3 saem juntas com o
`singleMode=0` aplicado pelo helper.

---

## 6. Caixa postal — corte de toque + auto-tabulação (2026-08-06, helper 1.9)

### O problema
A caixa postal atende com `200 OK` igual a um humano — para o SIP são indistinguíveis, e o
MicroSIP não analisa áudio (ver `../fixes/correcoes-discadora-sprints.md` §Sprint 2). **Na
preditiva é pior que no 1-a-1:** a caixa atende rápido e sempre, então ela **vence a corrida
do lote** e faz o helper derrubar as outras 2 linhas — que podiam ser gente de verdade.

### A decisão (sem depender da Intelbras)
Não deixar a chamada **chegar** na caixa postal: a caixa da operadora entra tipicamente entre
25 e 30s de toque, então a linha que só toca é derrubada em **20s** (`RING_CUTOFF_MS`).

> **Isto não é o `autoHangUpTime` do MicroSIP** (aquele foi vetado, e com razão: é cego e mata
> conversa já atendida). O corte usa `/hangupcalling`, que **por definição** poupa a chamada
> CONFIRMED — nenhuma conversa em curso pode cair por causa dele. Só morre linha que ainda
> está tocando.

**Custo assumido:** perde-se quem demora mais de 20s para atender. Por isso a **auto-tabulação
como `abandoned`** (decisão do usuário): quem desistiu fomos nós, o contato não recusou nada —
ele volta pela reciclagem no período em vez de levar um `no_answer`. Isso acontece **pelas
costas do agente**: o lote resolve sozinho e a fila segue, sem tela de tabulação.

### Implementação
- **Helper:** timer por lote em `RING_CUTOFF_MS` (env, default 20s), contado a partir da última
  linha disparada. Marca as linhas ainda tocando como `'cut'` e dispara `/hangupcalling`.
  **Não** marca `resolved`: se alguém atendeu nos milissegundos anteriores, o MicroSIP preserva
  a chamada e o `call-start` ainda é processado normalmente como vencedor.
- `handleParallelEnd` **preserva o `'cut'`** quando o `call-end` chega logo depois — é ele que
  distingue "nós derrubamos" (`abandoned`) de "o destino desistiu" (`no_answer`).
- O watchdog de 90s também marca `'cut'` (linha pendurada = encerrada por nós).
- **Front:** `'busy'` → `busy`; `'cut'` → **`abandoned`**; resto → `no_answer`.
- **Reciclagem:** `abandoned` **não existia** em `RECYCLE_OPTIONS` — os contatos derrubados
  (inclusive os do modo paralelo, desde 2026-06) ficavam parados para sempre. Agora é opção,
  vem marcada por padrão, e listas **já existentes** ganharam um editor de reciclagem
  (`updateListRecycle` + botão na lista) — antes só dava para mudar apagando e reimportando.
  A tela avisa quando uma lista recicla mas **não** inclui `abandoned`.

### Calibrar o 20s com dado real
`GET http://localhost:3001/answer-times` devolve a distribuição do tempo-até-atender medida
pelo próprio helper (memória, ~500 amostras), com mediana, p90 e **`perdidasPeloCorte`** =
quantas atendidas o corte atual teria descartado. Humano se espalha pela faixa; caixa postal
se concentra num valor fixo. Ajustar via `RING_CUTOFF_MS` depois de ver o número real.

### Hider desligado (v1.9) — ⚠️ REVERTIDO na v1.15

> **Atualização 14/08/2026:** o hider **voltou a ser ligado por padrão** (opt-out, desligável com
> `HELPER_NO_HIDE=1`). A fase de configuração do softphone acabou e o efeito colateral apareceu em
> produção: a janela do MicroSIP aparecendo na frente do agente durante a operação. O texto abaixo
> fica como registro da decisão original. Ver
> [`../fixes/correcao-modal-ini-e-janela-visivel.md`](../fixes/correcao-modal-ini-e-janela-visivel.md).

O hider da janela do MicroSIP passou a ser **opt-in** (`HELPER_HIDE=1`). Enquanto o softphone
está sendo testado e configurado, esconder a janela impede o próprio administrador de abri-lo.
Com `minimized=1` ele continua nascendo na bandeja — dá para abrir pelo ícone.

### ❌ O piso de atendimento NÃO resolveu — medição derrubou a hipótese (v1.14)

**3º teste real:** número com bloqueio de spam venceu a corrida de novo e derrubou as outras
duas. O piso de 4s não disparou. O motivo está na medição do próprio helper:

```
startedAt   15:43:37.334
answeredAt  15:43:46.908   →  tempo-até-atender: 8,9 s
```

**O bloqueio de spam levou 8,9 segundos para "atender"** — não 1-3s como a v1.13 supôs. E 8,9s
é território de humano: gente atende nesse tempo o tempo todo. **Tempo não separa esse caso.**

Consequências registradas:
- `MIN_ANSWER_MS` passou a **0 (desligado)**. O mecanismo continua no código (existe o caso
  genuinamente instantâneo, tipo anúncio de "número inexistente"), mas ligado por palpite ele só
  arriscava descartar pessoa real sem resolver o problema. Para decidir com dado, `/answer-times`
  passou a devolver **`atendimentosAte3s`** — medido sempre, mesmo com o piso desligado. Se isso
  ficar em 0 na operação, atendimento instantâneo não existe aqui e o piso deve continuar off.
- **Lição de método:** a v1.13 foi construída sobre uma suposição de tempo não medida. O dado
  existia (o helper já media desde a v1.10) e não foi consultado antes de implementar.

**Distribuição medida até agora:**

| Caso | Tempo-até-atender |
|---|---|
| Bloqueio de spam / anúncio da operadora | **~8,9 s** |
| Caixa postal depois do toque | **~27 s** |
| Humano | esperado ~5-15 s (sobrepõe o spam block) |

O corte de toque de 20s continua válido — ele pega a faixa dos 27s. O que ficou **sem solução
por tempo** é o spam block, e isso é o argumento mais concreto até agora para AMD no PABX ou
para o caminho WebRTC (áudio no navegador). Ver
`../reference/perguntas-intelbras-widevoice.md` §Bloco 2.

### Log em arquivo (v1.14)

O helper roda oculto, então o stdout ia para lugar nenhum: só houve diagnóstico acima porque as
amostras estavam na memória do processo. Agora tudo que vai ao console também vai para
`local-helper/helper.log`, com timestamp em **milissegundos** (o log de tela tem resolução de
segundo, inútil para investigar corrida entre chamadas). Rotaciona em 2 MB. Ignorado pelo git.

### Piso de atendimento: caixa postal INSTANTÂNEA (v1.13 — revisado acima)

**Achado no 2º teste real:** um dos celulares tinha **bloqueio de spam**. A operadora mandou a
chamada para a caixa/anúncio em ~1-3s, **antes de o telefone tocar**. Para o SIP foi um `200 OK`
normal → venceu a corrida → o helper derrubou as outras duas linhas (que podiam ser gente) e
entregou uma gravação ao agente. O pior desfecho possível de um lote.

O corte de toque não pega esse caso: ele protege do lado **lento** (caixa que entra depois de
~25-30s de toque). Este é o lado **rápido**, e o sinal é simétrico — humano precisa de tempo. A
chamada leva ~1-2s só para começar a tocar no destino, mais a reação da pessoa.

**`MIN_ANSWER_MS` (default 4s):** atendimento abaixo do piso é tratado como máquina. O lote
**inteiro é descartado** — sem vencedor, sem tela de tabulação — e a fila puxa um lote novo.
O contato suspeito fica como `machine` no helper → **`failed`** no banco (não é "não atendeu":
alguém atendeu, só não era pessoa; e insistir tende a bater na mesma parede). Os demais viram
`cut` → `abandoned`, recicláveis.

Detalhe de implementação: aqui usa-se `msip:hangupall`, não `/hangupcalling` — a linha suspeita
**já está atendida**, então o hangupcalling não a derrubaria; e o lote todo está sendo jogado fora
de qualquer forma.

**Conservador de propósito:** melhor deixar passar uma máquina do que descartar uma pessoa que
atendeu rápido. Calibre com `/answer-times`, que agora devolve `pisoAtendimentoS` e
**`abaixoDoPiso`** (quantos atendimentos ficaram abaixo do piso).

Testado: atendimento em 1.3s → `machine` + demais `cut` + `instantAnswer: true`, sem vencedor;
atendimento em 6.1s → vencedor normal, demais derrubadas.

| Desfecho da linha (helper) | Status do contato | Significado |
|---|---|---|
| `answered` | tabulado pelo agente | falou com alguém |
| `cut` | `abandoned` | **nós** derrubamos (corte de toque / outra atendeu / watchdog) |
| `machine` | `failed` | atendeu rápido demais — bloqueio de spam, desligado, caixa direta |
| `busy` | `busy` | ocupado de verdade (486/600/603) |
| `ended` | `no_answer` | o destino encerrou sozinho antes do corte |

### Modal "Failed to open file for writing microsip.ini" no atendimento (v1.12)

**Primeiro teste real da preditiva (07/ago):** as 3 linhas saíram simultâneas e o corte de toque
funcionou (log do MicroSIP: `12:02:57 Chamando` → `12:03:17 Chamada encerrada`, exatos 20s).
Mas ao **atender** uma delas, o MicroSIP abriu o modal
`Failed to open file for writing ...\microsip.ini`.

**Causa:** toda conversa com o MicroSIP nasce um `microsip.exe` novo (entrega via `WM_COPYDATA`
e sai) e esse processo **toca no `microsip.ini`** (histórico de discados) ao subir/sair — ao
mesmo tempo que a instância principal grava lá. Dois escrevendo junto = modal, e ele ainda
**congela a fila de comandos** do MicroSIP.

Isso já era conhecido para a rajada de discagem (havia um `STAGGER_MS` de 300ms **só nos
dials**), mas o atendimento disparava **dois comandos no mesmo milissegundo** —
`msip:speakunmute` + `/hangupcalling` — exatamente enquanto o principal gravava a chamada
atendida. Era o pior instante possível.

**Correção, em duas partes:**
1. **Fila única (`queueMsip`)**: *toda* invocação do `microsip.exe` — discagens e comandos —
   passa por uma fila com intervalo mínimo (`MSIP_MIN_GAP_MS`, default 300ms). Substitui o
   stagger ad-hoc, que cobria só metade dos casos. Custo máximo: ~300ms de atraso no
   `/hangupcalling`, irrelevante perto dos 15–30s de toque.
2. **`msip:speakmute`/`speakunmute` removidos do fluxo paralelo.** Eles nunca funcionaram para
   o que se queria: no fonte do MicroSIP só zeram o RX de chamadas **já conectadas**, ou seja,
   não calam o ringback do "discando N" (achado de `../fixes/correcoes-producao-2026-06.md` §4).
   Eram dois `microsip.exe` inócuos por lote — um deles no instante do atendimento. Quem
   silencia de verdade é o mute no nível do Windows (`/mute`), acionado pelo agente.

**Verificado** com `HELPER_DEBUG_MSIP=1` (novo; imprime o intervalo real entre lançamentos em
ms — o log normal tem resolução de segundo e não serve): rajada de 3 + atendimento no meio dela
produziu 4 lançamentos com **intervalo mínimo de 300ms**, nenhum simultâneo. Fluxo completo
reconferido: vencedor detectado, derrubados marcados, corte de toque em 20s → `cut`.

### Enxugamento do helper (2026-08-07, v1.11)

Eram **4 arquivos de inicialização** para uma única linha de lógica. A cascata existia porque a
auto-atualização saía com código **42** e alguém precisava reabrir o node: esse alguém era o
loop do `start.bat`; e como `.bat` pisca console, veio o `.vbs` só para escondê-lo.

O loop foi para **dentro do helper** (`restartSelf`): ao se atualizar, ele spawna a versão nova
desacoplada (`detached`, sem console) e encerra.

| Antes | Agora |
|---|---|
| `start.bat` (loop do 42) | ❌ removido |
| `atualizar.bat` (matar + npm install + subir) | ❌ removido — o código se atualiza sozinho; dependências = rodar `instalar.bat` |
| `start-hidden.vbs` → `start.bat` → node | ✅ `start-hidden.vbs` → node (launcher único) |
| `instalar.bat` | ✅ + registra o protocolo `bluedesk-helper://` |

**Compatibilidade no rollout (importante):**
- `exitForUpdate()` sai com **0** quando o self-restart funciona. Se saísse com 42, o
  `start.bat` **antigo** — que ainda existe na máquina dos agentes até reinstalarem — abriria um
  **segundo** helper. Só sai com 42 se o self-restart falhar, deixando o launcher antigo cobrir.
- A validação do update procura a string `app.listen` no código baixado. Helpers antigos
  **recusariam** um helper novo sem ela, então o listen IPv4 continua usando `app.listen`.

### Botão "Ligar helper" no Blue Desk
Página web **não pode** iniciar processo local — não existe API, é proteção do navegador. O
caminho suportado é um **protocolo registrado no Windows**: o `instalar.bat` grava
`HKCU\Software\Classes\bluedesk-helper` apontando para o `.vbs`, e o botão navega para
`bluedesk-helper://start`. Limites honestos: o navegador pede confirmação na 1ª vez; a página
não recebe retorno (o polling de `/ping` a cada 10s é que confirma); e só funciona se o
`instalar.bat` já tiver rodado naquela máquina.

### Armadilha de ambiente: o Next rouba a porta 3001
Visto na prática ao preparar o teste. Com **dois** `next dev` rodando, o segundo acha a 3000
ocupada e **incrementa sozinho para a 3001** — a porta do helper. Como o helper faz bind só em
`127.0.0.1` e o Next em `::`, os dois convivem sem `EADDRINUSE`; mas `localhost` no Windows
resolve **IPv6 primeiro**, então o navegador conversa com o **Next**, não com o helper.

Sintoma: discagem não acontece e o `/ping` devolve HTML. Como o app só olhava `res.ok`, ele
exibia **"Helper online" sem versão** — mentindo. Corrigido em duas frentes:

1. **UI:** só conta como helper se o payload vier com `ok: true` (`SoftphoneClient.tsx`).
2. **Helper (v1.11):** passou a escutar em `127.0.0.1` **e** `::1` — as duas caras do
   `localhost`. Testado: mesmo com um intruso conseguindo bind em `[::]:3001`, o socket mais
   específico (`::1`) vence e `localhost` continua chegando no helper. Continua só loopback.
3. **`predev` guard** (`scripts/dev-guard.mjs`): o `npm run dev` **aborta** se a 3000 já estiver
   ocupada, em vez de deixar o Next pular para a 3001 sozinho. Ataca a origem: sem o pulo, não
   há disputa. A mensagem manda abrir `http://localhost:3000` (quase sempre o dev server já
   está no ar) e mostra o comando para ver quem ocupa as portas.

> **Worktrees:** há 3 cópias do repo (`discip-fix`, `discsip`, `discsip-diretoria`), cada uma
> com seu `local-helper`. Só **uma** pode ocupar a 3001, e o launcher de qualquer uma sobe a
> versão **daquela** pasta — foi assim que um v1.7 ficou respondendo enquanto o v1.9 estava na
> `discip-fix`. Por isso o `/ping` agora devolve **`dir`** e **`pid`**: dá para ver na hora qual
> pasta está no ar, sem adivinhar.

### Sobre o AMD da Intelbras (leitura técnica, não confirmada por eles)
Ver `../reference/perguntas-intelbras-widevoice.md` §Bloco 2: os parâmetros que eles listaram
são os do `AMD()` do Asterisk, que **sinaliza** (variável de canal) e não derruba — quem
derruba é o plano de discagem deles. Se um dia confirmarem AMD com hangup na rota de saída do
ramal, o `cmdCallEnd` resultante já é tratado aqui, mas **faltará uma janela de carência** no
helper: hoje o vencedor é consolidado no `call-start` e as outras linhas morrem antes de o AMD
dar veredito. Não implementado — depende da confirmação deles.

---

## 7. Limite conhecido (não mexido aqui)

O motor de discagem continua vivendo na tela do discador: **sair de `/softphone` ainda para a
fila**. Está desenhado em
[`discagem-em-background-dialer-engine.md`](discagem-em-background-dialer-engine.md) e não
entrou neste lote para não empilhar risco no núcleo da discagem.

---

## 8. Tabulação "Caixa postal / Bloqueio" (2026-08-07)

**Causa.** Caixa postal e bloqueio de spam **atendem a chamada** — do ponto de vista do SIP vem um
200 OK igual ao de uma pessoa. A linha vence a corrida, vira `currentContact`, e ao desligar o
agente cai no painel de tabulação.

**Por que isso era um problema.** Nenhuma das seis disposições existentes descrevia o que
aconteceu. Na prática o agente marcava "Não Atendeu" (`no_answer`) ou "Sem Interesse"
(`answered`) — e nos dois casos duas coisas se perdiam: a informação de que aquele número tem
bloqueio, e a regra de reciclagem correta, já que `no_answer` e `abandoned` seguem configurações
diferentes por lista.

**Solução.** Uma disposição nova em `src/lib/dispositions.ts`:

```ts
{ label: 'Caixa postal / Bloqueio', status: 'abandoned', value: 'voicemail' },
```

A escolha do classificador é deliberada: **o agente ouve a gravação**. Depois de a v1.13 provar
que tempo não separa esses casos (bloqueio medido em 8,9s, dentro da faixa humana), o ouvido do
agente é o único discriminador confiável disponível sem AMD ou WebRTC — ver §0.

**Arquivos.** `src/lib/dispositions.ts` (uma linha + comentário). Nada de lógica de discagem
mudou; a lista alimenta sozinha o painel do discador, o filtro do histórico, o relatório de
performance e o seletor de `notify_dispositions` da campanha, que todos leem de `DISPOSITIONS`.

**Risco.** Grava `abandoned`. Se a lista **não** tiver "Abandonada" marcada na reciclagem, o
contato fica parado em vez de voltar à fila — o oposto da intenção. É a mesma pendência do corte
de toque (§0, item 1), agora com duas razões para ser resolvida.

**Efeito colateral desejado.** `where disposition = 'voicemail'` passa a medir sozinho a
frequência real do bloqueio de spam — o dado que faltava para decidir se um dia vale investir em
AMD, obtido sem projeto nenhum.
