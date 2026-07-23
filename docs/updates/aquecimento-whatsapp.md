# Aquecimento de números WhatsApp — módulo novo (sprints)

> Criado em 2026-07-19. Planejado em conjunto com o dono (plan mode) antes de qualquer
> código — plano completo em `C:\Users\ffili\.claude\plans\ent-o-eu-estou-criando-cozy-hoare.md`
> (arquivo local do agente, fora do repo). Domínio **separado** (mesmo padrão de isolamento
> de Leads/CS: tabelas, RLS e rotas próprios, prefixo `warmup_`), desenhado para ser
> **replicável/extraível** — todo o código novo vive em namespaces próprios e não toca
> Discador/Leads/CS.

## O problema

Campanhas de disparo em WhatsApp esbarram em **bloqueios/restrições da Meta** em números
recém-ativados. A hipótese inicial do dono era que a trava vinha de "1 BM só aguenta 1
número" (daí a ideia de 6 BMs para 6 números). **Isso não é a causa raiz:** uma Business
Manager pode conter várias WABAs, cada uma com vários números — 1 BM → 6 números é
tecnicamente possível na Cloud API. O gargalo real é **Business Verification + tier de
volume + reputação (quality rating)** de cada número. A trava de "coexistence" que o dono
bateu é específica desse modo (número já ativo no app WhatsApp Business vinculado à API);
no modo Cloud API puro ela não existe.

A solução é **aquecer** os números: fazê-los trocar mensagens de forma gradual e "humana"
antes de entrarem em campanha, construindo histórico/reputação. Este módulo automatiza
isso com até **6 números da mesma BM conversando entre si**.

## Decisões travadas

1. **Blue Line é o plano de controle; o Make é o braço executor.** O app decide QUEM fala
   com QUEM, QUANDO e O QUÊ, grava o histórico e dispara o Make por webhook (reaproveitando
   o padrão de `notifications.ts`). O envio real à Graph API da Meta acontece **no Make** —
   não há chamada direta à Graph API no Next.js (mesma filosofia do Pipefy→Make dos outros
   domínios). Ver [`make-integracao-aquecimento.md`](make-integracao-aquecimento.md).
2. **Não dá para fugir 100% de template** (decisão fechada com o dono depois de explicada a
   regra). A Cloud API **exige** um template aprovado para abrir qualquer conversa sem uma
   sessão de 24h ativa (erro `131047` caso contrário) — não existe workaround via API. A
   aproximação escolhida: **1 template leve abre cada conversa** (ex.: "Oi, tudo bem?") e
   **todo o resto da troca dentro das 24h é texto livre/variado** (sessão), indistinguível
   de conversa real. Isso é exatamente o mecanismo oficial de warming da Meta, não uma
   gambiarra.
3. **A janela de 24h é derivada do próprio histórico, sem webhook de status da Meta.** A
   janela de atendimento do WhatsApp abre no número que **recebeu** uma mensagem. Como os
   dois lados da conversa são controlados pelo Blue Line, a regra
   `pode_enviar_sessão(de=X, para=Y)` ⟺ *existe mensagem Y→X nas últimas 24h em
   `warmup_messages`* é suficiente. **Nenhum callback de entrega/leitura da Meta é
   necessário para o MVP funcionar** — simplifica muito o desenho.
4. **Pacing humano, nunca disparo em massa simultâneo** — que é exatamente o padrão que a
   Meta pune. Garantido por: teto de envios por tick (`tick_max_sends`, padrão 3), gap
   aleatório por número (`min/max_gap_minutes`), rampa de volume por dias aquecendo
   (`warmup_ramp_stages`, análoga ao Tier da Meta) e variação de conteúdo (não repetir a
   mesma frase em sequência pelo mesmo remetente).
5. **Cron via GitHub Actions, não Cloudflare Cron Triggers.** O deploy é Cloudflare
   **Pages** (`wrangler.toml` → `pages_build_output_dir`), onde `scheduled()`/`[triggers]
   crons` **não existem** (são exclusivos de Workers puros). Reaproveitado o padrão já
   comprovado no repo (`.github/workflows/supabase-keepalive.yml`): Actions com
   `on.schedule.cron` batendo um endpoint HTTP protegido por segredo. O pacing real é
   decidido **dentro** do tick; o cron só garante a frequência.
6. **Módulo sensível → supervisor/manager/admin (agente não).** Erro de configuração aqui
   pode **bloquear uma conta/BM na Meta**. Por isso: RLS restrito a supervisor/manager/admin,
   item na Sidebar restrito aos mesmos papéis, e guard de página no `middleware.ts` (defesa
   em profundidade, como `/admin`). Agente não enxerga o módulo. *(Acesso do supervisor
   liberado depois do desenho inicial — antes era só manager/admin; ver migration
   `20260719b_warmup_supervisor_access.sql`.)*
7. **`dry_run = true` de fábrica.** O tick roda a mecânica inteira e grava histórico
   **simulado** (`dispatch_mode='dry_run'`) sem chamar o Make. O dono liga o modo real só
   depois de revisar dias de simulação. Zero risco de tocar Meta antes da hora.

## Modos de operação (`warmup_mode`)

O aquecimento tem **dois modos**, escolhidos no painel (seletor "Sessão (24h)" / "Gradual
(dias)"); a lógica do tick ramifica em `runWarmupTick`:

- **`sessao`** (padrão) — aquecimento **intensivo num período fixo**. O dono clica **"Iniciar
  aquecimento"** (grava `sessao_iniciada_em`); o tick só age enquanto `now < início +
  sessao_duracao_horas` (padrão 24h), depois encerra sozinho. O volume por número
  (`sessao_msgs_por_numero`) e as conversas por número (`sessao_conversas_por_numero`) são
  contados **desde o início da sessão**, não por dia. Como tudo cabe numa janela de 24h, a
  conversa abre uma vez com template e segue em sessão livre — sem reabertura.
- **`gradual`** — a **rampa multi-dia** original (`warmup_ramp_stages`): volume por dia sobe
  conforme os dias de aquecimento de cada número. Mais seguro, ~1–2 semanas.

Trade-off: `sessao` deixa o número pronto rápido mas concentra volume (mais agressivo);
`gradual` é o padrão que a Meta premia. Os dois convivem — se a qualidade cair no modo
sessão, migrar para gradual sem mudar código. Intervalo entre mensagens (`min/max_gap_minutes`)
e teto por rodada (`tick_max_sends`) valem nos **dois** modos.

## Visão geral das sprints

Planejado em plan mode e implementado numa leva só; documentado em sprints para manter o
padrão dos outros domínios e deixar claro o que falta para produção.

| Sprint | O quê | Status |
|---|---|---|
| **0** | Fundação: navegação (Sidebar), gate de rota (middleware manager/admin), flag `NEXT_PUBLIC_WARMUP_ENABLED`, placeholder "Em breve" | ✅ Entregue |
| **1** | Schema + infra: migration `warmup_*`, RLS, cliente `service_role`, tipos | ✅ Entregue — **migration aplicada** |
| **2** | Orquestração: `runWarmupTick`, endpoints `tick`/`dispatch-result`, workflow do cron, contrato do Make | ✅ Entregue |
| **3** | Painel: pool de números, config, templates/snippets, histórico, botão "rodar tick agora" | ✅ Entregue — falta ligar a flag e verificar com sessão real |
| **4** | Cenários no Make (Disparo + callback) | 🟡 Cenário de **Disparo montado** (20/jul) — falta o **token do System User** (assets ainda não atribuídos) p/ ele autenticar |
| **5** | Status Meta (webhook de qualidade/review → auto-bloqueio) | ⬜ Planejada (fase 2, opcional) |

`npx tsc --noEmit`, `npm run lint` e `npx next build` **verdes**. Nada commitado (o dono
controla o git). Migrations `20260719_warmup_schema.sql` **e** `20260719b_warmup_supervisor_access.sql`
**aplicadas** no Supabase. **Para retomar amanhã, comece pela seção
["Estado em 20/jul — o que falta"](#estado-em-20jul2026--retomar-aqui) logo abaixo.**

---

## Estado em 20/jul/2026 — retomar aqui

Ponto de retomada. **Código 100% pronto e verde** (`tsc`/`lint`/`build`); o que resta é
**configuração fora do código** (Meta + Cloudflare + GitHub + cadastro na UI).

### ✅ Já feito
- Todo o código das Sprints 0–3 (schema, RLS, `service_role`, tick, endpoints, cron,
  painel, server actions) — implementado e verde.
- Migrations **aplicadas** no Supabase: `20260719_warmup_schema.sql` (tabelas/RLS/seeds,
  `dry_run=true` de fábrica) + `20260719b_warmup_supervisor_access.sql` (libera supervisor).
- **Cenário "Aquecimento · Disparo" montado no Make** (webhook → Router template/session →
  HTTP Graph API). Ver [`make-integracao-aquecimento.md`](make-integracao-aquecimento.md).

### ⛔ Bloqueador do "go live" — próximo passo
1. **Atribuir os ativos ao System User na Meta** (Business Settings → **Usuários do sistema**
   → *Adicionar ativos* → **Contas do WhatsApp** → marcar **cada WABA** do pool → **Controle
   total**). Depois **Gerar novo token** com `whatsapp_business_messaging` +
   `whatsapp_business_management` (expiração **Nunca**) e colá-lo na **conexão HTTP do Make**
   (keychain, nunca hardcoded). **Sem isso o cenário de Disparo não autentica na Graph API.**
   Detalhe em [`make-integracao-aquecimento.md`](make-integracao-aquecimento.md), seção
   "Conexão única".

### 🔜 Depois do token, em ordem
2. **Secrets** — gerar dois valores aleatórios (`node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('base64url'))"`)
   e cadastrar: no **Cloudflare** (`WARMUP_CRON_SECRET`, `MAKE_CALLBACK_SECRET`,
   `MAKE_WEBHOOK_URL_WARMUP` = URL do webhook do Make) e no **GitHub Actions**
   (`BLUELINE_URL`, `WARMUP_CRON_SECRET` — **mesmo** valor do Cloudflare).
   *(Dois valores já foram gerados na sessão de 20/jul — cole-os do histórico ou regenere;
   não ficam salvos aqui de propósito, pois este doc é versionado no git.)*
3. **Flag** — `NEXT_PUBLIC_WARMUP_ENABLED=1` no Cloudflare **e** no `.env.local` (sem ela,
   `/aquecimento` mostra "Em breve").
4. **Confirmar o callback no Make** ligado nos **dois** ramos (sucesso e erro) →
   `POST {BLUELINE_URL}/api/aquecimento/dispatch-result`, header `X-Warmup-Callback-Secret`.
5. **Cadastrar na UI** (`/aquecimento`): pool de números (o `sender_id` = phone_number_id de
   cada número) + ≥1 template de abertura + ≥1 session_snippet. Sem ≥2 números `active` e
   esses catálogos, o tick só retorna `skipped`.
6. **Iniciar a sessão** (modo default `sessao` fica inerte até clicar "Iniciar aquecimento")
   ou trocar para `gradual`.
7. **Validar em `dry_run`** (padrão, seguro): `curl` no endpoint do tick (401 sem header,
   resumo com header), rodar "rodar uma rodada agora", revisar o histórico simulado (pacing
   espalhado, sem repetição), e testar a regra da janela de 24h.
8. **Só então virar `dry_run=false`** — sem mudança de código.

---

## Sprint 0 — Fundação de navegação e permissões (entregue)

- **Sidebar** (`src/components/Sidebar.tsx`): item **"Warmup Whatsapp"** (ícone `Flame`) em
  `OPERATION_ITEMS`, logo **abaixo do Discador**, `roles: ['supervisor','manager','admin']` —
  é ferramenta operacional/infra, não uma vertical de departamento (por isso vai em Operação,
  não num grupo de vertical).
- **Middleware** (`src/lib/supabase/middleware.ts`): guard de página — `/aquecimento` só
  para supervisor/manager/admin (redireciona os demais para `/softphone`, igual `/admin`). E o matcher
  em `src/middleware.ts` passou a **excluir `api/aquecimento/`** do gate de auth — o tick do
  cron e o callback do Make chegam **sem sessão** (autenticados por segredo próprio); sem a
  exclusão, seriam redirecionados para `/login` e nunca atingiriam o route handler.
- **Rota placeholder**: `src/app/aquecimento/page.tsx` com gate `NEXT_PUBLIC_WARMUP_ENABLED`
  (early return `<WarmupComingSoon/>` **antes** de qualquer busca no banco, mesmo padrão do
  `/cs`), reusando o `ComingSoon` genérico.

---

## Sprint 1 — Schema + infra (código pronto, falta aplicar)

### Migration `supabase/migrations/20260719_warmup_schema.sql`

Tabelas (prefixo `warmup_`, em inglês, reforçando que é extraível):

- **`warmup_numbers`** — pool (até 6). `sender_id` (phone_number_id da Meta, usado no path
  da Graph API), `phone_number` (E.164, usado como `to`), `waba_id`, `status`
  (`active`/`paused`/`blocked`/`cooling`), `participating`, `added_at` (conta "dias
  aquecendo"), `quality_rating` (`GREEN`/`YELLOW`/`RED`, observado).
- **`warmup_settings`** — config em key/value (fácil de estender sem migration): `qntd_numbers`,
  `max_numbers_cap` (=6, teto duro), `dry_run`, `tick_max_sends`, `min_gap_minutes`,
  `max_gap_minutes`, e as do **modo de operação** (`warmup_mode`, `sessao_duracao_horas`,
  `sessao_msgs_por_numero`, `sessao_conversas_por_numero`, `sessao_iniciada_em`). As chaves
  do modo têm **valor padrão no código** (`getWarmupSettings`/`readSettings`), então
  funcionam mesmo sem seed — a primeira gravação as cria (upsert). Ver "Modos de operação".
- **`warmup_ramp_stages`** — rampa de volume por dias aquecendo (`daily_message_cap`,
  `new_conversations_per_day_cap`). Seed: 0–2d→6/dia, 3–6d→14, 7–13d→24, 14+→40.
- **`warmup_templates`** — catálogo **único** discriminado por `kind`: `template` (abertura
  aprovada na Meta — exige `meta_template_name`/`_language`) ou `session_snippet` (frase
  livre de sessão). Uma tabela só evita duplicar estrutura idêntica.
- **`warmup_conversations`** — thread por par **normalizado** (`number_a_id < number_b_id`),
  `opener_number_id`, `last_sender_id` (controla o turno), `last_message_at`, `status`
  (`active`/`idle`/`closed`). Índice **único parcial** `WHERE status='active'`: no máximo
  uma thread ativa por par ao mesmo tempo, mas o par pode ter várias threads históricas
  (cada reabertura após 24h de silêncio é uma thread nova, aberta com template).
- **`warmup_messages`** — histórico e **fonte de verdade da janela de 24h**. `message_type`
  (`template`/`session`), `template_id`, `content`, `dispatch_mode` (`live`/`dry_run`),
  `make_dispatch_ok`/`graph_message_id`/`error_detail` (preenchidos pelo callback do Make).

### RLS (padrão de `20260715_cs_pipeline_schema.sql`)

- Helper `warmup_current_role()` (namespace próprio, módulo extraível).
- **Config** (`warmup_numbers`, `warmup_settings`, `warmup_templates`): CRUD completo para
  supervisor/manager/admin via Server Action (sessão do usuário).
- **Execução** (`warmup_conversations`, `warmup_messages`): **somente leitura** para
  supervisor/manager/admin. A escrita é exclusiva do tick/callback via `service_role`
  (bypassa RLS) — não há policy de escrita para `authenticated`, de propósito (mesma
  filosofia "o front só lê" do CS). `warmup_ramp_stages`: leitura para os mesmos papéis,
  escrita por migração. *(Supervisor incluído via `20260719b_warmup_supervisor_access.sql`.)*

### Infra de app

- **`src/lib/supabase/service.ts`** — cliente `service_role` (peça nova; até então só
  existia em scripts CLI). Ignora RLS; uso **restrito** ao tick e ao callback, que rodam
  sem sessão de usuário. Reaproveita o `SUPABASE_SERVICE_ROLE_KEY` já existente.
- **`src/lib/types/database.ts`** — tipos `WarmupNumber`, `WarmupSettings`, `WarmupRampStage`,
  `WarmupTemplate`, `WarmupConversation`, `WarmupMessage`, `WarmupNumberStats` + unions.

---

## Sprint 2 — Orquestração e endpoints (entregue)

### Lógica central `src/lib/warmup/tick.ts` (`runWarmupTick`)

**Não** é módulo `'use server'` de propósito — recebe o client `service_role` como
argumento (server actions não aceitam args não-serializáveis), então é chamável tanto pelo
endpoint do cron quanto pela server action do botão manual. A cada tick:

1. Lê `warmup_settings`; seleciona até `qntd_numbers` números `active`+`participating` (nunca
   acima de `max_numbers_cap`). < 2 → encerra.
2. Por número: `dias_aquecendo` → `stage` da rampa → `sent_today` vs `daily_message_cap`
   (headroom) → `next_eligible_at` = último envio **daquele número** + gap aleatório
   (`random(min,max)`). Elegível = headroom **e** gap ok.
3. **Prioridade 1 — continuar conversas ativas**: é a vez de quem **não** mandou a última
   (alterna via `last_sender_id`). Sempre `session` (janela garantidamente aberta).
   Conversa parada > 24h vira `idle` (reaberta depois com template). Snippet escolhido
   **excluindo** os usados recentemente pelo mesmo remetente (anti-repetição).
4. **Prioridade 2 — abrir novas conversas** (só com sobra de `tick_max_sends`): pares
   elegíveis sem thread **ativa** entre si e sob o `new_conversations_per_day_cap`; `template`
   sorteado; cria `warmup_conversations`.
5. **Executa a fila** (até `tick_max_sends`): grava `warmup_messages`, atualiza a conversa,
   monta o payload e chama `sendWarmupNotification`. Em `dry_run`, nada é enviado.
6. **Housekeeping**: conversas ativas paradas > 24h → `idle`. Retorna resumo (`sent`,
   `opened`, `continued`, `skipped[]`).

### Contrato do Make — `src/app/actions/warmup-notifications.ts`

Réplica do padrão de `notifications.ts`: `fetch` best-effort para `MAKE_WEBHOOK_URL_WARMUP`
(variável **própria**, para não misturar com o webhook de disposição do discador), no-op em
`dry_run` ou sem URL. Payload (`WarmupMessagePayload`): `message_log_id` (idempotency key),
`message_type`, `sender.{sender_id,waba_id,phone_number}`, `receiver.receiver_number`,
`template.{name,language}` **ou** `session_text`, `dry_run`. O resultado real de entrega
volta pelo callback (Sprint 4).

### Endpoints (`src/app/api/aquecimento/`)

- **`tick/route.ts`** (`POST`) — protegido por header `X-Warmup-Cron-Secret` vs
  `WARMUP_CRON_SECRET` (comparação de tempo quase constante; 401 sem match, sem tocar o
  banco). Roda `runWarmupTick(service_role)` e devolve o resumo JSON.
- **`dispatch-result/route.ts`** (`POST`) — callback do Make, protegido por
  `X-Warmup-Callback-Secret` vs `MAKE_CALLBACK_SECRET`. Atualiza `warmup_messages`
  (`make_dispatch_ok`, `graph_message_id`, `error_detail`); se a Meta reportar código de
  número indisponível (`131026`/`131031`/`368`), marca o remetente como `blocked` (sai do
  pool ativo).

### Cron — `.github/workflows/aquecimento-tick.yml`

`on.schedule.cron: '*/10 * * * *'` + `workflow_dispatch` (gatilho manual, como o
keep-alive). `curl POST` no `/api/aquecimento/tick` com o header secreto; loga o resumo e
falha o job em status ≠ 200. Secrets no GitHub: `BLUELINE_URL`, `WARMUP_CRON_SECRET`.

---

## Sprint 3 — Painel (entregue, falta flag + sessão real)

`src/app/aquecimento/` — mesmo padrão de `page.tsx` server → `*Client.tsx` do `/campaigns`:

- **`page.tsx`** — gate da flag; com ela ligada, busca em paralelo números, settings,
  templates, stats e 1ª página do histórico.
- **`WarmupDashboardClient.tsx`** — barra de controle: toggle **Simulador do Warmup / Warmup
  Ativado**, **seletor de modo Sessão (24h) / Gradual (dias)**, grid de parâmetros (números,
  intervalo mín.–máx., máx. por rodada e — no modo sessão — duração, mensagens/número,
  conversas/número), controle **Iniciar/Encerrar sessão**, e botão **"rodar uma rodada agora
  (teste)"** com resumo — + abas Números / Mensagens / Histórico.
- **`NumbersConfigSection.tsx`** — CRUD do pool (sender_id + phone_number + apelido), toggle
  `participating`, badges de status/qualidade, contadores por número (dias, hoje/cap, total).
- **`TemplatesSection.tsx`** — CRUD de templates de abertura e frases de sessão (valida que
  template exige nome aprovado na Meta), toggle `active`.
- **`HistoryTable.tsx`** — histórico paginado ("carregar mais"), badges **Simulado/Real** e
  **Confirmado/Falhou/Pendente** (entrega), com o detalhe do erro no title.

### Server actions — `src/app/actions/warmup.ts`

`getWarmupNumbers`, `upsertWarmupNumber`, `deleteWarmupNumber`, `getWarmupSettings`,
`updateWarmupSettings` (clampa `qntd_numbers` ao teto), `getWarmupTemplates`,
`upsertWarmupTemplate`, `deleteWarmupTemplate`, `getWarmupHistory(page)`, `getWarmupStats`
(dias aquecendo, volume live vs dry-run, hoje/cap por número) e **`runWarmupTickManually`**
(confere manager/admin, cria client `service_role` e roda o mesmo `runWarmupTick` do cron).

---

## Sprint 4 — Cenários no Make (Disparo montado; falta o token do System User)

**Estado (20/jul):** o cenário **"Aquecimento · Disparo" já está montado no Make** (webhook →
Router template/session → HTTP Graph API → callback). O que falta para ele **funcionar** é o
**token do System User** — os ativos (WABAs) ainda não foram atribuídos ao System User na
Meta, então não há token válido na conexão HTTP. Ver o bloqueador na seção
["Estado em 20/jul"](#estado-em-20jul2026--retomar-aqui) e o passo-a-passo em
[`make-integracao-aquecimento.md`](make-integracao-aquecimento.md).

Ver [`make-integracao-aquecimento.md`](make-integracao-aquecimento.md). Decisões fixadas:
**módulo HTTP genérico** (não o app nativo, que amarra a conexão a um phone_number_id fixo —
e o `sender_id` muda a cada chamada) e **1 System User da BM** com permissão em todas as
WABAs (1 token, 1 conexão reutilizável).

## Sprint 5 — Status Meta (planejada, fase 2)

Cenário separado no Make recebendo os webhooks de conta da Meta
(`phone_number_quality_update`, `message_template_status_update`, `account_review_update`) e
chamando um novo endpoint Blue Line para atualizar `warmup_numbers.quality_rating`/`status`
e desativar templates reprovados **automaticamente** — elimina a checagem manual no Meta
Business Suite. Depende de configurar os webhooks no App da Meta (passo fora do código).
Só depois do cenário de Disparo validado em produção com números reais.

---

## Checklist de verificação

### Feito
- [x] `npx tsc --noEmit` / `npm run lint` / `npx next build` sem erros novos.
- [x] Build gera as rotas `/aquecimento`, `/api/aquecimento/tick`,
      `/api/aquecimento/dispatch-result`.

### Falta (dono) — ordem de retomada
- [x] Aplicar `20260719_warmup_schema.sql` **e** `20260719b_warmup_supervisor_access.sql` no
      Supabase (feito). As chaves novas do modo de operação **não exigem migration** — nascem
      com padrão no código e são gravadas no primeiro uso (upsert em `warmup_settings`).
- [x] Montar o cenário **"Aquecimento · Disparo"** no Make (feito, 20/jul).
- [ ] **⛔ Bloqueador:** atribuir os **ativos (WABAs) ao System User** na Meta e gerar o
      **token** (`whatsapp_business_messaging` + `whatsapp_business_management`); colar na
      conexão HTTP do Make. Sem isso o cenário montado não autentica.
- [ ] Definir os secrets: no **Cloudflare** (`WARMUP_CRON_SECRET`, `MAKE_CALLBACK_SECRET`,
      `MAKE_WEBHOOK_URL_WARMUP`) e no **GitHub Actions** (`BLUELINE_URL`, `WARMUP_CRON_SECRET`
      — mesmo valor). Gerar com `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- [ ] Confirmar o módulo de **callback** no Make ligado nos dois ramos (sucesso e erro) →
      `/api/aquecimento/dispatch-result` com `X-Warmup-Callback-Secret`.
- [ ] Testar o endpoint isolado: `curl -X POST -H "X-Warmup-Cron-Secret: ..." .../api/aquecimento/tick`
      — 401 sem header, resumo JSON com header correto (encerra cedo com 0–1 números).
- [ ] Ligar `NEXT_PUBLIC_WARMUP_ENABLED=1`, cadastrar os números + templates/snippets, iniciar
      a sessão e rodar **em dry-run** revisando o histórico simulado (pacing espalhado, sem
      repetição, rampa respeitada) — botão "rodar tick agora" gera execuções sem esperar o cron.
- [ ] Validar a regra da janela de 24h: inserir manualmente uma linha B→A em `warmup_messages`
      e confirmar que o tick classifica A→B como `session` habilitado; apagar e confirmar que
      volta a exigir `template` (peça mais sutil do desenho).
- [ ] Só então virar `dry_run=false` e configurar o `MAKE_WEBHOOK_URL_WARMUP` real — sem
      nenhuma mudança de código nesse ponto.

## Referências

- [`make-integracao-aquecimento.md`](make-integracao-aquecimento.md) — cenários do Make.
- [`aquecimento-whatsapp-indice.md`](aquecimento-whatsapp-indice.md) — índice do módulo.
- [`painel-sucesso-cliente-cs.md`](painel-sucesso-cliente-cs.md) — padrão de domínio isolado
  em sprints usado como modelo.
