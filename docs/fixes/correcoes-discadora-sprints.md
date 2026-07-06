# Blue Line / Blue Line — Correções da Discadora (plano por sprints)

> Criado em 2026-06-24. Conceito e planejamento das correções dos bugs reportados
> após o lançamento da **discagem paralela/preditiva** (helper v1.6 + front-end).
> Complementa `discagem-paralela-preditiva.md` (fonte de verdade da feature).
>
> **Status:** CONCEITO — nada implementado. Aguardando aprovação por sprint.
> Para cada item: **Causa → Por que gera o bug → Solução → Arquivos → Risco/Esforço.**

---

## Visão geral / ordem sugerida

| Sprint | Bug | Severidade | Esforço | Risco | Pré-condição |
|---|---|---|---|---|---|
| **1** | Campanhas antigas caindo/desligando | 🔴 Crítico (bloqueia produção) | Médio | Médio | **Diagnóstico guiado primeiro** |
| **2** | Caixa postal sem gatilho de derrubar | 🟠 Produtividade | Pequeno–Médio | Baixo | — |
| **3** | Botão "Editar campanha" | 🟡 UX | Mínimo | Baixo | — |
| **4** | Remover opção de 5 linhas (máx. 3) | 🟡 Regra de negócio | Mínimo | Baixo | — |

> **Quick wins:** Sprints 3 e 4 são triviais e de risco baixo — podem ser entregues
> primeiro como "limpeza rápida" enquanto o Sprint 1 passa pelo diagnóstico.
> A ordem acima é por **severidade**; a de **entrega** pode começar por 4 → 3.

Princípio que guia todos os sprints: **não recriar o que já existe.** Boa parte do
que parece "faltar" já está no código — as correções são pequenas e cirúrgicas.

---

## Sprint 1 — Campanhas antigas estão "caindo e desligando"

### Causa (o que mudou de fato)
Comparando o código atual com o anterior à feature (`git show 3e5d114~1`):

- O **caminho 1-a-1 do front-end** (`usePowerDialer.ts`) está **funcionalmente idêntico**
  ao de antes: mesmo `dialNext`, mesmo polling de `/events`, mesma transição para `ended`.
- O **`/call` do helper** também está idêntico (spawn do `microsip.exe <numero>`).

Ou seja: para uma campanha antiga (`parallel_lines = 1` → `isParallel = false`), o
fluxo de app **não mudou**. O que mudou e atinge **toda** chamada são efeitos colaterais
introduzidos pelo modo paralelo no helper v1.6 e no ambiente:

1. **Hider de janela sempre ligado** — `startMicrosipHider()` roda durante toda a vida do
   helper (loop PowerShell a cada ~250ms escondendo qualquer janela do softphone utilizado),
   inclusive durante chamadas 1-a-1. (`local-helper/index.js`, `startMicrosipHider`)
2. **`parallelSession` nunca é zerada** e, no caminho "ninguém atendeu"
   (`handleParallelEnd`), o `resolved` **não vira `true`** (só seta `endedNoAnswer`).
   Resultado: fica uma **sessão paralela fantasma**. Numa chamada 1-a-1 posterior, o
   `/event/call-start` chama `handleParallelAnswer`, que só não age por causa do
   *match por número* — proteção frágil. (`local-helper/index.js`, linhas ~200–229)
3. **softphone utilizado em multi-call (`singleMode=0`)** — exigência da feature; é um modo global
   que muda o comportamento de **todas** as chamadas, não só as paralelas.

### Por que isso gera o bug
Como o código 1-a-1 não mudou, a regressão é quase certamente **de runtime** (modo
multi-call / comportamento de janela do softphone utilizado) **ou** da **sessão paralela fantasma**
vazando para o 1-a-1 (disparando `/hangupcalling`/`speakmute` indevidamente). Não é
honesto cravar o mecanismo exato sem **reproduzir uma vez** — por isso o sprint começa
por diagnóstico, não por patch às cegas.

### Solução
**Fase A — Diagnóstico guiado (~10 min, sem alterar código):**
1. Derrubar o helper oculto e subir com console:
   `taskkill /IM node.exe /F` → `cd local-helper` → `set HELPER_NO_HIDE=1 && node index.js`
   (softphone utilizado visível + log ao vivo).
2. Rodar **uma campanha antiga** em 1-a-1 e observar:
   - O softphone utilizado estabelece áudio ou a chamada cai sozinha?
   - O log do helper mostra `/hangupcalling`/`speakmute` disparando numa chamada 1-a-1?
     (indicaria a sessão fantasma — suspeito #2)
   - Confirmar `singleMode` no `microsip.ini` e se era `0` **antes** da feature
     (se já era `0`, descarta o suspeito #3).
3. Concluir qual dos 3 suspeitos é a causa → aplicar o fix-alvo correspondente.

**Fase B — Consertos defensivos (independentes do diagnóstico, valem de qualquer forma):**
- **Encerrar/zerar a `parallelSession`** ao fim do lote (setar `resolved = true` também
  no caminho "ninguém atendeu", ou anular a sessão) para que **nunca** vaze para o 1-a-1.
- **Escopar o hider e o `speakmute` estritamente à sessão paralela ativa** — só esconder/
  mutar enquanto há lote paralelo em andamento; fora disso, não tocar no softphone utilizado. Assim
  uma campanha 1-a-1 fica imune aos efeitos do modo paralelo.

### Arquivos prováveis
- `local-helper/index.js` (`handleParallelEnd`, `handleParallelAnswer`, `startMicrosipHider`,
  `/dial-parallel`) — **bump de versão do helper** (v1.7) + republicar.
- (Possível) ajuste de configuração do `microsip.ini`, conforme diagnóstico.

### Risco / esforço
Médio. Mexe no helper (precisa republicar e os agentes atualizam pelo botão). O
diagnóstico primeiro reduz o risco de "consertar o que não era".

---

## Sprint 2 — Caixa postal: derrubar automaticamente (sem o agente perceber)

> **Restrições do usuário (firmes):** SEM botão manual de derrubar (nem 1-a-1 nem
> paralelo) e SEM auto-hangup por tempo (um timeout cego pode matar ligação produtiva).
> O alvo é classificação automática "pelas costas do agente", sobretudo no paralelo.

### Resultado da pesquisa na documentação (2026-06-24)
**O softphone utilizado NÃO emite gatilho de caixa postal — e não pode emitir.** Verificado na
[ajuda oficial](https://www.microsip.org/help). A lista COMPLETA de eventos é só de
**estado de chamada**, nenhum de detecção de secretária:

| Evento | Quando dispara |
|---|---|
| `cmdCallStart` | conexão estabelecida (atendeu — `200 OK`/CONFIRMED) |
| `cmdCallEnd` | chamada encerrou |
| `cmdCallAnswer` | quando o usuário atende uma **entrante** |
| `cmdIncomingCall` | chega chamada entrante |
| `cmdCallBusy` | ocupado (486/600/603) |

### Causa (por que o gatilho não existe)
Para a camada SIP, **a caixa postal "atende" igual a um humano**: a operadora devolve
`200 OK` e a chamada vira CONFIRMED → dispara `cmdCallStart`, idêntico a um humano.
Distinguir humano × máquina é **AMD (Answering Machine Detection)**, que exige **analisar
o áudio** da chamada (bipe / silêncio / padrão de fala). O softphone utilizado é cliente PJSIP que
**não analisa áudio nem expõe o RTP** a scripts — logo a informação **nunca chega** ao
hook. Por isso não há `cmdVoicemail`. O único automático do softphone utilizado é o `autoHangUpTime`
(timeout cego — **vetado** pelo usuário, com razão).

### Solução — o único caminho "pelas costas do agente": AMD no PABX
AMD precisa rodar **onde o áudio existe**: no **Intelbras WidevoiceX**. Descoberta-chave:
- Se o WidevoiceX fizer **AMD que DERRUBA** a chamada ao detectar máquina → isso dispara
  `cmdCallEnd`, que o helper **já escuta hoje** → a ligação cai sozinha, o lote paralelo
  segue, **zero código novo**, 100% transparente. É exatamente o objetivo.
- Se o WidevoiceX só **sinalizar** via cabeçalho SIP (ex.: `X-Detect`) sem derrubar →
  **não serve**: o softphone utilizado não repassa cabeçalhos SIP aos hooks `cmd*`.

**Ação do sprint = pergunta ao suporte Intelbras (não é código):**
> "O WidevoiceX oferece **detecção de secretária eletrônica (AMD)** em campanha de
> discagem ativa? Se sim, ela **desliga automaticamente** a chamada ao cair em caixa
> postal (em vez de só sinalizar)?"

Encaminhamento conforme a resposta:
- **Sim, derruba:** validar em 1 teste real (cai em caixa → `cmdCallEnd` → helper avança).
  Possivelmente **nada a implementar** no Blue Line.
- **Sinaliza, mas não derruba:** avaliar se dá para o PABX ser configurado para derrubar;
  via softphone utilizado puro, inalcançável.
- **Não tem AMD:** então não existe solução automática confiável com a stack atual. As
  únicas saídas seriam (a) softphone próprio Electron+PJSIP **com AMD de áudio** — caro e
  já descartado no projeto (`discadora-microsip-integracao.md` §4), ou (b) conviver com o
  custo da caixa postal. Reabrir a decisão com o usuário.

### Arquivos prováveis
- Provavelmente **nenhum** no Blue Line (a solução vive no PABX). Se o teste exigir tabular
  o `cmdCallEnd` de máquina de forma diferente, aí sim mexe em `usePowerDialer.ts`.

### Risco / esforço
Baixo de engenharia (é investigação + 1 teste). O esforço real é **externo** (suporte
Intelbras). Bloqueado até a resposta do WidevoiceX.

---

## Sprint 3 — Botão "Editar campanha"

### Causa
A tela de configuração **já existe e já edita tudo** (`/campaigns/[id]`,
`ConfigureCampaignClient.tsx`): departamento, horário, campos visíveis, agentes,
notificações, linhas paralelas e listas. O único acesso hoje é **clicar no nome** da
campanha na lista (`CampaignsListClient.tsx`, ~linha 124) — não há botão explícito, o
que faz parecer que "não dá para editar".

### Por que isso gera a percepção de bug
Affordance escondida: sem um botão "Editar", o usuário não descobre que clicar no nome
abre a configuração.

### Solução
Adicionar um botão **"Editar"** na coluna **Ações** de cada linha, ao lado do ícone de
excluir, navegando para `/campaigns/${c.id}` (a tela que já existe). Serve para **alterar
as configurações da campanha novamente** (confirmado com o usuário). **Não** recriar tela
nem adicionar renomear (fora de escopo neste sprint).

### Arquivos
- `src/app/campaigns/CampaignsListClient.tsx` (só a célula de Ações — ~10 linhas).

### Risco / esforço
Mínimo. Sem backend, sem migration.

---

## Sprint 4 — Remover a opção de 5 linhas (máximo 3)

### Causa
- A UI renderiza `[1, 2, 3, 4, 5]` (`ConfigureCampaignClient.tsx`, ~linha 181).
- O servidor faz `clamp` para **1–10** (`campaigns.ts`, `updateCampaignConfig`, ~linha 284).
- A `CHECK` do banco é `BETWEEN 1 AND 10` (`20260619_parallel_dialing.sql`).

Nada disso reflete o teto **comprovado empiricamente = 3** (ver
`discagem-paralela-preditiva.md` §4.4). 4 e 5 não têm comprovação.

### Por que isso gera o bug
Permite configurar 4–5 linhas que o ramal/PABX pode não sustentar → chamadas
`call-busy` falsas, abandono e comportamento imprevisível.

### Solução (decisão do usuário: **máx. 3**)
1. **UI:** array passa a `[1, 2, 3]` (`ConfigureCampaignClient.tsx`).
2. **Servidor:** clamp `Math.min(3, ...)` em `updateCampaignConfig` (`campaigns.ts`) —
   defesa em profundidade.
3. **(Opcional) Banco:** migration nova apertando a CHECK para `BETWEEN 1 AND 3`.
   - ⚠️ Antes: rebaixar campanhas já salvas com `parallel_lines > 3` para 3, senão a
     migration falha na constraint. `UPDATE campaigns SET parallel_lines = 3 WHERE parallel_lines > 3;`

### Arquivos
- `src/app/campaigns/[id]/ConfigureCampaignClient.tsx`
- `src/app/actions/campaigns.ts`
- (Opcional) `supabase/migrations/2026XXXX_parallel_lines_max_3.sql`

### Risco / esforço
Mínimo. O passo 3 (banco) é o único com atenção (rebaixar valores existentes antes da CHECK).

---

## Notas de implementação transversais
- **Helper:** qualquer mudança em `local-helper/index.js` exige **subir `HELPER_VERSION`**
  e republicar; os agentes atualizam pelo botão "Atualizar helper". (ver
  `helper-deploy-and-update.md`)
- **Ambiente:** PowerShell 5.1; o usuário controla o git (não commitar sem ordem).
- **Testar paralelo** com números reais distintos (placeholder vira lixo — ver
  `discagem-paralela-preditiva.md`, nota PowerShell).
