# Página 2 (Equipe) — export CSV nas duas seções

**Data:** 2026-08-12 · **Pedido do dono** · **Sem migration** (nenhum dado novo; a
`get_cs_team` já devolve tudo) · **Frontend:** `CsTeam.tsx`.

## O pedido

> "Preciso de um botão de exportar na aba de equipes também. Com o mesmo padrão de URL."

A Página 2 era a **única aba do painel sem export** — a regra "URL do card em toda exportação"
de 11/ago pegou Matriz, Minutas, Pagamento e Minutas Processuais
([`../fixes/pagamento-projecao-so-na-fase-e-url-no-csv.md`](../fixes/pagamento-projecao-so-na-fase-e-url-no-csv.md)),
mas a Equipe não tinha botão nenhum pra receber a regra.

## Dois arquivos, não um — as seções não têm a mesma granularidade

A aba tem duas tabelas que respondem perguntas diferentes e **não compartilham eixo** (uma é
por responsável **do card**, a outra por responsável **pela negociação** — divergem de
propósito). Juntar as duas numa planilha só produziria uma tabela que não soma nem filtra
direito. Então: **um botão por seção**, no cabeçalho de cada uma.

| Seção | Uma linha por | URL do card? |
|---|---|---|
| **Negociações feitas no período** | **card** | ✅ primeira coluna |
| **Movimento no período** | **responsável** | ❌ não existe card por trás da linha |

### Negociações — a regra da URL aplicada

`URL do card · ID · Cliente · Responsável pela negociação · Completude · Campos faltando ·
Qtd. faltando · Período (início) · Período (fim)`

Achata os agentes em linhas de card. **Não duplica linha**: o agrupamento é pelo valor do campo
da fase (`quem_realizou_a_negocia_o`), então cada card aparece sob **um único** negociador.

"Campos faltando" sai com os rótulos dos 5 campos vazios (`Q.A, P.V`) e a contagem ao lado, que
é o que torna a planilha acionável — dá pra ordenar por "quem está mais incompleto" sem abrir
card nenhum.

**Exporta o período inteiro, não o drill aberto.** As colunas "Responsável" e "Completude" já
deixam refazer qualquer recorte no Excel, e assim o arquivo não depende de um estado que não
aparece no CSV — botão que exporta coisa diferente conforme o que está selecionado é o tipo de
surpresa que faz a pessoa conferir duas vezes. Está dito no `title` do botão.

### Movimento — sem URL, e isso é limitação de dado, não esquecimento

`Responsável · Recebidos · Movimentados (total) · Movido c/ atualização · Movido s/ atualização ·
Só atualização · Sem mover/atualizar · Período (início) · Período (fim)`

A `get_cs_team` devolve só as **contagens** por responsável nessa seção (`CsTeamMovementAgent` é
`agentId + agentName + 5 números`) — **não existe id de card** no payload do movimento, diferente
das negociações, onde `cards[]` alimenta o drill. Não há o que linkar.

> **Se a URL for necessária aqui**, o caminho é a RPC passar a devolver os cards do movimento
> (como já faz nas negociações) — não inventar link no front. É mudança de migration + payload,
> fora do escopo deste pedido. **Decisão do dono.**

"Movimentados (total)" (= `movido c/` + `movido s/`) entra como coluna própria porque é o número
que o KPI da tela mostra; sem ele, quem abre a planilha refaz a soma na mão.

## Detalhes

- **Nome do arquivo:** `cs-equipe-negociacoes-<início>_<fim>.csv` e
  `cs-equipe-movimento-<início>_<fim>.csv`, com as datas ISO do período. Usa `periodStart`/
  `periodEnd` crus, **não** o `period.label` ("Ciclo 11/10 · ago/26"), que tem espaço, barra e
  `·` — caracteres que não sobrevivem a nome de arquivo. O período também vai em **duas colunas
  no CSV**, pra planilha solta não perder o contexto.
- **Formato:** `src/lib/csv.ts` (`;`, BOM UTF-8, aspas só quando precisa) — o mesmo escritor das
  outras abas, nada duplicado.
- **Botão desabilitado** enquanto carrega ou quando a seção está vazia, igual ao das outras abas.
- **CPU:** as linhas são montadas **no clique**, não em `useMemo` — export é evento raro, e
  memoizar as linhas custaria a montagem a cada troca de período mesmo sem ninguém exportar.

## Segurança

Nada de `localStorage`/`sessionStorage`, nenhuma env nova, nenhuma rota nova: o CSV é montado em
memória no cliente e baixado via `Blob` + `URL.revokeObjectURL` (o escritor já revoga). Os dados
exportados são **os mesmos que a tela já mostrou** — o RLS de `cs_cards` escopou na leitura, e o
export não refaz consulta nem alarga escopo. Nome de cliente é dado sensível: a planilha sai da
esteira e vira arquivo solto na máquina de quem baixou — vale o mesmo cuidado das outras abas.

## Arquivos

- `src/features/cs/components/CsTeam.tsx` — `exportNegociacoes()` / `exportMovimento()`,
  `classLabel()`, `periodSlug()` e os dois botões nos cabeçalhos das seções.
