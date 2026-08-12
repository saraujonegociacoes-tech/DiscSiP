'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Users,
  Loader2,
  ArrowRightLeft,
  Handshake,
  Inbox,
  Info,
  Download,
  ExternalLink,
  X,
} from 'lucide-react'
import { PeriodPicker } from '@/components/bluedesk/PeriodPicker'
import { currentCycle, type LeadPeriod } from '@/lib/period'
import { getCsTeam } from '@/app/actions/cs'
import { downloadCsv, type CsvValue } from '@/lib/csv'
import { cn } from '@/lib/utils'
import type { CsTeamData, CsTeamNegotiationAgent, CsNegotiationClass } from '@/lib/types/database'

// PÁGINA 2 do painel de CS — EQUIPE. Duas seções, ambas filtradas pelo PERÍODO:
//   1) Movimento no período por RESPONSÁVEL DO CARD (assignee): recebidos + 4 buckets
//      moveu×comentou.
//   2) Negociações feitas no período por RESPONSÁVEL PELA NEGOCIAÇÃO — o campo da fase
//      ("Quem realizou a Negociação?"), não o assignee (decisão do dono 2026-07-31, migration
//      20260731b). Total/Completas/Parcial/Incompletas, com drill-down: clica num número →
//      cards daquele recorte, campos faltando e link Pipefy.
// Os dois eixos divergem de propósito: o card fica com o consultor do acompanhamento mensal
// enquanto a negociação pode ter sido feita por outra pessoa.
// Série temporal: nasce ~vazia e enche conforme o Make acumula. Ver docs/updates/
// painel-sucesso-cliente-cs.md.

const nf = (n: number) => n.toLocaleString('pt-BR')
const pipefyUrl = (id: string) => `https://app.pipefy.com/open-cards/${id}`

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
  icon: typeof ArrowRightLeft
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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNegSel(null)
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

  const movement = data?.movement ?? []
  const negotiations = useMemo(() => data?.negotiations ?? [], [data])
  const mt = data?.movementTotals
  const nt = data?.negotiationTotals

  const hasMovement = useMemo(() => {
    if (!mt) return false
    return mt.movedWithUpdate + mt.movedNoUpdate + mt.onlyUpdate + mt.received > 0
  }, [mt])

  const movedTotal = mt ? mt.movedWithUpdate + mt.movedNoUpdate : 0

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

  // Movimento: uma linha por RESPONSÁVEL, sem URL — e isso não é esquecimento da regra. A
  // `get_cs_team` devolve só as CONTAGENS por responsável (`CsTeamMovementAgent`), não os ids
  // dos cards; não existe card por trás da linha pra linkar. Se um dia isso for preciso, o
  // caminho é a RPC passar a devolver os cards do movimento (como já faz nas negociações), não
  // inventar URL aqui.
  function exportMovimento() {
    if (!data) return
    const head = [
      'Responsável', 'Recebidos', 'Movimentados (total)', 'Movido c/ atualização',
      'Movido s/ atualização', 'Só atualização', 'Sem mover/atualizar', 'Período (início)',
      'Período (fim)',
    ]
    const start = data.periodStart.slice(0, 10)
    const end = data.periodEnd.slice(0, 10)
    const rows: CsvValue[][] = data.movement.map((a) => [
      a.agentName,
      a.received,
      a.movedWithUpdate + a.movedNoUpdate,
      a.movedWithUpdate,
      a.movedNoUpdate,
      a.onlyUpdate,
      a.idle,
      start,
      end,
    ])
    downloadCsv(`cs-equipe-movimento-${periodSlug(data)}`, head, rows)
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
              label="Movimentados"
              value={nf(movedTotal)}
              sub={`${nf(mt?.movedWithUpdate ?? 0)} c/ atualização`}
              icon={ArrowRightLeft}
            />
            <Stat label="Negociações feitas" value={nf(nt?.total ?? 0)} sub="mudança nos 5 campos" icon={Handshake} />
            <Stat label="Cards recebidos" value={nf(mt?.received ?? 0)} icon={Inbox} />
          </div>

          {/* ── Movimento no período ────────────────────────────────────────── */}
          <section className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <ArrowRightLeft className="h-4 w-4 text-primary" /> Movimento no período
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Por responsável do card, sobre os cards ativos. Ignora entrada/saída de Negociação
                  e Aguardando pagamento.
                </p>
              </div>
              <button
                type="button"
                onClick={exportMovimento}
                disabled={loading || movement.length === 0}
                title="Exporta uma linha por responsável (é a granularidade desta seção — a RPC não devolve os cards do movimento, então não há URL pra linkar)."
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar
              </button>
            </div>

            {!hasMovement && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  A série temporal ainda está acumulando — movimento, atualização e recebidos
                  aparecem conforme o Make sincroniza. Por ora tudo cai em{' '}
                  <span className="font-medium text-foreground">Sem mover/atualizar</span>.
                </span>
              </div>
            )}

            {movement.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem cards ativos neste recorte.
              </p>
            ) : (
              <div className="scrollbar-slim max-h-[520px] overflow-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-background/95 backdrop-blur">
                      <th className="sticky left-0 z-20 bg-background/95 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Responsável
                      </th>
                      {[
                        'Recebidos',
                        'Movido c/ atualização',
                        'Movido s/ atualização',
                        'Só atualização',
                        'Sem mover/atualizar',
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movement.map((a) => (
                      <tr key={a.agentId ?? 'none'} className="border-t border-border/60">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 max-w-[200px] truncate bg-gradient-card px-3 py-1.5 text-left text-xs font-medium text-foreground"
                          title={a.agentName}
                        >
                          {a.agentName}
                        </th>
                        <td className="px-3 py-1.5 text-center text-xs font-semibold tabular-nums text-foreground">
                          {nf(a.received)}
                        </td>
                        <td className="px-3 py-1.5 text-center text-xs tabular-nums text-success">
                          {nf(a.movedWithUpdate)}
                        </td>
                        <td className="px-3 py-1.5 text-center text-xs tabular-nums text-foreground">
                          {nf(a.movedNoUpdate)}
                        </td>
                        <td className="px-3 py-1.5 text-center text-xs tabular-nums text-foreground">
                          {nf(a.onlyUpdate)}
                        </td>
                        <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                          {nf(a.idle)}
                        </td>
                      </tr>
                    ))}
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
