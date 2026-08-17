# Ocultar projetos concluídos + board de altura fixa com arrasto lateral

Três ajustes de usabilidade na aba **Projetos**, **sem migration** (nenhuma coluna nova — o
"concluído" é derivado das estatísticas que a lista já carregava):

1. **Ocultar projetos concluídos** na lista `/projects`.
2. **Altura fixa do board** — as fases não crescem mais até o total de cards.
3. **Arrasto lateral ("de mão")** no lugar da barra de rolagem horizontal do board.

---

## 1. Ocultar projetos concluídos

A lista ganhou um switch **"Ocultar concluídos"** com o contador de quantos são, no mesmo
molde do **"Ocultar concluídas"** do calendário de entregas (`delivery-calendar.tsx`).

**O que conta como concluído:** `isProjectDone()` (`src/lib/monday/domain.ts`) — o projeto
**tem tarefas** e **todas** estão em `done`. Projeto **vazio não conta**: senão um projeto
recém-criado (0 tarefas) nasceria escondido pelo filtro.

**Não confundir com `archived`:** a coluna `monday_projects.archived` já existe e é filtrada
no servidor (`getProjectsWithStats`); este filtro é outra coisa — é de **exibição**, roda no
cliente e não escreve no banco.

### Como funciona

A página `/projects` continua **Server Component** (auth, gate de papel e fetch); só a lista
virou client (`ProjectsList`), que agora concentra o agrupamento por dono, os cards e o filtro.
Filtrar e agrupar são o **mesmo `useMemo`** (`[projects, hideDone]`), então virar o switch é o
único momento em que a lista é recalculada.

O contador do cabeçalho (“N projetos · M pessoas”) segue mostrando o **total** — quanto está
escondido aparece no próprio switch. Com tudo concluído e o filtro ligado, entra um aviso
"Todos os projetos estão concluídos." no lugar das pastas.

O switch **já entra ligado** (`useState(true)`): o caso comum é olhar só o que está em
andamento, então concluído nasce escondido e quem quiser ver tudo desliga o filtro. O estado
**não persiste** entre visitas (`useState`, igual ao do calendário) — cada visita volta a
esconder os concluídos.

---

## 2. Board de altura fixa

**Problema:** a coluna crescia com a quantidade de cards, a página inteira esticava junto e a
barra de rolagem horizontal do board — que fica no rodapé do container — ia parar lá embaixo,
longe do conteúdo.

**Solução:** o container do board tem altura de viewport (`h-[calc(100dvh-20rem)]`, com piso
`min-h-96`) e **cada fase rola por dentro** (`overflow-y-auto` no corpo da coluna). O board
inteiro passa a caber na tela: as colunas ficam todas da mesma altura e o rodapé do board fica
sempre visível.

Detalhes que o layout exige:

- `min-h-0` no corpo da coluna — sem isso o flex-child não encolhe e o `overflow-y-auto` nunca
  ativa (ele substituiu o antigo `min-h-24`, agora desnecessário).
- `shrink-0` no card — com a coluna rolando, o flex espremeria os cards em vez de transbordar.
- `overscroll-y-contain` na coluna: chegar ao fim da lista não "vaza" a rolagem para a página.
- Os `20rem` são o espaço ocupado acima do board (header + link de voltar + cabeçalho do
  projeto + abas + paddings). É um número fixo — nome ou descrição do projeto quebrando em duas
  linhas volta a gerar uma sobra pequena de rolagem na página.

---

## 3. Arrasto lateral no lugar da barra

A barra horizontal do board foi **escondida** (utility nova `scrollbar-none` no `globals.css`;
o container continua rolável por roda do mouse e teclado) e a navegação lateral passou a ser
**segurar o botão do mouse no fundo e puxar** — hook `useDragScroll`
(`src/hooks/use-drag-scroll.ts`). O cursor vira `grab`/`grabbing` para sinalizar isso.

**Convivência com o drag-and-drop das tarefas:** o card carrega `data-no-pan` e o hook ignora
qualquer `pointerdown` que caia num card ou controle (`button, a, input, textarea, select,
[data-no-pan]`). Ou seja: puxar o **fundo** move o board, puxar o **card** move a tarefa —
nunca os dois. O limiar de 4px preserva o clique simples (abrir a tarefa, botão "+").

### Custo de CPU

O hook foi escrito para não pesar no board (que já roda `@dnd-kit`):

- `pointermove`/`pointerup` só existem **enquanto o botão está pressionado** — fora do gesto não
  há nenhum listener ativo;
- o pan escreve direto em `el.scrollLeft` e o cursor sai de um `classList.toggle` no próprio nó:
  **zero estado React**, logo zero re-render da árvore de cards a cada pixel;
- a posição inicial (`scrollLeft`) é lida **uma vez** no `pointerdown`, então o `pointermove`
  nunca força reflow síncrono por leitura de layout.

---

## Arquivos principais

- **Lista:** `src/components/monday/projects/projects-list.tsx` (novo — agrupamento + cards +
  filtro, saíram de `src/app/projects/page.tsx`), `src/app/projects/page.tsx` (enxugado).
- **Domínio:** `src/lib/monday/domain.ts` — `isProjectDone(overview)`.
- **Board:** `src/components/monday/board/board-view.tsx` (altura fixa, coluna rolável,
  `data-no-pan` no card).
- **Arrasto:** `src/hooks/use-drag-scroll.ts` (novo), utility `scrollbar-none` em
  `src/app/globals.css`.

---

## Observações / limitações

- **Sem migration e sem passo manual no Supabase** — tudo é derivado/visual.
- **Arrasto só na horizontal:** dentro da fase a rolagem vertical continua pela roda do mouse
  (com barra fina normal, `scrollbar-slim`).
- **Toque:** em telas de toque a rolagem nativa já funciona; o pan por `pointerdown` é para
  mouse (o card mantém `touch-none` por causa do `@dnd-kit`).
