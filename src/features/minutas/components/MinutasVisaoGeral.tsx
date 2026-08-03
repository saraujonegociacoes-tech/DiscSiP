'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Info, CalendarClock } from 'lucide-react'
import { currentCivilMonth, periodBounds, type LeadPeriod } from '@/lib/period'
import { useChartTheme } from '@/components/bluedesk/useChartTheme'
import { CeoPeriodPicker, type CeoPeriodMode } from '@/features/ceo/components/CeoPeriodPicker'
import type { ProcMinutasData } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import {
  brl,
  nf,
  flattenRows,
  BUCKETS,
  bucketOf,
  monthKey,
  monthLabel,
  monthsRange,
  addMonthsKey,
  todayBRT,
  nomeCliente,
} from '../shared'

// PÁGINA 1 — Visão Geral. KPIs de "pago × a pagar" na janela escolhida (ciclo 11→10 ou mês
// civil), buckets por proximidade de vencimento (carteira em aberto), série mensal e insights.

const brlShort = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000) return `R$ ${Math.round(n / 1_000).toLocaleString('pt-BR')} mil`
  return `R$ ${nf(Math.round(n))}`
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card lift">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tracking-tight tabular-nums text-foreground', tone)}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}

export function MinutasVisaoGeral({ data }: { data: ProcMinutasData }) {
  const chart = useChartTheme()
  const [mode, setMode] = useState<CeoPeriodMode>('mes')
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCivilMonth())

  const rows = useMemo(() => flattenRows(data.acordos), [data])
  const bounds = useMemo(() => periodBounds(period), [period])

  // KPIs
  const kpis = useMemo(() => {
    const inPeriod = (ymd: string | null) => ymd != null && ymd >= bounds.startDate && ymd <= bounds.endDate
    let aPagarCount = 0, aPagarVal = 0
    let pagoCount = 0, pagoVal = 0
    let vencCount = 0, vencVal = 0
    let carteiraCount = 0, carteiraVal = 0
    for (const { parcela: p } of rows) {
      const v = p.valor ?? 0
      if (p.status === 'pago') {
        if (inPeriod(p.dataPagamento)) { pagoCount++; pagoVal += v }
      } else {
        carteiraCount++; carteiraVal += v
        if (inPeriod(p.vencimento)) { aPagarCount++; aPagarVal += v }
        if (p.status === 'vencida') { vencCount++; vencVal += v }
      }
    }
    return { aPagarCount, aPagarVal, pagoCount, pagoVal, vencCount, vencVal, carteiraCount, carteiraVal }
  }, [rows, bounds])

  // Buckets por vencimento (só parcelas em aberto).
  const buckets = useMemo(() => {
    const acc = Object.fromEntries(BUCKETS.map((b) => [b.key, { count: 0, valor: 0 }])) as Record<
      string,
      { count: number; valor: number }
    >
    for (const { parcela: p } of rows) {
      if (p.status === 'pago' || p.daysToDue === null) continue
      const k = bucketOf(p.daysToDue)
      acc[k].count++
      acc[k].valor += p.valor ?? 0
    }
    return acc
  }, [rows])

  // Série mensal: pago (por data de pagamento) × a pagar (por vencimento das em aberto).
  const series = useMemo(() => {
    const cur = todayBRT().slice(0, 7)
    const months = monthsRange(addMonthsKey(cur, -11), addMonthsKey(cur, 6))
    const pago = new Map<string, number>()
    const aPagar = new Map<string, number>()
    for (const { parcela: p } of rows) {
      const v = p.valor ?? 0
      if (p.dataPagamento) pago.set(monthKey(p.dataPagamento), (pago.get(monthKey(p.dataPagamento)) ?? 0) + v)
      if (p.status !== 'pago' && p.vencimento)
        aPagar.set(monthKey(p.vencimento), (aPagar.get(monthKey(p.vencimento)) ?? 0) + v)
    }
    return months.map((k) => ({ month: monthLabel(k), pago: pago.get(k) ?? 0, aPagar: aPagar.get(k) ?? 0 }))
  }, [rows])

  const hasSeries = useMemo(() => series.some((s) => s.pago > 0 || s.aPagar > 0), [series])

  // Insights (bullets de alerta).
  const insights = useMemo(() => {
    const abertas = rows.filter((r) => r.parcela.status !== 'pago')
    const out: { id: string; tone: string; text: string }[] = []

    if (kpis.vencCount > 0)
      out.push({
        id: 'vencidas',
        tone: 'text-destructive',
        text: `${nf(kpis.vencCount)} parcela(s) vencida(s) em aberto, somando ${brl(kpis.vencVal)}.`,
      })

    const em30 = abertas.filter((r) => r.parcela.daysToDue !== null && r.parcela.daysToDue >= 0 && r.parcela.daysToDue <= 30)
    if (em30.length > 0)
      out.push({
        id: 'em30',
        tone: 'text-warning',
        text: `${nf(em30.length)} vence(m) em até 30 dias (${brl(em30.reduce((a, r) => a + (r.parcela.valor ?? 0), 0))}).`,
      })

    const proxima = abertas
      .filter((r) => r.parcela.daysToDue !== null && r.parcela.daysToDue >= 0)
      .sort((a, b) => (a.parcela.daysToDue ?? 0) - (b.parcela.daysToDue ?? 0))[0]
    if (proxima)
      out.push({
        id: 'proxima',
        tone: 'text-primary',
        text: `Próxima a vencer: ${nomeCliente(proxima.acordo)} — ${brl(proxima.parcela.valor ?? 0)} em ${nf(proxima.parcela.daysToDue ?? 0)}d.`,
      })

    let maior = abertas[0]
    for (const r of abertas) if ((r.parcela.valor ?? 0) > (maior?.parcela.valor ?? 0)) maior = r
    if (maior && (maior.parcela.valor ?? 0) > 0)
      out.push({
        id: 'maior',
        tone: 'text-muted-foreground',
        text: `Maior parcela em aberto: ${brl(maior.parcela.valor ?? 0)} — ${nomeCliente(maior.acordo)}.`,
      })

    return out
  }, [rows, kpis])

  return (
    <div className="flex flex-col gap-4">
      {/* Período */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
        <span className="text-sm text-muted-foreground">
          Pago × a pagar na janela · <span className="font-medium text-foreground">{period.label}</span>
        </span>
        <CeoPeriodPicker value={period} mode={mode} onChange={(p, m) => { setPeriod(p); setMode(m) }} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="A pagar na janela" value={brl(kpis.aPagarVal)} sub={`${nf(kpis.aPagarCount)} parcela(s)`} />
        <Stat label="Pago na janela" value={brl(kpis.pagoVal)} sub={`${nf(kpis.pagoCount)} parcela(s)`} tone="text-success" />
        <Stat label="Vencidas (carteira)" value={brl(kpis.vencVal)} sub={`${nf(kpis.vencCount)} parcela(s)`} tone={kpis.vencCount > 0 ? 'text-status-stuck' : undefined} />
        <Stat label="Carteira a receber" value={brl(kpis.carteiraVal)} sub={`${nf(kpis.carteiraCount)} parcela(s) em aberto`} />
      </div>

      {/* Buckets por vencimento */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {BUCKETS.map((b) => {
          const { count, valor } = buckets[b.key]
          return (
            <div key={b.key} className="rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
              <div className={cn('text-[11px] font-semibold uppercase tracking-wider', b.tone)}>{b.label}</div>
              <div className="text-[10px] text-muted-foreground">{b.hint}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{nf(count)}</div>
              <div className="text-xs tabular-nums text-muted-foreground">{brl(valor)}</div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Gráfico */}
        <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 text-primary" /> Pago × a pagar por mês
          </h2>
          {hasSeries ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="minutasPago" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chart.series.success} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={chart.series.success} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="minutasAPagar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chart.series.primary} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={chart.series.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="month" stroke={chart.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis stroke={chart.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={brlShort} width={64} />
                  <Tooltip
                    contentStyle={chart.tooltip}
                    formatter={(v: unknown, name: unknown) =>
                      [brl(Number(v ?? 0)), name === 'pago' ? 'Pago' : 'A pagar'] as [string, string]
                    }
                  />
                  <Legend wrapperStyle={chart.legend} formatter={(v) => (v === 'pago' ? 'Pago' : 'A pagar')} />
                  <Area type="monotone" dataKey="aPagar" stroke={chart.series.primary} strokeWidth={2} fill="url(#minutasAPagar)" />
                  <Area type="monotone" dataKey="pago" stroke={chart.series.success} strokeWidth={2} fill="url(#minutasPago)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">Sem dados de parcelas para o gráfico ainda.</p>
          )}
        </div>

        {/* Insights */}
        <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Info className="h-4 w-4 text-primary" /> Insights
          </h3>
          {insights.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem alertas — nenhuma parcela em aberto.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {insights.map((it) => (
                <li key={it.id} className={cn('flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs', it.tone)}>
                  <span aria-hidden>•</span>
                  <span className="flex-1">{it.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
