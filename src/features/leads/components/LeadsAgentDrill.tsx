'use client'

import { useEffect, useState } from 'react'
import { X, ExternalLink, Loader2, ChevronRight } from 'lucide-react'
import {
  getLeadsDrillAgents,
  getLeadsDrillCards,
  type LeadDrillDimension,
  type LeadDrillAgent,
  type LeadDrillCard,
} from '@/app/actions/leads'
import type { LeadPeriod } from '@/lib/period'

// Drill de card por responsável (aba Funil) — 2 níveis lazy. Aparece inline abaixo do
// gráfico ao clicar numa barra: lista os responsáveis daquele recorte (nível 1); clicar num
// responsável expande os CARDS dele com link pro Pipefy (nível 2). Compartilhado pelos 4
// gráficos (Funil, Distribuição por fase, Funil geral, Distribuição atual) via `dimension`.
const pipefyUrl = (id: string) => `https://app.pipefy.com/open-cards/${id}`
const ORPHAN = '∅' // chave local do bucket "Sem responsável" (agentId null)

export function LeadsAgentDrill({
  dimension,
  dimKey,
  title,
  period,
  onClose,
}: {
  dimension: LeadDrillDimension
  dimKey: string
  title: string
  period: LeadPeriod
  onClose: () => void
}) {
  const [agents, setAgents] = useState<LeadDrillAgent[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [cards, setCards] = useState<Record<string, LeadDrillCard[]>>({})
  const [loadingCards, setLoadingCards] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setAgents(null)
    setOpenId(null)
    setCards({})
    getLeadsDrillAgents(dimension, dimKey, period)
      .then((a) => {
        if (!cancelled) setAgents(a)
      })
      .catch(() => {
        if (!cancelled) setAgents([])
      })
    return () => {
      cancelled = true
    }
  }, [dimension, dimKey, period])

  const max = agents ? agents.reduce((m, r) => Math.max(m, r.count), 0) || 1 : 1
  const keyOf = (a: LeadDrillAgent) => a.agentId ?? ORPHAN

  async function toggle(a: LeadDrillAgent) {
    const k = keyOf(a)
    if (openId === k) {
      setOpenId(null)
      return
    }
    setOpenId(k)
    if (!cards[k]) {
      setLoadingCards(k)
      const c = await getLeadsDrillCards(dimension, dimKey, a.agentId, period).catch(() => [])
      setCards((cur) => ({ ...cur, [k]: c }))
      setLoadingCards(null)
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-background/40 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-xs font-semibold text-foreground" title={title}>
          {title} · por responsável
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Fechar detalhamento"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {agents === null ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
        </div>
      ) : agents.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem leads para detalhar.</p>
      ) : (
        <ul className="space-y-0.5">
          {agents.map((a) => {
            const k = keyOf(a)
            const open = openId === k
            const list = cards[k]
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => toggle(a)}
                  className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left transition-colors hover:bg-primary/10"
                  aria-expanded={open}
                >
                  <ChevronRight
                    className={
                      'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ' +
                      (open ? 'rotate-90' : '')
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={a.name}>
                    {a.name}
                  </span>
                  <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted/40 sm:block">
                    <div
                      className="h-full bg-primary/60"
                      style={{ width: `${Math.round((a.count / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right tabular-nums text-xs text-foreground">
                    {a.count.toLocaleString('pt-BR')}
                  </span>
                </button>

                {open && (
                  <div className="mb-1 ml-6 mt-0.5">
                    {loadingCards === k ? (
                      <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Carregando cards…
                      </div>
                    ) : (list?.length ?? 0) === 0 ? (
                      <p className="py-1 text-[11px] text-muted-foreground">Sem cards.</p>
                    ) : (
                      <div className="scrollbar-slim flex max-h-60 flex-col gap-0.5 overflow-auto pr-1">
                        {list!.map((c) => (
                          <a
                            key={c.pipefyCardId}
                            href={pipefyUrl(c.pipefyCardId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center justify-between gap-2 rounded px-2 py-1 text-[11px] transition-colors hover:bg-primary/10"
                          >
                            <span className="min-w-0 truncate text-foreground" title={c.title ?? undefined}>
                              {c.title || `Card ${c.pipefyCardId}`}
                            </span>
                            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
