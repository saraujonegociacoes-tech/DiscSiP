# Catálogo de métricas — Dashboard de recebimento de leads

Baseado na análise do relatório real exportado do Pipefy (`novo_relatrio_02-07-2026.xlsx`, 4.212 leads, 96 colunas).

> ⚠ **Recalibrado com dado vivo (03/jul/2026):** este catálogo é do snapshot de 02/jul e alguns números
> envelheceram. A base viva tem **~4.247 leads, 8 agentes, 15 leads com responsabilidade duplicada, ~700
> finalizados** (não 24 agentes / 137 duplicados). O responsável vem do campo **`respons_vel`** e o canal do
> **`capta_o_do_lead`** (já preenchido em leads novos — a métrica de canal está destravando). As métricas em si
> continuam válidas; só os totais mudaram. Ver estado atual em [`sprints-dashboard-leads.md`](sprints-dashboard-leads.md).

---

## 0. Achado importante antes de definir as métricas

O arquivo já traz, para cada fase do pipe, três colunas: *primeira vez que entrou*, *última vez que saiu* e *tempo total na fase (dias)*. Isso é ótimo — significa que boa parte do trabalho de cálculo de tempo já vem pronto do Pipefy, não precisamos recalcular do zero.

Mas dois pontos limitam o que dá pra fazer **hoje**:

- **Canal de origem quase não é preenchido**: a coluna `Captação do Lead` só tem 20 valores preenchidos em 4.212 leads (0,5%). `canal_origem` está 100% vazia. Isso significa que **"qualidade do lead por canal" e "taxa de fechamento por canal" não são calculáveis com o dado atual** — vou incluir essas métricas no catálogo, mas como bloqueadas até esse campo virar obrigatório no formulário/pipe.
- **Um lead pode ter mais de um responsável simultaneamente** (137 dos 4.212 leads têm 2+ pessoas no campo `Responsáveis`, ex: "Guilherme Venturelli, Henrique Paulino"). Isso é uma decisão de modelagem, não só de métrica: precisamos definir se a atribuição de desempenho é ao primeiro responsável, ao último, ou se o lead conta para todos. Fica como pergunta em aberto lá no final.

Fora isso, os dados são ricos: 24 agentes ativos, funil de até 6 tentativas de acionamento antes do descarte, motivo de descarte registrado, e fases pós-venda (Fechamento, Quitação/Negociação, Procedimento).

---

## 1. Estrutura do funil identificada

**Caminho produtivo (o que conta como funil de verdade):**

```
Recebidos → 1° Acionamento → 2° Acionamento → 3° Acionamento → 4° Acionamento
          → 5° Acionamento → 6° Acionamento → Procedimento → Fechamento → Venda
```

**Fases improdutivas (lead morto — não fazem parte do caminho de conversão):**

```
Sem Finalidade   (descarte explícito, com motivo registrado)
Empréstimo       (lead desqualificado — quer produto que não é o foco)
Quitação/Negociação  (idem — tratado como lead morto, não como etapa pré-venda)
```

Qualquer lead que entra em uma dessas três fases é contado como **perdido**, independente de quanto tempo fica lá ou se depois "volta" para o funil. Isso muda a base de cálculo de conversão: antes eu tinha incluído Empréstimo e Quitação/Negociação como pós-venda produtiva — corrigido agora em todo o catálogo abaixo.

- **Recebidos**: entrada do lead, quase instantâneo hoje (apenas 2 leads parados aqui).
- **1° a 6° Acionamento**: funil de tentativas de contato. A maioria dos leads (2.285) está travada em 1° Acionamento — já é um sinal de gap (seção 5).
- **Procedimento → Fechamento → Venda**: reta final do caminho produtivo, depois que o lead avançou pelas tentativas de acionamento.

Apenas 691 dos 4.212 leads (16%) têm `Finalizado em` preenchido — 84% da base está com o funil ainda em aberto.

---

## 2. Métricas de volume e distribuição

| Métrica | Cálculo | Fonte | Visão |
|---|---|---|---|
| Leads recebidos no período | contagem por `Criado em` | Criado em | Agente + Supervisor |
| Leads por fase atual | contagem por `Fase atual` | Fase atual | Ambos |
| Carga por agente | contagem de leads ativos por `Responsáveis` | Responsáveis | Ambos |
| Leads finalizados vs em aberto | `Finalizado em` preenchido ou não | Finalizado em | Supervisor |
| Distribuição de carga entre agentes | desvio da média de leads ativos por agente | Responsáveis | Supervisor |

## 3. Métricas de velocidade / tempo

| Métrica | Cálculo | Fonte | Visão |
|---|---|---|---|
| Tempo até 1º contato | `1° Acionamento - Data+Hora` − `Criado em` | campos de acionamento | Agente + Supervisor |
| Tempo médio por fase (por agente) | média de `Tempo total na fase X (dias)` agrupado por agente | colunas "Tempo total na fase..." | Ambos |
| Tempo médio por fase (equipe) | mesma métrica, agregada geral | idem | Supervisor |
| Ciclo total do lead | `Finalizado em` − `Criado em` (só leads finalizados) | Criado em / Finalizado em | Supervisor |
| Leads parados na fase atual | agora − `Atualizado em`, comparado a um limite (ex: 48h) | Atualizado em | Ambos — é o alerta operacional |

## 4. Métricas de conversão e qualidade

| Métrica | Cálculo | Fonte | Visão |
|---|---|---|---|
| Taxa de conversão geral | leads que chegaram em `Venda` ÷ total | Fase atual (histórico) | Supervisor |
| Taxa de conversão por agente | idem, agrupado por `Responsáveis` | idem | Ambos |
| Taxa de lead morto | leads em `Sem Finalidade` + `Empréstimo` + `Quitação/Negociação` ÷ total | Fase atual | Ambos |
| Taxa de lead morto por agente | idem, agrupado por `Responsáveis` — separa quem recebe leads ruins de quem "perde" lead bom | Fase atual + Responsáveis | Supervisor |
| Motivo do lead morto mais comum | contagem de `Motivo do Descarte` / `Informe o Motivo`, agora cobrindo as 3 fases mortas, não só Sem Finalidade | idem | Supervisor |
| Funil de tentativas (queda por acionamento) | % de leads que avançam de 1º→2º→3º...6º acionamento até Procedimento | fases de acionamento | Supervisor |
| Em qual tentativa o lead mais morre | cruzamento da fase morta com a última fase produtiva antes disso | histórico de fases | Supervisor |

## 5. Indicadores de gap na equipe

| Indicador | Cálculo | Por quê importa |
|---|---|---|
| Leads sem nenhum acionamento após X horas | `Fase atual = Recebidos` ou `1° Acionamento` sem `1° Mensagem enviada` preenchido, tempo > limite | detecta lead esquecido |
| Agentes acima da meta de tempo de resposta | tempo até 1º contato vs meta definida pelo supervisor | prioriza coaching |
| Agentes com leads acumulados numa fase | contagem de leads parados por agente | identifica gargalo individual |
| Taxa de reincidência em lead morto por agente | leads mortos ÷ leads atendidos, por agente | separa "lead ruim" de "atendimento ruim" (cuidado: sem canal confiável, isso ainda mistura os dois motivos) |
| **Leads com mais de um responsável simultâneo** | contagem de leads onde `Responsáveis` tem 2+ nomes, agrupado por quem está envolvido | não deveria acontecer — vira alerta de processo para o supervisor, não uma métrica de desempenho individual |

## 6. Métricas de canal/origem — bloqueadas por dado incompleto

| Métrica | Status |
|---|---|
| Volume de leads por canal | ⚠️ só 0,5% dos leads têm canal preenchido hoje |
| Taxa de conversão por canal | ⚠️ mesma limitação |
| Qualidade do lead por canal (taxa de lead morto) | ⚠️ mesma limitação |

**Ação necessária antes de ativar essas métricas**: tornar `Captação do Lead` (ou `canal_origem`) campo obrigatório na entrada do card no Pipefy, ou garantir que o Meta Ads/formulário já envie esse dado automaticamente no card criado. Sem isso, essas três métricas ficam com dado sujo demais para confiar.

## 7. Ranking do supervisor (agrega o que já foi definido acima)

Um único painel comparando, por agente, lado a lado:
- Volume atendido
- Tempo médio até 1º contato
- Taxa de conversão
- Taxa de lead morto
- Leads parados agora

---

## Sobre "tempo real"

Duas formas de fazer isso no Make + Supabase, com trade-offs diferentes:

- **Webhook do Pipefy no Make** (recomendado): dispara instantaneamente quando um card muda de fase ou é atualizado — não é "de minuto em minuto", é no exato momento da movimentação. O Make grava no Supabase, e o Supabase Realtime empurra a atualização pro dashboard sem o usuário precisar dar refresh.
- **Polling programado no Make**: Make consulta o Pipefy a cada X minutos e sincroniza o que mudou. Mais simples de montar, mas sempre com atraso de até X minutos, e consome mais operações do seu plano do Make.

Dado que você já mencionou "nem que seja de minuto em minuto", a boa notícia é que dá pra fazer melhor que isso sem custo extra de infraestrutura — o webhook é a peça certa aqui.

---

## Decisão: leads com múltiplos responsáveis simultâneos

Confirmado que isso é uma exceção de processo, não um cenário esperado. Regra adotada:

- **Métricas individuais (agente)**: atribuídas ao responsável mais recente listado no campo `Responsáveis` enquanto o card estiver duplicado. Não há rateio nem contagem para todos os envolvidos.
- **Painel do supervisor**: esses 137 leads (3,3% da base atual) aparecem numa lista separada de alerta — "leads com responsabilidade duplicada" — para o supervisor investigar e corrigir a atribuição no Pipefy. Não entram no ranking normal até isso ser resolvido, pra não distorcer a comparação entre agentes.
