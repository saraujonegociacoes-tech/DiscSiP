# Panorama visual — Dashboard de leads (Agente v1)

Análise da proposta visual recebida (paleta, tipografia, animação e layout), à parte da discussão sobre dado/arquitetura já registrada em outro documento.

> ⚠ **Decisão (03/jul/2026):** a seção usará o **design system que já existe na Blue Line** (`theme.tsx`,
> `useChartTheme.ts`, `KpiCard`, tokens theme-aware), **não** a paleta "Midnight Indigo" — para não virar uma
> ilha visual dentro do app. Esta análise segue útil como referência de tom (count-up sóbrio, som opt-in), mas a
> paleta/base vem do app. Ver princípios em [`sprints-dashboard-leads.md`](sprints-dashboard-leads.md).

---

## O que foi proposto

**Paleta — Midnight Indigo**: fundo quase preto azulado (`#0a0a1a`), cards em indigo escuro, um roxo/indigo vibrante (`#4f46e5`) como cor primária com gradiente para hero e CTAs, sombras com glow colorido.

**Tipografia**: Sora para headings, Manrope para corpo/UI, números de KPI em Sora 700 com tabular-nums.

**Animação**: transições rápidas (150–200ms), contadores com count-up, cards entrando com fade+slide, hover com leve scale e brilho de borda, toast de realtime com som opcional.

**Layout**: topbar fixa translúcida → hero "fila de ação" com lead prioritário e SLA regressivo → 4 KPIs grandes com count-up → funil pessoal + donut de motivos de descarte → tabela de leads.

---

## Análise

### Paleta

Escuro + glow indigo é uma linguagem visual de produto SaaS de consumo — comum em ferramentas de growth, analytics voltadas a "impressionar", ou apps que vendem a sensação de estar num painel futurista. Não é errado em si, mas é uma escolha de **registro**, e vale nomear o que ela comunica: energia, urgência, "modo foco". É a linguagem certa para uma tela que existe para acelerar ação em tempo real (bate com o conceito de "fila de acionamento").

Onde isso pode atritar: essa mesma tela é usada para **autoavaliação**, inclusive em dias ruins — taxa de lead morto alta, meta longe de bater. Um fundo quase preto com glow e cores vibrantes tende a deixar tudo com a mesma intensidade visual, dia bom ou ruim. Um painel de autoavaliação costuma pedir uma paleta mais neutra, que deixa o dado falar por si (é a direção que segui no mockup anterior: fundo claro, cor só como sinal semântico — teal para produtivo, coral para lead morto, âmbar para alerta). As duas linguagens são legítimas; a pergunta é qual tom vocês querem que o agente sinta ao abrir a tela todo dia.

### Tipografia

Sora + Manrope é um par sólido e bem executado — as duas são geométricas, contemporâneas, combinam entre si sem disputar atenção. Números de KPI em tabular-nums é o detalhe certo (evita números "dançando" ao atualizar). Sem ressalva aqui, é uma escolha bem fundamentada tecnicamente.

### Animação

Count-up nos KPIs, fade+slide ao montar, hover com glow: tecnicamente bem escolhido (durações curtas, easing correto, nada exagerado isoladamente). O ponto de atenção não é a execução, é o acúmulo: quando **toda** métrica anima, todo card tem hover-glow e todo evento novo toca um som, a tela fica com uma cadência de "produto que celebra constantemente". Vale decidir deliberadamente quais elementos merecem esse destaque (ex: uma venda fechada pode merecer celebração; um lead comum entrando na fila, provavelmente não) em vez de aplicar o mesmo tratamento a tudo por padrão.

O som no toast é o ponto mais sensível dessa lista — está corretamente proposto como opt-in (desligado por padrão), o que é a escolha certa. Mantém a decisão nas mãos do agente.

### Layout — hero "fila de ação"

Visualmente, dar 2/3 da tela acima da dobra para um único lead prioritário com timer regressivo é uma escolha forte e coerente *se* o objetivo real da tela é prescrever a próxima ação (o que é uma proposta de produto diferente de um dashboard de acompanhamento passivo — isso já foi sinalizado à parte). Do ponto de vista puramente visual, o risco é de hierarquia: um hero grande e chamativo empurra o funil pessoal e a tabela de leads para depois da segunda dobra, quando esses dois elementos carregam a maior parte do catálogo de métricas que foi fechado. Vale checar se essa é mesmo a ordem de prioridade visual desejada, ou se o SLA de um único lead está ocupando espaço desproporcional ao seu peso real na rotina do agente.

O restante do layout (KPIs em grid, funil horizontal, tabela filtrável) é uma estrutura comum e testada para esse tipo de conteúdo — não tem nada de arriscado ali.

---

## Resumo

| Elemento | Avaliação |
|---|---|
| Paleta Midnight Indigo | Bem executada, mas é a linguagem de "produto de crescimento/urgência" — vale confirmar se é o tom certo para uma tela de autoavaliação diária |
| Tipografia (Sora + Manrope) | Sólida, sem ressalva |
| Animação | Bem executada isoladamente; risco é o acúmulo deixar tudo com o mesmo grau de destaque |
| Som no toast | Resolvido corretamente (opt-in, desligado por padrão) |
| Hero "fila de ação" | Visualmente forte, mas desloca funil e tabela para depois da dobra — checar se é a prioridade certa |

Nenhum desses pontos é um erro técnico — são decisões de tom que vale confirmar conscientemente antes de codar, porque são caras de reverter depois que o design system estiver todo implementado.
