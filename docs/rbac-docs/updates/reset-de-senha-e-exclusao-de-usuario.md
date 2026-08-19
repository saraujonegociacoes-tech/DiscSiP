# Redefinição de senha e exclusão de usuário

Duas lacunas do RBAC fechadas de uma vez: quem esquecia a senha não tinha saída
nenhuma (só um admin mexendo direto no Supabase), e o `/admin` sabia mudar papel,
departamento e ramal, mas não sabia **remover** ninguém.

---

## 1. Redefinição de senha (self-service)

Fluxo em três etapas, espelhando o que a confirmação de email já fazia:

```
/login  ─ "Esqueci minha senha" ─►  /esqueci-senha
                                          │  resetPasswordForEmail(redirectTo=/auth/recuperar)
                                          ▼
                                    email do Supabase
                                          │  ?code=… (PKCE)
                                          ▼
                                    /auth/recuperar          (route handler)
                                          │  exchangeCodeForSession → grava o cookie
                                          ▼
                                    /auth/redefinir-senha    (form)
                                          │  updateUser({ password }) + signOut()
                                          ▼
                                       /login
```

| Arquivo | Papel |
| --- | --- |
| `src/app/esqueci-senha/page.tsx` + `EsqueciSenhaClient.tsx` | pede o email e dispara o link |
| `src/app/auth/recuperar/route.ts` | troca o `code`/`token_hash` por sessão |
| `src/app/auth/redefinir-senha/page.tsx` | form da senha nova |
| `src/components/auth/AuthShell.tsx` | moldura (hero + form) das telas novas |

### Decisões que não são óbvias no código

- **Por que um route handler no meio.** Só route handler pode *escrever* o cookie de
  sessão (Server Component não pode), e é essa sessão que autoriza o
  `updateUser({ password })` na tela seguinte. Mesmo motivo do `/auth/confirm`.
- **`/auth/*` roda sem middleware.** O `matcher` já exclui `auth/`, então as duas
  etapas finais não passam pelo gate de papel — necessário, porque um usuário
  `pending` ou `ceo` seria redirecionado para `/aguardando` / `/ceo` no meio do
  fluxo. Só o `/esqueci-senha` entrou em `PUBLIC_ROUTES`.
- **Sucesso é sempre genérico** ("se existir uma conta com esse email…"). Confirmar
  para um anônimo que um email existe entrega a lista de quem trabalha aqui.
- **`signOut()` depois de trocar a senha.** O link do email vira uma sessão viva;
  deixá-la aberta significaria que quem abriu o email continua logado.
- **Link só funciona no mesmo navegador** que pediu a redefinição — o verifier do
  PKCE fica num cookie local. A tela de erro diz isso em português.

### ⚠️ Configuração no Supabase (não está no código)

`https://SEU_DOMINIO/auth/recuperar` precisa entrar em **Authentication → URL
Configuration → Redirect URLs**. Sem isso o GoTrue ignora o `redirectTo` e joga a
pessoa na Site URL — o link "não faz nada". Inclua também
`http://localhost:3000/auth/recuperar` para desenvolver.

O SMTP padrão do Supabase tem limite baixo de envio; se o time inteiro pedir reset
no mesmo dia, o gargalo é esse, não o app.

---

## 2. Exclusão de usuário (`/admin`)

Botão de lixeira em cada linha de usuário → diálogo que mostra o **impacto real**
antes de liberar o botão, e exige digitar o email da pessoa para confirmar.

Excluir de verdade é apagar de `auth.users`, não de `profiles`: apagar só o perfil
deixaria o login funcionando e o `handle_new_user` nem recriaria a linha (ele só
dispara no INSERT do cadastro) — sobraria um usuário logado e invisível. `auth.users`
exige a Admin API com `service_role`, então a permissão deixa de ser responsabilidade
do RLS e passa a ser do código: `requireAdmin()` roda antes de qualquer coisa em
`src/app/actions/admin.ts`.

`admin` **e** `tester` podem excluir — mesma régua do banco, onde
`current_profile_role()` mapeia `tester` → `admin`. Barrar só aqui seria teatro: o
tester já edita papéis e se auto-promoveria a admin em dois cliques.

### O que a varredura de FKs encontrou

Apagar de `auth.users` propaga por tudo que aponta para lá e para `public.profiles`
(que é `id … REFERENCES auth.users ON DELETE CASCADE`). Duas armadilhas:

| Problema | Consequência | Correção |
| --- | --- | --- |
| `cs_agents.profile_id` nasceu **sem** `ON DELETE` (= `NO ACTION`) | exclusão **abortava** com violação de FK para qualquer usuário ligado a um agente do CS — erro opaco vindo do GoTrue | vira `SET NULL` |
| `monday_projects.owner_id` era **`CASCADE`** | excluir o dono **apagava o projeto inteiro** e, em cascata, boards, tarefas, sprints e comentários de *todo mundo* que trabalha nele — calado | vira `RESTRICT`: o banco recusa enquanto houver projeto; o admin transfere antes (botão "Transferir" já existia) |

Migration: `supabase/migrations/Migrations_rbac/20260819_delete_user_fks.sql`
(idempotente; resolve os nomes das constraints via `pg_constraint` porque as duas
nasceram com nome automático).

O resto da árvore já estava correto:

- **Histórico preservado** (`SET NULL`) — `call_logs.agent_id`,
  `campaign_contacts.assigned_agent_id`, `leads.profile_id`, custos do CEO,
  `monday_tasks.assignee_id`/`created_by`, `monday_task_comments.author_id`,
  `notifications.actor_id`, `minutas.created_by`.
- **Some junto** (`CASCADE`, e tudo bem) — `agent_presence`, `campaign_agents`,
  `monday_project_members`, `notifications.user_id`, `monday_quick_tasks.owner_id`
  (lista pessoal; o diálogo mostra a contagem antes).

### Por que o pré-voo usa `service_role`

`getDeletionPreview()` roda com a service key **de propósito**: sob RLS, as tarefas
rápidas de outra pessoa não apareceriam e o diálogo diria "0 tarefas rápidas" antes
de apagar várias. A permissão já foi checada por `requireAdmin()` na entrada.
A exceção está documentada em `src/lib/supabase/service.ts`.

### ⚠️ Configuração de ambiente

`SUPABASE_SERVICE_ROLE_KEY` precisa existir **em runtime na produção** (Cloudflare
Pages), não só no `.env.local`. Hoje ela já é usada pelo `/api/aquecimento/*`, então
provavelmente está lá — mas se o "Excluir" falhar em produção e funcionar local, é o
primeiro lugar a olhar.
