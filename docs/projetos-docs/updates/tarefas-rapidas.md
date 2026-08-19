# Tarefas rápidas (dinâmicas)

A rota `/projects` ganhou uma segunda aba: **Projetos | Tarefas rápidas**. A aba nova
(`/projects/quick`) registra trabalho curto e avulso — o que não justifica criar projeto, board e
grupo só para existir. **Precisa de migration**
(`supabase/migrations/Migrations_projetos/20260818_monday_quick_tasks.sql`).

---

## 1. Dados

### Por que uma tabela nova

Uma tarefa de projeto vive numa hierarquia: `monday_projects → monday_boards → monday_groups →
monday_tasks`. Encaixar a tarefa avulsa aí exigiria um board e um grupo fantasma por pessoa, e essas
linhas passariam a aparecer no Board, no Backlog, nos Sprints e no burndown de um projeto que não
existe — cada uma dessas telas precisaria de um filtro novo para escondê-las.

`monday_quick_tasks` é **flat**: sem `board_id`, sem `group_id`, sem `sprint_id`. As telas existentes
continuam intocadas, e a integração acontece só onde foi pedida (Daily, Calendário, Histórico).

### O que a tabela reaproveita

- Os **mesmos `check`** de `status` e `priority` de `monday_tasks`. Por isso `STATUS_META`,
  `PRIORITY_META`, `StatusBadge` e `PriorityBadge` funcionam sem uma linha de adaptação.
- As **funções de trigger que já existiam**: `monday_set_updated_at()` e
  `monday_sync_task_completed_at()`. A segunda grava `completed_at` sozinha ao virar `done` — e é
  exatamente esse campo que a Daily e o Histórico leem.
- O helper de RBAC `monday_is_gerencia()` (de `20260727_monday_gerencia_access.sql`).

RLS: **dono OU responsável OU gerência**.

Índices parciais cobrem exatamente as três leituras cruzadas: `due_date` (Calendário), `status`
(Daily) e `completed_at desc` (Histórico).

> `position` é `double precision`, não `integer` — o app grava `Date.now()` ali, seguindo a convenção
> de `monday_tasks`, e isso estoura o `int4`. A migration traz um `alter column` idempotente para
> consertar bancos que aplicaram a primeira versão.

---

## 2. Integração com Daily / Calendário / Histórico

O pedido veio com uma restrição: essas tarefas aparecem nas três telas **sem encarecer** a
requisição.

1. **A consulta nova entra no `Promise.all` que já existia.** Nenhuma das três telas ganhou um
   roundtrip a mais — a consulta de tarefa rápida roda em paralelo com a de tarefa de projeto.
2. **A tarefa rápida pula o caminho `board → projeto`.** Ela não tem projeto, então
   `projectId/projectName/projectKey/projectColor` vêm da constante `QUICK_PSEUDO_PROJECT`
   (`src/lib/monday/domain.ts`) — em JS, sem consulta nenhuma. Aparece agrupada como
   **"Tarefas rápidas"**, na cor `#00C2A8`.
3. **Uma consulta de `profiles` só** cobre os responsáveis dos dois tipos de tarefa (os ids entram
   no mesmo `in()`).

Saldo por tela: **+1 index scan, zero join, zero roundtrip**.

Nenhum componente de UI dessas telas mudou — elas já renderizavam por `projectName`/`projectColor`.

Os dois joins feitos em JS (`resolveProjects`, `resolveProfiles`) e o helper `assigneeNameFrom` ficam
em **`src/lib/monday/task-joins.ts`**, compartilhados pelas duas actions. Não podem morar nos
próprios arquivos de action: um módulo `'use server'` só exporta funções async, que viram endpoint —
e estes são helpers internos, não pontos de entrada.

### Detalhe do Histórico

Antes, o `HISTORY_LIMIT` de 500 era o `.limit()` de uma consulta só. Agora **cada** consulta traz até
500, o merge é reordenado por `completed_at desc` em JS e o corte de 500 é aplicado depois. `capped`
fica `true` se o merge passou do limite **ou** se qualquer uma das duas consultas bateu no teto — sem
isso, 500 tarefas rápidas e nenhuma de projeto reportariam "não há mais nada".

---

## 3. A aba

`/projects/quick`, Server Component, mesmo gate de papel de `/projects`
(`manager | admin | tester`). Carrega em paralelo:

```ts
const [tasks, assignableUsers] = await Promise.all([getQuickTasks(), getAssignableUsers()])
const categories = quickTaskCategories(tasks)
```

As categorias saem da lista já carregada (`quickTaskCategories`, em `domain.ts`). Existia uma segunda
action só para isso; as duas varriam a mesma tabela sob a mesma RLS, e a segunda fazia um `distinct`
que o JS resolve numa passada.

### Por que as abas não viraram um `layout.tsx`

Um `src/app/projects/layout.tsx` envolveria **também** `/projects/[projectId]`, e a página de um
projeto já tem a própria barra (`ProjectTabs`: Board | Sprints | Backlog). As duas apareceriam
empilhadas. Por isso `<ProjectsTabs />` é renderizado dentro de cada página do nível.

---

## 4. A visualização: AccordionGallery

Instalado pelo CLI (`npx shadcn@latest add @react-bits/AccordionGallery-JS-CSS`) e **portado** para
`src/components/ui/accordion-gallery.tsx`. Trouxe **`gsap`** como dependência.

O original é uma galeria de **imagens**. A adaptação troca a imagem por conteúdo React arbitrário,
mantendo o motor de layout: GSAP animando `flex-grow` mais rotação 3D e escala nos vizinhos.

- **1 painel = 1 tarefa.** Fechado: ponto na cor do status, título na vertical e o dia/mês do prazo.
  Aberto: sobrancelha (status · prioridade · categoria), título, descrição, ficha (Prazo ·
  Responsável) e as ações.
- Painel fechado leva `inert` — os botões dentro dele continuam no DOM mas saem do fluxo de foco.
- Acima de **10 tarefas visíveis** o excedente cai numa grade de cards. Accordion horizontal degrada
  com muitos itens: cada painel fechado vira uma faixa de poucos pixels.
- `expandRatioFor(n)` dá a fatia do painel aberto: 78% com até 2 tarefas, caindo a 50% com 7+. Valor
  fixo resolvia bem com 6 e mal com 2 — a fechada ficava com metade do trilho, vazia.

### Profundidade: dois canais, separados por custo

Esta é a decisão central do componente.

- **`--ag-depth`** (0 = em foco, 1 = ao fundo), animada pelo GSAP a cada quadro, controla **apenas
  opacidade** de duas camadas (`__dim` e `__lift`) — trabalho de composição, que a GPU faz de graça.
- **Borda, sombra e desfoque** são estados presos à classe `--active`, com transição de CSS. São
  propriedades de **pintura**: derivá-las de `--ag-depth` obrigava o navegador a recompor sombra de
  três camadas, `color-mix` e filtro de **todos** os painéis 60 vezes por segundo.

### Hierarquia e ações

O título é o maior elemento e vem logo abaixo da sobrancelha, em corpo pequeno, que classifica sem
competir. A ficha tem dois campos (Prazo, Responsável); categoria subiu para a sobrancelha e
"criada em" desceu para o rodapé em 11px. **Nenhuma informação foi removida** — mudou o peso.

"Concluir" é o único botão cheio. "Editar" é `ghost`. "Excluir" é botão de ícone no canto direito,
com `aria-label` e `title`: continua a um clique, sem o peso da ação principal. O filtro da barra de
cima é `outline` pelo mesmo motivo — cheio, estava mais forte que a ação principal do card.

---

## 5. O modal: formulário Uiverse + BorderGlow

O `DialogContent` do shadcn perde fundo, borda, padding e sombra
(`border-0 bg-transparent p-0 shadow-none`): quem desenha o card é o **BorderGlow** (react-bits,
portado para `src/components/ui/border-glow.tsx`), que acende a borda conforme o cursor se aproxima.
Sem isso ficariam duas molduras empilhadas.

O layout segue o card do Uiverse — labels miúdos em cima, campos transparentes de borda fina, botão
curto alinhado à esquerda — reescrito nos tokens do Blue Desk (`quick-task-form.css`). As cores
roxo/rosa do original deram lugar a `#0066CC → #00C2A8`; o foco usa `var(--primary)`.

O `backgroundColor` do BorderGlow é `var(--card)`. Substituição de variável em CSS é recursiva, então
o card acompanha o tema claro/escuro **sem JS**.

**Campos:** Título (obrigatório) · Detalhes · Categoria (texto livre, com `datalist` das categorias
já usadas) · Prazo · Status · Prioridade · Responsável.

O prazo usa o `BrDateInput` do Blue Desk — DD/MM/AAAA na tela, ISO no envio — e por isso viaja num
campo montado no `action`. O responsável vem de `getAssignableUsers()` (RPC
`monday_assignable_users`, que só responde para a gerência); para quem não é gerência a lista vem
vazia e a tarefa fica sem responsável, que é o uso normal da aba.

---

## 6. Armadilhas encontradas (e o porquê das soluções)

Cinco coisas custaram tempo e não são óbvias relendo o código pronto.

### `@property` com `inherits: false`

O sintoma foi o pior de todos: **o painel em foco ficava escurecido como os outros e a camada de luz
nunca aparecia**. O GSAP escreve `--ag-depth` no painel, mas quem consome são as camadas *filhas*.
Com `inherits: false` elas não enxergam o valor do pai e caem no `initial-value: 1`.

O que despistou: borda e sombra reagiam certo, porque essas declarações ficam no próprio painel.

> Um custom property comum herda por padrão. Um declarado com `@property` herda só se você pedir.
> O `@property` continua necessário: sem tipo, um `calc()` inválido derrubaria a declaração inteira.

### Filme branco dessatura

A camada de luz do painel em foco era branca. Branco sobre superfície de croma baixo **dessatura** —
não ilumina. Os painéis laterais não tinham camada nenhuma por cima e ficavam *mais* azuis que o
principal. A luz agora é `color-mix` com `--primary`: acrescenta luminância **e** croma.

Mesma causa no véu de escurecimento: ele tinha croma quase neutro sobre um card azul. Passou a usar a
família do fundo da página (`oklch(0.12 0.07 268)`) — os painéis ao fundo **afundam no fundo** em vez
de desbotar.

### `filter` e `will-change` matam o antialiasing subpixel

Qualquer um dos dois promove o elemento a uma camada de composição própria, e texto em camada própria
perde a suavização subpixel: a fonte fica mais fina e acinzentada.

- `filter: blur(0px)` no painel em foco parecia inofensivo. O desfoque vive em
  `.ag-panel:not(.ag-panel--active)`; o painel em foco não tem `filter` nenhum.
- `will-change: transform` foi removido — a promoção passa a acontecer só durante a transição.
- O `transform` inline do painel em foco é apagado (`clearProps: 'transform'`) no `onComplete` da
  timeline: ele já é a identidade, mas enquanto existe mantém o elemento na camada.

### Um canvas WebGL não renasce no mesmo elemento

(Da tentativa com o DarkVeil, depois removida.) `getContext` devolve sempre o mesmo objeto, inclusive
depois de perdido. Chamar `loseContext()` na limpeza e reusar o `<canvas>` do JSX fazia a montagem
seguinte pegar um contexto morto e estourar no primeiro `render()`.

### Componente declarado dentro de outro componente

`TaskDetails` morava no corpo de `QuickTasksGallery`. Um componente declarado assim ganha identidade
nova a cada render do pai, e o React **desmonta e remonta** a árvore inteira em vez de reconciliar —
dez painéis refeitos do zero a cada clique em filtro. Hoje vive no módulo, embrulhado em `memo`, com
os callbacks do pai estabilizados em `useCallback` para o `memo` valer alguma coisa.

---

## 7. Otimizações de CPU

Além das duas acima (pintura fora do quadro a quadro, `TaskDetails` estável):

| O quê | Antes | Agora |
|---|---|---|
| Spotlight do accordion e ponteiro do BorderGlow | `getBoundingClientRect()` a cada `pointermove` | o evento só anota a posição; medir e escrever acontece **uma vez por quadro**, no rAF |
| Formatação de data nos cards | `toLocaleDateString` monta um `Intl.DateTimeFormat` novo a cada chamada, por card, a cada render | dois formatadores no módulo, criados uma vez |
| `style` do BorderGlow | 15 custom properties remontadas a cada tecla digitada no formulário | `useMemo`, com as cores padrão hasteadas para constante de módulo |
| `matchMedia` | novo `MediaQueryList` a cada render | lido uma vez, no inicializador do `useState` |
| Categorias da aba | segunda consulta ao banco só para o `distinct` | derivadas da lista já carregada |
| Arrays de ref do accordion | cresciam e nunca encolhiam — nós de painéis removidos ficavam retidos e entravam no `forEach` da animação | truncados junto com a lista |
| `EditQuickTaskDialog` | montado sempre | montado só quando há tarefa em edição |

### Código morto removido

- `BorderGlow`: a prop `animated` e a varredura de apresentação (`animateValue`, `easeInCubic`,
  `easeOutCubic`, o `useEffect` inteiro e as regras `.sweep-active` do CSS) — nada nunca passou
  `animated`.
- `AccordionGallery`: a prop `onActiveChange` (nenhum chamador), o `rootRef` (declarado e nunca
  lido), e o `borderRadius` inline por painel, que repetia o que o CSS já faz com `var(--ag-radius)`.
- `isQuickTaskItem` em `domain.ts` e `getQuickTaskCategories` nas actions.
- Os `export default` de `AccordionGallery` e `BorderGlow` — os dois só são importados por nome.
- `resolveProjects`/`resolveProfiles` estavam duplicados em `monday-daily.ts` e `monday-calendar.ts`.

---

## Arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/Migrations_projetos/20260818_monday_quick_tasks.sql` | tabela, índices, triggers, RLS |
| `src/app/actions/monday-quick-tasks.ts` | CRUD + `setQuickTaskStatus` (atalho de 1 clique) |
| `src/app/actions/monday-daily.ts` | Daily e Histórico passam a somar as tarefas rápidas |
| `src/app/actions/monday-calendar.ts` | Calendário idem |
| `src/lib/monday/task-joins.ts` | joins em JS compartilhados pelas duas actions |
| `src/lib/monday/domain.ts` | `QUICK_PSEUDO_PROJECT`, `quickTaskCategories` |
| `src/lib/monday/types.ts` | `MondayQuickTask`, `MondayQuickTaskWithAssignee`, `QuickTaskInput` |
| `src/components/ui/accordion-gallery.tsx` / `.css` | react-bits portado e adaptado |
| `src/components/ui/border-glow.tsx` / `.css` | react-bits portado |
| `src/components/monday/projects-tabs.tsx` | abas do nível `/projects` |
| `src/components/monday/quick/` | formulário, diálogos e galeria |
| `src/app/projects/quick/page.tsx` | a aba |
| `components.json` | criado para o CLI do shadcn funcionar neste repo |
