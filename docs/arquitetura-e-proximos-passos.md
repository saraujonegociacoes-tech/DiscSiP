# DiscSiP — Documentação Técnica

> Atualizado em: 2026-06-09

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

---

## 6. Banco de Dados — Schema (Supabase)

### Tabelas

- `agents` — agentes (ramais 5125–5150, nome, role)
- `campaigns` — campanhas de discagem
- `campaign_contacts` — contatos de cada campanha com status de discagem
- `call_logs` — registro histórico de chamadas por agente

### Status de contato (`ContactStatus`)

```
pending → dialing → answered | no_answer | busy | failed | do_not_call
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
| Sprint 5 | Supervisor Dashboard | 🔜 **PRÓXIMO** |
| Sprint 6 | Estados de erro, polish e Make | 🔜 Futuro |

---

## ⚡ SPRINT 5 — Supervisor Dashboard

### Objetivo

Criar uma visão gerencial em `/dashboard` onde o supervisor vê em tempo real: métricas das campanhas, status dos agentes e volume de chamadas.

### Referência visual

Ver `visual/imagem_prototipo.png` — painel à esquerda com sidebar expandida, métricas no topo, gráfico de chamadas no centro, lista de agentes à direita.

### Tarefas

#### 5.1 — Sidebar: adicionar navegação

Atualizar `src/components/Sidebar.tsx`:
```
/softphone  → "Dialer"     (agentes)
/dashboard  → "Dashboard"  (supervisor)
```

#### 5.2 — Nova rota `/dashboard`

Criar `src/app/dashboard/page.tsx` (Server Component) e `src/app/dashboard/DashboardClient.tsx` (`'use client'`).

Layout: grid de métricas no topo + gráfico + lista de agentes.

#### 5.3 — Server Actions para métricas

Criar `src/app/actions/supervisor.ts`:
- `getDashboardStats()` — total de contatos, % contatados, chamadas hoje, agentes ativos
- `getCampaignsSummary()` — lista de campanhas com stats resumidos
- `getRecentActivity()` — últimas 50 chamadas de todos os agentes

#### 5.4 — Cards de métricas

Componente `src/app/dashboard/MetricCard.tsx`:
- Total de contatos na fila
- Chamadas hoje
- Taxa de atendimento (%)
- Agentes ativos

#### 5.5 — Gráfico de chamadas

Instalar `recharts` e criar componente de gráfico de linha com chamadas por hora do dia atual.

#### 5.6 — Lista de agentes

Buscar `call_logs` recentes agrupados por agente para mostrar quem está ativo e status da última chamada.

### Banco de dados — queries necessárias (sem migração)

Todas as queries usam tabelas já existentes (`call_logs`, `campaign_contacts`, `agents`). Nenhuma migração necessária para Sprint 5.

---

## ⚡ SPRINT 6 — Polish e Make

### Objetivo

Estabilizar a experiência do agente e conectar automações externas via Make.

### Tarefas

#### 6.1 — Estados de erro e borda

- Helper offline: bloquear início de discagem com mensagem clara
- Sem contatos pendentes: mensagem ao tentar iniciar campanha vazia
- Falha de rede: retry automático no `getNextContact`

#### 6.2 — Estados vazios e loading

- Skeleton loading nas listas de campanha
- Empty state quando não há campanhas
- Empty state no histórico

#### 6.3 — Make: importação de contatos

Criar webhook endpoint `src/app/api/contacts/import/route.ts`:
- Recebe lista de contatos via Make (Google Sheets → DiscSiP)
- Adiciona à campanha especificada
- Autenticação por header `x-webhook-key`

#### 6.4 — Make: notificação pós-chamada

Cenário Make: quando disposição = "Interessado", enviar notificação (WhatsApp / email) para o gerente.

---

## 8. Estrutura de Arquivos

```
src/
├── app/
│   ├── actions/
│   │   ├── dialer.ts        Server Actions: login ramal, salvar chamada, histórico
│   │   └── campaigns.ts     Server Actions: campanhas e contatos
│   └── softphone/
│       ├── page.tsx         Wrapper SSR desabilitado
│       ├── SoftphoneClient.tsx  Layout principal, login, banner de chamada
│       ├── DialerTab.tsx    UI das campanhas e controles do dialer
│       └── CallHistory.tsx  Histórico de chamadas do agente
├── hooks/
│   └── usePowerDialer.ts    Lógica da fila: dialNext, start, pause, submitDisposition
├── store/
│   ├── softphoneStore.ts    Estado do agente e da chamada atual
│   └── dialerStore.ts       Estado da campanha e do dialer
├── lib/
│   ├── constants.ts         HELPER_URL compartilhado
│   ├── types/database.ts    Types TypeScript das tabelas Supabase
│   └── supabase/            Clientes Supabase (client e server)
local-helper/
├── index.js                 Helper Node.js
├── package.json
├── start.bat                Iniciar manualmente
└── instalar.bat             Instalação completa + startup Windows
```
