# Blue Line — Power Dialer

Sistema web de discagem semi-automática para a equipe de vendas da **Araujo Negociações**, integrado ao PABX **Intelbras WidevoiceX** via **softphone utilizado**. O Blue Line gerencia filas de contatos, seleciona o próximo automaticamente e aciona o softphone utilizado instalado na máquina do agente — o agente só atende e fala.

- **App:** https://discsip.pages.dev
- **Deploy:** Cloudflare Pages (deploy automático no push para `main`)
- **Repositório:** https://github.com/saraujonegociacoes-tech/DiscSiP
- **PABX:** Intelbras WidevoiceX (`widevoice8.intelbras.com.br`) — ramais 5125–5150

> Documentação técnica aprofundada em [`docs/`](docs/README.md), organizada em `reference/`
> (arquitetura, integração softphone utilizado, perguntas Intelbras), `updates/` (discagem paralela,
> discagem em background) e `fixes/` (correções por lote).

---

## Índice

- [Visão geral](#visão-geral)
- [Como funciona](#como-funciona)
- [Papéis e permissões (RBAC)](#papéis-e-permissões-rbac)
- [Arquitetura de discagem](#arquitetura-de-discagem)
- [Helper local (máquinas dos agentes)](#helper-local-máquinas-dos-agentes)
- [Stack](#stack)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Banco de dados (Supabase)](#banco-de-dados-supabase)
- [Server Actions](#server-actions)
- [Ambiente de desenvolvimento](#ambiente-de-desenvolvimento)
- [Build e deploy](#build-e-deploy)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Configuração do Supabase](#configuração-do-supabase)

---

## Visão geral

O servidor SIP da Intelbras só aceita WebSocket sem TLS (`ws://`), o que um app em HTTPS não pode usar (mixed content). Em vez de discar pelo browser, o Blue Line aproveita o **softphone utilizado** que os agentes já usam: um **helper local** (Node.js, porta 3001) rodando na máquina de cada agente recebe o número do navegador e aciona o softphone utilizado, que disca via SIP no PABX. Sem proxy central, sem IP fixo, sem API Intelbras.

O sistema é **dirigido pelo supervisor**: ele cria campanhas, sobe os mailings (`.csv`/`.xlsx`) e define quem disca, quando e o que o agente vê. O agente apenas seleciona uma campanha e inicia a discagem.

---

## Como funciona

### Autenticação

O acesso é por **Supabase Auth (email/senha)**. O cadastro é autosserviço: novos usuários entram como `pending` e ficam em `/aguardando` até um **admin** atribuir papel, departamento e (opcional) ramal. A confirmação de email está ligada — o link do template padrão do Supabase é tratado em `/auth/confirm`.

### Fluxo do supervisor (em `/campaigns`)

1. **Cria** uma campanha (nome + departamento).
2. **Configura**: horário de funcionamento, agentes participantes, campos visíveis ao agente e quais disposições disparam notificação.
3. **Sobe a lista** (mailing `.csv`/`.xlsx`): preview das colunas, mapeamento (nome / telefone / campos extras) e regras de reciclagem.
4. **Roda**: a campanha entra em operação para os agentes participantes, dentro do horário.

### Fluxo do agente (em `/softphone`)

1. Vê apenas as campanhas em que participa e seleciona uma.
2. Clica **Iniciar discagem** (bloqueado fora do horário configurado, reavaliado periodicamente).
3. O sistema busca o próximo contato pendente da fila e aciona o softphone utilizado via helper local.
4. O softphone utilizado disca automaticamente — o agente só atende o telefone.
5. O fim da chamada é detectado em tempo real (eventos do softphone utilizado via helper) ou pelo botão **Encerrar**.
6. O agente registra o **resultado** (disposição); se ela estiver entre as configuradas, um webhook do Make é disparado (email/WhatsApp).
7. O próximo contato carrega após uma pausa curta entre chamadas.

Contatos sem sucesso voltam à fila automaticamente (**reciclagem**) após um intervalo, até um limite de tentativas — depois são marcados como `exhausted` e saem da fila.

### Discagem paralela / preditiva

Cada campanha tem `parallel_lines`: **1 = power dialer 1-a-1** (padrão); **≥2 = modo
preditivo** — o helper disca N números ao mesmo tempo, conecta o **primeiro que atende** e
derruba os demais (`microsip.exe /hangupcalling`, que poupa a chamada já atendida). Durante o
"discando N" o agente pode fazer outra coisa; é avisado (visual + som) quando alguém atende.
Os contatos discados-mas-derrubados viram `abandoned` (recicláveis). Detalhes e testes em
[`docs/updates/discagem-paralela-preditiva.md`](docs/updates/discagem-paralela-preditiva.md).

### Painel de áudio do agente

Ao **iniciar a discagem** (não ao só selecionar a campanha), o agente vê um painel com
**Desligar**, **Microfone** (mudo/aberto) e **Som** (mudo/aberto); o painel some quando a
discagem para. O microfone usa `msip:micmute`; o alto-falante é mutado
no nível do Windows (sessão de áudio do `microsip.exe`), porque o mute interno do softphone utilizado não
silencia o ringback. Requer **helper ≥ 1.7** (os botões ficam desabilitados em versões antigas).

### Métricas do agente

A aba **Meu desempenho** (em `/softphone`) mostra os números do próprio agente no dia
(chamadas, atendidas, tempo em chamada, por hora e quebra de tabulações), escopados pela sessão.

---

## Papéis e permissões (RBAC)

O escopo de dados é aplicado por **Row Level Security (RLS)** no Postgres, e o acesso às rotas é reforçado no `middleware.ts`.

| Papel | Acesso |
|-------|--------|
| `pending` | Cadastrado, aguardando aprovação. Fica preso em `/aguardando`, não acessa o app |
| `agent` | Apenas o discador (`/softphone`) e os próprios dados/métricas |
| `supervisor` | Dialer + Dashboard + Campanhas — restrito ao **seu departamento** |
| `manager` | Todo o negócio (todos os departamentos, campanhas e métricas); não gerencia contas |
| `admin` | Tudo + área `/admin` (gestão de usuários, papéis e departamentos) |

- Cadastro → `pending` → admin aprova atribuindo papel/depto/ramal pela tela `/admin`.
- **Bootstrap do 1º admin** (manual, uma vez, após se cadastrar):
  ```sql
  update public.profiles set role = 'admin'
  where id = (select id from auth.users where email = 'SEU_EMAIL');
  ```

---

## Arquitetura de discagem

```
Browser (agente)
  │  HTTPS                         ┌──────────────────────────────┐
  ├────────────────────────────▶  │ Cloudflare Pages (Next.js)    │
  │                                │  Server Actions, RLS, Supabase│
  │                                └──────────────────────────────┘
  │  fetch http://localhost:3001
  ▼
Helper Node.js (porta 3001)        ← roda na máquina do agente
  │  spawn microsip.exe NUMERO  (ou fallback protocolo tel:)
  ▼
softphone utilizado (softphone Windows)
  │  SIP
  ▼
PABX Intelbras WidevoiceX
```

- O número é normalizado para `021 + DDD + número` (CSP da operadora, sem o qual o interurbano não completa).
- O fim da chamada flui de volta: softphone utilizado → hooks `cmdCallStart/End/Busy` (no `microsip.ini`) → helper (`/event/*`) → o app faz polling em `/events` para tabular automaticamente.

---

## Helper local (máquinas dos agentes)

App Express (`local-helper/index.js`, **v1.7**) em `http://localhost:3001`. Endpoints:

| Método | Rota | Função |
|--------|------|--------|
| `GET` | `/ping` | Health check + versão do helper (status "Helper online/offline" no app) |
| `POST` | `/call` | Recebe `{ number }`, normaliza e disca via `microsip.exe` (ou fallback `tel:`) |
| `POST` | `/dial-parallel` | Recebe `{ numbers: [...] }`, disca N em paralelo (modo preditivo) |
| `GET` | `/parallel-status` | Estado agregado do lote paralelo (quem atendeu, derrubados) |
| `POST` | `/hangup` | Encerra a chamada ativa (`msip:hangupall`) — botão "Desligar" |
| `POST` | `/mute` | `{ device:'mic'\|'speaker', muted }` — mic via `msip:micmute`; alto-falante via mute da sessão de áudio do `microsip.exe` no Windows (**v1.7+**) |
| `GET` | `/events` | Último evento de chamada (o app faz polling aqui) |
| `GET` | `/event/call-start` · `/event/call-end` · `/event/call-busy` | Recebem os eventos do softphone utilizado |
| `POST` | `/update` | Auto-atualização sob demanda (botão "Atualizar helper" no app) |

**Discagem:** prefixa o CSP `021` (configurável via `DIAL_PREFIX`), removendo `+55`/`55` e formatação. Sempre disca `021 + DDD + número` (ex.: `11952085529` → `02111952085529`). O `microsip.exe` é localizado automaticamente nos caminhos padrão (override via `MICROSIP_PATH`).

### Auto-atualização do helper

A versão publicada do helper vai junto do site em `public/helper/` (`scripts/sync-helper.mjs`
roda no `prebuild`, copiando `local-helper/index.js` e gravando `version.json`). O app compara a
versão publicada com a do helper (`/ping`) e, se houver nova, mostra **"Atualizar helper"**. Cada
helper vira a versão nova **só quando o agente clica nesse botão** (`POST /update`) **ou quando a
máquina/helper reinicia** (`maybeAutoUpdate` no start) — não há push. Logo, durante um rollout há
versões convivendo; o app trata isso (ex.: o painel de mute exige helper ≥ 1.7). O `start.bat`
reabre o `node` quando o helper sai com código 42 (após se atualizar).

### Arquivos do helper

| Arquivo | Função |
|---------|--------|
| `instalar.bat` | Instalação completa (1× por máquina): `npm install` → configura hooks do softphone utilizado → cria atalho de startup oculto |
| `atualizar.bat` | Atualizador manual: mata só o node do helper → `npm install` → sobe oculto (a atualização do código em si é via app, `/update`) |
| `start.bat` | Inicia o helper manualmente com console (debug); reabre o node ao sair com código 42 (auto-update) |
| `start-hidden.vbs` | Inicia o helper sem janela (usado no startup) |
| `setup-hooks.ps1` | Copia os `on-call-*.bat` para `C:\Users\Public\blueline-helper` (caminho sem espaços) e grava os hooks `cmdCallStart/End/Busy` + `minimized=1` no `microsip.ini` |
| `on-call-start/end/busy.bat` | Disparados pelo softphone utilizado; fazem `curl` para os endpoints `/event/*` do helper |

**Instalação (uma vez por máquina, com o softphone utilizado fechado):**
```
local-helper/instalar.bat
```
Pré-requisito: Node.js instalado.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend + Backend | Next.js 15.5 (App Router, Server Actions, React 19) |
| Deploy | Cloudflare Pages (Advanced Mode, `_worker.js`) via `@opennextjs/cloudflare` |
| Banco de dados / Auth | Supabase (PostgreSQL + Auth + RLS), via `@supabase/ssr` |
| Estado global | Zustand 5 |
| Estilo | TailwindCSS 4 |
| Gráficos | Recharts |
| Parse de mailing | `xlsx` (SheetJS), client-side com dynamic import |
| Discagem | softphone utilizado + helper local Node.js/Express |

---

## Estrutura do projeto

```
src/
├── middleware.ts              Gate de auth/role + refresh de sessão (@supabase/ssr)
├── app/
│   ├── login/ · cadastro/ · verifique-email/ · aguardando/   Telas de auth
│   ├── auth/confirm/route.ts  Handler do link de confirmação (code | token_hash)
│   ├── actions/
│   │   ├── auth.ts            getCurrentProfile, signOut
│   │   ├── admin.ts           getProfiles, updateProfile, CRUD de departamentos
│   │   ├── campaigns.ts       campanhas, config, fila + reciclagem, stats
│   │   ├── lists.ts           listas/mailing (criar, importar, rótulos, excluir)
│   │   ├── dialer.ts          saveCallLog (grava disposition), getCallHistory
│   │   ├── supervisor.ts      métricas do dashboard (fuso de Brasília via lib/timezone)
│   │   ├── performance.ts     getMyPerformance — desempenho do próprio agente (escopo da sessão)
│   │   └── notifications.ts   sendDispositionNotification (webhook Make)
│   ├── softphone/             (agente) discador
│   │   ├── SoftphoneClient.tsx   Layout, painel de áudio, abas (Discador / Histórico / Meu desempenho)
│   │   ├── DialerTab.tsx         Campanhas do agente, horário, extra_data, controles, disposição
│   │   ├── CallControls.tsx      Painel: Desligar + mute Microfone/Som (só com discagem iniciada, helper ≥ 1.7)
│   │   ├── AgentPerformance.tsx  Aba "Meu desempenho" (métricas do próprio agente, hoje)
│   │   └── CallHistory.tsx       Histórico de chamadas (mostra a disposição tabulada)
│   ├── campaigns/             (supervisor) gestão e configuração
│   │   ├── CampaignsListClient.tsx   Lista + criar campanha
│   │   └── [id]/                     Config: horário, agentes, campos visíveis, listas
│   ├── dashboard/             (supervisor+) métricas, gráfico, atividade dos agentes
│   └── admin/                 (admin) usuários + departamentos
├── components/Sidebar.tsx     Nav condicional por papel
├── hooks/usePowerDialer.ts    Motor da fila: 1-a-1 e paralelo/preditivo, start/pause/resume, submitDisposition
├── store/
│   ├── softphoneStore.ts      Perfil da sessão + estado da chamada + mute (mic/alto-falante)
│   └── dialerStore.ts         Campanha, contato atual, status do dialer, lote paralelo
└── lib/
    ├── constants.ts           HELPER_URL = http://localhost:3001 + helperFetch (Local Network Access)
    ├── dispositions.ts        DISPOSITIONS (compartilhado dialer + config + histórico)
    ├── timezone.ts            hourInBRT / brtTodayStartUtcISO (fuso America/Sao_Paulo)
    ├── mailing.ts             parseMailingFile (xlsx), normalizePhone, slugify
    ├── types/database.ts      Types das tabelas Supabase
    └── supabase/              clientes server / client / middleware (@supabase/ssr)

supabase/migrations/           SQL idempotente, rodado manualmente no Supabase
local-helper/                  Helper Node.js + scripts de instalação (Windows)
docs/                          Documentação técnica
.github/workflows/             Keep-alive do Supabase Free (ping a cada 3 dias)
```

---

## Banco de dados (Supabase)

| Tabela | Descrição |
|--------|-----------|
| `departments` | Departamentos (CRUD pelo admin) |
| `profiles` | Identidade do app (**id = `auth.users.id`**): `name`, `email`, `role`, `department_id`, `extension`. Trigger cria perfil `pending` no cadastro |
| `campaigns` | Campanhas: `status`, `department_id`, `schedule_start/end`, `visible_fields` (jsonb), `notify_dispositions`, `parallel_lines` (1 = 1-a-1; ≥2 = preditivo) |
| `campaign_agents` | N:N campanha ↔ agente (quem participa) |
| `lists` | Mailing dentro de uma campanha: `column_mapping` (jsonb) + regras `recycle_*` |
| `campaign_contacts` | Contatos: `list_id`, `extra_data` (jsonb), `status`, `disposition`, `attempts`, `assigned_agent_id`, `dialed_at` |
| `call_logs` | Histórico de chamadas (`agent_id` nullable; `disposition`/`notes` = tabulação registrada) |

Estados do contato (`ContactStatus`):
```
pending → dialing → answered | no_answer | busy | failed | do_not_call
                  ↘ abandoned (paralelo: tocou mas foi derrubado antes de atender — reciclável)
                  ↘ (reciclagem) volta a pending até recycle_max_attempts → exhausted
```

As migrações ficam em `supabase/migrations/` (prefixo `YYYYMMDD_`, idempotentes, rodadas manualmente no SQL Editor do Supabase):

| Migração | Conteúdo |
|----------|----------|
| `20260610_lists_and_campaigns.sql` | Listas e campanhas (schema 6.3) |
| `20260610_campaign_notify_dispositions.sql` | `campaigns.notify_dispositions` (6.4) |
| `20260611_auth_rbac_schema.sql` | Fundação RBAC: `departments`, `profiles`, trigger, helpers (7a) |
| `20260612_drop_agent_fks.sql` | Solta FKs `agent_id → agents` (7b-i) |
| `20260613_drop_agents_repoint_fks.sql` | Repont. FKs → `profiles` + drop `agents` (7b-ii) |
| `20260614_rls_policies.sql` | RLS por papel/departamento + seed dos departamentos (7c) |
| `20260615_profiles_email.sql` | Espelha `email` em `profiles` + backfill (7d) |
| `20260619_parallel_dialing.sql` | `campaigns.parallel_lines` + status `abandoned` em `campaign_contacts` |

---

## Server Actions

Mutações e queries rodam como Server Actions (em `src/app/actions/`), sempre com `await createServerClient()` para que o RLS enxergue `auth.uid()`:

- **auth** — `getCurrentProfile`, `signOut`
- **admin** — `getProfiles`, `updateProfile`, `createDepartment`, `updateDepartment`, `deleteDepartment`
- **campaigns** — `getCampaigns`, `getCampaignsForAgent`, `createCampaign`, `updateCampaignStatus`, `getNextContact` (+ reciclagem), `updateContactStatus`, `getDepartments`, `getAgents`, `getCampaignConfig`, `updateCampaignConfig`, `setCampaignAgents`, `getCampaignStats`
- **lists** — `getLists`, `getListFieldLabels`, `createList` (dedup + lotes de 500), `deleteList`
- **dialer** — `saveCallLog` (grava a `disposition` tabulada), `getCallHistory`
- **supervisor** — `getDashboardStats`, `getCampaignsSummary`, `getCallsByHour`, `getAgentActivity` (horas no fuso de Brasília)
- **performance** — `getMyPerformance` (desempenho do próprio agente, escopado por `auth.getUser()`)
- **notifications** — `sendDispositionNotification` (POST best-effort para `MAKE_WEBHOOK_URL`)

---

## Ambiente de desenvolvimento

```bash
cp .env.example .env.local   # preencha com as credenciais do Supabase
npm install
npm run dev                  # Next.js com Turbopack
```

Para testar o discador localmente, rode também o helper:
```bash
cd local-helper && npm install && npm start
```

---

## Build e deploy

```bash
npm run build:cf   # build para Cloudflare Pages (OpenNext + pós-processamento)
npm run preview    # build + wrangler pages dev (preview local do worker)
```

O `build:cf` faz o build com `@opennextjs/cloudflare` e, em seguida: renomeia `worker.js` → `_worker.js`, copia `assets/*` para a raiz do output e ativa `__ASSETS_RUN_WORKER_FIRST__`. O Cloudflare Pages detecta commits em `main` e faz o deploy automaticamente.

**Configuração no dashboard do Cloudflare Pages:**
- Build command: `npm run build:cf`
- Build output: `.open-next`
- Node.js: 22 · Branch: `main`
- `wrangler.toml`: `pages_build_output_dir = ".open-next"` + `compatibility_flags = ["nodejs_compat"]`

---

## Variáveis de ambiente

| Variável | Onde | Descrição |
|----------|------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` + Cloudflare (Secret) | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` + Cloudflare (Secret) | Chave pública (anon) do Supabase |
| `MAKE_WEBHOOK_URL` | Cloudflare (Secret, opcional) | Webhook do Make para notificação pós-chamada; sem ela, no-op |

Variáveis do helper (opcionais, na máquina do agente): `DIAL_PREFIX` (default `021`), `MICROSIP_PATH`.

---

## Configuração do Supabase

No painel do projeto:
- **Authentication → Confirm email:** ligado
- **Site URL:** `https://discsip.pages.dev`
- **Redirect URLs:** `https://discsip.pages.dev/**` (+ `localhost` se for testar em dev)
- Template de email **padrão** basta (sem SMTP nem edição — o `/auth/confirm` trata o `code`)
- **Keep-alive:** o plano Free pausa após 7 dias inativo; o workflow `.github/workflows/supabase-keepalive.yml` faz ping a cada 3 dias (requer os secrets `SUPABASE_URL` e `SUPABASE_ANON_KEY` no GitHub)
