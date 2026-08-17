# Sistema da Araújo (Blue Desk)

Sistema web para a **Araujo Negociações**, organizado em **verticais de negócio** (departamentos), todas no mesmo app Next.js: o **Discador** (Blue Desk, o módulo original — discagem semi-automática via PABX **Intelbras WidevoiceX**), o **Dashboard de Leads** (funil comercial vindo do Pipefy) e o **Painel de Sucesso do Cliente** (CS, outro pipe do Pipefy). Uma quarta vertical, **Negociação**, já tem espaço reservado no menu mas ainda não tem aplicação construída.

Discador, Leads e CS são **domínios de produto separados** (schema, RLS e RPCs próprios no Supabase) que compartilham a mesma base de código, autenticação (RBAC) e deploy — não são apps distintos.

Há ainda um módulo de **infra** (não uma vertical de departamento): o **Warmup Whatsapp** (`/aquecimento`, supervisor/manager/admin), que faz até 6 números da mesma BM conversarem entre si para construir reputação antes das campanhas de disparo. Mesmo padrão de isolamento (schema `warmup_*`, RLS e rotas próprios).

E um módulo **interno** de **Desenvolvimento / TI**: **Projetos** (`/projects`, só manager/admin), um gerenciador de tarefas/sprints estilo Monday (schema `monday_*`, RLS por *membership*) — board kanban, comentários por tarefa, membros por projeto, pastas por pessoa e uma **Daily** por responsável. Doc do módulo: [`docs/projetos-docs/updates/projetos-blue-desk.md`](docs/projetos-docs/updates/projetos-blue-desk.md).

- **App:** https://discsip.pages.dev
- **Deploy:** Cloudflare Pages (deploy automático no push para `main`)
- **Repositório:** https://github.com/saraujonegociacoes-tech/bluedesk
- **PABX (Discador):** Intelbras WidevoiceX (`widevoice8.intelbras.com.br`) — ramais 5125–5150

> Documentação técnica aprofundada em [`docs/links.md`](docs/links.md) (índice geral).
> A doc é organizada **por projeto**: `docs/<projeto>-docs/` (`discadora-docs`,
> `painelleads-docs`, `painelcs-docs`, `warmup-docs`, `projetos-docs`), e dentro de cada uma
> o espelho `reference/` (base/fonte de verdade), `updates/` (features e mudanças) e `fixes/` (correções).

---

## Índice

- [Visão geral](#visão-geral)
- [Discador — Como funciona](#discador--como-funciona)
- [Dashboard de Leads (Comercial)](#dashboard-de-leads-comercial)
- [Painel de Sucesso do Cliente (CS)](#painel-de-sucesso-do-cliente-cs)
- [Negociação](#negociação)
- [Aquecimento WhatsApp](#aquecimento-whatsapp)
- [Projetos (Desenvolvimento e TI)](#projetos-desenvolvimento-e-ti)
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

O **Discador** resolve um problema específico: o servidor SIP da Intelbras só aceita
WebSocket sem TLS (`ws://`), o que um app em HTTPS não pode usar (mixed content). Em vez de
discar pelo browser, ele aproveita o **softphone utilizado** que os agentes já usam: um
**helper local** (Node.js, porta 3001) rodando na máquina de cada agente recebe o número do
navegador e aciona o softphone utilizado, que disca via SIP no PABX. Sem proxy central, sem
IP fixo, sem API Intelbras.

> 🚧 **Esta premissa mudou (ago/2026).** O `ws://`-only vale só para a porta 7048; existe um
> endpoint **WSS** no ar (`wss://widevoice8.intelbras.com.br:8089/ws`, Asterisk 22). Está em
> andamento a migração para um **softphone WebRTC no navegador**, que elimina o helper e a
> instalação por máquina — ver
> [`docs/discadora-docs/updates/softphone-webrtc-navegador.md`](docs/discadora-docs/updates/softphone-webrtc-navegador.md).
> Até lá, **o helper continua sendo o caminho de produção** e tudo abaixo segue valendo.

O **Dashboard de Leads** e o **Painel de CS** resolvem outro problema: dar visibilidade a
dois funis que já rodam no **Pipefy** (comercial e sucesso do cliente), sincronizados quase
em tempo real via **Make** para o Supabase e exibidos com métricas próprias por
papel/departamento — ver seções dedicadas abaixo.

---

## Discador — Como funciona

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
[`docs/discadora-docs/updates/discagem-paralela-preditiva.md`](docs/discadora-docs/updates/discagem-paralela-preditiva.md).

**Caixa postal (corte de toque).** Para o SIP, caixa postal atende igual a humano (`200 OK`) —
e na preditiva ela vence a corrida e derruba as outras linhas. Sem AMD no PABX, a defesa é não
deixar a chamada chegar lá: a linha que **ainda está tocando** é derrubada em **20s**
(`RING_CUTOFF_MS` no helper), antes de a caixa atender, e o contato é auto-tabulado como
`abandoned` — volta pela reciclagem, sem passar pela tela do agente. Não é auto-hangup cego: o
comando é `/hangupcalling`, que poupa a chamada já atendida; **conversa em curso nunca cai**.
Há também um **piso de atendimento** (`MIN_ANSWER_MS`) para descartar o lote quando alguém "atende" rápido demais para ser gente — **desligado por padrão**: a medição em ligação real mostrou bloqueio de spam atendendo em **8,9s**, tempo indistinguível de humano, então tempo não resolve esse caso. Para calibrar com dado real: `http://localhost:3001/answer-times`.

> ⚠️ **Requisito:** o softphone precisa estar em **modo multi-chamada** (`singleMode=0` no
> `microsip.ini`). Em modo de chamada única sai **uma** ligação por lote e a preditiva não
> acontece. O helper (**v1.8+**) confere isso no `/ping` (`multiCall`), corrige sozinho quando o
> softphone está fechado e oferece o botão **Preparar MicroSIP** no discador quando está aberto;
> `/dial-parallel` recusa (409) em vez de discar 1 achando que discou N. Ver
> [`preditiva-real-e-discagem-manual.md`](docs/discadora-docs/updates/preditiva-real-e-discagem-manual.md).

### Discagem manual

Aba **"Discagem manual"** no `/softphone`: o agente digita o número (teclado na tela ou
teclado físico) e liga — **fora de campanha**, sem consumir mailing. Até 6 dígitos disca um
**ramal interno** (sem o CSP); 10/11 dígitos discam fixo/celular com DDD, e a tela mostra o que
vai ser discado antes de ligar. A ligação vai para o histórico (`call_logs` sem campanha) com
tabulação **opcional**. Fica bloqueada enquanto a discagem por campanha está rodando/pausada.

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

## Dashboard de Leads (Comercial)

Painel do funil comercial (Pipefy) em `/leads`, domínio separado do Discador — schema, RLS
e RPCs próprios no Supabase. Atrás da flag `NEXT_PUBLIC_LEADS_ENABLED` (sem ela, a rota
mostra "Em breve"). Detalhes completos em
[`docs/painelleads-docs/updates/dashboard-leads-indice.md`](docs/painelleads-docs/updates/dashboard-leads-indice.md).

- **Ingestão:** Pipefy → cenário Make (schedule 24/7, GraphQL delta) → RPC
  `ingest_lead_card` no Supabase. Ver
  [`docs/painelleads-docs/updates/make-integracao-pipefy.md`](docs/painelleads-docs/updates/make-integracao-pipefy.md).
- **Abas:** Visão Geral (KPIs, funil, distribuição por fase), Meus leads / ranking do
  agente, Performance, canal, órfãos/duplicados, alertas de leads parados por SLA.
- **Ganhos por data de venda:** o KPI "Ganhos" e o funil "geral" contam por
  `finalized_at`/`updated_at` (data real do evento), não por `created_at`, com split
  **ciclo × retroativo** (lead antigo mexido no período atual) — ver
  [`docs/painelleads-docs/fixes/correcao-ganhos-retroativos-e-funil-geral.md`](docs/painelleads-docs/fixes/correcao-ganhos-retroativos-e-funil-geral.md).
- **RBAC:** segue o mesmo padrão do Discador — agente vê o próprio; supervisor, o
  departamento Comercial + órfãos; manager/admin, tudo.
- **Backup lógico:** `npm run backup:leads` / `npm run import:leads` (Pipefy como fonte de
  verdade, recuperação testada).

## Painel de Sucesso do Cliente (CS)

Painel do funil de CS (Pipefy, pipe **"3.3 - Customer Success"**, id `305801110`) em `/cs`,
domínio separado do Discador e do Dashboard de Leads. Atrás da flag
`NEXT_PUBLIC_CS_ENABLED`. Detalhes completos em
[`docs/painelcs-docs/updates/dashboard-cs-indice.md`](docs/painelcs-docs/updates/dashboard-cs-indice.md).

- **Funil:** Triagem → Apresentação → Negociação do Cliente → 24 fases mensais de
  acompanhamento (1° a 24° Mês) → saídas (Quitados, Distratos, Acordos Vencidos,
  Arquivado, etc.) — 35 fases no total, seedadas na migration `20260715_cs_pipeline_schema.sql`.
- **Ingestão:** Pipefy → Make → RPCs `ingest_cs_card`/`ingest_cs_event` (mesmo desenho do
  comercial, pipe diferente). Carga histórica via `npm run import:cs-cards`.
- **Dado sensível:** o pipe tem dado pessoal de clientes reais (CPF, RG, endereço, dados
  financeiros) — ingerido inteiro em `cs_cards.metadata` (jsonb). Por isso o RLS de
  `cs_cards`/`cs_card_events` é mais estrito: só quem é do departamento de CS (ou
  manager/admin) lê qualquer linha.
- **Painel:** KPIs, tempo médio por fase (`CsDwellByPhase`), distribuição por fase e
  breakdown por responsável.

## Negociação

Terceira vertical de negócio (departamento próprio, `department_slug = 'negociacao'`).
Rota `/negociacao` reserva o espaço no menu lateral, mas **ainda não existe aplicação
construída** — mostra "Em breve" sem flag (não há dado nem sprint previsto ainda).

## Warmup Whatsapp

Módulo de **infra** (não uma vertical de departamento) em `/aquecimento`, só
**supervisor/manager/admin** (agente não). Resolve os bloqueios da Meta em números novos: até
**6 números da mesma BM** (várias WABAs) conversam entre si de forma gradual e "humana" para
construir reputação/quality rating antes de entrarem em campanha. Atrás da flag
`NEXT_PUBLIC_WARMUP_ENABLED`. Domínio separado (schema `warmup_*`, RLS e rotas próprios),
desenhado para ser extraível. Detalhes completos em
[`docs/warmup-docs/updates/aquecimento-whatsapp-indice.md`](docs/warmup-docs/updates/aquecimento-whatsapp-indice.md).

- **Plano de controle vs. braço executor:** o Blue Desk decide quem fala com quem, quando e o
  quê, grava o histórico e dispara o **Make** por webhook; o envio real à **Graph API da
  Meta** acontece no Make (mesma filosofia do Pipefy→Make). Ver
  [`docs/warmup-docs/updates/make-integracao-aquecimento.md`](docs/warmup-docs/updates/make-integracao-aquecimento.md).
- **Dois modos de operação** (`warmup_mode`, selecionável no painel): **Sessão (24h)** —
  aquecimento intensivo num período fixo (dono clica "Iniciar aquecimento"; volume por número
  contado desde o início da sessão); e **Gradual (dias)** — rampa multi-dia (`warmup_ramp_stages`),
  mais seguro. O intervalo entre mensagens e o teto por rodada valem nos dois.
- **Regra de mensageria:** a Cloud API exige **template aprovado** para abrir conversa sem
  sessão de 24h ativa (não dá para fugir 100%). Cada conversa **abre com 1 template leve** e
  segue em **texto livre variado** dentro das 24h. A janela é derivada do próprio histórico
  (`warmup_messages`), sem webhook de status da Meta no MVP.
- **Pacing humano:** teto de envios por rodada, gap aleatório por número, rampa/volume por
  período e variação de conteúdo — nunca disparo em massa simultâneo.
- **Agendamento:** a "rodada" (tick) roda por **GitHub Actions**
  (`.github/workflows/aquecimento-tick.yml`, a cada ~10 min) batendo `POST /api/aquecimento/tick`,
  porque Cloudflare **Pages** não tem Cron Triggers. O resultado real de entrega volta do Make
  por `POST /api/aquecimento/dispatch-result`.
- **Segurança:** `dry_run=true` de fábrica (grava histórico simulado sem tocar a Meta); RLS +
  Sidebar + guard de página restritos a supervisor/manager/admin (erro aqui pode bloquear a
  conta/BM).

---

## Projetos (Desenvolvimento e TI)

Módulo **interno** de gestão de tarefas/sprints estilo Monday (área "Desenvolvimento / TI"),
portado do app `blueline-monday`. Domínio isolado: todas as tabelas com prefixo `monday_`,
RLS própria por *membership* (`monday_project_members`), reusando só `profiles`.

- **Rotas:** `/projects` (lista, agrupada em **pastas por pessoa/dono**), `/projects/[id]`
  (board kanban), `/sprints`, `/backlog` e `/projects/daily` (**Daily** por responsável:
  feito hoje/ontem via `completed_at` + a entregar). Só `manager`/`admin` (gate + Sidebar).
- **Acesso:** RLS por membership; a **gerência vê todos os projetos** (helper
  `monday_is_gerencia()` somado aos helpers de acesso). O botão "Membros" adiciona pessoas
  específicas a um projeto (necessário para atribuir tarefas). `DELETE` só do dono.
- **Tarefa:** clicar abre a **visualização** (comentários, prazo, infos); botão "Editar"
  abre o formulário. Cada card mostra o **último comentário** (quem/quando).

Detalhes, arquivos e **migrations pendentes** em
[`docs/projetos-docs/updates/projetos-blue-desk.md`](docs/projetos-docs/updates/projetos-blue-desk.md).

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

Dentro do Discador, o escopo é por **papel**. Nas verticais de negócio (Comercial/CS/
Negociação), o menu lateral (`Sidebar.tsx`) também escopa por **departamento**
(`departments.slug`): cada grupo só aparece pra quem é do respectivo departamento, ou é
manager/admin (vê todas as verticais). O módulo de **Warmup Whatsapp** (`/aquecimento`)
é restrito a **supervisor/manager/admin** (RLS + Sidebar + guard no `middleware.ts`) — módulo
sensível, erro de configuração pode bloquear a conta/BM na Meta; agente não acessa. O módulo
de **Projetos** (`/projects`, "Desenvolvimento / TI") é só **manager/admin** (gate nas páginas
+ Sidebar); dentro dele o escopo é por *membership* de projeto (RLS `monday_*`), com a gerência
enxergando todos os projetos.

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

App Express (`local-helper/index.js`, **v1.15**) em `http://localhost:3001`. Endpoints:

> 📖 **O que cada arquivo do helper faz** (e o que é essencial × contorno de Windows):
> [`docs/discadora-docs/reference/helper-anatomia.md`](docs/discadora-docs/reference/helper-anatomia.md).

| Método | Rota | Função |
|--------|------|--------|
| `GET` | `/ping` | Health check: versão, `multiCall` (**v1.8+**), `dir` e `pid` — de qual pasta o helper subiu (**v1.11+**) |
| `POST` | `/call` | Recebe `{ number, raw? }`, normaliza e disca via `microsip.exe` (ou fallback `tel:`). `raw: true` disca sem o CSP — ramal interno (**v1.8+**) |
| `POST` | `/microsip-multicall` | Liga o modo multi-chamada no `microsip.ini` (fecha/reabre o softphone se preciso) — botão "Preparar MicroSIP" (**v1.8+**) |
| `POST` | `/dial-parallel` | Recebe `{ numbers: [...] }`, disca N em paralelo (modo preditivo). Recusa com **409** se o softphone estiver em chamada única |
| `GET` | `/parallel-status` | Estado agregado do lote paralelo (quem atendeu, derrubados) |
| `GET` | `/answer-times` | Distribuição do tempo-até-atender, para calibrar o corte de toque (**v1.9+**) |
| `POST` | `/hangup` | Encerra a chamada ativa (`msip:hangupall`) — botão "Desligar" |
| `POST` | `/hangup-calling` | Derruba só as linhas que ainda tocam, poupando a atendida — usado ao pausar um lote paralelo (**v1.8+**) |
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
versões convivendo; o app trata isso (ex.: o painel de mute exige helper ≥ 1.7). Desde a
**v1.11** quem reabre o `node` no código novo é o **próprio helper** (`restartSelf`): ele spawna
a versão nova desacoplada e encerra, sem precisar de launcher externo. O código de saída 42
continua existindo só como plano B para máquinas com o `start.bat` antigo.

Na prática o rollout se resolve sozinho: como o helper grava a origem do Blue Desk
(`helper-config.json`, alimentada pelo header `Origin` de qualquer request do app), toda máquina
que teve um agente logado se atualiza **no próximo boot**. Máquina com o helper **parado** é a
exceção — não tem processo para receber o clique nem para rodar o boot, e precisa do
"Ligar helper" ou de subir na mão.

> ⚠️ O botão **"Ligar helper"** depende do protocolo `bluedesk-helper://`, que o `instalar.bat`
> registra com o **caminho absoluto** do `start-hidden.vbs`. Se a pasta do helper mudar de lugar
> depois da instalação, o botão falha **em silêncio** (o navegador aciona, nada acontece). Conferir
> com `reg query "HKCU\Software\Classes\bluedesk-helper\shell\open\command" /ve`; o conserto é
> rodar o `instalar.bat` de novo.

### Arquivos do helper

| Arquivo | Função |
|---------|--------|
| `instalar.bat` | Instalação completa (1× por máquina): `npm install` → configura o softphone (hooks + multi-chamada) → atalho de startup oculto → registra o protocolo `bluedesk-helper://` → sobe o helper |
| `start-hidden.vbs` | **Launcher único**: inicia o helper sem janela. Usado pelo atalho de startup, pelo protocolo (botão "Ligar helper") e no duplo-clique. Para ver o log, rode `node index.js` num terminal |
| `setup-hooks.ps1` | Copia os `on-call-*.bat` para `C:\Users\Public\bluedesk-helper` (caminho sem espaços) e grava os hooks `cmdCallStart/End/Busy` + `minimized=1` + `singleMode=0` (multi-chamada) no `microsip.ini` |
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
| Ingestão Leads/CS | Pipefy (funis) → Make (sincronização quase real-time) → RPCs de ingestão no Supabase |
| Aquecimento WhatsApp | Blue Desk (plano de controle) → Make (braço executor) → Graph API da Meta; tick agendado por GitHub Actions |

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
│   │   ├── notifications.ts   sendDispositionNotification (webhook Make)
│   │   ├── presence.ts        reportPresence — heartbeat de presença do agente
│   │   ├── leads.ts           dados do Dashboard de Leads (KPIs, funil, atividade, ranking, alertas)
│   │   ├── cs.ts              getCsDashboard — dados do Painel de CS
│   │   ├── warmup.ts          Aquecimento: CRUD (números/settings/templates), stats, histórico, runWarmupTickManually
│   │   └── warmup-notifications.ts  sendWarmupNotification (webhook Make do aquecimento; no-op em dry-run)
│   ├── softphone/             (agente) discador
│   │   ├── SoftphoneClient.tsx   Layout, painel de áudio, abas (Discador / Discagem manual / Histórico / Meu desempenho)
│   │   ├── DialerTab.tsx         Campanhas do agente, horário, extra_data, controles, disposição, aviso de multi-chamada
│   │   ├── ManualDialTab.tsx     Discagem manual: teclado, ligar/desligar, tabulação opcional, log sem campanha
│   │   ├── CallControls.tsx      Painel: Desligar + mute Microfone/Som (discagem iniciada ou ligação manual, helper ≥ 1.7)
│   │   ├── AgentPerformance.tsx  Aba "Meu desempenho" (métricas do próprio agente, hoje)
│   │   └── CallHistory.tsx       Histórico de chamadas (mostra a disposição tabulada)
│   ├── campaigns/             (supervisor) gestão e configuração
│   │   ├── CampaignsListClient.tsx   Lista + criar campanha
│   │   └── [id]/                     Config: horário, agentes, campos visíveis, listas
│   ├── dashboard/             (supervisor+) métricas, gráfico, atividade dos agentes
│   ├── admin/                 (admin) usuários + departamentos
│   ├── leads/                 (vertical Comercial) Dashboard de Leads — flag NEXT_PUBLIC_LEADS_ENABLED
│   │   ├── LeadsClient.tsx       Abas: Visão Geral, Funil, Meus leads, Performance...
│   │   └── LeadsComingSoon.tsx   Tela exibida com a flag desligada
│   ├── cs/                    (vertical CS) Painel de Sucesso do Cliente — flag NEXT_PUBLIC_CS_ENABLED
│   │   ├── CsClient.tsx          KPIs, tempo por fase, distribuição, responsável
│   │   └── CsComingSoon.tsx      Tela exibida com a flag desligada
│   ├── negociacao/             (vertical Negociação) placeholder "Em breve", sem app ainda
│   ├── aquecimento/            (infra, supervisor/manager/admin) Warmup Whatsapp — flag NEXT_PUBLIC_WARMUP_ENABLED
│   │   ├── WarmupDashboardClient.tsx  Barra de controle (Simulador/Warmup, modo Sessão/Gradual, "rodar rodada") + abas
│   │   ├── NumbersConfigSection.tsx · TemplatesSection.tsx · HistoryTable.tsx
│   │   └── WarmupComingSoon.tsx       Tela exibida com a flag desligada
│   ├── api/aquecimento/        tick (cron GitHub Actions) + dispatch-result (callback do Make); auth por segredo
│   └── ajuda/                  "Como usar?" (todos os papéis)
├── features/
│   ├── leads/components/      Gráficos e painéis do Dashboard de Leads: Funnel, EvolutionChart,
│   │                          AgentRanking, ChannelBreakdown, FunnelActivity/PhaseDistributionActivity
│   │                          (funil "geral" ciclo × retroativo), AlertsPanel, OrphanLeads...
│   ├── cs/components/         Gráficos do Painel de CS: CsKpiRow, CsDwellByPhase,
│   │                          CsPhaseDistribution, CsResponsibleBreakdown
│   └── ajuda/                 Conteúdo da aba "Como usar?"
├── components/Sidebar.tsx     Nav condicional por papel + por vertical/departamento (department_slug)
├── hooks/usePowerDialer.ts    Motor da fila: 1-a-1 e paralelo/preditivo, start/pause/resume, submitDisposition
├── store/
│   ├── softphoneStore.ts      Perfil da sessão + estado da chamada + mute + multiCall do softphone + ligação manual
│   └── dialerStore.ts         Campanha, contato atual, status do dialer, lote paralelo (+ id da sessão) e erro de discagem
└── lib/
    ├── constants.ts           HELPER_URL = http://localhost:3001 + helperFetch (Local Network Access)
    ├── dispositions.ts        DISPOSITIONS (compartilhado dialer + config + histórico)
    ├── timezone.ts            hourInBRT / brtTodayStartUtcISO (fuso America/Sao_Paulo)
    ├── mailing.ts             parseMailingFile (xlsx), normalizePhone, slugify
    ├── types/database.ts      Types das tabelas Supabase
    ├── warmup/tick.ts         Orquestração do Aquecimento (runWarmupTick): elegibilidade, rampa, template×sessão, pacing
    └── supabase/              clientes server / client / middleware (@supabase/ssr) + service (service_role, só tick/callback)

scripts/                       import-leads.mjs / import-cs-cards.mjs (carga histórica Pipefy),
                                backup:leads, sync-helper.mjs (publica o helper no build)
supabase/migrations/           SQL idempotente, rodado manualmente no Supabase — uma subpasta
                                Migrations_<projeto>/ por domínio (índice em supabase/migrations/README.md)
local-helper/                  Helper Node.js + scripts de instalação (Windows) — só Discador
docs/                          Documentação técnica (índice em docs/links.md, por domínio)
.github/workflows/             Keep-alive do Supabase (a cada 3 dias) + tick do Aquecimento (a cada ~10 min)
```

---

## Banco de dados (Supabase)

Um único projeto Supabase, mas **schema/RLS isolados por domínio**: as tabelas do Discador,
do Dashboard de Leads e do Painel de CS não têm FKs entre si (ponte só por `profiles.id`,
quando necessário).

### Discador

| Tabela | Descrição |
|--------|-----------|
| `departments` | Departamentos (CRUD pelo admin). `slug` (`comercial`/`cs`/`negociacao`) identifica as verticais de negócio pro menu/RLS |
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

### Dashboard de Leads (Comercial)

Schema próprio (não versionado em `supabase/migrations/`, aplicado direto no Supabase ao
vivo) girando em torno de `v_lead_progress` (view — progresso/fase atual de cada lead),
`lead_agents` e RPCs como `get_leads_dashboard`, `get_leads_timeseries`,
`get_leads_won_by_sale_date`, `get_leads_activity`. Detalhes em
[`docs/painelleads-docs/updates/dashboard-leads-indice.md`](docs/painelleads-docs/updates/dashboard-leads-indice.md).

### Painel de Sucesso do Cliente (CS)

| Tabela | Descrição |
|--------|-----------|
| `cs_phases` | As 35 fases do funil de CS (seed na migration) |
| `cs_agents` | Agentes do pipe de CS no Pipefy |
| `cs_cards` | Um card por cliente em negociação; `metadata` (jsonb) guarda o node do Pipefy inteiro (dado sensível — CPF, RG, financeiro) |
| `cs_card_events` | Eventos/transições de fase de cada card |

### Warmup Whatsapp

Schema `warmup_*` (supervisor/manager/admin leem/configuram; tabelas de execução escritas só
pelo tick/callback via `service_role`).

| Tabela | Descrição |
|--------|-----------|
| `warmup_numbers` | Pool (até 6): `sender_id` (phone_number_id da Meta), `phone_number` (E.164), `status`, `participating`, `added_at`, `quality_rating` |
| `warmup_settings` | Config key/value: `qntd_numbers`, `max_numbers_cap`, `dry_run`, `tick_max_sends`, `min/max_gap_minutes`, e do modo de operação (`warmup_mode`, `sessao_duracao_horas`, `sessao_msgs_por_numero`, `sessao_conversas_por_numero`, `sessao_iniciada_em`) |
| `warmup_ramp_stages` | Rampa de volume por dias aquecendo (`daily_message_cap`, `new_conversations_per_day_cap`) |
| `warmup_templates` | Catálogo `kind`: `template` (abertura aprovada na Meta) ou `session_snippet` (frase livre) |
| `warmup_conversations` | Thread por par normalizado; `last_sender_id` (turno), `status`; único parcial `WHERE status='active'` |
| `warmup_messages` | Histórico e **fonte de verdade da janela de 24h**: `message_type`, `dispatch_mode` (live/dry_run), resultado do callback |

As migrações ficam em `supabase/migrations/` (prefixo `YYYYMMDD_`, idempotentes, rodadas manualmente
no SQL Editor do Supabase). Todos os domínios dividem o MESMO projeto Supabase, mas os arquivos são
organizados numa subpasta `Migrations_<projeto>/` por domínio — espelhando os nomes de `docs/`. O
índice das pastas, com a regra de ordem de execução, está em
[`supabase/migrations/README.md`](supabase/migrations/README.md).

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
| `20260710_leads_funnel_depth.sql` | RPC de profundidade/tempo de permanência por etapa do funil de Leads |
| `20260715_campaign_status_archive.sql` | Status de campanha calculado + arquivamento reversível (Discador) |
| `20260715_departments_slug.sql` | `departments.slug` (`comercial`/`cs`/`negociacao`) pro menu lateral e RLS por vertical |
| `20260715_cs_pipeline_schema.sql` | Schema do Painel de CS: `cs_phases`/`cs_agents`/`cs_cards`/`cs_card_events`, RLS, RPCs `ingest_cs_card`/`ingest_cs_event` |
| `20260716_cs_dashboard.sql` | RPC(s) de agregação do Painel de CS (KPIs, tempo por fase, distribuição) |
| `20260717_leads_won_by_sale_date.sql` | `get_leads_won_by_sale_date` — ganhos/mortos por `finalized_at`, split ciclo × retroativo |
| `20260718_leads_activity_by_update.sql` | `get_leads_activity` — funil "geral" por `updated_at`, split ciclo × retroativo |
| `20260719_warmup_schema.sql` | Schema do Warmup Whatsapp: tabelas `warmup_*`, RLS (manager/admin; execução só por `service_role`), seeds (settings + rampa) |
| `20260719b_warmup_supervisor_access.sql` | Libera o Warmup também para **supervisor** (recria as policies `warmup_*` incluindo o papel); agente segue sem acesso |
| `20260723d_monday.sql` | **Projetos** (base): tabelas/views/RPCs `monday_*`, RLS por membership, seed demo — ⏳ *pendente* |
| `20260727_monday_gerencia_access.sql` | Gerência vê/gerencia todos os projetos (`monday_is_gerencia()`); RPC `monday_assignable_users` — ⏳ *pendente* |
| `20260727b_monday_task_comments.sql` | Comentários por tarefa (`monday_task_comments`) + view `monday_task_last_comment` — ⏳ *pendente* |

> As migrações de **Projetos** (`monday_*`) ainda **não foram aplicadas** no Supabase — o
> código está no ar mas o módulo só funciona depois de rodá-las à mão. Ver
> [`docs/projetos-docs/updates/projetos-blue-desk.md`](docs/projetos-docs/updates/projetos-blue-desk.md). Outras migrações
> mais recentes (CS `2026072x`, leads drill) foram aplicadas ao vivo e ainda não constam nesta
> tabela.

O schema principal do Dashboard de Leads (`v_lead_progress`, `lead_agents`,
`get_leads_dashboard` e RPCs relacionadas) foi aplicado direto no Supabase ao vivo e não
está versionado nesta pasta — ver
[`docs/painelleads-docs/updates/dashboard-leads-indice.md`](docs/painelleads-docs/updates/dashboard-leads-indice.md).

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
- **presence** — `reportPresence` (heartbeat de presença do agente)
- **leads** (Dashboard de Leads) — `getLeadsData` (KPIs + funil + ganhos por data de venda),
  `getLeadsTimeseries`, `getLeadsTrend`, `getLeadsFunnelDepth`, `getLeadsActivity` (funil
  "geral" ciclo × retroativo), `getAgentLeads`, `getDuplicateAlerts`, `getSupervisorMetrics`
- **cs** (Painel de CS) — `getCsDashboard`
- **warmup** (Warmup Whatsapp) — `getWarmupNumbers`, `upsertWarmupNumber`, `deleteWarmupNumber`,
  `getWarmupSettings`, `updateWarmupSettings`, `getWarmupTemplates`, `upsertWarmupTemplate`,
  `deleteWarmupTemplate`, `getWarmupHistory`, `getWarmupStats`, `startWarmupSession`,
  `stopWarmupSession`, `runWarmupTickManually` (checa supervisor/manager/admin e roda o mesmo
  `runWarmupTick` do cron via `service_role`)
- **warmup-notifications** — `sendWarmupNotification` (POST best-effort para `MAKE_WEBHOOK_URL_WARMUP`; no-op em dry-run)

> As Server Actions e o painel do Warmup usam a sessão do usuário (RLS supervisor/manager/admin). Já
> o **tick** (`/api/aquecimento/tick`) e o **callback** (`/api/aquecimento/dispatch-result`)
> rodam **sem sessão**, autenticados por segredo próprio, e escrevem via `service_role`
> (`src/lib/supabase/service.ts`) — por isso `api/aquecimento/` é excluído do gate do `middleware.ts`.

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
| `MAKE_WEBHOOK_URL` | Cloudflare (Secret, opcional) | Webhook do Make para notificação pós-chamada (Discador); sem ela, no-op |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` (backend/CLI only) | Carga histórica de Leads e CS (`scripts/import-leads.mjs`, `scripts/import-cs-cards.mjs`) — nunca expor no frontend |
| `PIPEFY_TOKEN` | `.env.local` (backend/CLI only) | Token pessoal da API do Pipefy, usado pelas cargas históricas de Leads e CS |
| `PIPEFY_PIPE_ID` | `.env.local` (backend/CLI only) | Pipe do Pipefy do funil comercial (Dashboard de Leads) |
| `CS_PIPEFY_PIPE_ID` | `.env.local` (backend/CLI only) | Pipe "3.3 - Customer Success" no Pipefy (default `305801110`) |
| `NEXT_PUBLIC_LEADS_ENABLED` | `.env.local` + Cloudflare (build-time) | Liga o Dashboard de Leads (`/leads`); sem ela (ou `!=1`), mostra "Em breve" |
| `NEXT_PUBLIC_LEADS_REALTIME` | `.env.local` + Cloudflare (build-time, opcional) | Liga o Realtime do Dashboard de Leads |
| `NEXT_PUBLIC_CS_ENABLED` | `.env.local` + Cloudflare (build-time) | Liga o Painel de CS (`/cs`); sem ela (ou `!=1`), mostra "Em breve" |
| `NEXT_PUBLIC_WARMUP_ENABLED` | `.env.local` + Cloudflare (build-time) | Liga o Aquecimento WhatsApp (`/aquecimento`); sem ela (ou `!=1`), mostra "Em breve" |
| `MAKE_WEBHOOK_URL_WARMUP` | Cloudflare (Secret, opcional) | Webhook do cenário "Aquecimento · Disparo" no Make; sem ela, o disparo é no-op (histórico ainda grava) |
| `WARMUP_CRON_SECRET` | Cloudflare (Secret) + GitHub Actions | Segredo do endpoint `POST /api/aquecimento/tick` (header `X-Warmup-Cron-Secret`) |
| `MAKE_CALLBACK_SECRET` | Cloudflare (Secret) | Segredo do callback `POST /api/aquecimento/dispatch-result` (header `X-Warmup-Callback-Secret`) |
| `BLUELINE_URL` | GitHub Actions (Secret) | URL pública do deploy, usada pelo workflow do tick do Aquecimento |

Variáveis do helper (opcionais, na máquina do agente, só Discador): `DIAL_PREFIX` (default `021`),
`MICROSIP_PATH`, `MICROSIP_INI`, `RING_CUTOFF_MS` (default `20000`), `MIN_ANSWER_MS` (default `0`
= desligado), `MSIP_MIN_GAP_MS` (default `300`), e as três travas de comportamento:
**`HELPER_NO_HIDE=1`** (mostra a janela do softphone — o padrão é esconder, desde a v1.15),
`HELPER_NO_INI_FIX=1` (não corrige o `singleMode` no boot) e `HELPER_NO_UPDATE=1` (não se
auto-atualiza). Lista completa em
[`docs/discadora-docs/reference/helper-anatomia.md`](docs/discadora-docs/reference/helper-anatomia.md).

---

## Configuração do Supabase

No painel do projeto:
- **Authentication → Confirm email:** ligado
- **Site URL:** `https://discsip.pages.dev`
- **Redirect URLs:** `https://discsip.pages.dev/**` (+ `localhost` se for testar em dev)
- Template de email **padrão** basta (sem SMTP nem edição — o `/auth/confirm` trata o `code`)
- **Keep-alive:** o plano Free pausa após 7 dias inativo; o workflow `.github/workflows/supabase-keepalive.yml` faz ping a cada 3 dias (requer os secrets `SUPABASE_URL` e `SUPABASE_ANON_KEY` no GitHub)
- **Tick do Aquecimento:** `.github/workflows/aquecimento-tick.yml` chama `POST /api/aquecimento/tick` a cada ~10 min (Cloudflare Pages não tem Cron Triggers). Requer os secrets `BLUELINE_URL` e `WARMUP_CRON_SECRET` no GitHub, e `WARMUP_CRON_SECRET`/`MAKE_CALLBACK_SECRET`/`MAKE_WEBHOOK_URL_WARMUP` no Cloudflare
