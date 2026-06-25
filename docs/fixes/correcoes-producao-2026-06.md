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
conf ports de chamadas conectadas (fonte do MicroSIP, `lib/MSIP.cpp`) — **não** cala o ringback
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
  Microfone + Som**, **só visível ao entrar numa campanha**; gate **helper ≥ 1.7** (Desligar
  funciona em 1.6); estado em `softphoneStore` (`micMuted`/`speakerMuted`); o botão só vira
  após o `ok` do helper. O "Encerrar" saiu do banner e vive no painel.
- **Verificado:** o C# do Core Audio compila e, num teste real, achou a sessão do MicroSIP e
  aplicou o mute (`HIT:1`).

### Rollout do helper (importante)
Não há push: cada helper vira 1.7 **quando o agente clica em "Atualizar v1.7"** (botão aparece
ao publicar o site) **ou quando a máquina/helper reinicia**. Logo, por um tempo há helpers 1.6
e 1.7 convivendo — o site é compatível com ambos (gate de versão; mute desabilitado em 1.6).

## #3 — Agentes online/offline (= está discando) ⏳ PENDENTE
Hoje a lista de agentes mostra o resultado da última ligação; "verde" = `callsToday>0` (não é
presença). Pedido: **online = está discando**. Precisa de **presença em tempo real**:
- Migration nova `agent_presence` (ou colunas em `profiles`): `last_seen_at`, status.
- Heartbeat do softphone (~20s) reportando `dialerStatus`.
- `getAgentActivity` deriva online de `last_seen_at < ~60s` + `running`; `AgentList` troca o
  texto de resultado por Online/Offline (Discando/Pausado/Ocioso).
Único item do lote que exige migration. **Não iniciado.**

---

## Aparte (fora do lote, anotado)
- `campaigns.notify_dispositions` está como **`text`** no banco, mas o código trata como array
  (`.includes`) → pode bagunçar as notificações do Make. Avaliar correção.
- 1ª leva de bugs (botão Editar campanha, limitar `parallel_lines` a 3, etc.):
  `correcoes-discadora-sprints.md`.
