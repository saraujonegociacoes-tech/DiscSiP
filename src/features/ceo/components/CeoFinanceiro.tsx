'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  Wallet,
  Receipt,
  Calculator,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Tag,
} from 'lucide-react'
import { KpiCard } from '@/components/bluedesk/KpiCard'
import { useChartTheme } from '@/components/bluedesk/useChartTheme'
import { CeoPeriodPicker, type CeoPeriodMode } from './CeoPeriodPicker'
import { currentCivilMonth, type LeadPeriod } from '@/lib/period'
import { getCeoFinanceiro } from '@/app/actions/ceo'
import { cn } from '@/lib/utils'
import type { CeoFinanceiroData, CeoFinanceiroBucket } from '@/lib/types/database'

// ABA 1 do painel do CEO — FINANCEIRO (entradas do mês), o carro-chefe.
// Fonte: get_ceo_financeiro (20260731_financeiro_schema.sql), que soma sobre `fin_entries`
// — uma linha por PAGAMENTO, não por card. Ver
// docs/projetopainelceo-docs/updates/introspeccao-pipefy-financeiro.md.
//
// O toggle (mês civil × ciclo 11→10) vale para TUDO na aba: os KPIs e os 12 baldes da
// série. Até 05/ago a série era sempre em meses civis — decisão da Sprint 1, com a
// intenção de proteger a leitura ("a barra de julho não seria julho"). O efeito prático
// foi uma tela que ignorava o filtro, que é pior, e o dono mandou seguir o recorte.
// Em ciclo, o rótulo passa a ser o dia de início ("11 jul") justamente para não se
// confundir com mês.

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })

// Eixo Y: R$ 1,2 mi / R$ 340 mil / R$ 900 — número cheio no eixo espremeria o gráfico.
const brlShort = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000) return `R$ ${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

const nf = (n: number) => n.toLocaleString('pt-BR')
const pipefyUrl = (id: string) => `https://app.pipefy.com/open-cards/${id}`

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// A RPC devolve a DATA DE INÍCIO do balde ('YYYY-MM-DD'); quem rotula é a tela, porque
// só ela sabe o recorte escolhido:
//   · mês civil → 'jul/26'
//   · ciclo     → '11 jul' (o dia importa: é o que distingue um ciclo de um mês)
function bucketLabel(bucket: string, modo: CeoPeriodMode): string {
  const [y, m, d] = bucket.split('-').map(Number)
  if (!y || !m) return bucket
  if (modo === 'ciclo') return `${String(d).padStart(2, '0')} ${MONTHS_PT[m - 1]}`
  return `${MONTHS_PT[m - 1]}/${String(y).slice(2)}`
}

// Delta % da janela contra a anterior. Sem base anterior não existe "variação" —
// devolvemos undefined em vez de fingir 100%.
function delta(total: number, previous: number): { value: string; positive: boolean } | undefined {
  if (previous === 0) return undefined
  const pct = ((total - previous) / Math.abs(previous)) * 100
  const sign = pct >= 0 ? '+' : ''
  return {
    value: `${sign}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. período anterior`,
    positive: pct >= 0,
  }
}

// Lista de barras de um breakdown. A largura é relativa ao MAIOR item (não ao total):
// com uma categoria dominante, proporção sobre o total deixaria o resto invisível.
function Breakdown({
  title,
  icon: Icon,
  buckets,
  empty,
}: {
  title: string
  icon: typeof Tag
  buckets: CeoFinanceiroBucket[]
  empty: string
}) {
  const max = Math.max(...buckets.map((b) => Math.abs(b.total)), 1)
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {buckets.length === 0 ? (
        <p className="relative text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="relative space-y-2.5">
          {buckets.map((b) => (
            <li key={b.key}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-foreground" title={b.key}>
                  {b.key}
                </span>
                <span
                  className={cn(
                    'shrink-0 tabular-nums font-medium',
                    b.total < 0 ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {brl(b.total)}
                  <span className="ml-1.5 text-muted-foreground">({nf(b.count)})</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background/60">
                <div
                  className={cn('h-full rounded-full', b.total < 0 ? 'bg-destructive/70' : 'bg-gradient-primary')}
                  style={{ width: `${(Math.abs(b.total) / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CeoFinanceiro() {
  const [mode, setMode] = useState<CeoPeriodMode>('mes')
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCivilMonth())
  const [data, setData] = useState<CeoFinanceiroData | null>(null)
  const [loading, setLoading] = useState(true)
  const ct = useChartTheme()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getCeoFinanceiro(period, mode)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        // A action já degrada pra vazio em erro/guarda; aqui só evitamos rejeição solta.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, mode])

  const chartData = useMemo(
    () => (data?.monthly ?? []).map((m) => ({ ...m, label: bucketLabel(m.month, mode) })),
    [data, mode],
  )

  const total = data?.total ?? 0
  const count = data?.count ?? 0
  const ticket = count > 0 ? total / count : 0
  const topCategory = data?.byCategory?.[0]
  const duplicates = data?.duplicates ?? []
  const hasData = count > 0 || chartData.some((m) => m.count > 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Entradas do período</h2>
          <p className="text-xs text-muted-foreground">
            Pagamentos recebidos no pipe do Financeiro, sem a fase de cancelados. Devoluções e
            descontos entram como valor negativo.
          </p>
        </div>
        <CeoPeriodPicker
          value={period}
          mode={mode}
          disabled={loading}
          onChange={(p, m) => {
            setMode(m)
            setPeriod(p)
          }}
        />
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-gradient-card py-16 text-sm text-muted-foreground shadow-card">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando entradas…
        </div>
      ) : (
        <>
          <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', loading && 'opacity-60')}>
            <KpiCard
              label="Entradas no período"
              value={brl(total)}
              delta={delta(total, data?.previousTotal ?? 0)}
              icon={Wallet}
            />
            <KpiCard label="Pagamentos" value={nf(count)} icon={Receipt} />
            <KpiCard label="Ticket médio" value={brl(ticket)} icon={Calculator} />
            {/* O nome da categoria vai no RÓTULO, não na pílula de delta: aquela pílula tem
                ícone de tendência e leria como variação, que não é o caso. */}
            <KpiCard
              label={topCategory ? `Maior categoria · ${topCategory.key}` : 'Maior categoria'}
              value={topCategory ? brl(topCategory.total) : '—'}
              icon={Tag}
            />
          </div>

          {/* A série segue o toggle: 12 meses civis ou 12 ciclos 11→10. */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
            <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              {mode === 'ciclo' ? 'Últimos 12 ciclos' : 'Últimos 12 meses'}
            </h3>
            <p className="mb-4 text-xs text-muted-foreground">
              {mode === 'ciclo'
                ? 'Cada ponto é um ciclo 11→10, rotulado pelo dia em que começa.'
                : 'Cada ponto é um mês civil, do dia 1 ao último.'}
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-ceo-fin" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ct.series.primary} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={ct.series.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={ct.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke={ct.axis}
                    tick={{ fontSize: 11, fill: ct.axis }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke={ct.axis}
                    tick={{ fontSize: 11, fill: ct.axis }}
                    tickFormatter={brlShort}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    contentStyle={ct.tooltip}
                    cursor={{ stroke: ct.series.primary, strokeOpacity: 0.2 }}
                    formatter={(v: unknown) => [brl(Number(v ?? 0)), 'Entradas'] as [string, string]}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke={ct.series.primary}
                    strokeWidth={2.5}
                    fill="url(#g-ceo-fin)"
                    name="Entradas"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Breakdown
              title="Por categoria"
              icon={Tag}
              buckets={data?.byCategory ?? []}
              empty="Sem pagamentos no período."
            />
            <Breakdown
              title="Por departamento"
              icon={Receipt}
              buckets={data?.byDepartment ?? []}
              empty="Sem pagamentos no período."
            />
            <Breakdown
              title="Por forma de pagamento"
              icon={Wallet}
              buckets={data?.byPaymentMethod ?? []}
              empty="Sem pagamentos no período."
            />
          </div>

          {/* Aviso, não filtro: os cards continuam somados. Só entra aqui o trio mesmo
              valor + mesma categoria + mesmo dia no mesmo contrato — contrato repetido com
              categorias diferentes é lançamento legítimo. */}
          {duplicates.length > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-warning/30 bg-warning/5 p-5 shadow-card">
              <div className="relative mb-1 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h3 className="text-sm font-semibold text-foreground">
                  {duplicates.length === 1
                    ? '1 possível lançamento em duplicata'
                    : `${nf(duplicates.length)} possíveis lançamentos em duplicata`}
                </h3>
              </div>
              <p className="relative mb-4 text-xs text-muted-foreground">
                Mesmo contrato, mesmo valor, mesma categoria e mesmo dia — os valores{' '}
                <strong>continuam somados</strong> acima. Confira no Pipefy antes de agir.
              </p>
              <ul className="relative space-y-2">
                {duplicates.map((d) => (
                  <li
                    key={`${d.contractRef}-${d.paidDate}-${d.value}-${d.category ?? ''}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs"
                  >
                    <span className="font-medium tabular-nums text-foreground">{brl(d.value)}</span>
                    <span className="text-muted-foreground">{d.category ?? 'Sem categoria'}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {d.paidDate.split('-').reverse().join('/')}
                    </span>
                    <span className="text-muted-foreground">
                      {d.cards} cards · {d.departments.join(', ')}
                    </span>
                    <span className="ml-auto flex flex-wrap gap-2">
                      {d.cardIds.map((id) => (
                        <a
                          key={id}
                          href={pipefyUrl(id)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          #{id}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasData && (
            <p className="rounded-2xl border border-border bg-gradient-card px-5 py-4 text-xs text-muted-foreground shadow-card">
              Nenhuma entrada encontrada. Se a migration{' '}
              <code className="text-foreground">20260731_financeiro_schema.sql</code> já foi
              aplicada, rode <code className="text-foreground">npm run import:financeiro</code> para
              a carga histórica.
            </p>
          )}
        </>
      )}
    </div>
  )
}
