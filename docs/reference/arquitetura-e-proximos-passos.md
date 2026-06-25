# DiscSiP — Documentação Técnica

> Atualizado em: 2026-06-11 (Sprint 7 concluído — Autenticação e Permissões RBAC, 7a→7e)

---

## 1. Visão Geral

**DiscSiP** é um Power Dialer semi-automático para a equipe de vendas da Araujo Negociações. O sistema gerencia filas de contatos, seleciona o próximo automaticamente e aciona o MicroSIP instalado na máquina do agente via protocolo `tel:`.

- **26 agentes** usando ramais 5125–5150
- **PABX:** Intelbras WidevoiceX (`widevoice8.intelbras.com.br`)
- **App:** `https://discsip.pages.dev`
- **Repositório:** https://github.com/saraujonegociacoes-tech/DiscSiP

---

## 2. Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend + Backend | Next.js 15.5 (App Router, Server Actions) |
| Deploy | Cloudflare Pages (Advanced Mode com `_worker.js`) |
| Adapter Cloudflare | `@opennextjs/cloudflare` v1.19.11 |
| Banco de dados | Supabase (PostgreSQL, Free tier) |
| Estado global | Zustand 5 |
| Estilo | TailwindCSS 4 |
| Discagem | MicroSIP + helper local Node.js |

---

## 3. Arquitetura de Discagem

### Por que não SIP.js no browser

O servidor Intelbras usa WebSocket sem TLS (`ws://`). Browsers bloqueiam conexões `ws://` a partir de páginas HTTPS por política de mixed content. Tentativa de TLS handshake confirmou que o servidor não suporta WSS na porta 7048.

### Solução adotada — Helper local + MicroSIP

Os agentes já usavam o MicroSIP como softphone para chamadas manuais. O MicroSIP é um app nativo Windows que conecta ao PABX sem restrições de TLS.

A solução é acionar o MicroSIP programaticamente via protocolo `tel:` do Windows, que qualquer browser consegue disparar quando há um app configurado como handler padrão.

### Fluxo completo

```
1. Agente entra no DiscSiP com seu ramal
2. Seleciona campanha → clica "Iniciar discagem"
3. App busca próximo contato pendente (Supabase)
4. App chama http://localhost:3001/call (helper local)
5. Helper executa: start "" "tel:NUMERO"
6. Windows abre MicroSIP → MicroSIP disca
7. Agente fala com o contato
8. Agente clica "Encerrar" no banner do DiscSiP
9. App exibe form de disposição
10. Agente registra resultado → próximo contato carrega
```

### Arquitetura de rede

```
Browser (agente)
  ↓ HTTPS
Cloudflare Pages (Next.js)   ← Server Actions, Supabase queries
  
Browser (agente)
  ↓ fetch localhost
Helper Node.js (porta 3001)  ← roda na máquina do agente
  ↓ protocolo tel:
MicroSIP                     ← softphone já configurado no PABX
  ↓ SIP
PABX Intelbras WidevoiceX
```

---

## 4. Helper Local

Arquivo: `local-helper/`

App Express mínimo (~40 linhas) rodando em `http://localhost:3001`.

**Endpoints:**
- `GET /ping` — health check (usado pelo DiscSiP para mostrar status "Helper online/offline")
- `POST /call` — recebe `{ number }`, executa `start "" "tel:NUMBER"`, aciona MicroSIP

**Instalação nos PCs dos agentes:**
1. Node.js instalado na máquina
2. Executar `local-helper/instalar.bat` como administrador
3. Cria atalho no startup do Windows — helper sobe automaticamente

---

## 5. Deploy Cloudflare Pages

### Script de build (`package.json`)

```
"build:cf": "opennextjs-cloudflare build && node -e \"...\""
```

O script pós-build faz 3 coisas manualmente:
1. Renomeia `worker.js` → `_worker.js` (Pages exige underscore)
2. Copia `assets/*` para a raiz do output (para o binding ASSETS funcionar)
3. Muda `__ASSETS_RUN_WORKER_FIRST__: false` → `true` em `cloudflare/init.js`

### Configuração no dashboard Cloudflare Pages

- **Build command:** `npm run build:cf`
- **Build output:** `.open-next`
- **Node.js:** 22
- **Branch:** `main`

### Variáveis de ambiente (Secrets)

| Nome | Tipo |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Secret |
| `MAKE_WEBHOOK_URL` | Secret (opcional; notificação pós-chamada via Make) |

---

## 6. Banco de Dados — Schema (Supabase)

### Tabelas

- `agents` — agentes (ramais 5125–5150, nome, role)
- `campaigns` — campanhas de discagem. Campos de config: `schedule_start`, `schedule_end` (horário de funcionamento), `visible_fields` (jsonb, campos visíveis ao agente)
- `campaign_agents` — N:N campanha ↔ agente (quem participa de cada campanha)
- `lists` — mailing carregado dentro de uma campanha. `column_mapping` (jsonb), regras de reciclagem (`recycle_enabled`, `recycle_statuses`, `recycle_after_hours`, `recycle_max_attempts`)
- `campaign_contacts` — contatos de cada campanha. Inclui `list_id`, `extra_data` (jsonb, campos extras do mailing), `attempts` (tentativas para reciclagem)
- `call_logs` — registro histórico de chamadas por agente

Migração: `supabase/migrations/20260610_lists_and_campaigns.sql`.

### Status de contato (`ContactStatus`)

```
pending → dialing → answered | no_answer | busy | failed | do_not_call
                  ↘ (reciclagem) pending → ... → exhausted (esgotou tentativas)
```

---

## 7. Status dos Sprints

| Sprint | Descrição | Status |
|--------|-----------|--------|
| Sprint 0 | Setup, Supabase, estrutura base | ✅ Concluído |
| Sprint 1 | SIP Core (hook `useSipAgent`) | ✅ Concluído → removido |
| Sprint 2 | Softphone UI | ✅ Concluído → removido |
| Sprint 3 | Power Dialer Backend | ✅ Concluído |
| Sprint 4 | Power Dialer UI + Helper local MicroSIP | ✅ Concluído |
| Sprint 5 | Supervisor Dashboard | ✅ Concluído |
| Sprint 6 | Estados de erro, polish, Listas, Campanhas, Notificações | ✅ Concluído (6.1–6.4) |
| Sprint 7 | Autenticação e Permissões (RBAC) | ✅ Concluído (7a–7e) |

---

## ✅ SPRINT 5 — Supervisor Dashboard (Concluído)

### O que foi entregue

- `src/components/Sidebar.tsx` — link "Dialer" (`/softphone`) e "Dashboard" (`/dashboard`)
- `src/app/actions/supervisor.ts` — Server Actions: `getDashboardStats`, `getCampaignsSummary`, `getCallsByHour`, `getAgentActivity`
- `src/app/dashboard/page.tsx` — Server Component, busca dados em paralelo com `Promise.all`
- `src/app/dashboard/DashboardClient.tsx` — layout com Sidebar, métricas, gráfico, tabela de campanhas
- `src/app/dashboard/MetricCard.tsx` — card reutilizável de métrica
- `src/app/dashboard/CallsChart.tsx` — gráfico de linha `recharts` (chamadas por hora do dia atual)
- `src/app/dashboard/AgentList.tsx` — lista de agentes com status e contagem de chamadas hoje

Nenhuma migração de banco necessária — usa tabelas existentes.

---

## ⚡ SPRINT 6 — Polish e Make

### Objetivo

Estabilizar a experiência do agente e conectar automações externas via Make.

### ✅ 6.1 — Estados de erro e borda (Concluído)

- `DialerTab.tsx`: banner vermelho quando helper offline, com instrução de como religar (`start.bat`)
- `DialerTab.tsx`: banner informativo quando campanha não tem mais contatos pendentes
- `usePowerDialer.ts`: `getNextContact` com retry automático (3 tentativas, 1s de intervalo)

### ✅ 6.2 — Estados vazios e loading (Concluído)

- `DialerTab.tsx`: skeleton animado na lista de campanhas durante carregamento
- `DialerTab.tsx`: empty state com ícone quando não há campanhas criadas
- `CallHistory.tsx`: skeleton animado + empty state com ícone quando não há chamadas

### 🔜 6.3 — Listas e Campanhas configuráveis  ← PRÓXIMO

Substitui o conceito antigo (webhook Make + Google Sheets). O supervisor sobe um
**mailing** (`.csv` ou `.xlsx`) direto na interface, e o DiscSiP importa os contatos.
Sem dependência externa, sem `x-webhook-key`.

#### Conceito: Listas vs Campanhas

Duas entidades distintas:

- **Campanha** = a operação. Define **quem** disca (agentes participantes), **quando**
  (horário de funcionamento) e **o que** o agente vê durante a ligação (campos visíveis).
- **Lista** = um mailing bruto carregado dentro de uma campanha. Carrega os contatos +
  as regras de **reciclagem**.

Relação: **1 campanha → N listas**. Uma lista sempre pertence a uma campanha (não há lista
"solta"). Para reaproveitar o mesmo mailing em outra campanha, basta subir o arquivo
novamente nessa outra campanha — não há vínculo compartilhado entre campanhas.

#### Fluxo de configuração

```
Criar Campanha → Configurar Campanha → Subir Lista → Configurar Lista → Rodar
```

1. **Criar Campanha** — nome.
2. **Configurar Campanha** — horário de funcionamento (ex: 09h–18h), agentes
   participantes, campos que o agente verá na tela de discagem.
3. **Subir Lista** — upload do `.csv`/`.xlsx`. O sistema mostra um preview das colunas.
4. **Configurar Lista** — mapear colunas (Nome / Telefone / Informação Adicional e
   demais extras) e definir as regras de reciclagem.
5. **Rodar** — a campanha entra em operação; agentes participantes passam a discar dentro
   do horário.

#### Formato do arquivo

Colunas esperadas: **Nome + Telefone + Informação Adicional** (e quaisquer colunas extras).
Detecção de cabeçalho case-insensitive; colunas não mapeadas como nome/telefone viram
campos extras nomeados em `extra_data`. Telefones são normalizados (remove `()`, `-`,
espaços, `+55`) e validados (10–11 dígitos com DDD); linhas inválidas entram num relatório
de erro sem travar a importação. Duplicados (mesmo telefone já na campanha) são ignorados.

Parsing via **`xlsx` (SheetJS)** no **cliente** (browser), com dynamic import para manter o
`xlsx` fora do bundle do worker Cloudflare. A Server Action recebe os contatos já normalizados
e apenas insere. Mesma API lê `.csv` e `.xlsx`.

#### Mudanças de schema (Supabase)

**`campaigns`** (novos campos)
- `schedule_start`, `schedule_end` — horário de funcionamento
- `visible_fields` (jsonb) — campos que o agente vê na discagem

**`campaign_agents`** (nova tabela) — `campaign_id`, `agent_id`: quem participa

**`lists`** (nova tabela)
- `campaign_id` (fk, obrigatório)
- `name`
- `column_mapping` (jsonb) — qual coluna do arquivo = nome / telefone / extras nomeados
- `recycle_enabled` (bool)
- `recycle_statuses` (jsonb) — status que voltam à fila (ex: `no_answer`, `busy`)
- `recycle_after_hours` (int) — espera antes de reciclar
- `recycle_max_attempts` (int) — limite de tentativas

**`campaign_contacts`** (novos campos)
- `list_id` (fk)
- `extra_data` (jsonb) — "Informação Adicional" + colunas extras do arquivo
- `attempts` (int, default 0)

**`ContactStatus`** ganha novo valor: `exhausted` — esgotou as tentativas de reciclagem,
sai da fila permanentemente.

#### Comportamento

- **Horário fora da campanha** — botão "Iniciar discagem" bloqueado, com aviso
  "Fora do horário desta campanha (09h–18h)".
- **Participação** — `getCampaignsForAgent` lista apenas campanhas em que o agente participa.
- **Campos visíveis** — `DialerTab` exibe os campos de `extra_data` conforme `visible_fields`.
- **Reciclagem** — quando `getNextContact` não acha `pending`, busca contatos com status
  reciclável, `dialed_at` mais antigo que `recycle_after_hours` e `attempts < max`, e os
  recoloca como `pending` (incrementando `attempts`). Ao atingir `recycle_max_attempts`
  sem sucesso, marca como `exhausted` e o contato sai da fila.

#### Sub-sprints

- **6.3a** — ✅ Migração de schema. SQL em `supabase/migrations/20260610_lists_and_campaigns.sql` (rodar no SQL Editor do Supabase) + types atualizados em `src/lib/types/database.ts` (`Campaign`, `CampaignAgent`, `List`, `ColumnMapping`, `CampaignContact`, status `exhausted`)
- **6.3b** — ✅ Tela "Configurar Campanha". Rota `/campaigns` (lista + criar) e `/campaigns/[id]` (configurar). Actions: `getAgents`, `getCampaignConfig`, `updateCampaignConfig`, `setCampaignAgents`. Sidebar ganhou item "Campanhas". Seção "Listas" é um stub apontando para 6.3c
- **6.3c** — ✅ Tela "Listas" dentro da campanha. Parsing **client-side** (`src/lib/mailing.ts` com `xlsx` via dynamic import — fica fora do bundle do worker). Componente `ListsSection` faz upload `.csv`/`.xlsx`, preview, auto-detecção e mapeamento de colunas (telefone/nome/extras), regras de reciclagem. Actions em `src/app/actions/lists.ts` (`getLists`, `createList` com dedup por campanha + insert em lotes de 500, `deleteList`). Campos extras das listas aparecem como toggles de campos visíveis na config da campanha
- **6.3d** — ✅ Ajustes no Dialer. `getCampaignsForAgent` (lista só campanhas em que o agente participa); bloqueio de discagem fora do horário (banner + botão desabilitado, reavaliado a cada 30s); exibição de `extra_data` conforme `visible_fields` (rótulos via `getListFieldLabels`); `getNextContact` agora recicla (`recycleCampaign`: esgota quem bateu `recycle_max_attempts` → `exhausted`, revive quem ainda pode e já esperou `recycle_after_hours`) e incrementa `attempts` no claim. Removido o fluxo antigo de criar campanha / colar contatos do `DialerTab` (agora é supervisor-driven); `addContactsToCampaign` removida

### ✅ 6.4 — Notificação pós-chamada (Make)

Quando o agente registra um resultado, se a disposição estiver entre as configuradas na
campanha, o DiscSiP faz um `POST` para o webhook do Make, que dispara email/WhatsApp.

- **Canal**: webhook único do Make. URL em `MAKE_WEBHOOK_URL` (secret no Cloudflare). Sem a
  var, a notificação é no-op. POST é **server-side** (`src/app/actions/notifications.ts`,
  `sendDispositionNotification`), best-effort (falha não bloqueia a discagem).
- **Gatilho por campanha**: campo `campaigns.notify_dispositions` (jsonb) — o supervisor marca
  na tela de config quais disposições notificam. Migração:
  `supabase/migrations/20260610_campaign_notify_dispositions.sql`.
- **Disparo**: em `usePowerDialer.submitDisposition`, após salvar o resultado, checa
  `campaign.notify_dispositions.includes(disposition)`.
- **Payload**: `{ contact {name, phone_number, extra_data}, agent {name, extension},
  campaign {id, name}, disposition {value, label}, occurred_at }`.
- As disposições passaram a viver em `src/lib/dispositions.ts` (compartilhadas entre o
  DialerTab e a config da campanha).

---

## ⚡ SPRINT 7 — Autenticação e Permissões (RBAC)

### Objetivo

Trocar o login por ramal (sem senha) por **Supabase Auth (email/senha)** com controle de
acesso por papel.

### Papéis e escopo

| Papel | Acesso |
|-------|--------|
| `pending` | Cadastrado, aguardando aprovação de um admin. Não acessa nada |
| `agent` | Só os dados e métricas dele |
| `supervisor` | Só o departamento dele |
| `manager` (gerente) | Todo o negócio (todos os deptos, campanhas, métricas); não gerencia contas |
| `admin` | Tudo + gestão de contas, papéis e departamentos |

Cadastro: autosserviço (email/senha) → cai como `pending` → admin aprova atribuindo papel +
departamento (+ ramal). Todos os papéis podem ter ramal e usar o discador.

### Modelo de dados

- `departments` (CRUD pelo admin)
- `profiles` — **id = auth.users.id**; `name`, `role`, `department_id`, `extension` (opcional).
  Substitui o papel de identidade da tabela `agents`; os FKs `agent_id` passam a apontar para
  `profiles` (cutover no 7b).
- `campaigns.department_id` — pro supervisor enxergar o seu departamento.
- Trigger `handle_new_user` cria o perfil `pending` no cadastro.
- Funções `current_profile_role()` / `current_profile_dept()` (SECURITY DEFINER) para as
  políticas RLS sem recursão.

### Sub-sprints

- **7a** — ✅ Fundação de schema (aditiva, não-quebra). Migração
  `supabase/migrations/20260611_auth_rbac_schema.sql`: `departments`, `profiles`, trigger de
  cadastro, helpers de RLS, `campaigns.department_id`. Dependência `@supabase/ssr` instalada.
  Types `Role`, `Department`, `Profile` + `Campaign.department_id`. RLS de `lists`/`campaign_agents`
  destravado temporariamente (real vem no 7c). Login por ramal segue funcionando.
- **7b** — ✅ Fluxo de auth + cutover de identidade. Entregue em duas passadas:
  - **7b-i** — Clientes `@supabase/ssr`: `src/lib/supabase/client.ts` (browser), `server.ts`
    refeito com cookies (async), `middleware.ts` (helper) + `src/middleware.ts` (gate: sem
    sessão→`/login`, role `pending`→`/aguardando`, aprovado em tela de auth→`/softphone`).
    Telas `/login`, `/cadastro`, `/verifique-email`, `/aguardando` + `/auth/confirm` (route
    handler que aceita `code` do template **padrão** do Supabase — sem precisar de SMTP — ou
    `token_hash` de template customizado). Actions `getCurrentProfile`/`signOut` em
    `src/app/actions/auth.ts`. Identidade migrou do ramal para o `Profile` da sessão
    (`softphoneStore.setProfile`); `getAgents`/`getAgentActivity` passaram a ler `profiles`;
    `getAgentByExtension` removido; todas as Server Actions usam `await createServerClient()`.
    Aviso "sem ramal" no Dialer pra quem não tem `extension`. Migração
    `20260612_drop_agent_fks.sql` (solta FKs `agent_id→agents`, mantém `agents`).
  - **7b-ii** — Migração destrutiva `20260613_drop_agents_repoint_fks.sql`: limpeza seletiva de
    referências órfãs (call_logs.agent_id→null preservando histórico, remove campaign_agents
    órfãos, desatribui/reseta contatos presos em `dialing`), repontou FKs `agent_id`/
    `assigned_agent_id` → `profiles(id)` e dropou `agents`. Tipos `Agent`/`AgentRole` removidos;
    `call_logs.agent_id` agora nullable.

  **Config do Supabase (feita no painel):** Confirm email ligado; Site URL `https://discsip.pages.dev`;
  Redirect URLs `https://discsip.pages.dev/**` (+ localhost se for testar dev). Template de
  email padrão (não precisa editar nem SMTP — o `/auth/confirm` trata o `code`). Aprovação de
  usuários e atribuição de papel/ramal/departamento é manual via SQL até o 7d.
- **7c** — ✅ RLS por papel/departamento em todas as tabelas. Migração
  `20260614_rls_policies.sql`: helpers SECURITY DEFINER (`is_campaign_participant`,
  `campaign_dept`, `profile_dept`) + políticas em profiles/departments/campaigns/
  campaign_agents/lists/campaign_contacts/call_logs; seed dos 3 departamentos. Decisões:
  **flip de status pelo agente removido** (campanha só é alterada por supervisor/manager/admin;
  o dialer não mexe mais em `campaigns`); **departamento da campanha** agora é configurável
  (seletor na config; `createCampaign` herda o depto do criador). `profiles` só admin edita.
  Como o usuário testa como admin (acesso total), o app não quebra; o escopo real de
  supervisor/agent é validado trocando de papel. RLS já entrega parte do escopo do dashboard.
- **7d** — ✅ Área do admin (`/admin`, só admin — gate no middleware + RLS). Aba **Usuários**:
  lista perfis (pendentes destacados), edita papel/departamento/ramal inline → tira a aprovação
  do SQL manual. Aba **Departamentos**: CRUD (criar/renomear/excluir). Actions em
  `src/app/actions/admin.ts` (`getProfiles`, `updateProfile`, `createDepartment`,
  `updateDepartment`, `deleteDepartment`). Migração `20260615_profiles_email.sql` espelha o
  `email` de auth.users em `profiles` (trigger + backfill) pra listar usuários sem service_role.
  Sidebar ganhou link "Admin" (só pro papel admin) + auto-hidratação do perfil da sessão
  (funciona em qualquer página, não só no softphone).
- **7e** — ✅ Navegação condicional + gate de rotas por papel. Sidebar mostra os itens conforme
  o papel (agente: só Dialer; supervisor/manager: + Dashboard + Campanhas; admin: + Admin). O
  middleware bloqueia o acesso direto: `/dashboard` e `/campaigns` exigem supervisor+, `/admin`
  exige admin. O **escopo dos dados por departamento já vem do RLS** (supervisor só enxerga as
  linhas do seu depto em qualquer query do dashboard/campanhas), sem mudança nas queries.
- **7e** — Escopo nas queries/UI por papel + navegação condicional na Sidebar.

### Bootstrap do primeiro admin

Como o cadastro cai em `pending` e não há admin para aprovar o primeiro, após o 7b (quando o
cadastro existir): cadastre-se pelo app e rode uma vez no SQL Editor do Supabase:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'SEU_EMAIL');
```

---

## 8. Estrutura de Arquivos

```
src/
├── app/
│   ├── admin/              (admin) /admin: page.tsx + AdminClient.tsx (usuários + departamentos)
│   ├── actions/
│   │   ├── auth.ts          Server Actions: getCurrentProfile, signOut
│   │   ├── admin.ts         Server Actions: getProfiles, updateProfile, CRUD departamentos
│   │   ├── dialer.ts        Server Actions: salvar chamada, histórico
│   │   ├── campaigns.ts     Server Actions: campanhas, config, agentes (profiles), fila + reciclagem
│   │   ├── lists.ts         Server Actions: listas/mailing (criar, importar, rótulos)
│   │   └── supervisor.ts    Server Actions: métricas do dashboard
│   ├── login/, cadastro/, verifique-email/, aguardando/  Telas de auth (Supabase)
│   ├── auth/confirm/route.ts  Handler do link de confirmação de email (code | token_hash)
│   ├── campaigns/          (supervisor) gestão e configuração de campanhas
│   │   ├── page.tsx         Server Component: lista de campanhas
│   │   ├── CampaignsListClient.tsx  Lista + criar campanha
│   │   └── [id]/
│   │       ├── page.tsx     Server Component: busca config, agentes e listas
│   │       ├── ConfigureCampaignClient.tsx  Horário, agentes, campos visíveis
│   │       └── ListsSection.tsx  Upload .csv/.xlsx, mapeamento, reciclagem
│   ├── dashboard/
│   │   ├── page.tsx         Server Component: busca dados e passa para o client
│   │   ├── DashboardClient.tsx  Layout principal do dashboard
│   │   ├── MetricCard.tsx   Card reutilizável de métrica
│   │   ├── CallsChart.tsx   Gráfico de chamadas por hora (recharts)
│   │   └── AgentList.tsx    Lista de agentes com status hoje
│   └── softphone/
│       ├── page.tsx         Wrapper SSR desabilitado
│       ├── SoftphoneClient.tsx  Layout principal, login, banner de chamada
│       ├── DialerTab.tsx    UI das campanhas do agente e controles do dialer
│       └── CallHistory.tsx  Histórico de chamadas do agente
├── components/
│   └── Sidebar.tsx          Navegação: Dialer, Dashboard, Campanhas
├── hooks/
│   └── usePowerDialer.ts    Lógica da fila: dialNext, start, pause, submitDisposition
├── store/
│   ├── softphoneStore.ts    Estado do agente e da chamada atual
│   └── dialerStore.ts       Estado da campanha e do dialer
├── middleware.ts            Gate de auth/role + refresh de sessão (@supabase/ssr)
├── lib/
│   ├── constants.ts         HELPER_URL compartilhado
│   ├── mailing.ts           Parsing client-side (.csv/.xlsx), normalização de telefone
│   ├── types/database.ts    Types TypeScript das tabelas Supabase
│   └── supabase/
│       ├── server.ts        Cliente server (cookies, async) — Server Actions/Components
│       ├── client.ts        Cliente browser ('use client')
│       └── middleware.ts    updateSession (refresh + gate) usado pelo middleware raiz
supabase/
└── migrations/              SQL idempotente, rodado manualmente no Supabase
    ├── 20260610_lists_and_campaigns.sql        Listas e Campanhas (6.3a)
    ├── 20260610_campaign_notify_dispositions.sql  Notificação por disposição (6.4)
    ├── 20260611_auth_rbac_schema.sql           Fundação RBAC: departments, profiles (7a)
    ├── 20260612_drop_agent_fks.sql             Solta FKs agent_id→agents (7b-i)
    ├── 20260613_drop_agents_repoint_fks.sql    Repont. FKs→profiles + drop agents (7b-ii)
    ├── 20260614_rls_policies.sql               RLS por papel/depto + seed deptos (7c)
    └── 20260615_profiles_email.sql             Espelha email em profiles + backfill (7d)
local-helper/
├── index.js                 Helper Node.js
├── package.json
├── start.bat                Iniciar manualmente
└── instalar.bat             Instalação completa + startup Windows
```
