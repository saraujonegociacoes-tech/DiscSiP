# Ingestão sob demanda — o botão "Atualizar" no lugar dos cenários do Make

> **04/set/2026.** Os 4 cenários agendados do Make que mantinham os painéis sincronizados com o
> Pipefy saem do ar. A ingestão passa a acontecer quando alguém clica em **Atualizar** no painel,
> e o Blue Desk consulta o Pipefy por conta própria. Decisão do dono, por custo: os cenários
> rodavam 48 vezes por dia cada um, quase sempre para não trazer card nenhum.

---

## A conta que motivou a mudança

Cada rodada de um cenário consome operações do Make mesmo quando o delta volta vazio: o módulo
GraphQL executa (1 op) e o Iterator executa (1 op). São ~2 ops por rodada ociosa.

```
4 cenários × 48 rodadas/dia × 2 ops = ~384 ops/dia = ~11.500 ops/mês
```

Onze mil operações por mês **sem um único card ter mudado**. Esse piso é metade da conta, e some
inteiro no modelo sob demanda: sem clique, não há chamada. A outra metade (2 ops por card que
mudou) também encolhe, porque um clique lê num lote o que o poll lia em 48 fatias.

## O que sai e o que fica

| Cenário | Pipe | Situação |
|---|---|---|
| Leads | `307104305` | **sai** — substituído pelo botão em `/leads` |
| CS | `305801110` | **sai** — botão em `/cs` |
| Financeiro | `304386356` | **sai** — botão em `/ceo` |
| Negociação | `304370275` | **sai** — botão em `/ceo` |
| `Aquecimento · Disparo` | — | **fica**. É webhook: só roda quando o tick chama. Ver [`make-integracao-aquecimento.md`](../../warmup-docs/updates/make-integracao-aquecimento.md) |
| Notificação pós-chamada | — | **sai junto com a discadora** (`MAKE_WEBHOOK_URL`) |

### O segundo poll do CS, que também foi replicado

O cenário do CS tinha uma quinta peça: o balde **"Aguardando Pagamento"** (fase `343781769`)
relido INTEIRO, sem filtro de delta. Ele existe porque a conexão do pagamento é feita do lado do
**Financeiro** e **não mexe no `updated_at` do card do CS** — o delta sozinho nunca enxergaria o
pagamento novo, e a aba Pagamento pararia no tempo sem ninguém perceber. No código ele é a fonte
`cs_pagamento` (mesma RPC, mesmo node cru, filtro de fase no lugar do delta), e o botão do `/cs`
leva as duas fontes.

> ⚠️ **A Negociação tem exposição parecida, e de propósito não foi coberta.** O
> [doc dela](../../projetopainelceo-docs/updates/make-integracao-negociacao.md) registra que, se a
> projeção um dia ficar presa mostrando card que já saiu da fase, a saída é a mesma receita: poll
> da fase `326422800` inteira. Lá mover o card MEXE no `updated_at`, então o delta pega — fica
> anotado como o primeiro suspeito, e não como pendência aberta.

**Nenhuma RPC de ingestão foi tocada.** `ingest_lead_card`, `ingest_cs_card`,
`ingest_financeiro_card` e `ingest_negociacao_card` continuam exatamente como estavam — o mesmo
caminho que o Make usava e que os `scripts/import-*.mjs` da carga histórica usam. O que mudou é
**quem chama**, e a partir de quando.

Isso é o que torna a troca barata: o Make nunca fez o trabalho pesado. Traduzir campo por
field-id, fazer upsert, classificar fase, deduplicar — tudo isso sempre morou no SQL, por decisão
de projeto. O Make era um cron hospedado com um cliente HTTP em cima. É o cron que estava sendo
pago.

---

## O modelo: uma consulta por rodada, não uma por pessoa

O risco óbvio de trocar poll por botão é o contrário do que se quer: três pessoas abrindo o
painel viram três varreduras do pipe ao mesmo tempo. O desenho abaixo (definido pelo dono) evita
isso — **N pedidos simultâneos viram UMA consulta ao Pipefy, e todos recebem o mesmo resultado**.
É coalescência de requisições.

```
        Refresh do painel  (pessoas A, B, C)
                  │
                  ▼
         ┌─────────────────────────────┐
         │  Existe refresh a menos     │
         │  de 5 min?                  │
         └──────────┬──────────────────┘
             NÃO    │    SIM
              │     │     └──────────────┐
              ▼                          ▼
       inicia o refresh          conecta ao refresh
              │                   existente e aguarda
              ▼                          │
      consulta o Pipefy                  │
              │                          │
              ▼                          │
       atualiza os dados                 │
              │                          │
              ▼                          │
       resultado pronto ◄────────────────┘
              │
      ┌───────┼───────┐
      ▼       ▼       ▼
      A       B       C
```

O nó do meio cobre **duas** situações que terminam diferente:

- **Refresh em andamento** → conecta e aguarda o fim.
- **Refresh concluído há menos de 5 min** → o dado já está no banco. Espera zero: responde na hora.

Nos dois casos o Pipefy é consultado uma vez só.

### Os quatro estados

O que a rota devolve, e o que o botão mostra:

| Estado | Quando | Na tela |
|---|---|---|
| `iniciado` | você venceu a corrida e está executando | `Atualizando… 312 cards` |
| `aguardando` | outra pessoa está executando | `Atualizando…` + "outra pessoa já está atualizando" |
| `recente` | concluída há menos de 5 min | `Atualizado agora`, desabilitado, com o relógio até liberar |
| `erro_recente` | a última tentativa falhou há menos de 1 min | `Tentar de novo` + o motivo |

---

## A trava e o cooldown moram na mesma instrução

Esta é a parte que precisa ficar clara para ninguém "simplificar" depois.

**Cooldown sozinho não resolve.** Duas pessoas clicando no mesmo segundo leem as duas "a última
rodada foi há 10 minutos", as duas passam pela regra, e você tem duas varreduras concorrentes.
Cooldown responde por **frequência**; falta responder por **simultaneidade**, e isso é trava.

As duas regras cabem no mesmo `UPDATE`, e é a atomicidade dele que dá a garantia — um `SELECT`
seguido de um `UPDATE` teria uma janela de corrida entre os dois:

```sql
UPDATE public.sync_state s
   SET rodando = true, token = gen_random_uuid(), lock_ate = now() + interval '2 minutes', …
 WHERE s.fonte = $1
   AND (s.rodando = false OR s.lock_ate <= now())                    -- trava
   AND COALESCE(s.last_ok_at, '-infinity') <= now() - interval '5 min'  -- cooldown
   AND COALESCE(s.last_erro_at, '-infinity') <= now() - interval '60 s' -- guarda de erro
RETURNING *;
```

Quem recebe a linha executa. Quem recebe zero linhas aguarda. É `sync_claim`, na migration
[`20260904_sync_on_demand.sql`](../../../supabase/migrations/Migrations_ingestao/20260904_sync_on_demand.sql).

### ⚠️ Por que isso NÃO pode viver na aplicação

A app roda em Workers da Cloudflare (Next via OpenNext). **Cada invocação é isolada.** Um `Map`,
um cache de promise, um mutex em memória — tudo isso morre com a invocação e não é enxergado pelo
Worker que atende a próxima pessoa, possivelmente em outra localidade. Um single-flight feito em
memória aqui daria certo em `npm run dev` e falharia em produção exatamente sob concorrência, que
é o caso que ele existe para cobrir.

A fila é **uma linha no Postgres**, e o Postgres é o árbitro. A rota só repassa o veredito.

### A guarda de erro (1 min)

O cooldown conta a partir de `last_ok_at` — a última rodada **concluída**. Uma rodada que falhou
no meio não pune ninguém com 5 minutos de espera. Mas também não pode liberar retry instantâneo,
senão um erro do Pipefy vira loop de marteladas: daí a guarda separada de 60 segundos.

---

## As três marcas de tempo

Confundir estas três é o jeito mais fácil de perder dado em silêncio.

| Campo | O que é |
|---|---|
| `watermark` | **Confirmada.** O `since` da próxima rodada. Só avança em `sync_finish` |
| `janela_desde` | O `since` da rodada **em curso**. Congelado do início ao fim, para a paginação ser coerente |
| `run_iniciado_em` | Quando a rodada em curso começou. Vira a `watermark` no fim |

**A `watermark` fecha no INÍCIO da rodada, não no fim.** Um card editado *durante* a rodada pode
ter caído numa página que já passou; fechando a janela no início, ele entra na próxima. Por cima
disso ainda há 2 minutos de overlap. Reprocessar é inofensivo — as RPCs são idempotentes.

**Rodada que falha não avança nada.** A janela inteira é relida no próximo clique.

### ⚠️ O que isto substituiu, e por que precisava substituir

Os cenários do Make usavam `since = formatDate(addMinutes(now; -35))` — uma janela fixa de 35
minutos, calibrada para o poll de 30. Essa fórmula **só funciona colada num agendamento fixo**.
Num modelo sob demanda ela seria uma perda de dados silenciosa: tudo que mudou fora dos últimos
35 minutos antes do clique nunca mais seria lido, porque o card só voltaria a aparecer se alguém
o editasse de novo no Pipefy.

A semente da `watermark` inicial sai de `max(synced_at)` de cada tabela — o ponto exato onde o
cenário do Make parou. A primeira rodada sob demanda continua de onde ele deixou, sem buraco e
sem reler o pipe inteiro.

---

## Uma invocação do Worker = uma página

O plano **Cloudflare Pages Free** dá ~10 ms de CPU e **50 subrequests** por invocação (é o mesmo
teto do [Error 1102](../../discadora-docs/fixes/correcao-cpu-cloudflare-1102.md)). Uma página de
30 cards custa 31 subrequests: 1 GraphQL + 30 POSTs na RPC. Duas páginas não cabem.

Então **quem executa encadeia invocações**: a cada página, o cliente chama a rota de novo com o
mesmo token, e cada chamada é uma invocação nova com orçamento novo.

```
POST /api/sync/cs            → { status:'iniciado', done:false, token, cards:30 }
POST /api/sync/cs  {token}   → { status:'iniciado', done:false, token, cards:60 }
POST /api/sync/cs  {token}   → { status:'pronto',   done:true,  cards:74 }
```

**A rodada não tem teto.** Ela vai até `hasNextPage = false`. O fatiamento é transporte, invisível
para quem aguarda: eles só veem o contador subir e depois `pronto`. Parar no meio quebraria o
contrato "resultado pronto" do modelo — quem aguardou receberia dado parcial.

### Retomada: quem aguarda também tenta reivindicar

Quem está no estado `aguardando` chama a rota a cada 3 segundos. Cada chamada é **uma nova
tentativa de reivindicação**, e é isso que dá a recuperação de graça:

> A pessoa que estava executando fecha a aba no meio da rodada. Em até 2 minutos o `lock_ate`
> expira. Na chamada seguinte, quem estava aguardando **assume** a rodada — do `cursor_atual`
> salvo, com a mesma `janela_desde` — e a leva até o fim.

A rodada se conclui sozinha, e ninguém vê estado parcial porque a tela só recarrega no `pronto`.

O `lock_ate` com expiração é o que impede uma fonte de ficar travada para sempre por um Worker
que morreu. Nunca troque a trava por um booleano sem prazo.

---

## Anatomia

| Arquivo | Papel |
|---|---|
| [`20260904_sync_on_demand.sql`](../../../supabase/migrations/Migrations_ingestao/20260904_sync_on_demand.sql) | `sync_state` + `sync_claim` / `sync_progress` / `sync_finish` / `sync_fail`. **A garantia inteira mora aqui** |
| [`src/lib/sync/fontes.ts`](../../../src/lib/sync/fontes.ts) | As 4 fontes: pipe, RPC, query delta e quem pode disparar |
| [`src/lib/sync/executar.ts`](../../../src/lib/sync/executar.ts) | Uma página: GraphQL no Pipefy → node cru para a RPC |
| [`src/app/api/sync/[fonte]/route.ts`](../../../src/app/api/sync/%5Bfonte%5D/route.ts) | `POST` uma página · `GET` estado. Autoriza espelhando o gate do painel |
| [`src/features/sync/useSincronizacao.ts`](../../../src/features/sync/useSincronizacao.ts) | O encadeamento das páginas e a espera |
| [`src/features/sync/BotaoAtualizar.tsx`](../../../src/features/sync/BotaoAtualizar.tsx) | O botão e os quatro estados |

O botão do `/ceo` leva **duas** fontes (`financeiro` e `negociacao`), porque o painel come de dois
pipes: a aba Financeiro sai de `fin_entries` e a de Projeções de `neg_cards`. Atualizar só uma
deixaria o painel internamente incoerente.

### Autorização

O middleware protege `/api/sync` (a rota não está nas exceções do matcher), então a requisição já
chega com sessão. O que falta é o **papel**, que o middleware só confere por prefixo de página —
por isso a rota repete a checagem, espelhando o gate de cada painel. Sem isso, um agente do CS
conseguiria disparar a ingestão do Financeiro.

---

## Para ligar

1. **Aplicar a migration** `20260904_sync_on_demand.sql` no SQL Editor. Ela semeia as 4 linhas de
   `sync_state` a partir de `max(synced_at)` de cada tabela.
2. **⚠️ Publicar os segredos no Cloudflare:** `PIPEFY_TOKEN` e `SUPABASE_SERVICE_ROLE_KEY` como
   Secret. Até agora o `PIPEFY_TOKEN` só existia no `.env.local` (era de CLI); a ingestão sob
   demanda consulta o Pipefy **do servidor**. Sem isso o botão funciona em local e devolve
   `PIPEFY_TOKEN ausente no ambiente` em produção — erro que só aparece no deploy.
3. **Deixar os cenários do Make LIGADOS** durante a validação. Os dois caminhos rodando juntos não
   duplicam nada (a ingestão é idempotente por `pipefy_card_id`).
4. **Validar por uma semana**: clicar em cada painel, conferir `sync_state` e rodar
   `npm run verify:financeiro` (read-only, relê o pipe inteiro e compara card a card). Aceite: 0
   divergências.
5. **Só então** desligar os 4 cenários no Make.

## Como conferir

```sql
-- Estado das 4 fontes
SELECT fonte, watermark, rodando, last_ok_at, cards, last_erro FROM public.sync_state;

-- Frescor por vertical (o mesmo sinal de antes, que agora depende do clique)
SELECT max(synced_at) FROM public.fin_cards;

-- Destravar à mão (a expiração de 2 min já faz isso sozinha; é só para emergência)
UPDATE public.sync_state SET rodando = false, token = NULL, lock_ate = NULL WHERE fonte = 'cs';
```

```bash
npm run verify:financeiro   # read-only, card a card
npm run verify:negociacao
```

---

## Armadilhas (registradas para não voltarem)

- **Não coloque o sync no carregamento da página.** Ele é ação de clique. Abrir o painel dispara
  zero sincronização — é isso que garante que duas pessoas abrindo juntas não custem nada.
- **Não faça o single-flight em memória no Worker.** Ver a seção da trava.
- **Não aumente `SYNC_PAGE_SIZE` acima de 40.** O código corta em 40, e o limite real é 49
  (50 subrequests menos a chamada GraphQL). Passar disso quebraria só em produção.
- **Não trate falha parcial como sucesso.** Se 3 de 30 cards não entraram e a rodada fosse dada
  por boa, a `watermark` avançaria por cima deles e esses 3 sumiriam para sempre. Por isso
  `sincronizarPagina` derruba a rodada inteira quando qualquer card falha.
- **Se mexer numa query GraphQL, mexa nos dois lugares.** As queries daqui são as dos
  `scripts/import-*.mjs` mais o filtro delta. Pedir um campo a menos quebra a RPC em silêncio —
  ela lê o que não veio como ausente.

## O que ficou de fora, de propósito

- **Cron de segurança.** Sem ninguém clicar, o painel fica parado — o que é o comportamento
  pedido. Se um dia incomodar, um workflow do GitHub Actions batendo a rota resolve, e continua
  sem tocar no Make. Exige abrir um caminho de autenticação por segredo na rota (hoje ela é só de
  sessão), no mesmo molde do [`aquecimento-tick.yml`](../../../.github/workflows/aquecimento-tick.yml).
- **RPC em lote.** Hoje é um POST por card. Uma `ingest_*_cards(nodes jsonb)` faria a página
  inteira num POST: menos subrequests e páginas maiores. Vale a pena se o volume por rodada
  crescer; não vale agora, porque exigiria mexer nas 4 RPCs que estão provadas em produção.

## Referências

- [`make-integracao-pipefy.md`](../../painelleads-docs/updates/make-integracao-pipefy.md) · [`make-integracao-cs.md`](../../painelcs-docs/updates/make-integracao-cs.md) · [`make-integracao-financeiro.md`](../../projetopainelceo-docs/updates/make-integracao-financeiro.md) · [`make-integracao-negociacao.md`](../../projetopainelceo-docs/updates/make-integracao-negociacao.md) — os cenários que saíram. Ficam como registro do desenho e da config.
- [`correcao-cpu-cloudflare-1102.md`](../../discadora-docs/fixes/correcao-cpu-cloudflare-1102.md) — o orçamento de CPU do Worker que explica o fatiamento por página.
