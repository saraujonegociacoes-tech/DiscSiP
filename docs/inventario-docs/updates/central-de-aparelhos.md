# Central de Aparelhos (inventário de TI)

Área nova do Blue Desk (rota `/aparelhos`): inventário dos **celulares da empresa, dos chips e de
quem está com cada aparelho**. Ver [`../../links.md`](../../links.md) (índice mestre).

> ⚠️ **É transversal, não é uma vertical de departamento.** Ao contrário de `/cs`, `/negociacao` e
> `/minutas`, esta área não pertence a um departamento — todo departamento tem celular da empresa.
> Por isso o gate é por **papel**, não por `department_slug`, e ela **não entra em
> `VERTICAL_GATES`** no middleware. É o mesmo tipo de área que `/admin` e `/aquecimento`.

## Estado (20/ago/2026): CÓDIGO PRONTO — ⏳ migration pendente do dono

Área completa em uma leva: migration, RLS, RPC, 4 abas e CSV. `tsc`, `eslint` e `next build`
passam; `/aparelhos` fica em **214 kB de First Load JS**, o mesmo patamar de `/minutas`.

- **⏳ Pendente:** aplicar
  [`20260820_inventario_aparelhos.sql`](../../../supabase/migrations/Migrations_inventario/20260820_inventario_aparelhos.sql)
  no SQL Editor do Supabase. **Até lá o painel abre vazio** — `getInventario()` degrada pra vazio
  quando as tabelas não existem (loga o motivo no servidor), em vez de quebrar a tela.
- **⏳ Sem teste de ponta a ponta.** O que foi verificado aqui é compilação e tipos; o CRUD, o
  limite de 2 chips e o gate por papel só podem ser conferidos com sessão real — ver
  [Como conferir](#como-conferir).
- **Sem carga inicial.** Diferente das Minutas, não existe planilha de origem nem script de
  import: o cadastro nasce na tela.

## De onde veio

De um protótipo HTML de página única (`inventario-celulares.html`) que guardava tudo em
`localStorage`: quatro abas (Visão Geral / Aparelhos / Chips / Pessoas), contadores no topo, status
do aparelho, dois chips por aparelho e export CSV. **O conceito foi trazido; o código, não** —
nada daquele arquivo sobreviveu. O que mudou ao entrar no Blue Desk:

| Protótipo | Aqui |
|---|---|
| `localStorage` do navegador de quem abriu | Postgres com RLS — o inventário é o mesmo pra todo mundo |
| Sem controle de acesso | Gate por papel (página + middleware) e RLS separando leitura de escrita |
| "pode receber até dois chips" escrito num parágrafo | `slot` + `unique (aparelho_id, slot)`: o 3º chip é **impossível** |
| Só criar e apagar | CRUD completo, com edição |
| Cores fixas (`#3fd6c4`, `#12161d`) | Tokens do tema — funciona em claro e escuro |
| Barrinhas de sinal em CSS próprio | Dois traços com os tokens do tema, mesmo dado |
| CSV montado à mão no arquivo | `downloadCsv` de [`src/lib/csv.ts`](../../../src/lib/csv.ts) (separador `;`, BOM UTF-8) |

## Decisões

- **Acesso (decidido com o dono, 20/ago):** leem `supervisor`, `manager`, `admin`; escrevem
  `manager` e `admin`. Fora ficam `agent` e `ceo` (este já é barrado antes, pela trava lateral do
  middleware). O `tester` entra nos dois grupos por consequência, não por menção — ver abaixo.
- **Pessoas são lista PRÓPRIA (`inv_pessoas`), não `profiles`:** quem tem celular da empresa nem
  sempre é usuário do Blue Desk. `profile_id` é um vínculo **opcional** pra quando for — chega-se
  ao perfil sem duplicar a identidade. Excluir o usuário no `/admin` não apaga a pessoa do
  inventário (`on delete set null`).
- **Limite de 2 chips é regra de BANCO.** Contar no app teria corrida entre duas abas abertas. O
  `slot` ainda dá sentido estável às colunas "Chip 1"/"Chip 2" da Visão Geral — a ordem não muda a
  cada leitura.
- **IMEI e número de linha são únicos quando preenchidos**, comparando só os dígitos (`35 274…` não
  passa como diferente de `35274…`). Duplicata aí é erro de digitação, não caso real. Se algum dia
  precisar aceitar repetido, o que muda são os dois índices parciais `ux_inv_*`.
- **`status` guarda slug (`em_uso`), não rótulo (`Em uso`).** Rótulo é decisão de tela e muda; a
  tradução vive em [`shared.ts`](../../../src/features/aparelhos/shared.ts). O protótipo gravava o
  rótulo.
- **Sem histórico de movimentação.** O painel responde "quem está com o quê **hoje**", não "quem
  estava em março". Foi decisão de escopo: uma tabela de eventos é uma área a mais para manter e o
  dono pediu o escopo do arquivo original.

### O tester, e por que ele não aparece na migration

`inv_can_read()` e `inv_can_write()` são construídas sobre **`current_profile_role()`**
([`20260807_tester_rls_effective_role.sql`](../../../supabase/migrations/Migrations_rbac/20260807_tester_rls_effective_role.sql)),
que já devolve `'admin'` para quem tem papel `tester`. Reusar esse helper transversal, em vez de
escrever um `inv_current_role()` próprio, é o que evita repetir o bug que
[`20260803b_proc_can_access_tester.sql`](../../../supabase/migrations/Migrations_minutas/20260803b_proc_can_access_tester.sql)
teve que corrigir no `/minutas`: lá o tester passava no gate da página e a RLS devolvia zero linha,
então o painel abria **vazio**. As listas de papel do lado do app (`page.tsx`) citam `tester`
explicitamente porque ali não existe esse mapeamento.

## Modelo de dados

Migration
[`20260820_inventario_aparelhos.sql`](../../../supabase/migrations/Migrations_inventario/20260820_inventario_aparelhos.sql).
Três tabelas em cadeia — **PESSOA ← APARELHO ← CHIP** — e nenhuma exige a outra: chip pode estar
solto e aparelho pode estar em estoque sem responsável.

- **`inv_pessoas`** — `nome`, `departamento` (texto livre), `profile_id` (vínculo opcional, único),
  `observacoes`.
- **`inv_aparelhos`** — `modelo`, `imei` (único quando preenchido), `pessoa_id`,
  `status` (`em_uso` | `estoque` | `manutencao`), `observacoes`.
- **`inv_chips`** — `numero` (único quando preenchido), `operadora`, `tipo` (`pre` | `pos`),
  `aparelho_id`, `slot` (1 ou 2), `observacoes`.

Duas constraints carregam a regra do limite de chips:

```sql
constraint inv_chips_slot_pareado check ((aparelho_id is null) = (slot is null)),
constraint inv_chips_slot_unico   unique (aparelho_id, slot)
```

> ⚠️ **A armadilha que elas criam, e o trigger que resolve.** Com só o `on delete set null` da FK,
> **excluir um aparelho falharia**: a FK zera `aparelho_id` mas não sabe de `slot`, e a linha
> resultante (aparelho nulo + slot 1) viola `inv_chips_slot_pareado`. Por isso existe
> `trg_inv_aparelhos_soltar_chips` (BEFORE DELETE), que solta os chips antes de a FK agir. Quem
> mexer nessas constraints tem que olhar o trigger junto.

**RPC `inv_assign_chip(chip_id, aparelho_id)`** (SECURITY INVOKER) — vincula escolhendo o slot livre
mais baixo, ou desvincula com `aparelho_id` nulo. A escolha do slot é feita **no banco** de
propósito: dois usuários vinculando ao mesmo aparelho ao mesmo tempo escolheriam o slot 1 os dois se
a conta fosse no app. O perdedor recebe a mensagem do limite, não uma linha errada.

**RLS** — leitura e escrita separadas (ao contrário do `for all` das Minutas, onde todo mundo que vê
também edita): `inv_can_read()` para SELECT, `inv_can_write()` para INSERT/UPDATE/DELETE, nas três
tabelas. As doze policies saem de um laço `do $$` — escrever doze à mão é como se esquece uma.

## As 4 abas

Rota [`src/app/aparelhos/`](../../../src/app/aparelhos/), feature
[`src/features/aparelhos/`](../../../src/features/aparelhos/). Abas sincronizadas com `?aba=`, mesmo
esqueleto do `MinutasClient`. As quatro leem o **mesmo** objeto em estado, então mudar o responsável
na aba Aparelhos já reflete na Visão Geral sem recarregar.

1. **Visão Geral** — 4 KPIs (Aparelhos / Chips / Pessoas / Sem chip) e uma linha por aparelho com
   responsável, os dois chips e o status. **Export CSV** daqui. Ordem **fixa** por urgência
   (manutenção → estoque → em uso): a pergunta desta aba é "o que precisa de atenção", e procurar um
   registro específico é tarefa das abas de cadastro.
2. **Aparelhos** — CRUD. Responsável e status trocam **direto na linha**: são as alterações do dia a
   dia ("fulano saiu, o celular voltou pro estoque"), e exigir um diálogo pra isso transformaria a
   tarefa mais comum na mais lenta. Modelo, IMEI e observações ficam no formulário.
3. **Chips** — CRUD. O vínculo com o aparelho troca na linha, sempre via `inv_assign_chip`.
   Aparelho cheio aparece **desabilitado com o motivo escrito** em vez de sumir da lista — esconder
   faria o usuário procurar um aparelho que ele sabe que existe.
4. **Pessoas** — CRUD dos responsáveis, com o vínculo opcional ao perfil do Blue Desk (selo ao lado
   do nome quando existe).

Quem só lê vê as quatro abas, sem os botões de ação e com o aviso no rodapé de cada tabela.

### Notas de implementação

- **Não existe `lazy.tsx`** neste feature, de propósito: as quatro abas são tabelas e formulários,
  nenhuma puxa Recharts ou date-fns. Não há chunk pesado pra adiar. Se uma aba ganhar gráfico, ela
  sai do barrel para um `./lazy` **antes** de importar a biblioteca — a armadilha documentada em
  [`auditoria-performance-2026-08.md`](../../performance-docs/updates/auditoria-performance-2026-08.md).
- **`tableKit.tsx` e `FormDialog.tsx`** existem porque as três abas de cadastro têm colunas
  diferentes mas mecânica idêntica (mesma casca, mesma ordenação, mesmos botões). Sem eles seriam
  três cópias da mesma lógica — o tipo de duplicação que fez nascer o `lib/csv.ts`.
- **Ordenação:** o primeiro clique num cabeçalho ordena na direção que faz sentido pro tipo da
  coluna (texto A→Z, número maior→menor), o segundo inverte, e **nulos vão sempre pro fim nos dois
  sentidos** — campo vazio é ausência de informação, não o "menor" de todos. Regra herdada da
  `MinutasLista`.
- **Erros do Postgres são traduzidos** em `actions/inventario.ts` antes de chegar na tela: as
  constraints daqui são todas regra de negócio, e devolver `duplicate key value violates unique
  constraint ux_inv_chips_numero` seria jogar o problema de volta pra quem só queria cadastrar um chip.
- **Os diálogos resetam na ABERTURA**, não só ao fechar: em modo edição os campos são semeados por
  props, e sem isso reabririam com o estado antigo depois de um refresh — a mesma classe de bug do
  commit `6b57aff` no board de Projetos.

## Como conferir

Depois de aplicar a migration (as consultas de conferência estão no rodapé do próprio `.sql`):

1. **Gate por papel** — logado como `agent`, abrir `/aparelhos` na URL: tem que redirecionar. Como
   `supervisor`: entra, vê as tabelas e **não** vê "Novo aparelho"/lápis/lixeira. Como `manager` ou
   `admin`: vê tudo.
2. **Sidebar** — o item "Central de Aparelhos" aparece no bloco *Operação* para supervisor, gerente
   e admin, e some para agente.
3. **Cadeia completa** — criar uma pessoa, um aparelho vinculado a ela e dois chips no aparelho.
   Conferir na Visão Geral: os dois traços cheios, os dois chips nas colunas certas.
4. **Limite de 2 chips** — cadastrar um terceiro chip e tentar vinculá-lo ao mesmo aparelho: a opção
   tem que aparecer desabilitada com "já tem 2 chips", e forçar pelo banco tem que dar erro.
5. **Exclusão em cadeia** — excluir o aparelho: os chips continuam cadastrados, agora sem aparelho
   (é aqui que se vê se o trigger `trg_inv_aparelhos_soltar_chips` foi criado). Excluir a pessoa: os
   aparelhos dela ficam sem responsável, não somem.
6. **CSV** — exportar da Visão Geral e abrir no Excel em pt-BR: acentos corretos e colunas separadas.
