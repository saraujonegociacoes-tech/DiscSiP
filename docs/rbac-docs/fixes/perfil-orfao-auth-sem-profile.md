# Correção — usuário órfão: `auth.users` sem `profiles`

Correção do beco sem saída em que um usuário existe na autenticação mas não tem perfil no app
(19/ago/2026, caso **Kelly Souza**). Ver [`../../links.md`](../../links.md) (índice mestre) e
[`../updates/acessos-e-papel-tester.md`](../updates/acessos-e-papel-tester.md) (matriz de acesso).

## Estado: código no ar · ⏳ migration pendente do dono

- **Dado de produção já corrigido** (19/ago): perfil da Kelly recriado (agent · Comercial · ramal
  5132) e 3 usuários órfãos da Vitória removidos de `auth.users`. Zero órfãos hoje.
- **⏳ Pendente do dono:** aplicar
  [`20260819_ensure_profile.sql`](../../../supabase/migrations/Migrations_rbac/20260819_ensure_profile.sql).
  Sem ela o app segue funcionando igual a antes — a chamada nova só registra erro no log e a tela
  de espera renderiza normalmente.

## O sintoma

Ao tentar criar o acesso da Kelly, o cadastro respondia **"Já existe uma conta com este email"** —
mas ela não aparecia em lugar nenhum do `/admin` para ser aprovada. Criar não dava, aprovar não
dava.

## A causa

`public.profiles` é 1:1 com `auth.users` e nasce pelo trigger `handle_new_user`. Quando a linha de
`profiles` **some depois** (apagada na mão no Studio, ou trigger que não rodou no cadastro), a
pessoa cai num beco fechado nas três frentes ao mesmo tempo:

| Frente | O que acontece |
|---|---|
| [`middleware.ts`](../../../src/lib/supabase/middleware.ts) | `if (!profile \|\| role === 'pending')` trata "sem perfil" como pendente → prende em `/aguardando` |
| [`/admin`](../../../src/app/actions/admin.ts) | lista a tabela `profiles` → **a pessoa não aparece** para ninguém aprovar |
| [`/cadastro`](../../../src/app/cadastro/page.tsx) | recadastrar não resolve: o e-mail já está em `auth.users` → "Já existe uma conta com este email" |

Nenhuma das três está errada isoladamente. O buraco é a combinação: **nada no app olha para
`auth.users`**, então um usuário sem perfil fica invisível e irrecuperável pela interface.

Diagnóstico do dia: 11 dos 15 usuários tinham perfil, e o trigger comprovadamente funcionou até
04/ago (Mayara). Os 4 órfãos eram anteriores e posteriores a isso, sem padrão de data — ou seja,
**perfis apagados na mão**, não trigger quebrado. A migration reafirma o trigger mesmo assim, como
seguro barato.

## A correção

**1. `ensure_profile()` no banco** — RPC `SECURITY DEFINER` que recria o perfil do usuário
**logado** se ele não existir:

- papel **sempre `'pending'`**, nome e e-mail lidos de `auth.users`. Nada vem do cliente, então não
  há o que forjar — é o mesmo motivo pelo qual `profiles` não tem política de INSERT (ver
  [`20260614_rls_policies.sql`](../../../supabase/migrations/Migrations_rbac/20260614_rls_policies.sql));
- `ON CONFLICT (id) DO NOTHING`: quem já tem perfil não é tocado. Chamar num usuário aprovado é
  no-op — **nunca rebaixa ninguém**;
- `GRANT EXECUTE` só para `authenticated`.

**2. Chamada em `/aguardando`** — a rota virou server component
([`page.tsx`](../../../src/app/aguardando/page.tsx)) que chama `ensureProfile()` e renderiza a tela
antiga, agora em [`AguardandoClient.tsx`](../../../src/app/aguardando/AguardandoClient.tsx).

Por que ali e não em outro lugar: `/aguardando` é o **funil de todo usuário sem acesso liberado** —
o middleware manda para lá tanto `role = 'pending'` quanto `!profile`. É o único ponto por onde o
órfão obrigatoriamente passa.

A ação [`ensureProfile()`](../../../src/app/actions/auth.ts) **nunca lança**: se a migration não
estiver aplicada, o RPC volta erro, o erro vai para o log e a tela renderiza como sempre renderizou.

## Efeito prático

O órfão loga → cai em `/aguardando` → o perfil nasce como `pending` → **aparece no `/admin`** → o
admin aprova e dá o ramal pelo fluxo normal. O beco sem saída deixa de existir.

## Consequência a saber

**Apagar a linha de `profiles` não remove mais ninguém**: no próximo login ela volta como
`pending`. Para tirar alguém de verdade, apague o usuário em **Authentication → Users** do Supabase
(o `ON DELETE CASCADE` da FK leva o perfil junto) — ou deixe em `pending`, que já barra o acesso.

Isto é uma melhora, não um efeito colateral: apagar só o perfil era exatamente o gesto que criava o
órfão invisível.

## Lacuna que fica

O `/admin` continua sem **"remover usuário"** — não há como apagar de `auth.users` pela interface
(exigiria `service_role` no servidor). Enquanto isso, remoção é manual no Studio, pelo caminho
descrito acima.
