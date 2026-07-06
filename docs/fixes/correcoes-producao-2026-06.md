# Fix — Lote de produção (jun/2026)

> Criado em 2026-06-25. Correções feitas com a operação **já em produção** (26 agentes
> discando). Ordem por urgência × risco. Status por item abaixo.
> Bug aberto de caixa postal: `../reference/perguntas-intelbras-widevoice.md` (depende do
> suporte Intelbras). Discagem em background: `../updates/discagem-em-background-dialer-engine.md`.

---

## #2 — Fuso horário no dashboard ✅
**Sintoma:** horário errado no dashboard (ex.: 15h aparecia como 17/18h).
**Causa:** as server actions calculavam hora/"hoje" com `getHours()`/`setHours()` no fuso
do runtime — em produção o Cloudflare Workers roda em **UTC**, então a hora saía deslocada.
**Fix:** helpers `hourInBRT` + `brtTodayStartUtcISO` em [`src/lib/timezone.ts`](../../src/lib/timezone.ts)
(fuso `America/Sao_Paulo`, UTC−3 fixo), aplicados em [`src/app/actions/supervisor.ts`](../../src/app/actions/supervisor.ts)
(`getDashboardStats`, `getCallsByHour`, `getAgentActivity`). O `CallHistory` não mudou
(formata no navegador, já no fuso certo). **Sem migration.**

## #1 — Histórico mostra a tabulação ✅
**Sintoma:** o histórico só mostrava o status grosso (Atendida/Não atendida), não a
disposição tabulada ("Interessado", "Sem Interesse"…).
**Causa:** `saveCallLog` não gravava `disposition` (a coluna **já existe** em `call_logs`).
**Fix:** [`dialer.ts`](../../src/app/actions/dialer.ts) grava `disposition`;
[`usePowerDialer.ts`](../../src/hooks/usePowerDialer.ts) `submitDisposition` passa o valor;
[`CallHistory.tsx`](../../src/app/softphone/CallHistory.tsx) exibe o rótulo via `DISPOSITIONS`
(fallback ao status em logs antigos). **Sem migration** (coluna confirmada no schema). Vale só
para logs novos.

## #5 — Dashboard do agente (cada um vê o seu) ✅
**Pedido:** cada agente vê o próprio desempenho (o dashboard gerencial é só de gestão).
**Fix:** aba **"Meu desempenho"** no `/softphone` ([`AgentPerformance.tsx`](../../src/app/softphone/AgentPerformance.tsx)),
alimentada por [`performance.ts`](../../src/app/actions/performance.ts) → `getMyPerformance()`
**escopado pela sessão** (`auth.getUser()`, nunca por id do cliente). Reusa `MetricCard` +
`CallsChart`. Helpers de fuso extraídos para `src/lib/timezone.ts` (compartilhados com o
supervisor — sem duplicação). O dashboard gerencial não mudou.

## #4 — Painel de mute/desmute (mic + alto-falante) ✅
**Pedido:** painel assertivo de mute do agente. **Achado:** `msip:speakmute` só zera o RX dos
conf ports de chamadas conectadas (fonte do softphone utilizado, `lib/MSIP.cpp`) — **não** cala o ringback
do "discando N" nem chamadas que conectam depois; por isso "não funcionava".
**Fix:**
- **Microfone:** `msip:micmute/micunmute` (zera a porta de entrada global — funciona).
- **Alto-falante:** mutado no **nível do Windows** (Core Audio `ISimpleAudioVolume`, mute da
  sessão do `microsip.exe` em **todos** os endpoints de saída ativos — cobre headset), via
  PowerShell + `Add-Type` no helper.
- Helper **1.6 → 1.7**: endpoint `POST /mute {device:'mic'|'speaker', muted}` (speaker
  awaitado; reaplica o mute a cada discagem em `/call` e `/dial-parallel`, pois sessão nova
  nasce com a chamada). Arquivo: [`local-helper/index.js`](../../local-helper/index.js).
- Front: [`CallControls.tsx`](../../src/app/softphone/CallControls.tsx) — painel com **Desligar +
  Microfone + Som**, **só visível com a discagem iniciada** (`dialerStatus` rodando/pausado, não
  na seleção da campanha); gate **helper ≥ 1.7** (Desligar funciona em 1.6); estado em
  `softphoneStore` (`micMuted`/`speakerMuted`); o botão só vira após o `ok` do helper. O
  "Encerrar" saiu do banner e vive no painel.
- **Verificado:** o C# do Core Audio compila e, num teste real, achou a sessão do softphone utilizado e
  aplicou o mute (`HIT:1`).

### Rollout do helper (importante)
Não há push: cada helper vira 1.7 **quando o agente clica em "Atualizar v1.7"** (botão aparece
ao publicar o site) **ou quando a máquina/helper reinicia**. Logo, por um tempo há helpers 1.6
e 1.7 convivendo — o site é compatível com ambos (gate de versão; mute desabilitado em 1.6).

## #3 — Agentes online/offline (= está discando) ✅
**Antes:** a lista mostrava o resultado da última ligação e "verde" = `callsToday>0` (ligou hoje,
não presença). **Pedido:** online = está discando.
**Fix — presença em tempo real por heartbeat:**
- **Migration** [`20260625_agent_presence.sql`](../../supabase/migrations/20260625_agent_presence.sql):
  tabela `agent_presence(agent_id PK, dialer_status, campaign_id, last_seen_at)` + RLS (leitura =
  visibilidade de `profiles`; escrita só `agent_id = auth.uid()`). **Tabela separada** (não colunas
  em `profiles`) porque a RLS de profiles só deixa admin dar UPDATE.
- **Heartbeat:** action [`presence.ts`](../../src/app/actions/presence.ts) `reportPresence` (upsert,
  agente da sessão), disparada pelo [`SoftphoneClient`](../../src/app/softphone/SoftphoneClient.tsx)
  a cada **~20s** (estado lido por ref p/ não recriar o intervalo).
- **Leitura:** [`getAgentActivity`](../../src/app/actions/supervisor.ts) junta `agent_presence` e
  deriva `online` (visto < **60s**) + `dialerStatus`.
- **UI:** [`AgentList`](../../src/app/dashboard/AgentList.tsx) mostra bolinha+rótulo por presença
  (Discando/Pausado/Ocioso/Offline); [`DashboardClient`](../../src/app/dashboard/DashboardClient.tsx)
  faz poll só de `getAgentActivity()` a cada **15s** (1 query, não recarrega o dashboard todo).
- Único item do lote que exige migration. **Falta:** rodar a SQL no Supabase + teste e2e (ver
  agente discando virar "Discando" no painel da gestão).

---

## Aparte (fora do lote, anotado)
- `campaigns.notify_dispositions` está como **`text`** no banco, mas o código trata como array
  (`.includes`) → pode bagunçar as notificações do Make. Avaliar correção.
- 1ª leva de bugs (botão Editar campanha, limitar `parallel_lines` a 3, etc.):
  `correcoes-discadora-sprints.md`.
