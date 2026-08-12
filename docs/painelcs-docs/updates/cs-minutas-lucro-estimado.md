# Página 3 (Minutas) — Lucro Estimado por card

**Data:** 2026-08-12 · **Pedido do dono** ·
**Migration:** `supabase/migrations/Migrations_painelcs/20260812_cs_minutas_lucro_estimado.sql`
✅ **aplicada em 12/ago/2026** · **Frontend:** `CsMinutas.tsx`, `src/lib/types/database.ts`.

> **No ar.** A migration foi aplicada pelo dono em 12/ago; a coluna popula direto da RPC, sem
> backfill e sem re-rodar o Make. O frontend degrada sozinho caso a função seja revertida
> (`lucroEstimado` ausente → "—", sem NaN na ordenação — ver "Se precisar reaplicar a 20260727d").

## O pedido

> "Adicionar o valor estimado de lucro com base na minuta. O valor estimado de lucro seria —
> Valor da Minuta Final − Última Negociação."

```
Lucro Estimado = Valor da Minuta Final − Última Negociação
                 (valor_resguardados_dos_clientes)   (q_d_valor_da_quita_o_com_desconto)
```

O spread entre o que o cliente paga pela minuta emitida e o Q.D real fechado na fase de
negociação — o ganho bruto estimado da operação naquele card. **Os dois campos já existiam** no
payload da P3 desde a [`20260727d`](../../../supabase/migrations/Migrations_painelcs/20260727d_cs_minutas_negociacao.sql);
nada novo precisou ser ingerido nem mapeado no Pipefy.

## Onde a conta mora (e por que não no front)

Na RPC, junto do `descontoPct`. A `20260727d` já tinha feito **exatamente essa escolha** pro
`% desc.` (`1 − valor/dívida`): os dois operandos viajam no payload, mas a regra fica num lugar
só — greppável, conferível com um `SELECT` e **igual** pra tabela, KPI, insight e CSV.

Padrão que vale guardar: **valor derivado de campo do card se resolve na leitura, no SQL.** O
front só soma. Assim não existe a possibilidade de a tabela mostrar um número e o CSV outro,
que é o que acontece quando cada componente reimplementa a fórmula.

Custo: zero de ingestão e zero de backfill — é resolvido **na leitura**, então trocar a função já
muda a aba na próxima chamada.

## Quando é NULL (e por que não é zero)

Só existe lucro com os **dois** lados preenchidos e **> 0**:

```sql
'lucroEstimado', CASE
  WHEN b.valor > 0 AND b.ultima_negociacao > 0
    THEN round(b.valor - b.ultima_negociacao, 2)
END
```

O Pipefy guarda **`"0,00"` em campo não preenchido**. É o mesmo motivo pelo qual o resguardo da
`20260727d` ignora `valor_de_resguardo_N = 0`, e a mesma guarda que o insight "última negociação
abaixo da minuta final" já usava no cliente. Sem ela, card com negociação vazia viraria
"lucro = minuta inteira" e **inflaria o KPI da carteira** com dinheiro que não existe.

`NULL` = "não dá pra estimar" → a tela mostra "—", a soma não conta o card, e o CSV sai **vazio**
(não `0` — zero é um lucro válido e não pode ser confundido com ausência de dado).

## Sinal negativo é resultado, não erro

O lucro **pode ser negativo**: negociação fechada **acima** da minuta emitida. Não se usa
`GREATEST(..., 0)` — esconderia justamente o caso que o dono precisa enxergar. Na tela isso vira
vermelho e um insight próprio ("N card(s) com lucro estimado negativo").

## O que mudou na tela

| Onde | O quê |
|---|---|
| **Tabela** | Coluna **"Lucro Est."** depois de "Última Negociação", ordenável asc/desc como as outras. Cor pelo sinal: positivo em `success`, negativo em `destructive`, sem estimativa em "—". |
| **Trilho** | Cartão **"Lucro estimado"**: total grande colorido pelo sinal + os **dois lados da conta** (Σ Minuta Final / − Σ Últ. negociação) e a cobertura ("N de M card(s) com os dois valores"). Acompanha o filtro Ativos/Inativos/Todos, como o resguardo — não o bucket clicado. |
| **Insights** | Novo: **lucro estimado negativo**, com a perda acumulada e drill nos cards (detalhe mostra `minuta − negociação = lucro`). |
| **CSV** | Coluna **"Lucro Estimado"** entre "Última Negociação" e "Resguardado". |

O cartão do trilho é **modelado na "Margem" por departamento do painel do CEO**
(`CeoSaudeEquipe.tsx`): resultado grande em cima colorido pelo sinal, e os componentes da conta
logo abaixo num `<dl>`, pra dar pra conferir a subtração de olho. Mesma linguagem visual, outro
domínio.

## Performance

O agregado sai em **uma passada só** sobre o recorte (`useMemo` em `filtered`), devolvendo de uma
vez: total, cobertura, os dois somatórios do cartão e **a lista dos cards negativos**, que o memo
dos insights **reaproveita** em vez de varrer `filtered` de novo. Uma iteração a mais no total, e
nenhuma alocação além do array dos negativos. O valor por card não é recalculado em nenhum lugar
— vem pronto da RPC.

## Aplicação — feita

A migration rodou no SQL editor do Supabase em **12/ago/2026**. Nada mais era necessário: o valor
é resolvido **na leitura**, então a coluna populou na chamada seguinte, **sem** backfill, **sem**
reingestão e **sem** re-rodar o Make.

Pra reconferir a qualquer momento, os 5 `SELECT`s no rodapé da migration continuam válidos —
valem principalmente **depois de qualquer mexida na `get_cs_minutas()`**:

1. a conta bate (derivado × subtração crua);
2. nenhuma linha sai com conta errada (tem que ser **zero**);
3. nenhum card com lado vazio/zero tem lucro (tem que ser **zero**);
4. cobertura + total da carteira + quantos negativos;
5. resguardo e `% desc.` intactos.

> ⚠️ **Armadilha viva (a mesma da `20260811`):** a `20260727d` tem um `CREATE OR REPLACE` da
> **mesma** `get_cs_minutas()`, na versão **sem** o lucro. Reexecutar aquele arquivo **desfaz esta
> migration em silêncio** — sem erro, a coluna só volta a ficar vazia. A `20260812` é a **última
> palavra** sobre essa RPC; se um dia precisar reaplicar a `20260727d`, rode a `20260812` logo em
> seguida e refaça a conferência acima.
>
> O frontend não quebra nesse cenário: `lucroEstimado` ausente chega `undefined`, cai no ramo "—"
> e o KPI mostra cobertura `0`. É por isso que o comparador de ordenação usa `== null`.

## Ponto em aberto pro dono

O insight **"última negociação abaixo da minuta final"** (da `20260727d`) marca em **vermelho**
exatamente o caso em que o lucro estimado é **positivo** — os dois leem o mesmo número
(`Minuta Final − Última Negociação`) com sinais opostos: lá é "renegociação pra baixo", aqui é
margem. **Ficou como estava**, porque a regra antiga foi uma decisão consciente de 27/jul e pode
existir por outro motivo (reconhecimento de receita, p.ex.).

Se a leitura nova é a que vale, o ajuste é trocar aquele insight pelo par natural do lucro
(destaque de **maior** lucro / concentração de margem) e deixar o vermelho só pro caso negativo.
**Decisão do dono.**

## Segurança

Sem `localStorage`, sem `sessionStorage`, sem cookie novo — o valor vive no estado do React
enquanto a aba está aberta e some no reload, como o resto da P3. Nenhuma variável de ambiente
nova. A RPC segue `SECURITY INVOKER` (default): quem escopa continua sendo o **RLS de
`cs_cards`** — o lucro é derivado de campos do card, então quem não podia ver a minuta continua
não vendo o lucro. `GRANT EXECUTE` só pra `authenticated`, igual às irmãs.

## Arquivos

- `supabase/migrations/Migrations_painelcs/20260812_cs_minutas_lucro_estimado.sql` — RPC
  `get_cs_minutas()` com `lucroEstimado` (auto-contida, forward-only, idempotente).
- `src/lib/types/database.ts` — `lucroEstimado: number | null` em `CsMinutaCard`.
- `src/features/cs/components/CsMinutas.tsx` — coluna + ordenação, cartão do trilho, insight,
  CSV, legenda. Também endurece o comparador de ordenação (`== null` em vez de `=== null`), que
  antes viraria `NaN` pra qualquer campo novo ainda não devolvido pela RPC.
