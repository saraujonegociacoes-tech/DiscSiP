# Transferir projeto para outra pessoa

Botão **Transferir** no cabeçalho do projeto, ao lado de "Membros" e "Apagar projeto". Passa o
projeto para outra pessoa — e ela pode devolver depois. **Sem migration.**

O efeito visível: na lista `/projects`, o card sai da pasta de quem era dono e aparece na pasta
do novo dono (as pastas são agrupadas por `owner_id`).

---

## A parte que não é óbvia: são DUAS fontes de verdade

"Dono" está gravado em dois lugares, e eles precisam andar juntos:

| Onde | Para que serve |
|------|----------------|
| `monday_projects.owner_id` | agrupa a lista `/projects` por pessoa |
| papel `'owner'` em `monday_project_members` | é o que a **RLS** consulta |

A policy de exclusão é `monday_projects_delete ... using (monday_project_role(id) = 'owner')` —
ela olha o **papel**, não a coluna. Trocar só a coluna deixaria o dono antigo **ainda podendo
apagar o projeto**, e o novo dono sem esse direito. Por isso a action escreve nos dois.

### O dono antigo vira `admin`, não `member`

`can_manage_monday_project` cobre **owner e admin**. Mantendo o antigo como `admin`, ele continua
com acesso total e **consegue transferir de volta** — que é o "e vice-versa" do pedido. Rebaixado
para `member`, o caminho de volta ficaria fechado.

---

## Como a action funciona

`transferProject(projectId, newOwnerId)` faz três escritas, **todas já permitidas pelas policies
existentes** (nenhuma migration):

1. **`monday_projects.owner_id = novo`** — vem primeiro de propósito: é o portão de permissão
   (`can_manage_monday_project`). Update sem permissão volta **0 linhas e nenhum erro**, então
   detectamos com `.select('id')`, mesmo padrão de `updateProjectName`/`deleteProject`. Falhando
   aqui, nenhum papel foi mexido.
2. **novo dono → membro `'owner'`** (`upsert`, porque ele pode ainda não ser membro).
3. **quem era `'owner'` → `'admin'`**, pelo predicado
   `role = 'owner' and user_id <> novo` — o que **dispensa ler antes quem era o dono**.

Os passos 2 e 3 tocam **linhas diferentes** da mesma tabela (a do novo dono / as dos demais), então
vão em `Promise.all` — uma ida ao banco em vez de duas. No total: **2 idas**, sem nenhum SELECT
prévio.

O `role = 'owner'` é escrito direto aqui, e não via `addProjectMember`/`updateProjectMemberRole`
— essas duas guardam o papel `owner` de propósito (`ASSIGNABLE_MEMBER_ROLES`, `.neq('role','owner')`),
porque a UI de membros nunca deve mexer nele. A transferência é justamente a exceção.

### Custo no cliente: zero consulta nova

O seletor de pessoas reusa o **mesmo `assignableUsers`** que o layout já carrega para o diálogo
de membros — o botão não faz consulta própria. O nome do dono atual sai da lista de `members`
que o layout também já tinha (o dono é sempre membro, pelo trigger `handle_new_monday_project`).
Ou seja: a tela não ficou nem uma query mais cara.

---

## Arquivos principais

- **Action:** `src/app/actions/monday-projects.ts` — `transferProject`.
- **UI:** `src/components/monday/projects/transfer-project-button.tsx` (novo — modelado no
  `DeleteProjectButton` para a confirmação e no diálogo de membros para o seletor de pessoa).
- **Fiação:** `src/app/projects/[projectId]/layout.tsx` — botão no cabeçalho + `ownerName`.

---

## Observações / limitações

- **Sem migration e sem passo manual no Supabase.**
- **Não é atômico.** Sem uma RPC, as três escritas não estão numa transação: se o passo 2 ou 3
  falhar, os papéis ficam a meio caminho e a action devolve um **aviso** (não erro) pedindo para
  refazer. Refazer é seguro — os três passos são idempotentes. Se essa janela incomodar, o
  próximo passo natural é uma RPC `security definer` fazendo os três numa transação só (aí sim,
  com migration).
- **Quem pode transferir:** a RLS (`can_manage_monday_project`) = gerência, dono ou admin do
  projeto. As telas de `/projects` já são restritas a `manager`/`admin`, então na prática todo
  mundo que vê o botão consegue usar; a permissão real é checada no banco, não na UI.
- **Candidatos:** as pessoas aprovadas da RPC `monday_assignable_users`, menos o dono atual. Se
  a escolhida ainda não for membro do projeto, o `upsert` do passo 2 já a adiciona.
