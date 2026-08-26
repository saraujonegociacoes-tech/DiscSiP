# Silêncio de toque — som só quando ATENDEM (helper v1.16)

> 2026-08-21. O agente não ouve mais nada enquanto disca/toca; o áudio abre sozinho no instante
> do atendimento e fecha quando a conversa acaba.
> Mapa do helper: [`../reference/helper-anatomia.md`](../reference/helper-anatomia.md).
>
> ⚠️ **Leia junto:** [`../fixes/correcao-downgrade-automatico-do-helper.md`](../fixes/correcao-downgrade-automatico-do-helper.md).
> A primeira tentativa de rodar esta versão em produção morreu porque o auto-update **rebaixou o
> helper de 1.16 para 1.7 e apagou o arquivo**. A correção faz parte da mesma v1.16.

---

## O pedido

> "Deixar as chamadas sem sons e só dar som quando atender no MicroSIP."

## Por que não dava para resolver nas Configurações do MicroSIP

O barulho do lote **não é** o toque do MicroSIP: é o **ringback do carrier** (early media —
áudio RTP de verdade, um por linha discada). Nenhuma opção da tela de Configurações desliga
isso — nem `ringingSound`/volume do toque (só chamada **recebida**), nem "Eventos sonoros"
(`localDTMF`, só tecla e sinal de saída).

E o `msip:speakmute` do próprio MicroSIP **não serve**: no fonte (`lib/MSIP.cpp`) ele só zera o
RX dos conf ports de chamadas **já conectadas** — achado antigo, registrado em
[`../fixes/correcoes-producao-2026-06.md`](../fixes/correcoes-producao-2026-06.md) (item #4).

Quem cala tudo é o **mute da sessão de áudio do `microsip.exe` no mixer do Windows**
(Core Audio / `ISimpleAudioVolume`) — que o helper já tinha, mas só no **botão manual** do
painel de áudio. A v1.16 passa a acioná-lo sozinho.

## Regra implementada

**O softphone fica MUDO por padrão. O som abre quando alguém ATENDE e fecha quando a conversa
termina.**

| Momento | Som |
|---|---|
| Helper sobe / entre chamadas | mudo |
| Lote paralelo discando (N linhas) | mudo — nenhum ringback chega ao agente |
| Caixa postal atendendo antes do corte de toque | mudo (o lote é derrubado sem o agente ouvir) |
| **Vencedor atende** | **abre** (`handleParallelAnswer`) |
| Discagem 1-a-1 / manual atende | abre (`handleSingleAnswer`) |
| **Chamada recebida atendida no MicroSIP** | abre (rede de segurança no `/event/call-start`) |
| Linhas perdedoras caindo depois do vencedor | **continua aberto** (`anyLiveCall`) |
| Fim da conversa (`call-end`/`call-busy`) | volta a mudo |

## O problema do 1 segundo (o motivo do worker)

O mute roda em PowerShell com `Add-Type`, que **compila C# em runtime: ~1s por spawn** (medido).
Tudo bem para um botão de painel — **fatal** para o desmute no atendimento: o agente perderia o
"alô" e o primeiro segundo da conversa.

Por isso a v1.16 sobe um **worker de PowerShell persistente**: compila o tipo **uma vez**, na
largada do helper, e depois cada mute/desmute é uma linha no `stdin` dele.

| | v1.15 (spawn por comando) | v1.16 (worker) |
|---|---|---|
| Latência do mute/desmute | ~1000 ms | **~40 ms** (medido, incluindo o HTTP) |

Duas coisas que o worker precisou acertar (as duas apareceram em revisão, antes de rodar):

- **Pedido e resposta pareados por `id`**, não por ordem de chegada. Com fila posicional, um
  único timeout desalinhava a fila **para sempre**: toda resposta seguinte era consumida pelo
  pedido errado, todo comando caía no fallback lento. Sintoma esperado: funciona no começo e
  degrada — exatamente o tipo de bug que some no teste curto.
- **Só usar o worker depois do `READY`.** Enquanto o `Add-Type` compila, o comando ficaria
  parado no buffer do stdin. Antes do READY (e se o worker cair), o helper vai direto de spawn
  avulso — lento, mas responde. O caminho antigo continua no arquivo justamente para isso.

## A guarda de toque (por que instantes fixos não bastam)

O mute vale **por sessão de áudio do Windows**, e a sessão do MicroSIP só nasce quando ele abre
o áudio de verdade — o que pode ser segundos depois do disparo, e **de novo a cada chamada**.
Sessão nova nasce **sem** mute.

A primeira versão reaplicava o silêncio em instantes fixos (250 ms e 1700 ms depois de discar).
Isso acerta no lote de hoje e erra no de amanhã. Trocado por uma **guarda**: enquanto houver
linha tocando e o silêncio estiver armado, o estado é reaplicado a cada 700 ms; ela para sozinha
no atendimento, quando nada mais toca, ou no teto do corte de toque.

O log ganhou o contador de sessões — é ele que diz se o silêncio **pegou** em alguma coisa:

```
[16:38:33] Som MUDO (helper iniciado) — 1 sessao/oes
[16:38:37] Guarda de toque: silencio reaplicado em 1 sessao/oes
[16:38:39] Som ABERTO (02111934962684 atendeu) — 1 sessao/oes
[16:38:43] Som MUDO (sem chamada em curso) — 1 sessao/oes
```

`0 sessao/oes` significa que o MicroSIP não tinha áudio aberto naquele instante — o mute não
pegou em nada. Sem esse número, "não funcionou" vira adivinhação.

## Outros detalhes que a implementação precisou respeitar

- **Duas flags separadas.** `speakerMuted` (mute **manual**, o botão do painel) e `autoMuted`
  (silêncio de toque). Efetivo = um OU outro. O automático nunca desfaz a escolha do agente, e
  o botão do painel continua refletindo só a escolha dele. Desmutar no botão limpa o automático
  **agora** (senão o botão não faria som nenhum entre chamadas); a próxima discagem rearma.
- **Desmute antes do `/hangupcalling`**, no vencedor do lote: o desmute é uma linha no worker
  (ms) e o hangup ainda vai esperar a vez na fila do `microsip.exe`.
- **Não remutar no meio da conversa**: as linhas perdedoras do lote caem logo depois do vencedor
  atender; o `call-end` delas só volta a mutar se `anyLiveCall()` for falso.
- **MicroSIP reiniciado** (ex.: "Preparar MicroSIP") = processo novo = sessão nova, sem mute:
  o silêncio é rearmado depois do restart.

## Interruptores (env)

| Variável | Efeito |
|---|---|
| `AUTO_MUTE_RING=0` | desliga tudo — volta ao comportamento da v1.15 (som sempre aberto, mute só no botão) |
| `AUTO_MUTE_IDLE=0` | mantém o silêncio **só do discar até o atendimento**; entre chamadas o som fica aberto — é o modo para quem precisa **ouvir a campainha de chamada recebida** |
| `MUTE_WORKER_TIMEOUT_MS` | quanto esperar o worker antes de cair no spawn avulso (padrão 700) |
| `RING_GUARD_DEBUG=1` | loga **toda** passada da guarda de toque, não só quando o número de sessões muda |

O `/ping` passou a devolver `ringSilence`, `ringSilenceIdle` e `speakerMuted` (estado efetivo).

## ⚠️ Efeito colateral a conhecer

Com o padrão (`AUTO_MUTE_IDLE` ligado), **o toque de uma chamada recebida não soa** — a janela
do MicroSIP aparece, mas sem som; ao atender, o áudio abre. Quem depende de ouvir a campainha
de entrada deve subir o helper com `AUTO_MUTE_IDLE=0`.

## Como foi testado

Helper de teste em porta separada (3099), com `MICROSIP_PATH` apontando para um exe inócuo e os
eventos `call-start`/`call-end` simulados por `curl` — sem discar de verdade. Verificado: boot
mudo → lote discando mudo → guarda reaplicando a cada 700 ms durante o toque → vencedor atende
**abre** (e a guarda para) → perdedora caindo **não** remuta → fim da conversa **muta** →
chamada recebida atendida **abre**. Também o modo `AUTO_MUTE_IDLE=0` e as duas direções do
auto-update (rebaixa: não; sobe: sim).

⏳ **Pendente:** teste em ligação real. Até 21/08 a v1.16 **nunca chegou a atender uma chamada**
— o auto-update a derrubou para 1.7 antes disso.
