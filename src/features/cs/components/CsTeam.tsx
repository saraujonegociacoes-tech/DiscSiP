'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Users,
  Loader2,
  ArrowRightLeft,
  Handshake,
  Inbox,
  Info,
  ExternalLink,
  X,
} from 'lucide-react'
import { PeriodPicker } from '@/components/bluedesk/PeriodPicker'
import { currentCycle, type LeadPeriod } from '@/lib/period'
import { getCsTeam } from '@/app/actions/cs'
import { cn } from '@/lib/utils'
import type { CsTeamData, CsTeamNegotiationAgent, CsNegotiationClass } from '@/lib/types/database'

// PÁGINA 2 do painel de CS — EQUIPE. Duas seções, ambas filtradas pelo PERÍODO:
//   1) Movimento no período por responsável (recebidos + 4 buckets moveu×comentou).
//   2) Negociações feitas no período por responsável (Total/Completas/Parcial/Incompletas),
//      com drill-down: clica num número → cards daquele recorte, campos faltando e link Pipefy.
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

type NegSel = { agentId: string | null; agentName: string; cls: 'total' | CsNegotiationClass }

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
    const agent = negotiations.find((a) => a.agentId === negSel.agentId)
    if (!agent) return null
    const cards =
      negSel.cls === 'total' ? agent.cards : agent.cards.filter((c) => c.cls === negSel.cls)
    const label = negSel.cls === 'total' ? 'todas' : NEG_CLASSES.find((c) => c.key === negSel.cls)?.label
    return { cards, label }
  }, [negSel, negotiations])

  function toggleNeg(agent: CsTeamNegotiationAgent, cls: 'total' | CsNegotiationClass, count: number) {
    if (count === 0) return
    setNegSel((cur) =>
      cur && cur.agentId === agent.agentId && cur.cls === cls
        ? null
        : { agentId: agent.agentId, agentName: agent.agentName, cls },
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
            <div className="mb-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <ArrowRightLeft className="h-4 w-4 text-primary" /> Movimento no período
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Por responsável, sobre os cards ativos. Ignora entrada/saída de Negociação e
                Aguardando pagamento.
              </p>
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
            <div className="mb-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Handshake className="h-4 w-4 text-primary" /> Negociações feitas no período
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Cards com mudança nos 5 campos no período, por responsável. Clique num número para
                ver os cards, o que falta e o link do Pipefy.
              </p>
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
                          Responsável
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
                        <tr key={a.agentId ?? 'none'} className="border-t border-border/60">
                          <th
                            scope="row"
                            className="max-w-[200px] truncate px-3 py-1.5 text-left text-xs font-medium text-foreground"
                            title={a.agentName}
                          >
                            {a.agentName}
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
                        <h3 className="truncate text-sm font-semibold text-foreground" title={negSel.agentName}>
                          {negSel.agentName}
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
  const active = sel?.agentId === agent.agentId && sel?.cls === cls
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
