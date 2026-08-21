'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Users,
  Loader2,
  Handshake,
  Inbox,
  Download,
  ExternalLink,
  X,
  MessageSquare,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { PeriodPicker } from '@/components/bluedesk/PeriodPicker'
import { currentCycle, type LeadPeriod } from '@/lib/period'
import { getCsTeam } from '@/app/actions/cs'
import { downloadCsv, type CsvValue } from '@/lib/csv'
import { cn } from '@/lib/utils'
import type {
  CsTeamData,
  CsTeamNegotiationAgent,
  CsNegotiationClass,
  CsTeamActivityAgent,
} from '@/lib/types/database'

// PÁGINA 2 do painel de CS — EQUIPE. DUAS seções, ambas filtradas pelo PERÍODO:
//
//   1) Atualizações no período por QUEM COMENTOU (`cs_card_comments.author_pipefy_id`),
//      migration 20260819. Independe de quem é o card: comentário do Charles num card da
//      Larissa conta pro Charles. Unidade = 1 comentário = 1 atualização, com drill de 2
//      níveis (pessoa → card → os comentários exatos que entraram na conta — nunca "o último
//      comentário do card", que pode ser de outra pessoa).
//      As colunas Recebidos e Carteira nesta MESMA tabela vêm do OUTRO eixo (o assignee do
//      card) — estão aqui só como contexto de volume, a pedido do dono. O encontro dos dois
//      eixos é `cs_agents.pipefy_user_id` = `author_pipefy_id`.
//   2) Negociações feitas no período por RESPONSÁVEL PELA NEGOCIAÇÃO — o campo da fase
//      ("Quem realizou a Negociação?"), não o assignee (decisão do dono 2026-07-31, migration
//      20260731b). Total/Completas/Parcial/Incompletas, com drill-down: clica num número →
//      cards daquele recorte, campos faltando e link Pipefy. É a ÚNICA seção que ainda usa
//      classificação de completude — decisão explícita do dono em 2026-08-19.
//
// ⚠ O bloco de MOVIMENTO saiu nessa mesma data ("não vamos mais trabalhar com movido / com
// atualização e etc. Apenas atualizado"). Não reintroduzir: "quem moveu" não existe na
// GraphQL do Pipefy (o type PhaseDetail não tem usuário) e o webhook `card.move` foi
// descartado em 2026-08-14 — qualquer coluna de movimento por pessoa seria por DONO do card,
// que é o bug que originou toda essa mudança.
//
// A seção 1 vale retroativo (os autores já estão gravados desde abr/2025); a 2 depende do
// snapshot que o Make acumula. Ver docs/painelcs-docs/updates/painel-sucesso-cliente-cs.md.

// Tolera null/undefined de propósito: este helper formata TODO número da tela, e um campo
// faltando no jsonb da RPC (banco uma migration atrás) não pode derrubar a página inteira
// num `undefined.toLocaleString` — foi exatamente o que aconteceu em 19/ago.
const nf = (n: number | null | undefined) => (typeof n === 'number' ? n : 0).toLocaleString('pt-BR')
const pipefyUrl = (id: string) => `https://app.pipefy.com/open-cards/${id}`

// Data+hora do comentário, em BRT. O drill precisa da HORA, não só do dia: é o que deixa
// casar a linha da tela com o comentário no Pipefy quando a mesma pessoa comentou várias
// vezes no mesmo card no mesmo dia.
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

// Chave estável do autor pra seleção — `authorId` é nullable e não dá pra usar direto.
const actKey = (a: CsTeamActivityAgent) => a.authorId ?? '__sem_autor__'

// Classes de completude (bom→ruim) — status palette, sempre com rótulo.
const NEG_CLASSES: { key: CsNegotiationClass; label: string; text: string }[] = [
  { key: 'completa', label: 'Completas', text: 'text-success' },
  { key: 'parcial', label: 'Parcialmente', text: 'text-warning' },
  { key: 'incompleta', label: 'Incompletas', text: 'text-destructive' },
]

function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: typeof MessageSquare
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
      <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
        <div className="rounded-lg bg-background/60 p-1.5 text-primary shadow-glow">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="relative mt-2 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </div>
      {sub && <div className="relative mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

const classLabel = (cls: CsNegotiationClass): string =>
  NEG_CLASSES.find((c) => c.key === cls)?.label ?? cls

// Sufixo de arquivo pelo período (as duas seções são filtradas por ele, então a planilha
// precisa dizer de quando é). ISO cru — não tem espaço nem barra, então é seguro em nome
// de arquivo, diferente do `period.label` ("Ciclo 11/10 · ago/26").
const periodSlug = (d: CsTeamData): string => `${d.periodStart.slice(0, 10)}_${d.periodEnd.slice(0, 10)}`

// Recorte selecionado no drill. A chave é o VALOR do campo da fase (texto), não um id de
// agente — cards sem o campo preenchido caem todos no mesmo balde (negotiator = null).
type NegSel = { negotiator: string | null; negotiatorName: string; cls: 'total' | CsNegotiationClass }

export function CsTeam() {
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCycle())
  const [data, setData] = useState<CsTeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [negSel, setNegSel] = useState<NegSel | null>(null)
  // Drill de atividade em DOIS níveis: pessoa aberta → card aberto dentro dela.
  const [actSel, setActSel] = useState<string | null>(null)
  const [actCardSel, setActCardSel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNegSel(null)
    setActSel(null)
    setActCardSel(null)
    getCsTeam(period)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        // A action já degrada pra vazio em erro de banco; aqui só evitamos rejeição solta.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  const negotiations = useMemo(() => data?.negotiations ?? [], [data])
  const activity = useMemo(() => data?.activity ?? [], [data])
  const nt = data?.negotiationTotals
  const at = data?.activityTotals

  // Cards do drill-down selecionado.
  const drill = useMemo(() => {
    if (!negSel) return null
    const agent = negotiations.find((a) => a.negotiator === negSel.negotiator)
    if (!agent) return null
    const cards =
      negSel.cls === 'total' ? agent.cards : agent.cards.filter((c) => c.cls === negSel.cls)
    const label = negSel.cls === 'total' ? 'todas' : NEG_CLASSES.find((c) => c.key === negSel.cls)?.label
    return { cards, label }
  }, [negSel, negotiations])

  // ── Export ────────────────────────────────────────────────────────────────
  // As duas seções desta aba têm GRANULARIDADE DIFERENTE, então saem em dois arquivos, não
  // num só: juntar linha de card com linha de responsável numa planilha só produziria uma
  // tabela que não soma nem filtra direito. Ambos os botões respeitam o período selecionado.

  // Negociações: uma linha por CARD, URL na primeira coluna (regra do dono, 11/ago — vale pra
  // toda exportação do painel). Cada card aparece sob UM único negociador (o agrupamento é
  // pelo valor do campo da fase), então achatar os agentes não duplica linha. Exporta sempre o
  // período inteiro, não o drill: as colunas "Responsável" e "Completude" já deixam refazer
  // qualquer recorte na planilha, e assim o botão não depende de estado invisível no CSV.
  function exportNegociacoes() {
    if (!data) return
    const head = [
      'URL do card', 'ID', 'Cliente', 'Responsável pela negociação', 'Completude',
      'Campos faltando', 'Qtd. faltando', 'Período (início)', 'Período (fim)',
    ]
    const start = data.periodStart.slice(0, 10)
    const end = data.periodEnd.slice(0, 10)
    const rows: CsvValue[][] = data.negotiations.flatMap((a) =>
      a.cards.map((c) => [
        pipefyUrl(c.pipefyCardId),
        c.pipefyCardId,
        c.title ?? '',
        a.negotiatorName,
        classLabel(c.cls),
        c.missing.join(', '),
        c.missing.length,
        start,
        end,
      ]),
    )
    downloadCsv(`cs-equipe-negociacoes-${periodSlug(data)}`, head, rows)
  }

  // Atividade: uma linha por COMENTÁRIO — que é a unidade da métrica (1 comentário = 1
  // atualização). Achatar pra card perderia justamente o que o dono pediu pra conseguir
  // auditar: QUAL comentário entrou na conta. URL na primeira coluna (regra do dono).
  function exportAtividade() {
    if (!data) return
    const head = [
      'URL do card', 'ID', 'Cliente', 'Fase atual', 'Responsável do card',
      'Quem atualizou', 'Data da atualização', 'Comentário',
      'Período (início)', 'Período (fim)',
    ]
    const start = data.periodStart.slice(0, 10)
    const end = data.periodEnd.slice(0, 10)
    const rows: CsvValue[][] = data.activity.flatMap((a) =>
      a.cardsList.flatMap((c) =>
        c.comments.map((k) => [
          pipefyUrl(c.pipefyCardId),
          c.pipefyCardId,
          c.title ?? '',
          c.currentPhase ?? '',
          c.responsibleName,
          a.authorName,
          fmtDateTime(k.createdAt),
          k.text ?? '',
          start,
          end,
        ]),
      ),
    )
    downloadCsv(`cs-equipe-atividade-${periodSlug(data)}`, head, rows)
  }

  function toggleAct(agent: CsTeamActivityAgent) {
    const key = actKey(agent)
    setActSel((cur) => (cur === key ? null : key))
    setActCardSel(null) // trocar de pessoa fecha o card aberto da anterior
  }

  function toggleNeg(agent: CsTeamNegotiationAgent, cls: 'total' | CsNegotiationClass, count: number) {
    if (count === 0) return
    setNegSel((cur) =>
      cur && cur.negotiator === agent.negotiator && cur.cls === cls
        ? null
        : { negotiator: agent.negotiator, negotiatorName: agent.negotiatorName, cls },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Barra de controle: período ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4 text-primary" />
          <span>
            Equipe no período{' '}
            <span className="font-medium text-foreground">{period.label}</span>.
          </span>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <PeriodPicker value={period} onChange={setPeriod} disabled={loading} />
      </div>

      {data === null ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-border bg-gradient-card text-sm text-muted-foreground shadow-card">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          {/* ── KPIs do período ─────────────────────────────────────────────── */}
          <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-3', loading && 'opacity-60')}>
            <Stat
              label="Atualizações"
              value={nf(at?.updates ?? 0)}
              sub={`${nf(at?.people ?? 0)} pessoa(s) · ${nf(at?.cards ?? 0)} card(s)`}
              icon={MessageSquare}
            />
            <Stat
              label="Cards recebidos"
              value={nf(at?.received ?? 0)}
              sub={`${nf(at?.portfolio ?? 0)} na carteira da equipe`}
              icon={Inbox}
            />
            <Stat label="Negociações feitas" value={nf(nt?.total ?? 0)} sub="mudança nos 5 campos" icon={Handshake} />
          </div>

          {/* ── Atividade no período (por quem comentou) ─────────────────────── */}
          <section className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <MessageSquare className="h-4 w-4 text-primary" /> Atualizações no período
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Por <span className="font-medium text-foreground">quem comentou</span>, independente
                  de quem é o card — comentário seu num card de outra pessoa conta para você. Cada
                  comentário é uma atualização. Clique no número para ver os cards, e no card para ver
                  os comentários exatos que entraram na conta.{' '}
                  <span className="text-muted-foreground/80">
                    Recebidos e Carteira são do outro eixo (responsável do card), só para contexto.
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={exportAtividade}
                disabled={loading || activity.length === 0}
                title="Exporta uma linha por comentário (com a URL do card) — mesma granularidade da métrica."
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar
              </button>
            </div>

            {activity.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum comentário neste período.
              </p>
            ) : (
              <div className="scrollbar-slim max-h-[560px] overflow-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-background/95 backdrop-blur">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Quem atualizou
                      </th>
                      <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-foreground">
                        Atualizações
                      </th>
                      <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Cards
                      </th>
                      <th
                        className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                        title="Cards que passaram a ser responsabilidade dela no período (troca de responsável no Pipefy)."
                      >
                        Recebidos
                      </th>
                      <th
                        className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                        title="Cards ativos sob responsabilidade dela agora. Não conta card em fase terminal (Quitados, Distratos, Concluído, Arquivado, Distribuição Processual)."
                      >
                        Carteira
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((a) => {
                      const key = actKey(a)
                      const open = actSel === key
                      return (
                        <Fragment key={key}>
                          <tr
                            className={cn(
                              'border-t border-border/60 transition-colors',
                              open && 'bg-primary/10',
                            )}
                          >
                            <th
                              scope="row"
                              className="max-w-[240px] truncate px-3 py-1.5 text-left text-xs font-medium text-foreground"
                              title={a.authorName}
                            >
                              <button
                                type="button"
                                onClick={() => toggleAct(a)}
                                className="flex w-full items-center gap-1.5 text-left transition-colors hover:text-primary"
                                aria-expanded={open}
                              >
                                {open ? (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                                )}
                                <span className="truncate">{a.authorName}</span>
                              </button>
                            </th>
                            <td className="p-0">
                              <button
                                type="button"
                                onClick={() => toggleAct(a)}
                                className={cn(
                                  'flex h-9 w-full items-center justify-center text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-primary/10',
                                  open && 'outline outline-2 -outline-offset-2 outline-primary',
                                )}
                              >
                                {nf(a.updates)}
                              </button>
                            </td>
                            <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                              {nf(a.cards)}
                            </td>
                            <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                              {nf(a.received)}
                            </td>
                            <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                              {nf(a.portfolio)}
                            </td>
                          </tr>

                          {/* Nível 2: cards em que essa pessoa comentou */}
                          {open && (
                            <tr className="border-t border-border/60 bg-background/40">
                              <td colSpan={5} className="p-2">
                                {a.cardsList.length === 0 && (
                                  // Linha de quem TEM carteira mas não comentou no período —
                                  // é o que sobrou do antigo bucket "Sem mover/atualizar".
                                  <p className="px-1 py-2 text-xs text-muted-foreground">
                                    Nenhuma atualização neste período.{' '}
                                    {a.portfolio > 0
                                      ? `Tem ${nf(a.portfolio)} card(s) na carteira.`
                                      : 'E não tem cards na carteira.'}
                                  </p>
                                )}
                                <div className="flex flex-col gap-1.5">
                                  {a.cardsList.map((c) => {
                                    const cardOpen = actCardSel === c.pipefyCardId
                                    return (
                                      <div
                                        key={c.pipefyCardId}
                                        className="rounded-lg border border-border bg-background/60"
                                      >
                                        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setActCardSel((cur) =>
                                                cur === c.pipefyCardId ? null : c.pipefyCardId,
                                              )
                                            }
                                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                            aria-expanded={cardOpen}
                                          >
                                            {cardOpen ? (
                                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                                            ) : (
                                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                                            )}
                                            <span className="min-w-0">
                                              <span
                                                className="block truncate text-xs font-medium text-foreground"
                                                title={c.title ?? undefined}
                                              >
                                                {c.title || `Card ${c.pipefyCardId}`}
                                              </span>
                                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                                {c.currentPhase ?? 'sem fase'} · card de{' '}
                                                <span className="text-foreground">{c.responsibleName}</span>
                                              </span>
                                            </span>
                                          </button>
                                          <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">
                                            {nf(c.updates)}
                                          </span>
                                          <a
                                            href={pipefyUrl(c.pipefyCardId)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title="Abrir no Pipefy"
                                            className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-primary"
                                          >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                          </a>
                                        </div>

                                        {/* Nível 3: OS comentários contabilizados. Não é
                                            "último comentário do card" — são só os desta
                                            pessoa, dentro do período. */}
                                        {cardOpen && (
                                          <div className="flex flex-col gap-1.5 border-t border-border/60 p-2">
                                            {c.comments.map((k) => (
                                              <div
                                                key={k.commentId}
                                                className="rounded-md border border-border/60 bg-gradient-card px-2.5 py-1.5"
                                              >
                                                <div className="text-[11px] font-medium text-primary">
                                                  {fmtDateTime(k.createdAt)}
                                                </div>
                                                <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-foreground">
                                                  {k.text?.trim() || (
                                                    <span className="italic text-muted-foreground">
                                                      (comentário sem texto)
                                                    </span>
                                                  )}
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Negociações feitas no período (com drill-down) ──────────────── */}
          <section className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Handshake className="h-4 w-4 text-primary" /> Negociações feitas no período
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Cards com mudança nos 5 campos no período, pelo campo{' '}
                  <span className="font-medium text-foreground">Quem realizou a Negociação?</span> da
                  fase de negociação — não pelo responsável do card. Clique num número para ver os
                  cards, o que falta e o link do Pipefy.
                </p>
              </div>
              <button
                type="button"
                onClick={exportNegociacoes}
                disabled={loading || !nt || nt.total === 0}
                title="Exporta uma linha por card (com a URL do Pipefy), de todos os responsáveis do período — não só do recorte aberto."
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar
              </button>
            </div>

            {!nt || nt.total === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma negociação feita neste período ainda.
              </p>
            ) : (
              <>
                <div className="scrollbar-slim overflow-auto rounded-xl border border-border">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-background/95">
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Responsável pela negociação
                        </th>
                        <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-foreground">
                          Total
                        </th>
                        {NEG_CLASSES.map((c) => (
                          <th
                            key={c.key}
                            className={cn(
                              'px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider',
                              c.text,
                            )}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {negotiations.map((a) => (
                        <tr key={a.negotiator ?? 'none'} className="border-t border-border/60">
                          <th
                            scope="row"
                            className={cn(
                              'max-w-[200px] truncate px-3 py-1.5 text-left text-xs font-medium',
                              a.negotiator ? 'text-foreground' : 'text-muted-foreground',
                            )}
                            title={a.negotiatorName}
                          >
                            {a.negotiatorName}
                          </th>
                          <NegCell agent={a} cls="total" value={a.total} sel={negSel} onClick={toggleNeg} strong />
                          <NegCell agent={a} cls="completa" value={a.completa} sel={negSel} onClick={toggleNeg} tone="text-success" />
                          <NegCell agent={a} cls="parcial" value={a.parcial} sel={negSel} onClick={toggleNeg} tone="text-warning" />
                          <NegCell agent={a} cls="incompleta" value={a.incompleta} sel={negSel} onClick={toggleNeg} tone="text-destructive" />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Drill-down do recorte selecionado */}
                {negSel && drill && (
                  <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-foreground" title={negSel.negotiatorName}>
                          {negSel.negotiatorName}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {drill.label} · {drill.cards.length} card(s)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNegSel(null)}
                        className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Fechar detalhamento"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {drill.cards.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem cards neste recorte.</p>
                    ) : (
                      <div className="scrollbar-slim flex max-h-[320px] flex-col gap-1.5 overflow-auto">
                        {drill.cards.map((c) => (
                          <a
                            key={c.pipefyCardId}
                            href={pipefyUrl(c.pipefyCardId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 py-2 transition-colors hover:bg-background"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-foreground" title={c.title ?? undefined}>
                                {c.title || `Card ${c.pipefyCardId}`}
                              </div>
                              <div className="mt-0.5 text-[11px]">
                                {c.missing.length === 0 ? (
                                  <span className="text-success">5/5 campos preenchidos</span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Falta: <span className="text-destructive">{c.missing.join(', ')}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function NegCell({
  agent,
  cls,
  value,
  sel,
  onClick,
  tone,
  strong,
}: {
  agent: CsTeamNegotiationAgent
  cls: 'total' | CsNegotiationClass
  value: number
  sel: NegSel | null
  onClick: (agent: CsTeamNegotiationAgent, cls: 'total' | CsNegotiationClass, value: number) => void
  tone?: string
  strong?: boolean
}) {
  const active = sel?.negotiator === agent.negotiator && sel?.cls === cls
  return (
    <td className="p-0">
      <button
        type="button"
        onClick={() => onClick(agent, cls, value)}
        disabled={value === 0}
        className={cn(
          'flex h-9 w-full items-center justify-center text-xs tabular-nums transition-colors',
          value === 0 ? 'cursor-default text-muted-foreground/40' : 'hover:bg-primary/10',
          strong ? 'font-semibold text-foreground' : tone,
          active && 'bg-primary/15 outline outline-2 -outline-offset-2 outline-primary',
        )}
      >
        {nf(value)}
      </button>
    </td>
  )
}
