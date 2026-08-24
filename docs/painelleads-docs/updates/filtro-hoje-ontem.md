# Filtro "Hoje" e "Ontem" nos seletores de período (transversal)

Mudança transversal: nasceu no dashboard de Leads, mas vale para **todos os painéis com filtro
de período**, porque o código do recorte é compartilhado (`src/lib/period.ts` + os dois seletores).

## Problema

Os seletores só ofereciam recortes longos — ciclo de meta 11→10, mês civil e intervalo livre.
Eles respondem "como foi o período"; ninguém conseguia responder "como está hoje" sem abrir o
Personalizado e digitar a mesma data duas vezes.

## O que mudou

`src/lib/period.ts` ganhou dois helpers, no mesmo contrato dos que já existiam (corte em BRT,
`end` **exclusivo**, `key` estável):

- `dayPeriod(daysAgo, now?)` — o dia BRT `daysAgo` dias atrás (`0` = hoje, `1` = ontem). O rótulo
  dos dois primeiros é nomeado (`"Hoje (24 ago)"`), para o painel que exibe `period.label` como
  descrição continuar legível; do terceiro em diante é só a data.
- `recentDays(now?)` — a lista dos seletores: hoje e ontem, nessa ordem. Mesma convenção de nome
  de `recentCycles` / `recentCivilMonths`.

A `key` desses períodos tem prefixo `dia_` (ex.: `dia_2026-08-24`). Sem o prefixo, o dia 11
colidiria com a `key` do ciclo que começa no dia 11, e o `<select>` teria dois `value` iguais.

Nos seletores, as opções passaram a ficar em `<optgroup>` — "Dia" primeiro, depois o recorte longo
do componente:

| Componente | Grupos do select |
|---|---|
| `src/components/bluedesk/PeriodPicker.tsx` | Dia · Ciclo 11→10 · Personalizado |
| `src/features/ceo/components/CeoPeriodPicker.tsx` | Dia · (Mês civil **ou** Ciclo 11→10, conforme o toggle) · Personalizado |
| `src/features/minutas/components/MinutasLista.tsx` | Todo o período · Dia · Mês civil · Ciclo 11→10 · Personalizado |

No `CeoPeriodPicker`, hoje/ontem aparecem nos **dois** modos do toggle: um dia não pertence a mês
nem a ciclo. Trocar o toggle continua reposicionando no período corrente daquele modo.

## Alcance

Os painéis não precisaram mudar — todos consomem um dos três seletores acima:

- Leads (`/leads`) e histórico da discadora (`/dashboard/historico`, `/softphone`) — `PeriodPicker`
- CS, abas Equipe e Pagamento — `PeriodPicker`
- CEO, abas Financeiro, Projeções e Saúde da Equipe — `CeoPeriodPicker`
- Minutas, Visão Geral (`CeoPeriodPicker`) e Lista (select próprio)

## Limitação conhecida

A lista é calculada uma vez por montagem (`useMemo`, igual aos ciclos e meses). Numa aba deixada
aberta atravessando a meia-noite, "Hoje" continua apontando para o dia anterior até o recarregar —
a data entre parênteses no rótulo deixa isso visível.
