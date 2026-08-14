# Subtarefas na criação do sprint

O formulário **Novo sprint** ganhou uma lista de **subtarefas** com os mesmos campos de uma
tarefa. Ao criar o sprint, cada subtarefa vira uma **tarefa do board na fase "Fazendo"**,
já vinculada ao sprint. **Sem migration.**

---

## Por que não precisou de tabela nova

Subtarefa **é** uma tarefa: o que o usuário pediu ("criadas na fase Fazendo do projeto") já é o
comportamento de uma linha em `monday_tasks` com `status = 'working'` e `sprint_id` apontando
para o sprint recém-criado. Nenhuma coluna, tabela ou RLS nova — o schema atual cobre tudo, e as
tarefas nascem visíveis no board, no backlog, na Daily e no burndown do sprint como qualquer outra.

---

## O formulário

A seção **Subtarefas** só aparece na **criação** (na edição as tarefas já existem e são geridas
no board/backlog — igual ao campo Status, que só aparece ao editar).

Campos por subtarefa, espelhando o `TaskDialog`: **título** (obrigatório), **descrição**,
**responsável**, **prioridade**, **pontos** e **prazo**. **Status não é editável** — é fixo em
"Fazendo", que é justamente a regra pedida; o formulário diz isso em uma linha, em vez de
oferecer um campo que seria ignorado.

- Linha em branco (nada preenchido) é **descartada em silêncio** — adicionar e desistir é normal.
- Linha com conteúdo mas **sem título** bloqueia o envio com "Dê um título a todas as subtarefas".
- O `Responsável` usa os membros do projeto — a página de sprints passou a carregar
  `getProjectMembers`, do mesmo jeito que a página do board já fazia.

### O corpo do diálogo rola — e o limite de altura fica no lugar certo

Com várias subtarefas o formulário passa da altura da tela. O limite vai no **elemento que
rola**, não no `DialogContent`:

```
max-h-[min(60dvh,calc(100dvh-12rem))] overflow-y-auto
```

**Por que não no `DialogContent`:** ele é `display: grid` com linhas implícitas `auto`, que se
dimensionam pelo conteúdo. Um `max-height` no container faz o grid **transbordar** em vez de
encolher a linha do meio — o formulário vaza para fora do diálogo. O sintoma só aparecia com
**zoom alto**, que é quando a viewport fica menor que o formulário (foi assim que apareceu).

**Por que o `min()`:** "60% da tela, mas nunca mais do que sobra depois do cabeçalho, do rodapé e
do respiro do diálogo (~12rem)". A segunda metade é o que segura o zoom alto — `dvh` encolhe
junto com a viewport, mas `rem` não; só com `60dvh` o corte voltaria abaixo de ~350px de altura
útil. O `-mx-1 px-1` dá folga lateral para o anel de foco dos campos não ser cortado pelo
`overflow`.

---

## Gravação (uma ida só ao banco)

`createSprint` passou a aceitar `subtasks` e, depois de gravar o sprint, insere **todas as
tarefas num único INSERT** (não uma chamada por linha). O board de destino é o **primário** do
projeto — o de menor `position`, mesmo critério do `getPrimaryBoardData`. A ordem digitada é
preservada por `position: Date.now() + i`.

**Falha nas subtarefas não invalida o sprint.** O sprint já está gravado nesse ponto, então a
action devolve um `warning` (não um `error`): o diálogo fecha e avisa o que aconteceu. Devolver
erro faria o usuário achar que nada foi criado e tentar de novo — criando um sprint duplicado.

Como o sprint aparece em `/sprints` e as tarefas no board, a action agora revalida **os dois**
caminhos (antes só o do board).

---

## Reset do formulário ao reabrir (bug que a feature expôs)

O `SprintDialog` fica **montado o tempo todo** — só o conteúdo do Radix desmonta ao fechar —,
então o estado dos campos sobrevivia entre aberturas. Isso já deixava o nome do sprint anterior
no formulário, mas com subtarefas o efeito ficaria grave: reabrir e salvar **duplicaria no board**
tarefas que já tinham sido criadas.

`CreateSprintDialog` agora troca a `key` do `SprintDialog` a **cada abertura**, o que remonta o
componente com o formulário zerado. A key muda só ao abrir (não ao fechar), preservando a
animação de saída do diálogo.

> O mesmo padrão existe no `SprintCardActions` (edição), que **não** foi alterado: lá o estado
> vem do sprint e o risco de duplicar não existe. Se incomodar ver uma edição abandonada
> reaparecer ao reabrir, é a mesma correção de uma linha.

---

## Arquivos principais

- **Action:** `src/app/actions/monday-sprints.ts` — tipo `CreateSprintSubtask`, campo `subtasks`
  em `CreateSprintInput` e o helper privado `insertSprintSubtasks`.
- **Formulário:** `src/components/monday/sprints/sprint-subtasks.tsx` (novo — lista editável +
  conversão draft→payload), `sprint-dialog.tsx` (seção nova + corpo rolável),
  `create-sprint-dialog.tsx` (membros + reset por `key`).
- **Página:** `src/app/projects/[projectId]/sprints/page.tsx` — carrega os membros do projeto.

---

## Observações / limitações

- **Sem migration e sem passo manual no Supabase.**
- **Só na criação:** para adicionar tarefas a um sprint que já existe, o caminho continua sendo
  o board/backlog (`setTaskSprint`).
- **Sem hierarquia real:** "subtarefa" aqui é o nome do campo no formulário, não um vínculo
  pai/filho — no board elas são tarefas comuns do sprint. Se um dia for preciso aninhar de
  verdade, aí sim entra coluna `parent_id` e migration.
- **Uma consulta a mais** na página de sprints (`getProjectMembers`), necessária para o campo
  Responsável — mesmo custo que a página do board já paga.
