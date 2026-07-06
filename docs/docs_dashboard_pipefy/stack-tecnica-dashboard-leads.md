# Stack técnica — Dashboard de recebimento de leads

Documento de referência da stack definida para o dashboard de autoavaliação (agente) e visão gerencial (supervisor), com o que cada peça supre e por quê foi escolhida.

> ⚠ **Atualização (03/jul/2026):** o *plano de dados* (Pipefy → Make → Supabase, RLS + Realtime + Views) foi
> mantido. O que **mudou** ao virar uma seção da Blue Line: o frontend **não é React+Vite no Cloudflare Pages** —
> é uma **rota nativa do Next** (`/leads`) reusando Recharts/Radix/Tailwind/Supabase/RBAC que já existem.
> E o Make **não usa webhook**: é um **poll agendado com filtro delta** (24/7) chamando `rpc/ingest_lead_card`.
> Ver [`sprints-dashboard-leads.md`](sprints-dashboard-leads.md) e [`make-integracao-pipefy.md`](make-integracao-pipefy.md).

---

## Visão geral

```
Pipefy (CRM) → Make (automação) → Supabase (banco + auth + realtime) → Next/Blue Line (frontend)
```

Cada camada resolve um problema específico do conceito. Nenhuma peça é redundante com outra.
*(Nota: o desenho original dizia "Cloudflare Pages"; virou rota do Next na Blue Line — ver atualização acima.)*

---

## 1. Pipefy — fonte de dados (não é uma peça nova)

Continua sendo o sistema onde a operação trabalha. Não sofre alteração — apenas é a origem dos eventos que alimentam o dashboard. As colunas de histórico de fase (`Primeira vez que entrou`, `Última vez que saiu`, `Tempo total na fase`) já vêm prontas de lá, o que reduz o cálculo que precisa ser feito depois.

---

## 2. Make — orquestração e tempo real

**O que supre:**

| Função | Descrição |
|---|---|
| Gatilho em tempo real | Webhook do Pipefy dispara no instante em que um card muda de fase — sem polling, sem atraso de minutos |
| Tradução de evento | Converte "card mudou de fase X para Y" em uma linha gravada em `lead_events` no Supabase |
| Classificação de fase | Marca automaticamente se a fase é produtiva ou "lead morto" (Sem Finalidade / Empréstimo / Quitação-Negociação) antes de gravar, centralizando essa regra num único lugar |
| Tratamento de responsabilidade duplicada | Aplica a regra definida (responsável mais recente + alerta ao supervisor) quando um card tem 2+ responsáveis simultâneos |
| Substituto de backend | Faz o papel que normalmente exigiria um servidor próprio escutando webhooks — aqui é configuração visual, sem infraestrutura extra pra manter |

**Não faz:** não guarda dado permanentemente, não serve o dashboard, não calcula métricas agregadas — só transporta e classifica o evento no momento em que ele acontece.

---

## 3. Supabase — banco, segurança e motor de métricas

Dividido em quatro funções dentro da mesma plataforma:

### 3.1 Postgres (banco relacional)
Guarda as tabelas de fato: `leads`, `lead_events`, `agents`. É a fonte de verdade de todo o dashboard.

### 3.2 Row Level Security (RLS)
Resolve o requisito central de ter duas visões diferentes (agente vs supervisor) sem duplicar lógica de permissão no frontend. A regra de acesso fica no banco: um agente autenticado não consegue puxar dado de outro agente, mesmo tentando manipular a consulta. O supervisor tem uma policy liberando a visão completa.

### 3.3 Realtime
Segunda metade do requisito de "tempo real". O Make grava o evento assim que ele acontece; o Realtime empurra essa atualização pra tela aberta do usuário, sem precisar de F5.

### 3.4 Views / views materializadas
As métricas do catálogo (tempo médio por fase, taxa de lead morto, funil de acionamento, ranking) são calculadas uma vez no banco via SQL, não recalculadas no frontend a cada carregamento de tela. O frontend só lê o resultado pronto — o que também protege o consumo de egress do plano gratuito (ver seção 6).

**Limitação aceita por ora:** plano gratuito não tem backup automático. Mitigação enquanto estiver no Free: rotina agendada no Make fazendo `pg_dump` periódico para um storage externo (ex: Cloudflare R2). Migrar para o Pro (US$25/mês) quando o dashboard virar rotina operacional diária, principalmente por causa do backup.

---

## 4. Cloudflare Pages — hospedagem do frontend

**O que supre:** serve os arquivos estáticos (HTML/JS/CSS) do dashboard, com HTTPS, sem servidor próprio para manter ou pagar rodando 24/7.

**O que não faz (de propósito):** não guarda dado, não roda lógica de negócio, não fala diretamente com o Pipefy. Toda a inteligência mora no Supabase — o Cloudflare Pages só entrega os arquivos já prontos.

---

## 5. Frontend (código, não ferramenta contratada)

| Peça | Função |
|---|---|
| React + Vite | Monta as telas (autoavaliação do agente, ranking do supervisor) e gera os arquivos estáticos que vão pro Cloudflare Pages |
| `@supabase/supabase-js` | Biblioteca de comunicação com o Supabase — login, consulta às views, inscrição no Realtime |
| Recharts | Gráficos (funil de acionamento, tempo por fase, ranking de agentes) |

Construído com Claude Code, dentro do VS Code.

---

## 6. Viabilidade no plano gratuito do Supabase (checado em jul/2026)

| Item | Limite Free | Situação no seu cenário |
|---|---|---|
| Banco de dados | 500 MB | Folgado — milhares de leads/eventos ocupam poucos MB |
| Egress (transferência/mês) | 5 GB | Folgado, **desde que** o frontend leia views agregadas em vez de tabelas brutas |
| Conexões simultâneas Realtime | 200 | Folgado — equipe de ~24 pessoas |
| Mensagens Realtime/mês | 2.000.000 | Folgado |
| Projetos ativos | 2 | Suficiente — um projeto já resolve |
| Pausa por inatividade | 7 dias sem requisição | Não é risco — o Make grava toda vez que um card muda |
| Backup automático | Nenhum | **Único ponto real de atenção** — mitigar com backup manual agendado até migrar para o Pro |

**Veredito:** viável para construir e validar com a equipe atual. Migrar para o plano Pro quando o dashboard deixar de ser protótipo e virar dependência diária da operação — principalmente pelo backup, os demais limites não devem ser sentidos no volume atual.

---

## Resumo de uma linha por peça

| Peça | Resolve |
|---|---|
| Pipefy | Fonte dos leads e eventos |
| Make | Traduz eventos do Pipefy e dispara em tempo real |
| Supabase — Postgres | Guarda os dados |
| Supabase — RLS | Garante que agente só vê o próprio dado |
| Supabase — Realtime | Atualiza a tela sem refresh |
| Supabase — Views | Calcula as métricas uma vez, não a cada carregamento |
| Cloudflare Pages | Hospeda o dashboard, sem servidor próprio |
| React + Vite + Recharts | Código do dashboard em si |
