# Auditoria de performance — agosto/2026

**Data:** 2026-08-03/04 · **Branch:** `branch-minutas` · **Status:** código pronto e verde
(build + `tsc` + `eslint`), **aguardando commit e deploy**. A migration de índices **já foi
aplicada** pelo dono.

Auditoria técnica transversal (bundle, backend, banco, arquitetura, segurança) com as correções
de maior impacto implementadas. Todo número aqui saiu de `next build` antes/depois — nenhuma
mudança foi feita por suposição.

---

## 1. O que o diagnóstico encontrou

O código está acima da média: zero `any`, zero `TODO`/`FIXME`, comentários explicando *por que*,
agregação empurrada para o Postgres via RPC, paginação contra o teto de 1000 linhas do PostgREST,
degradação graciosa quando a migration não rodou, e RLS como barreira real de dados.

**Nenhum problema de segurança encontrado:** sem secrets versionados (`.env.local` no
`.gitignore`), sem injeção de SQL (PostgREST parametrizado; o único filtro montado por string
passa por `sanitizePeriod()`), comparação de tempo constante nos webhooks do Warmup, e a
`service_role` isolada de contexto de usuário.

Os gargalos reais eram **dois**, ambos invisíveis lendo componente por componente:
**bibliotecas pesadas no caminho crítico** e **idas ao Supabase enfileiradas**.

### P1 · `@supabase/ssr` no First Load JS de toda tela interna — Grave

| | |
|---|---|
| **Arquivo** | `src/components/notifications/notification-bell.tsx` (import no topo) |
| **Causa** | O `NotificationBell` mora no `AppShell`, ou seja, em toda tela interna. O import estático do client de browser trazia `realtime-js` + `gotrue` (~180 KB não-comprimidos) para o bundle inicial — inclusive de `/negociacao` e `/projects/daily`, que têm ~600 B de código próprio. |
| **Impacto** | ~64 kB comprimidos baixados e parseados por página, sem uso até depois da montagem. |
| **Correção** | `import()` dinâmico dentro do `useEffect`. A assinatura só pode existir depois da montagem, então adiar não muda comportamento. |

O mesmo padrão estava em `src/features/leads/useLeadsRealtime.ts`, com um agravante: o hook está
**desligado** por flag de env (`NEXT_PUBLIC_LEADS_REALTIME`), mas o import estático arrastava o
chunk para `/leads` mesmo assim. A flag evitava abrir o socket, não o custo do bundle.

### P2 · Recharts (336 KB raw) no First Load de painéis inteiros — Grave

| | |
|---|---|
| **Arquivos** | `src/features/{leads,ceo,minutas,cs}/index.ts` (barrels) |
| **Causa** | **Um barrel é um módulo só.** Bastava `export { Funnel }` para o bundler puxar o Recharts inteiro para a rota, mesmo sem ninguém importar `Funnel`. |
| **Impacto** | Um agente abrindo `/leads?aba=leads` (só a tabela da própria fila) baixava o Recharts sem ver um gráfico. As abas do Radix já desmontavam o conteúdo inativo — faltava o código também não vir. |
| **Correção** | `features/*/lazy.tsx` com `next/dynamic` **e remoção das re-exportações dos barrels**. |

> ⚠️ **Esta é a armadilha que vai voltar.** A primeira rodada de `next/dynamic` **não surtiu
> efeito nenhum** em `/leads`, `/minutas` e `/ceo` — só em `/dashboard`, que não usa barrel. Foi
> preciso remover os `export` dos `index.ts` para o ganho aparecer. **Gráfico novo entra em
> `features/<x>/lazy.tsx`, nunca no `index.ts`.**

`ssr: false` não perde nada aqui: o `ResponsiveContainer` do Recharts mede o container no cliente,
então o HTML que o servidor produzia para esses gráficos já era um wrapper vazio.

### P3 · `getNextContacts()` serializa até 2N round-trips — Grave

| | |
|---|---|
| **Arquivo** | `src/app/actions/campaigns.ts` |
| **Causa** | Laço estritamente sequencial: 1 `SELECT` + 1 `UPDATE` por contato, um de cada vez. |
| **Impacto** | Está no caminho **mais crítico do produto**. Com `parallel_lines = 10`, 20 idas enfileiradas antes da primeira discagem — a ~80 ms de RTT, ~1,6 s de agente parado olhando a tela. |
| **Correção** | 1 `SELECT` em lote traz os N candidatos mais antigos; os claims saem em `Promise.all`. Custo: ~2 RTTs em vez de 2N. |

**A atomicidade não mudou:** cada contato continua sendo reservado por um
`UPDATE ... WHERE status='pending'` individual — é ele que garante exclusividade entre agentes.
Só o formato do laço mudou. Se um claim perder a corrida, a rodada repete com os candidatos
restantes (até `CLAIM_ROUNDS = 3`), e a distinção entre "perdi a corrida" e "acabaram os
pendentes" continua sendo feita pela busca, não pelo claim.

### P4 · `getCurrentProfile()` com 3 round-trips sequenciais — Média

| | |
|---|---|
| **Arquivo** | `src/app/actions/auth.ts` |
| **Causa** | `auth.getUser()` → `profiles` → `departments`, em série. Chamada pela Sidebar (toda tela) **e** por 8 páginas; em `/projects/[projectId]` o layout **e** a page chamavam, dobrando o custo. |
| **Correção** | `React.cache` (dedupe por requisição) + embed da FK `profiles→departments` — o mesmo embed que o middleware já usa em produção, prova de que a FK está exposta no PostgREST. |

**Blindagem obrigatória:** se o embed falhar (schema cache frio → `PGRST200`), o erro derruba a
query **inteira**, e devolver `null` faria o app tratar usuário logado como **deslogado** — falha
muito pior que a ida extra que o embed economiza. Por isso há retry sem embed.

### P5 · Índices ausentes na fila do discador — Média/Grave conforme volume

`campaign_contacts` é a maior tabela transacional do Discador e é lida no caminho mais quente
(`WHERE campaign_id AND status ORDER BY created_at`). Sem índice, cada pedido vira Seq Scan +
Sort na campanha inteira, e o custo cresce com o tamanho do mailing — justamente no pico.

O schema base do Discador **não está versionado**, então não havia como afirmar do repo o que já
existia na base: a migration é idempotente (`IF NOT EXISTS`) e é no-op para o que já estiver lá.

### P6 · Middleware faz 2 chamadas externas por requisição — Arquitetural

`src/lib/supabase/middleware.ts` roda `auth.getUser()` (HTTP ao GoTrue) **+** query em `profiles`
em **toda** requisição — página, prefetch RSC e POST de server action. É o gargalo nº 1 de escala.
**Não corrigido de propósito** — ver §6.

---

## 2. Resultado medido (First Load JS, `next build`)

| Rota | Antes | Depois | Δ |
|---|---:|---:|---:|
| `/leads` | 413 kB | **216 kB** | −47,7% |
| `/ceo` | 395 kB | **208 kB** | −47,3% |
| `/minutas` | 397 kB | **211 kB** | −46,9% |
| `/dashboard` | 379 kB | **206 kB** | −45,6% |
| `/projects/[projectId]/sprints` | 278 kB | **160 kB** | −42,4% |
| `/cs` | 284 kB | **210 kB** | −26,1% |
| `/negociacao`, `/admin`, `/campaigns`, `/aquecimento`, `/projects*`, `/dashboard/historico` | 266–274 kB | **201–210 kB** | ≈ −24% |

**Regressão honesta:** `/login`, `/cadastro`, `/ajuda`, `/verifique-email` e
`/projects/[projectId]` subiram **+1 kB** — o chunk compartilhado foi de 2,35 → 2,82 kB (glue do
webpack para import dinâmico). Saldo amplamente positivo.

**Natureza do ganho:** é **tempo até a tela ficar utilizável** (menos JS para baixar, parsear e
hidratar). **Não** acelera o carregamento dos *dados* — isso é RPC/banco, outro eixo. O
`ChartSkeleton` reserva a altura exata (`h-80` / `h-56`), então **não foi introduzido CLS**.

**Servidor:** `getNextContacts` sai de O(N) idas sequenciais para O(1) ondas; `getCurrentProfile`
de 3 para 1–2 idas, com dedupe por requisição.

---

## 3. Arquivos alterados

**Novos**
- `src/components/bluedesk/ChartSkeleton.tsx` — placeholder que reserva a altura do gráfico
- `src/features/{leads,ceo,minutas,cs}/lazy.tsx` — gráficos/abas sob demanda
- `src/components/monday/sprints/burndown-chart-lazy.tsx` — invólucro client (a página de sprints é Server Component, e `ssr:false` só vale dentro de client)
- `supabase/migrations/Migrations_discadora/20260803b_dialer_queue_indexes.sql`

**Modificados**
- `src/app/actions/auth.ts`, `src/app/actions/campaigns.ts` — round-trips
- `src/components/notifications/notification-bell.tsx`, `src/features/leads/useLeadsRealtime.ts` — import dinâmico
- `src/features/{leads,ceo,minutas,cs}/index.ts` — gráficos fora dos barrels
- `src/app/{leads/LeadsClient,ceo/CeoClient,cs/CsClient,minutas/MinutasClient,dashboard/DashboardClient}.tsx`, `src/app/projects/[projectId]/sprints/page.tsx` — apontam para os módulos lazy

---

## 4. Plano de commit

Três commits, para que um rollback seja cirúrgico — os riscos são de naturezas diferentes:

| Commit | Arquivos | Risco se der errado |
|---|---|---|
| **A** `perf(bundle): tira Supabase client e Recharts do First Load JS` | `notification-bell`, `useLeadsRealtime`, `ChartSkeleton`, os 4 `lazy.tsx`, os 4 `index.ts`, `burndown-chart-lazy`, os 6 clients/pages | Visual — gráfico não aparece |
| **B** `perf(db): reduz round-trips de getCurrentProfile e getNextContacts` | `auth.ts`, `campaigns.ts` | Lógico — login ou discador |
| **C** `chore(db): índices da fila do discador + migrations por projeto` | migration, README da pasta, README principal, docs | Nenhum (a migration já foi aplicada; é registro) |

⚠️ A migration nova é **untracked** — `git commit -am` não pega. Precisa de `git add` explícito.

**Commitar não melhora nada; deployar melhora.** Os ganhos de bundle só existem depois de um
build novo no Cloudflare Pages. Vale confirmar de qual branch o Pages builda — não há workflow de
deploy em `.github/workflows/` (só o tick do Aquecimento e o keep-alive do Supabase).

---

## 5. Checklist de validação manual

Três caminhos **não puderam ser testados** por falta de sessão autenticada. Vale ~10 minutos
depois do deploy:

- [ ] **Logar.** Se `getCurrentProfile` quebrasse no embed, o resultado seria loop no `/login`.
      Existe fallback, mas confirme. *(commit B)*
- [ ] **Abrir `/leads`, `/cs`, `/minutas`, `/ceo`, `/dashboard` e clicar em todas as abas.** Todo
      gráfico deve sair do esqueleto e renderizar. Preso no esqueleto = commit A.
- [ ] **Discar uma campanha com `parallel_lines ≥ 2`.** Deve pegar o lote e **não repetir contato
      entre agentes**. É o mais crítico dos três. *(commit B)*
- [ ] **F12 → Network:** o chunk do Recharts só deve baixar ao abrir uma aba com gráfico.

**Conferir se os índices estão sendo usados** (o ganho depende do volume — em tabela pequena o
Postgres pode continuar preferindo Seq Scan):

```sql
select count(*) as contatos from public.campaign_contacts;

select relname, indexrelname, idx_scan
  from pg_stat_user_indexes
 where relname in ('campaign_contacts','lists');
```

Se `idx_scan` continuar em 0 depois de uma sessão de discagem, o índice não está sendo escolhido.

---

## 6. Recomendado e NÃO implementado

1. **`role`/`department_slug` como custom claim no JWT** (Auth Hook do Supabase) — elimina a query
   em `profiles` do middleware, o gargalo nº 1 de escala. **Não feito porque muda quando uma troca
   de papel passa a valer** — é decisão de segurança do dono. *Alternativa descartada:* cache em
   cookie com TTL (um usuário rebaixado manteria acesso durante o TTL).
2. **Refetch ao trocar de aba no CS** — `CsTeam`/`CsMinutas`/`CsPagamento` buscam no `useEffect` e
   o Radix desmonta aba inativa, então ir e voltar entre abas repete as RPCs (Pagamento dispara
   **duas**). Cache com TTL reduz carga mas envelhece o dado; *stale-while-revalidate* preserva o
   frescor mas não reduz requisições. As duas trocam frescor por custo — escolha do dono.
3. **`getBurndown` por sprint** (`projects/[projectId]/sprints/page.tsx`) — N RPCs. Estão em
   `Promise.all` e só para sprints ativos (normalmente 1), então o impacto hoje é baixo; a solução
   (RPC recebendo array) exigiria migration por pouco retorno.
4. **Observabilidade** — hoje só `console.error`. Agravante: o padrão de degradação graciosa faz
   "erro de RPC" e "sem dado" produzirem **a mesma tela vazia**.
5. **Testes** — não há nenhum. `sanitizePeriod`, `lib/period.ts` (corte BRT) e `fetchAllRows` são
   lógica pura, crítica e barata de testar.

---

## 7. Escalabilidade — o que quebra primeiro

| Usuários | O que segura / o que cede |
|---|---|
| 10–100 | Nada. |
| 1.000 | **Middleware** (2 chamadas externas × requisição) vira o teto. |
| 10.000 | **`campaign_contacts` sem índice** torna o claim O(tamanho do mailing) — primeiro ponto de dor real, daí a P5. |
| 100.000 | Os `fetchAllRows` de fallback (`dashboardFromScan`, órfãos) puxam a base para o Worker. Hoje só rodam se a RPC não existir, mas são bomba-relógio. |

## 8. Dívidas restantes

Sem testes e sem CI de qualidade; sem observabilidade; `getMinutas` usa `select('*')` em duas
tabelas (aceitável no volume do Jurídico, não escala); **schema base do Discador e de Leads não
versionado** — impede auditar índices e RLS a partir do repo.
