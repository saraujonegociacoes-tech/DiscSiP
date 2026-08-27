# Silêncio de toque DESLIGADO por padrão — a ligação ficava muda do começo ao fim

> 2026-08-27. Máquina nova de uma colaboradora entrou em produção com a v1.16 e a ligação
> **inteira** ficava sem som. O botão "Som" do painel abria, mas voltava a mudar sozinho.
> Feature original: [`../updates/silencio-de-toque-som-no-atendimento.md`](../updates/silencio-de-toque-som-no-atendimento.md).

---

## O sintoma

Relato do agente, em produção:

- a chamada ficava **muda** de ponta a ponta — nem o toque, nem a conversa;
- o botão **Som** do painel de áudio "destrava, porém fica mudando; acaba que não destrava";
- na mesma máquina, o **multi-chamada** (preditiva) também não funcionava.

## Por que o botão parecia não funcionar

Não era o botão. Ele faz o que promete (`POST /mute` → `speakerMuted = false`, e ainda limpa o
`autoMuted` na hora). O que acontece é que **a discagem seguinte rearma o silêncio**:
`setRingSilence(true, 'discando …')` roda antes de cada `/call` e de cada `/dial-parallel`. Num
discador, "a discagem seguinte" chega em segundos — daí a sensação de que o som "fica mudando" e
no fim não abre.

O som só volta de vez quando o **atendimento** é detectado. E é aí que estava o buraco.

## A causa provável (hipótese principal, ainda não confirmada na máquina dela)

O helper só sabe que **atenderam** pelos hooks do MicroSIP (`cmdCallStart` no `microsip.ini`,
que chama `on-call-start.bat` → `GET /event/call-start`). Sem esse evento, `handleSingleAnswer` /
`handleParallelAnswer` nunca rodam e **o desmute nunca acontece**.

Quem grava esses hooks é o [`setup-hooks.ps1`](../../../local-helper/setup-hooks.ps1) — e ele
**aborta com `exit 1`** em dois casos comuns numa instalação nova:

- MicroSIP **aberto** na hora da instalação (ele reescreve o ini ao sair);
- `microsip.ini` ainda não existe (MicroSIP nunca foi aberto).

O `instalar.bat` trata isso como **aviso** e segue adiante. Resultado: a máquina fica sem
`cmdCallStart`/`cmdCallEnd`/`cmdCallBusy` **e** sem `singleMode=0`.

**É a mesma falha explicando os dois sintomas:** sem os hooks, a ligação fica muda; sem
`singleMode=0`, a preditiva não sai do papel. Que os dois tenham aparecido juntos, na mesma
máquina nova, é o que aponta para cá.

## O que mudou no helper

`AUTO_MUTE_RING` virou **opt-in**:

```js
// antes: ligado por padrão, AUTO_MUTE_RING=0 desligava
const AUTO_MUTE_RING = process.env.AUTO_MUTE_RING !== '0'
// agora: desligado por padrão, AUTO_MUTE_RING=1 liga
const AUTO_MUTE_RING = process.env.AUTO_MUTE_RING === '1'
```

Com ele desligado, **nada muta sozinho**: `setRingSilence()` e `startRingGuard()` saem na
primeira linha, e sobra só o mute **manual** do painel de áudio — que continua funcionando nas
duas direções.

Uma segunda mudança foi necessária para o desligamento realmente **resgatar** a máquina: o mute
vale por **sessão de áudio do Windows** e sobrevive ao restart do helper. Uma máquina que ficou
muda continuaria muda mesmo depois de subir a versão nova. Então, na largada, quando o silêncio
está desligado, o helper **abre o som ativamente**:

```
[10:12:03] Som ABERTO (helper iniciado, silencio de toque desligado) — 1 sessao/oes
```

`0 sessao/oes` = o MicroSIP não tinha áudio aberto naquele instante (nada a fazer); o número é o
que diz se a operação **pegou** em alguma coisa.

## ⚠️ A versão NÃO foi bumpada (decisão do dono)

O `HELPER_VERSION` continua **1.16**. Consequência prática, para não haver surpresa:

**Nenhuma máquina que já está na 1.16 vai receber esta mudança sozinha.** O auto-update compara
versões com `isVersionNewer` e responde `reason: 'ja-atualizado'` quando o número é igual — foi
justamente a trava criada no [downgrade automático](correcao-downgrade-automatico-do-helper.md).
O botão "Atualizar helper" do Blue Desk também não vai fazer nada.

Para colocar em cada máquina agora, um dos dois:

1. copiar o `local-helper/index.js` novo por cima do que está na máquina e reiniciar o helper
   (matar o `node.exe` do `index.js` e rodar o `start-hidden.vbs`); ou
2. subir para **1.17** num próximo passo e deixar o auto-update distribuir.

## Como conferir a máquina de um agente

`http://localhost:3001/ping` responde tudo o que importa:

| Campo | O que esperar |
|---|---|
| `version` | `1.16` |
| `ringSilence` | `false` (silêncio desligado) |
| `multiCall` | `true` — se vier `false`, o `singleMode=0` não foi aplicado |
| `speakerMuted` | `false` fora de mute manual |
| `dir` | de qual pasta o helper subiu (com cópias do repo, isto importa) |

E os hooks, direto no `%APPDATA%\MicroSIP\microsip.ini` (UTF-16): tem que haver
`cmdCallStart="C:\Users\Public\bluedesk-helper\on-call-start.bat"` (e os irmãos `End`/`Busy`).
Se não tiver: **fechar o MicroSIP** e rodar

```
powershell -NoProfile -ExecutionPolicy Bypass -File local-helper\setup-hooks.ps1
```

O `helper.log` fecha o diagnóstico: com os hooks certos aparece `Evento: call-start …` a cada
atendimento. Se nunca aparece, o problema é o ini — não o mute.

## Pendências (o "outro caminho" a testar)

- **Não armar o silêncio quando os hooks não estão configurados.** É a correção de raiz: o
  helper já lê o ini (`iniValue`) para o `singleMode`; ler `cmdCallStart` no boot e recusar o
  silêncio (com aviso no log e no `/ping`) transforma um "ligação muda" silencioso num aviso.
- **`instalar.bat` falhar alto** quando o `setup-hooks.ps1` sai com erro, em vez de imprimir
  AVISO e seguir. Máquina nova não deveria conseguir terminar a instalação pela metade.
- Confirmar na máquina da colaboradora se os hooks eram mesmo o que faltava (o `/ping` e o
  `helper.log` acima respondem em um minuto).
