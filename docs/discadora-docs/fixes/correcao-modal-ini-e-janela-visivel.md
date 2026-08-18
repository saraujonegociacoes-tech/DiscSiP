# Correção — modal "Failed to open file for writing microsip.ini" + janela visível (helper v1.15)

> 2026-08-14. Duas correções no `local-helper`, ambas reportadas como acontecendo em **todas as
> máquinas**: o modal de erro do `microsip.ini` e o helper "não ficar escondido".
> Mapa do helper: [`../reference/helper-anatomia.md`](../reference/helper-anatomia.md).

---

## Bug 1 — o modal do `.ini` (causa raiz)

### Sintoma
```
microsip
Failed to open file for writing
C:\Users\<agente>\AppData\Roaming\MicroSIP\microsip.ini
```
Em todos os agentes, com frequência.

### Causa
O próprio código **já documentava** o mecanismo, no comentário do `queueMsip`:

> Toda vez que falamos com o MicroSIP nasce um `microsip.exe` novo, que entrega a mensagem via
> `WM_COPYDATA` e sai. Ao subir e sair, esse processo **toca no `microsip.ini`** (histórico de
> discados), e a instância principal também escreve lá. Dois processos escrevendo junto = modal
> *"Failed to open file for writing"*, que ainda **CONGELA a fila de comandos do MicroSIP**.

A proteção contra isso é a **fila única** (`queueMsip`, gap de 300ms), criada na v1.12.

**O furo:** o `POST /call` **não passava pela fila**. Ele fazia `spawn(MICROSIP, [dial])` direto.

```js
// ANTES (v1.14) — fora da fila
const child = spawn(MICROSIP, [dial], { detached: true, stdio: 'ignore' })
```

Ou seja: a proteção existia, mas **o caminho mais usado do helper ficava de fora** — o `/call`
atende a **discagem 1-a-1** e a **discagem manual**. Só o `/dial-parallel` (modo preditivo)
usava a fila.

Isso explica o alcance do problema: os agentes que mais sofriam eram os de campanha 1-a-1 e
discagem manual, que é a maioria da operação. Bastava discar enquanto a instância principal
gravava o histórico no ini para os dois colidirem.

Havia um segundo ponto fora da fila: o `enableMultiCall` **reabria** o MicroSIP com `spawn`
direto logo após gravar o ini — outra janela de colisão, no pior momento possível.

### Correção (v1.15)
Os dois passam pela fila:

```js
// DEPOIS — /call
if (MICROSIP) {
  queueMsip([dial])
  ...
}

// DEPOIS — enableMultiCall, ao reabrir
if (running && MICROSIP) queueMsip([])
```

**Verificação:** `grep "spawn(MICROSIP"` deve devolver **uma única ocorrência** — a de dentro do
`queueMsip`. Qualquer outra é uma regressão deste bug.

---

## Bug 2 — "o helper não fica escondido"

O `start-hidden.vbs` estava **correto e sempre esteve**. O que aparecia eram outras duas coisas:

### 2a. A janela do MicroSIP
O hider (`startMicrosipHider`) foi **ligado por padrão** até a v1.8, virou **opt-in na v1.9**
(`HELPER_HIDE=1`) porque, durante a configuração do softphone, esconder a janela impedia o
próprio administrador de abrir o MicroSIP. Essa fase acabou e o efeito colateral ficou: a janela
aparecendo na frente do agente durante a operação — o MicroSIP **reexibe a janela a cada evento**
em modo multi-call.

**Correção:** volta a ser **opt-out**. Esconde por padrão; `HELPER_NO_HIDE=1` mostra.

### 2b. Piscadas de `cmd.exe`
Dois `exec()` rodavam sem `windowsHide`, e `exec` no Windows passa por `cmd.exe /c` **com
console visível**:

- `isMicrosipRunning()` (`tasklist`) — chamado **em loop a cada 400ms** dentro do
  `enableMultiCall`, ou seja, várias piscadas seguidas de janela preta
- o fallback do protocolo `tel:`

**Correção:** `{ windowsHide: true }` nos dois, e também no `spawn` do `queueMsip`.

---

## O que foi verificado

| Verificação | Resultado |
|---|---|
| `node --check local-helper/index.js` | ✅ sintaxe OK |
| `grep "spawn(MICROSIP"` | ✅ 1 ocorrência, dentro do `queueMsip` |
| `grep "exec("` | ✅ 2 ocorrências, ambas com `windowsHide` |
| Helper v1.15 sobe e responde | ✅ testado em porta isolada (3099), com `HELPER_NO_UPDATE`/`NO_INI_FIX`/`NO_HIDE` |
| `/ping`, `/events`, `/parallel-status` | ✅ respondem |
| Helper de produção da máquina | ✅ intacto (v1.14, pid 1140, rodando de outra pasta) |
| `npm run sync:helper` | ✅ v1.15 publicada em `public/helper/` |

### ⏳ O que só o dono consegue testar

O teste isolado prova que o helper **sobe e responde** — não prova que o modal sumiu, porque
isso exige **discar de verdade**, repetidamente, com o MicroSIP gravando o ini. O roteiro:

1. Atualizar o helper (botão **"Atualizar helper"** no Blue Desk) e conferir `version: 1.15` no
   `/ping`.
2. **Discagem manual** — várias ligações seguidas, sem pausa. Era o caminho campeão do modal.
3. **Power dialer 1-a-1** — uma campanha inteira.
4. **Campanha preditiva** (3 linhas) — confirmar que não regrediu.
5. Confirmar que a **janela do MicroSIP não aparece** mais durante a operação.
6. Confirmar que **não há piscada de janela preta** ao usar "Preparar MicroSIP".

Se o modal reaparecer, rodar com `HELPER_DEBUG_MSIP=1` e olhar o intervalo entre lançamentos no
`helper.log` — se aparecer algo abaixo de 300ms, sobrou caminho fora da fila.

---

## Rollout

O helper **não** se atualiza sozinho por push: cada máquina vira a v1.15 quando o agente clica
em **"Atualizar helper"** ou quando a máquina reinicia (`maybeAutoUpdate` no boot). Durante o
rollout, v1.14 e v1.15 convivem — o app já trata isso.

> ⚠️ A v1.15 só chega aos agentes **depois do deploy**, porque o helper baixa de
> `https://discsip.pages.dev/helper/index.js`. O `sync:helper` já rodou (o arquivo está em
> `public/helper/`), mas ele precisa ir para produção no push.
