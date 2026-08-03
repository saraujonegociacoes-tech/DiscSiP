# Correção — a guarda das RPCs do CEO não bloqueava com `ceo_current_role()` NULL

> Encontrado em 2026-08-03, durante a conferência do Sprint 2. Afeta
> `get_ceo_financeiro`, que estava **em produção** desde 31/jul, e as 3 RPCs de projeção
> da mesma data. Correção:
> [`20260731c_ceo_guard_null_safe.sql`](../../../supabase/migrations/20260731c_ceo_guard_null_safe.sql).

## O sintoma

Chamando `get_ceo_projecoes()` com a chave `service_role` (que não tem `auth.uid()`),
esperava-se `NULL` — a guarda deveria barrar. Voltou o **payload completo**.

Na mesma chamada, `ceo_current_role()` devolvia `null`.

## A causa: `NOT IN` com NULL

O idioma da guarda, replicado em todas as RPCs do painel desde o Sprint 0:

```sql
IF public.ceo_current_role() NOT IN ('ceo', 'admin') THEN RETURN NULL; END IF;
```

E o helper ([`20260729_ceo_role.sql`](../../../supabase/migrations/20260729_ceo_role.sql)):

```sql
SELECT role::text FROM public.profiles WHERE id = auth.uid()
```

Sem linha em `profiles` para aquele `auth.uid()`, uma função SQL escalar devolve **NULL**.
E então:

```
NULL NOT IN ('ceo','admin')   →   NULL     (não TRUE)
IF NULL THEN ... END IF       →   NÃO ENTRA
```

PL/pgSQL trata condição NULL como falsa. A guarda não retorna, a execução segue, e a
função devolve o painel inteiro.

**Por que passou despercebido:** o caso comum funciona certo. Um `agent` logado tem
profile, `ceo_current_role()` devolve `'agent'`, `'agent' NOT IN ('ceo','admin')` é TRUE
e a guarda bloqueia. O teste manual da trava (feito em 31/jul, três papéis) exercitou
exatamente esse caminho — e passou, corretamente. O buraco só aparece com o papel
**ausente**, que nenhum dos três casos cobria.

## O alcance real

Não era buraco aberto pra internet:

- As RPCs são `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated` — `anon` não
  chama.
- O middleware barra `/ceo` por papel antes disso.

Passava quem estivesse **autenticado mas sem linha em `profiles`**: a janela entre o
signup e a criação do profile, ou um profile removido. Estreito — mas é precisamente o
estado em que alguém não deveria ver o painel executivo, e a guarda no banco existe
justamente pra não depender só do middleware ("defesa em profundidade", como está escrito
em [`src/app/ceo/page.tsx`](../../../src/app/ceo/page.tsx)).

## A correção: consertar o helper, não as quatro guardas

```sql
CREATE OR REPLACE FUNCTION public.ceo_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT role::text FROM public.profiles WHERE id = auth.uid()), '')
$$;
```

Nenhum papel válido é string vazia, então `'' NOT IN ('ceo','admin')` é TRUE e a guarda
bloqueia.

**Por que no helper e não em cada RPC:**

1. Uma função em vez de quatro — e conserta `get_ceo_financeiro` **retroativamente**, sem
   redeclarar um corpo de ~140 linhas que está em produção funcionando.
2. As RPCs dos Sprints 3 e 4 vão copiar o mesmo idioma da documentação. Com o helper
   não-nulo elas nascem seguras, sem ninguém precisar lembrar deste fix.

⚠️ **Mudança de contrato:** `ceo_current_role()` nunca mais devolve NULL. Quem quiser
distinguir "sem sessão" de "papel X" compara com `''`. Conferido antes de mudar: os únicos
consumidores são as 4 RPCs do painel, e todas usam o `NOT IN` — nenhuma testa `IS NULL`.

## A lição

**`NOT IN` com um valor possivelmente NULL não é uma negação — é uma terceira resposta.**
Sempre que o idioma for `IF <coisa> NOT IN (lista) THEN <negar acesso>`, a `<coisa>`
precisa ser garantidamente não-nula, senão a negação silenciosamente **libera**. O jeito
seguro é resolver na origem (helper que não devolve NULL), porque o idioma vai ser copiado.

Vale para qualquer guarda futura do repo, não só as do CEO: `cs_current_role()` e as
funções equivalentes de outros domínios seguem o mesmo desenho e merecem a mesma
conferência antes de virarem base de guarda em RPC `SECURITY DEFINER`. (No CS elas hoje
alimentam **policies de RLS**, onde uma policy que avalia NULL nega por padrão — o
comportamento é o oposto e está seguro. O risco é migrar esse helper pra dentro de um
`IF ... THEN RETURN` sem lembrar disso.)

## Referências

- [`20260731c_ceo_guard_null_safe.sql`](../../../supabase/migrations/20260731c_ceo_guard_null_safe.sql) — a correção.
- [`20260729_ceo_role.sql`](../../../supabase/migrations/20260729_ceo_role.sql) — o helper original.
- [`painel-ceo-sprints.md`](../updates/painel-ceo-sprints.md) — onde o idioma da guarda está documentado.
