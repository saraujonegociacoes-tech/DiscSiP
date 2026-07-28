'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, Download, ExternalLink, X } from 'lucide-react'
import { useTheme } from '@/components/bluedesk/theme'
import { BRT_TZ } from '@/lib/timezone'
import type { CsMatrixData, CsMatrixCard } from '@/lib/types/database'

// PÁGINA 1 do painel de CS — MATRIZ Fase × Tempo na fase (heatmap). Linhas = fases (ordem do
// funil), colunas = 4 janelas de TEMPO NA FASE ATUAL (há quanto tempo o card está parado na
// fase, sem avançar) + Total + Tempo médio na fase. Decisão do dono: as janelas medem o
// tempo na fase (recência), NÃO a idade do card — um card no 3º Mês contatado há 20 dias cai
// na janela 1-30, mesmo tendo >90 dias de vida. A cor da célula é um heat: a MATIZ vem da
// janela (frio→quente = recente→parado) e a INTENSIDADE vem do nº de cards. Fase inicial com
// cards há 181+ dias parados ganha alerta. Clique numa célula → painel lateral com os cards
// (mais parado → menos parado, com link do Pipefy).
//
// ⚠ Hoje `dwellDays` (tempo na fase) ~ idade para a maioria, porque quase não há eventos de
// transição reais (só backfill) e a RPC cai no created_at quando falta o evento de entrada na
// fase. Fica preciso quando o cenário do Make rodar e capturar as transições.
// Ver docs/painelcs-docs/updates/painel-sucesso-cliente-cs.md e cs-pagina1-alternativas-viz.txt.

const WINDOWS = [
  { key: '1-30', short: '1-30 dias', min: 0, max: 30 },
  { key: '31-90', short: '31-90 dias', min: 30, max: 90 },
  { key: '91-180', short: '91-180 dias', min: 90, max: 180 },
  { key: '181+', short: '181+ dias', min: 180, max: Infinity },
] as const

type WindowKey = (typeof WINDOWS)[number]['key']

// Matiz por janela de tempo na fase (recente→parado). Passos próprios por tema; o texto da
// célula é escolhido por luminância (preto/branco) pra manter contraste em qualquer intensidade.
const HUE_LIGHT = ['#2f6fd0', '#1a9e6f', '#d98a1f', '#cf4038']
const HUE_DARK = ['#3f80cf', '#20a87b', '#e0a437', '#e46b6b']
const SURFACE_LIGHT = '#fcfcfb'
const SURFACE_DARK = '#07133f'

// Alerta "card abandonado": fases pré-acompanhamento (Triagem/Apresentação/Negociação,
// ordem ≤ 2) com cards há 181+ dias PARADOS na fase. Ajustável num lugar só.
const PRE_ACCOMPANIMENT_MAX_ORDER = 2
const ALERT_WINDOW: WindowKey = '181+'

const DRILL_PREVIEW = 8 // cards mostrados antes de "Ver todos"

type StatusFilter = 'ativos' | 'inativos' | 'todos'
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ativos', label: 'Ativos' },
  { key: 'inativos', label: 'Inativos' },
  { key: 'todos', label: 'Todos' },
]

interface Rgb {
  r: number
  g: number
  b: number
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function relLuminance({ r, g, b }: Rgb): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

// Bucketa pelo TEMPO NA FASE (dwellDays), não pela idade — ver o cabeçalho do arquivo.
function windowOf(days: number): WindowKey | null {
  return WINDOWS.find((w) => days >= w.min && days < w.max)?.key ?? null
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: BRT_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function pipefyUrl(id: string): string {
  return `https://app.pipefy.com/open-cards/${id}`
}

interface Row {
  phaseId: string
  phase: string
  funnelOrder: number | null
  terminal: boolean
  windows: Record<WindowKey, CsMatrixCard[]>
  total: number
  avgDwell: number | null
}

interface Selection {
  phaseId: string
  windowKey: WindowKey | 'all'
}

export function CsMatrix({ data }: { data: CsMatrixData }) {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const hues = dark ? HUE_DARK : HUE_LIGHT
  const surface = hexToRgb(dark ? SURFACE_DARK : SURFACE_LIGHT)

  const [status, setStatus] = useState<StatusFilter>('ativos')
  const [selected, setSelected] = useState<Selection | null>(null)
  const [expanded, setExpanded] = useState(false)

  const filtered = useMemo(() => {
    if (status === 'ativos') return data.cards.filter((c) => c.active)
    if (status === 'inativos') return data.cards.filter((c) => !c.active)
    return data.cards
  }, [data.cards, status])

  // Uma linha por fase (só as com cards), na ordem do funil.
  const rows = useMemo<Row[]>(() => {
    const byPhase = new Map<
      string,
      { phase: string; funnelOrder: number | null; terminal: boolean; cards: CsMatrixCard[] }
    >()
    for (const c of filtered) {
      const key = c.phaseId ?? 'none'
      const e =
        byPhase.get(key) ??
        { phase: c.phase, funnelOrder: c.funnelOrder, terminal: !c.active, cards: [] }
      e.cards.push(c)
      byPhase.set(key, e)
    }
    const out: Row[] = [...byPhase.entries()].map(([phaseId, e]) => {
      const windows = { '1-30': [], '31-90': [], '91-180': [], '181+': [] } as Record<
        WindowKey,
        CsMatrixCard[]
      >
      for (const c of e.cards) {
        const w = windowOf(c.dwellDays)
        if (w) windows[w].push(c)
      }
      const avgDwell = e.terminal
        ? null
        : Math.round(e.cards.reduce((a, c) => a + c.dwellDays, 0) / e.cards.length)
      return { phaseId, phase: e.phase, funnelOrder: e.funnelOrder, terminal: e.terminal, windows, total: e.cards.length, avgDwell }
    })
    out.sort((a, b) => (a.funnelOrder ?? 9999) - (b.funnelOrder ?? 9999))
    return out
  }, [filtered])

  const globalMax = useMemo(() => {
    let m = 0
    for (const r of rows) for (const w of WINDOWS) m = Math.max(m, r.windows[w.key].length)
    return m || 1
  }, [rows])

  const total = filtered.length

  function cellStyle(count: number, windowIdx: number): React.CSSProperties {
    if (count === 0) return {}
    const hue = hexToRgb(hues[windowIdx])
    const ratio = Math.sqrt(count / globalMax)
    const alpha = 0.15 + 0.75 * ratio
    const blend = {
      r: Math.round(surface.r * (1 - alpha) + hue.r * alpha),
      g: Math.round(surface.g * (1 - alpha) + hue.g * alpha),
      b: Math.round(surface.b * (1 - alpha) + hue.b * alpha),
    }
    return {
      backgroundColor: `rgb(${blend.r},${blend.g},${blend.b})`,
      color: relLuminance(blend) > 0.5 ? '#0a1230' : '#ffffff',
    }
  }

  function isAlert(row: Row, windowKey: WindowKey, count: number): boolean {
    return (
      count > 0 &&
      windowKey === ALERT_WINDOW &&
      row.funnelOrder != null &&
      row.funnelOrder <= PRE_ACCOMPANIMENT_MAX_ORDER
    )
  }

  function changeStatus(next: StatusFilter) {
    setStatus(next)
    setSelected(null)
    setExpanded(false)
  }

  function selectCell(phaseId: string, windowKey: WindowKey | 'all') {
    setExpanded(false)
    setSelected((cur) =>
      cur && cur.phaseId === phaseId && cur.windowKey === windowKey ? null : { phaseId, windowKey },
    )
  }

  const drill = useMemo(() => {
    if (!selected) return null
    const row = rows.find((r) => r.phaseId === selected.phaseId)
    if (!row) return null
    const cards =
      selected.windowKey === 'all'
        ? row.total > 0
          ? WINDOWS.flatMap((w) => row.windows[w.key])
          : []
        : row.windows[selected.windowKey]
    // Mais parado primeiro (maior tempo na fase).
    const sorted = [...cards].sort((a, b) => b.dwellDays - a.dwellDays)
    const label = selected.windowKey === 'all' ? 'toda a fase' : windowLabel(selected.windowKey)
    return { phase: row.phase, label, cards: sorted }
  }, [selected, rows])

  function exportCsv() {
    const head = ['ID', 'Cliente', 'Responsável', 'Dias na fase', 'Idade (dias)', 'Fase', 'Janela (tempo na fase)', 'Situação']
    const cell = (v: string | number) => {
      const s = String(v)
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = filtered.map((c) =>
      [
        c.pipefyCardId,
        c.title ?? '',
        c.agentName,
        c.dwellDays,
        c.ageDays,
        c.phase,
        windowLabel(windowOf(c.dwellDays)),
        c.active ? 'Ativo' : 'Inativo',
      ]
        .map(cell)
        .join(';'),
    )
    const csv = '﻿' + [head.map(cell).join(';'), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cs-cards-${fmtDate(data.referenceAt).replace(/\s/g, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* ── Matriz ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Matriz Fase × Tempo na fase</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Colunas = há quanto tempo o card está parado na fase · foto de{' '}
              {fmtDate(data.referenceAt)} · clique numa célula para ver os cards.
            </p>
          </div>
          <div
            className="inline-flex rounded-lg border border-border bg-background/50 p-0.5"
            role="tablist"
            aria-label="Filtrar por situação do card"
          >
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={status === t.key}
                onClick={() => changeStatus(t.key)}
                className={
                  status === t.key
                    ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-glow'
                    : 'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Sem cards para esta situação no período.
          </p>
        ) : (
          <div className="scrollbar-slim max-h-[560px] overflow-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-background/95 backdrop-blur">
                  <th className="sticky left-0 z-20 bg-background/95 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Fase / Idade
                  </th>
                  {WINDOWS.map((w) => (
                    <th
                      key={w.key}
                      className={
                        'px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider ' +
                        (w.key === ALERT_WINDOW ? 'text-destructive' : 'text-muted-foreground')
                      }
                    >
                      {w.short}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Total
                  </th>
                  <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Tempo médio na fase
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.phaseId} className="border-t border-border/60">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-[180px] truncate bg-gradient-card px-3 py-1.5 text-left text-xs font-medium text-foreground"
                      title={row.phase}
                    >
                      {row.phase}
                    </th>
                    {WINDOWS.map((w, i) => {
                      const count = row.windows[w.key].length
                      const active =
                        selected?.phaseId === row.phaseId && selected?.windowKey === w.key
                      const alert = isAlert(row, w.key, count)
                      return (
                        <td key={w.key} className="p-0">
                          <button
                            type="button"
                            onClick={() => selectCell(row.phaseId, w.key)}
                            style={cellStyle(count, i)}
                            className={
                              'relative flex h-9 w-full items-center justify-center text-xs tabular-nums transition-[outline] ' +
                              (count === 0 ? 'text-muted-foreground/40 ' : 'font-medium ') +
                              (active ? 'outline outline-2 -outline-offset-2 outline-primary' : '')
                            }
                            aria-label={`${row.phase}, ${w.short}, ${count} cards`}
                          >
                            {count}
                            {alert && (
                              <AlertCircle
                                className="absolute right-1 top-1 h-3.5 w-3.5 text-destructive"
                                aria-label="Alerta: cards velhos em fase inicial"
                              />
                            )}
                          </button>
                        </td>
                      )
                    })}
                    <td className="p-0">
                      <button
                        type="button"
                        onClick={() => selectCell(row.phaseId, 'all')}
                        className={
                          'flex h-9 w-full items-center justify-center text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-primary/10 ' +
                          (selected?.phaseId === row.phaseId && selected?.windowKey === 'all'
                            ? 'outline outline-2 -outline-offset-2 outline-primary'
                            : '')
                        }
                      >
                        {row.total}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                      {row.avgDwell == null ? '–' : `${row.avgDwell} dias`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>Colunas = tempo do card na fase atual · cor da célula = nº de cards.</span>
          <span className="inline-flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-destructive" /> fase inicial com cards há 181+
            dias parados (possível card abandonado).
          </span>
        </p>
      </div>

      {/* ── Rail: total + export + drill-down ──────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Total de cards
              </div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                {total.toLocaleString('pt-BR')}
              </div>
            </div>
            <button
              type="button"
              onClick={exportCsv}
              disabled={total === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar
            </button>
          </div>
        </div>

        <div className="min-h-[200px] rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
          {!drill ? (
            <div className="flex h-full min-h-[168px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">
                Clique numa célula da matriz para listar os cards daquela fase e janela.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-destructive" title={drill.phase}>
                    {drill.phase}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {drill.label} · {drill.cards.length} cards
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Fechar detalhamento"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {drill.cards.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem cards neste recorte.</p>
              ) : (
                <>
                  <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 text-xs">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Cliente
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Responsável
                    </div>
                    <div className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Na fase
                    </div>
                    {(expanded ? drill.cards : drill.cards.slice(0, DRILL_PREVIEW)).map((c) => (
                      <a
                        key={c.pipefyCardId}
                        href={pipefyUrl(c.pipefyCardId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group col-span-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-md px-1 py-1 transition-colors hover:bg-primary/10"
                      >
                        <span className="min-w-0 max-w-[130px] truncate text-foreground" title={c.title ?? undefined}>
                          {c.title || `Card ${c.pipefyCardId}`}
                        </span>
                        <span className="min-w-0 truncate text-muted-foreground" title={c.agentName}>
                          {c.agentName}
                        </span>
                        <span className="inline-flex items-center gap-1 justify-self-end tabular-nums text-muted-foreground">
                          {c.dwellDays}d
                          <ExternalLink className="h-3 w-3 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                        </span>
                      </a>
                    ))}
                  </div>

                  {drill.cards.length > DRILL_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="mt-3 w-full rounded-lg border border-border bg-background/60 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
                    >
                      {expanded ? 'Mostrar menos' : `Ver todos os cards (${drill.cards.length}) ›`}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function windowLabel(key: WindowKey | null): string {
  if (!key) return '—'
  return WINDOWS.find((w) => w.key === key)?.short ?? key
}
