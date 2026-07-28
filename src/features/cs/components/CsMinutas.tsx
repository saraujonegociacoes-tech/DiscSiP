'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, Download, ExternalLink, Loader2, Info, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, X } from 'lucide-react'
import { BRT_TZ } from '@/lib/timezone'
import { getCsMinutas } from '@/app/actions/cs'
import { cn } from '@/lib/utils'
import type { CsMinutasData, CsMinutaCard } from '@/lib/types/database'

// PÁGINA 3 do painel de CS — CONTROLE DE MINUTAS. Snapshot de estado ATUAL (sem filtro de
// período, como a P1). Lista os cards que TÊM minuta (data de quitação = vencimento),
// agrupados em buckets por proximidade do vencimento. Cada card mostra o valor da minuta
// (Q.D), o vencimento, o % de desconto (derivado 1 − Q.D/dívida) e a etiqueta marcada, com
// link pro card no Pipefy (a minuta fica anexada nele — não há URL própria). Ver
// docs/painelcs-docs/updates/painel-sucesso-cliente-cs.md (mapeamento confirmado pelo dono 2026-07-27).
//
// Nasce completo do snapshot (a P3 não depende do Make). Se a migration 20260727 ainda não
// foi aplicada, a action degrada pra vazio e a tela mostra o estado "sem minutas".

const nf = (n: number) => n.toLocaleString('pt-BR')
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const pipefyUrl = (id: string) => `https://app.pipefy.com/open-cards/${id}`

// Buckets por proximidade do vencimento (daysToDue = vencimento − hoje; negativo = vencida).
// Faixas mutuamente exclusivas, cobrindo toda a reta (decisão do dono 2026-07-27).
const BUCKETS = [
  { key: 'vencidas', label: 'Vencidas', hint: 'já venceu', tone: 'text-destructive', test: (d: number) => d < 0 },
  { key: 'mensal', label: 'Mensal', hint: '≤ 30 dias', tone: 'text-warning', test: (d: number) => d >= 0 && d <= 30 },
  { key: 'trimestral', label: 'Trimestral', hint: '31–90 dias', tone: 'text-primary', test: (d: number) => d > 30 && d <= 90 },
  { key: 'semestral', label: 'Semestral', hint: '91–180 dias', tone: 'text-foreground', test: (d: number) => d > 90 && d <= 180 },
  { key: 'longo', label: '180+ dias', hint: '> 180 dias', tone: 'text-muted-foreground', test: (d: number) => d > 180 },
] as const

type BucketKey = (typeof BUCKETS)[number]['key']

function bucketOf(days: number): BucketKey {
  return BUCKETS.find((b) => b.test(days))?.key ?? 'longo'
}

function bucketLabel(key: BucketKey): string {
  return BUCKETS.find((b) => b.key === key)?.label ?? key
}

type StatusFilter = 'ativos' | 'inativos' | 'todos'
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ativos', label: 'Ativos' },
  { key: 'inativos', label: 'Inativos' },
  { key: 'todos', label: 'Todos' },
]
const STATUS_NOUN: Record<StatusFilter, string> = {
  ativos: 'cards ativos',
  inativos: 'cards inativos',
  todos: 'todos os cards',
}

// Colunas da tabela, todas ordenáveis (crescente/decrescente). Q.A = Valor da Minuta Total
// (dívida atual do cliente, sem desconto) → VEM ANTES do Q.D (valor com desconto). Texto ordena
// alfabético (pt-BR); número/data ordenam numérico/cronológico. `type: 'text'` cobre datas ISO
// (comparação lexicográfica = cronológica), então "asc" já é do mais velho pro mais novo.
type SortKey = 'cliente' | 'responsavel' | 'qa' | 'qd' | 'negociacao' | 'resguardo' | 'vencimento' | 'prazo' | 'desconto' | 'etiqueta'
type SortDir = 'asc' | 'desc'
interface SortState {
  key: SortKey
  dir: SortDir
}

const COLUMNS: {
  key: SortKey
  label: string
  align: 'left' | 'right' | 'center'
  type: 'text' | 'num'
  title?: string
}[] = [
  { key: 'cliente', label: 'Cliente', align: 'left', type: 'text' },
  { key: 'responsavel', label: 'Responsável', align: 'left', type: 'text' },
  { key: 'qa', label: 'Dívida do Cliente', align: 'right', type: 'num', title: 'Dívida atual do cliente, sem desconto (d_vida_atual_do_cliente)' },
  { key: 'qd', label: 'Valor da Minuta Final', align: 'right', type: 'num', title: 'Valor da minuta emitida, com desconto (valor_resguardados_dos_clientes)' },
  { key: 'negociacao', label: 'Última Negociação', align: 'right', type: 'num', title: 'Q.D real da fase de negociação — valor negociado atual no card (q_d_valor_da_quita_o_com_desconto)' },
  { key: 'resguardo', label: 'Resguardado', align: 'right', type: 'num', title: 'Valor de Resguardo do mês mais avançado preenchido (>0)' },
  { key: 'vencimento', label: 'Vencimento', align: 'center', type: 'text' },
  { key: 'prazo', label: 'Prazo', align: 'center', type: 'num' },
  { key: 'desconto', label: '% desc.', align: 'right', type: 'num' },
  { key: 'etiqueta', label: 'Etiqueta', align: 'left', type: 'text' },
]

function rawVal(c: CsMinutaCard, key: SortKey): string | number | null {
  switch (key) {
    case 'cliente':
      return c.title
    case 'responsavel':
      return c.agentName
    case 'qa':
      return c.divida
    case 'qd':
      return c.valor
    case 'negociacao':
      return c.ultimaNegociacao
    case 'resguardo':
      return c.resguardo
    case 'vencimento':
      return c.dueDate
    case 'prazo':
      return c.daysToDue
    case 'desconto':
      return c.descontoPct
    case 'etiqueta':
      return c.etiqueta
    default:
      return null
  }
}

function sortCards(cards: CsMinutaCard[], sort: SortState): CsMinutaCard[] {
  const type = COLUMNS.find((c) => c.key === sort.key)?.type ?? 'text'
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...cards].sort((a, b) => {
    const av = rawVal(a, sort.key)
    const bv = rawVal(b, sort.key)
    const aNull = av === null || av === ''
    const bNull = bv === null || bv === ''
    if (aNull && bNull) return 0
    if (aNull) return 1 // nulos sempre por último, independente da direção
    if (bNull) return -1
    const base =
      type === 'num'
        ? Number(av) - Number(bv)
        : String(av).localeCompare(String(bv), 'pt-BR', { sensitivity: 'base' })
    return base * mul
  })
}

// Cada insight carrega os cards que ele cita (pra o drill ao clicar) + como resumir o card.
interface InsightItem {
  id: string
  tone: string
  text: string
  cards: CsMinutaCard[]
  detail: (c: CsMinutaCard) => string
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

// "Agora" (referenceAt vem com hora) formatado pro subtítulo.
function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: BRT_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function dueLabel(days: number): string {
  if (days < 0) return `venceu há ${nf(Math.abs(days))}d`
  if (days === 0) return 'vence hoje'
  return `em ${nf(days)}d`
}

function dueTone(days: number): string {
  if (days < 0) return 'text-destructive'
  if (days <= 30) return 'text-warning'
  return 'text-muted-foreground'
}

export function CsMinutas() {
  const [data, setData] = useState<CsMinutasData | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<StatusFilter>('ativos')
  const [bucketSel, setBucketSel] = useState<BucketKey | null>(null)
  const [sortBy, setSortBy] = useState<SortState>({ key: 'vencimento', dir: 'asc' })
  const [insightSel, setInsightSel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getCsMinutas()
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
  }, [])

  const cards = useMemo(() => data?.cards ?? [], [data])

  const filtered = useMemo(() => {
    if (status === 'ativos') return cards.filter((c) => c.active)
    if (status === 'inativos') return cards.filter((c) => !c.active)
    return cards
  }, [cards, status])

  // Contagem + soma do valor por bucket (sobre o recorte de situação).
  const buckets = useMemo(() => {
    const acc = Object.fromEntries(
      BUCKETS.map((b) => [b.key, { count: 0, valor: 0 }]),
    ) as Record<BucketKey, { count: number; valor: number }>
    for (const c of filtered) {
      const k = bucketOf(c.daysToDue)
      acc[k].count++
      acc[k].valor += c.valor ?? 0
    }
    return acc
  }, [filtered])

  // Cards da tabela: filtrados pelo bucket clicado (ou todos), depois ordenados pela coluna ativa.
  const tableCards = useMemo(
    () => (bucketSel ? filtered.filter((c) => bucketOf(c.daysToDue) === bucketSel) : filtered),
    [filtered, bucketSel],
  )
  const visibleCards = useMemo(() => sortCards(tableCards, sortBy), [tableCards, sortBy])

  const totalValor = useMemo(() => filtered.reduce((a, c) => a + (c.valor ?? 0), 0), [filtered])

  // Resguardo da carteira acompanhando o filtro de situação (ativos = não-terminais; inativos =
  // terminais; todos = soma dos dois). Independe do bucket — é métrica de carteira, não da lista.
  const resg = useMemo(() => {
    const a = data?.resguardo.active ?? { total: 0, count: 0 }
    const i = data?.resguardo.inactive ?? { total: 0, count: 0 }
    if (status === 'ativos') return a
    if (status === 'inativos') return i
    return { total: a.total + i.total, count: a.count + i.count }
  }, [data, status])

  const insights = useMemo<InsightItem[]>(() => {
    const out: InsightItem[] = []
    const sumValor = (arr: CsMinutaCard[]) => arr.reduce((a, c) => a + (c.valor ?? 0), 0)

    const vencidas = filtered.filter((c) => c.daysToDue < 0)
    if (vencidas.length > 0)
      out.push({
        id: 'vencidas',
        tone: 'text-destructive',
        text: `${nf(vencidas.length)} minuta(s) vencida(s), somando ${brl(sumValor(vencidas))}.`,
        cards: vencidas,
        detail: (c) => `${dueLabel(c.daysToDue)} · ${c.valor == null ? '—' : brl(c.valor)}`,
      })

    const mensal = filtered.filter((c) => c.daysToDue >= 0 && c.daysToDue <= 30)
    if (mensal.length > 0)
      out.push({
        id: 'mensal',
        tone: 'text-warning',
        text: `${nf(mensal.length)} vence(m) em até 30 dias (${brl(sumValor(mensal))}).`,
        cards: mensal,
        detail: (c) => `${dueLabel(c.daysToDue)} · ${c.valor == null ? '—' : brl(c.valor)}`,
      })

    // Última negociação abaixo da minuta final (ambos > 0): a negociação corrente ficou menor que
    // o valor da minuta emitida — possível renegociação pra baixo. Mostra a diferença acumulada.
    const negBelow = filtered.filter(
      (c) => c.ultimaNegociacao != null && c.ultimaNegociacao > 0 && c.valor != null && c.valor > 0 && c.ultimaNegociacao < c.valor,
    )
    if (negBelow.length > 0) {
      const gap = negBelow.reduce((a, c) => a + ((c.valor ?? 0) - (c.ultimaNegociacao ?? 0)), 0)
      out.push({
        id: 'negBelow',
        tone: 'text-destructive',
        text: `${nf(negBelow.length)} última(s) negociação(ões) abaixo da minuta final (diferença de ${brl(gap)}).`,
        cards: negBelow,
        detail: (c) =>
          `${brl(c.valor ?? 0)} → ${brl(c.ultimaNegociacao ?? 0)} (−${brl((c.valor ?? 0) - (c.ultimaNegociacao ?? 0))})`,
      })
    }

    let biggest: CsMinutaCard | null = null
    for (const c of filtered)
      if (c.valor != null && (biggest === null || c.valor > (biggest.valor ?? 0))) biggest = c
    if (biggest && biggest.valor != null)
      out.push({
        id: 'biggest',
        tone: 'text-muted-foreground',
        text: `Maior minuta: ${brl(biggest.valor)} — ${biggest.title || `card ${biggest.pipefyCardId}`}.`,
        cards: [biggest],
        detail: (c) => `${c.valor == null ? '—' : brl(c.valor)} · vence ${fmtDate(c.dueDate)}`,
      })
    return out
  }, [filtered])

  const insightDrill = useMemo(
    () => insights.find((i) => i.id === insightSel) ?? null,
    [insights, insightSel],
  )

  function changeStatus(next: StatusFilter) {
    setStatus(next)
    setBucketSel(null)
    setInsightSel(null)
  }

  // Clique no cabeçalho: mesma coluna alterna asc↔desc; coluna nova começa em asc
  // (alfabético A→Z / mais velho→mais novo / menor→maior).
  function toggleSort(key: SortKey) {
    setSortBy((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  function exportCsv() {
    const head = [
      'ID', 'Cliente', 'Responsável', 'Dívida do Cliente', 'Valor da Minuta Final',
      'Última Negociação', 'Resguardado', 'Mês resguardo', 'Vencimento', 'Dias até vencer',
      'Bucket', '% desconto', 'Etiqueta', 'Situação',
    ]
    const cell = (v: string | number) => {
      const s = String(v)
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = visibleCards.map((c) =>
      [
        c.pipefyCardId,
        c.title ?? '',
        c.agentName,
        c.divida ?? '',
        c.valor ?? '',
        c.ultimaNegociacao ?? '',
        c.resguardo ?? '',
        c.resguardoMonth ?? '',
        fmtDate(c.dueDate),
        c.daysToDue,
        bucketLabel(bucketOf(c.daysToDue)),
        c.descontoPct ?? '',
        c.etiqueta ?? '',
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
    a.download = `cs-minutas-${data ? fmtStamp(data.referenceAt).replace(/\s/g, '') : 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (data === null) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-border bg-gradient-card text-sm text-muted-foreground shadow-card">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Barra de controle: situação ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4 text-primary" />
          <span>
            Minutas com data de quitação · foto de{' '}
            <span className="font-medium text-foreground">{fmtStamp(data.referenceAt)}</span>.
          </span>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
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

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-border bg-gradient-card p-10 text-center shadow-card">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Nenhuma minuta com data de quitação encontrada.
            {data.withoutMinuta > 0 && (
              <>
                {' '}
                <span className="text-foreground">{nf(data.withoutMinuta)}</span> card(s) ainda sem
                minuta.
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          {/* ── Buckets por vencimento (clicáveis) ──────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {BUCKETS.map((b) => {
              const active = bucketSel === b.key
              const { count, valor } = buckets[b.key]
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => setBucketSel((cur) => (cur === b.key ? null : b.key))}
                  className={cn(
                    'rounded-2xl border p-3 text-left transition-colors',
                    active
                      ? 'border-primary bg-primary/10 shadow-glow'
                      : 'border-border bg-gradient-card shadow-card hover:bg-background/50',
                  )}
                >
                  <div className={cn('text-[11px] font-semibold uppercase tracking-wider', b.tone)}>
                    {b.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{b.hint}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                    {nf(count)}
                  </div>
                  <div className="text-xs tabular-nums text-muted-foreground">{brl(valor)}</div>
                </button>
              )
            })}
          </div>

          {/* ── Tabela + trilho (resumo/insights) ───────────────────────────── */}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Tabela de minutas */}
            <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Minutas{' '}
                  {bucketSel && (
                    <span className="font-normal text-muted-foreground">· {bucketLabel(bucketSel)}</span>
                  )}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {nf(tableCards.length)} de {nf(filtered.length)}
                </span>
              </div>

              {tableCards.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Sem minutas neste recorte.
                </p>
              ) : (
                <div className="scrollbar-slim max-h-[560px] overflow-auto rounded-xl border border-border">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-background/95 backdrop-blur">
                        {COLUMNS.map((col, i) => {
                          const active = sortBy.key === col.key
                          return (
                            <th
                              key={col.key}
                              scope="col"
                              title={col.title}
                              className={cn(
                                'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                                i === 0 && 'sticky left-0 z-20 bg-background/95',
                                col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                              )}
                              aria-sort={active ? (sortBy.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                            >
                              <button
                                type="button"
                                onClick={() => toggleSort(col.key)}
                                className={cn(
                                  'inline-flex w-full items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground',
                                  active && 'text-foreground',
                                  col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start',
                                )}
                              >
                                <span>{col.label}</span>
                                {active ? (
                                  sortBy.dir === 'asc' ? (
                                    <ArrowUp className="h-3 w-3 shrink-0" />
                                  ) : (
                                    <ArrowDown className="h-3 w-3 shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                                )}
                              </button>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCards.map((c) => (
                        <tr key={c.pipefyCardId} className="border-t border-border/60 hover:bg-primary/5">
                          <th
                            scope="row"
                            className="sticky left-0 z-10 max-w-[180px] bg-gradient-card px-3 py-1.5 text-left font-medium"
                          >
                            <a
                              href={pipefyUrl(c.pipefyCardId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group inline-flex items-center gap-1 text-xs text-foreground"
                              title={c.title ?? undefined}
                            >
                              <span className="max-w-[150px] truncate">
                                {c.title || `Card ${c.pipefyCardId}`}
                              </span>
                              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                            </a>
                          </th>
                          <td className="max-w-[160px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={c.agentName}>
                            {c.agentName}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                            {c.divida == null ? '—' : brl(c.divida)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums text-foreground">
                            {c.valor == null ? '—' : brl(c.valor)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                            {c.ultimaNegociacao == null ? '—' : brl(c.ultimaNegociacao)}
                          </td>
                          <td
                            className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground"
                            title={c.resguardoMonth ? `Resguardo do ${c.resguardoMonth}º mês` : undefined}
                          >
                            {c.resguardo == null ? (
                              '—'
                            ) : (
                              <>
                                {brl(c.resguardo)}
                                {c.resguardoMonth != null && (
                                  <span className="ml-1 text-[10px] text-muted-foreground/70">{c.resguardoMonth}º</span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                            {fmtDate(c.dueDate)}
                          </td>
                          <td className={cn('px-3 py-1.5 text-center text-xs tabular-nums', dueTone(c.daysToDue))}>
                            {dueLabel(c.daysToDue)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                            {c.descontoPct == null ? '—' : `${pct(c.descontoPct)}%`}
                          </td>
                          <td className="max-w-[140px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={c.etiqueta ?? undefined}>
                            {c.etiqueta ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="mt-2 text-[11px] text-muted-foreground">
                Dívida do Cliente = dívida atual (sem desconto) · Valor da Minuta Final = valor da
                minuta emitida · Última Negociação = Q.D real da fase de negociação · % desc. = 1 −
                (Minuta Final ÷ Dívida) · Resguardado = valor do mês mais avançado preenchido (o
                superscrito é o mês). Clique num cabeçalho para ordenar; clique num cliente para abrir
                o card (a minuta está anexada nele).
              </p>
            </div>

            {/* Trilho: resumo + export + insights */}
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Minutas · Σ valor
                    </div>
                    <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                      {nf(filtered.length)}
                    </div>
                    <div className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                      {brl(totalValor)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={exportCsv}
                    disabled={tableCards.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exportar
                  </button>
                </div>
                {data.withoutMinuta > 0 && (
                  <p className="mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{nf(data.withoutMinuta)}</span>{' '}
                    card(s) ainda sem minuta (sem data de quitação).
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Resguardado na carteira
                </div>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                  {brl(resg.total)}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {nf(resg.count)} card(s) com resguardo ·{' '}
                  <span className="text-foreground">{STATUS_NOUN[status]}</span>
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Info className="h-4 w-4 text-primary" /> Insights
                </h3>
                {insights.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem alertas de vencimento neste recorte.</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-1">
                      {insights.map((it) => {
                        const active = insightSel === it.id
                        return (
                          <li key={it.id}>
                            <button
                              type="button"
                              onClick={() => setInsightSel((cur) => (cur === it.id ? null : it.id))}
                              aria-expanded={active}
                              className={cn(
                                'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-primary/10',
                                active && 'bg-primary/15 outline outline-1 -outline-offset-1 outline-primary',
                                it.tone,
                              )}
                            >
                              <span aria-hidden>•</span>
                              <span className="flex-1">{it.text}</span>
                              <ChevronDown
                                className={cn('mt-0.5 h-3 w-3 shrink-0 transition-transform', active && 'rotate-180')}
                              />
                            </button>
                          </li>
                        )
                      })}
                    </ul>

                    {insightDrill && (
                      <div className="mt-3 border-t border-border/60 pt-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {nf(insightDrill.cards.length)} card(s) citados
                          </span>
                          <button
                            type="button"
                            onClick={() => setInsightSel(null)}
                            className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="Fechar detalhamento"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="scrollbar-slim flex max-h-[280px] flex-col gap-1 overflow-auto">
                          {insightDrill.cards.map((c) => (
                            <a
                              key={c.pipefyCardId}
                              href={pipefyUrl(c.pipefyCardId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 transition-colors hover:bg-background"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-foreground" title={c.title ?? undefined}>
                                  {c.title || `Card ${c.pipefyCardId}`}
                                </div>
                                <div className="truncate text-[10px] tabular-nums text-muted-foreground">
                                  {insightDrill.detail(c)}
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
