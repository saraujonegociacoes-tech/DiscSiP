'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import {
  CalendarClock,
  AlarmClock,
  Loader2,
  ExternalLink,
  Tag,
  Handshake,
  Users,
  Info,
} from 'lucide-react'
import { KpiCard } from '@/components/bluedesk/KpiCard'
import { useChartTheme } from '@/components/bluedesk/useChartTheme'
import { getCeoProjecoes } from '@/app/actions/ceo'
import { CeoPeriodPicker, type CeoPeriodMode } from './CeoPeriodPicker'
import { currentCivilMonth, type LeadPeriod } from '@/lib/period'
import { cn } from '@/lib/utils'
import type {
  CeoProjecaoData,
  CeoProjecaoItem,
  CeoProjecaoWindow,
} from '@/lib/types/database'

// ABA 2 do painel do CEO — PROJEÇÕES DE PAGAMENTO.
// Fonte: get_ceo_projecoes (20260731b_negociacao_schema.sql), que junta `neg_cards`
// (pipe 3.0 Negociação) com o plano de pagamento do CS. Ver
// docs/projetopainelceo-docs/updates/introspeccao-pipefy-negociacao.md.
//
// SNAPSHOT, não série: a pergunta é "quem deve, quanto e quando", não "quanto entrou em
// julho". Por isso não há PeriodPicker aqui — o recorte é a janela de VENCIMENTO.
//
// ⚠️ Este número NÃO se soma ao da aba Financeiro. Lá é dinheiro que ENTROU; aqui é
// dinheiro que ainda NÃO entrou. Quando um card daqui é pago, ele vira card no pipe do
// Financeiro e migra de uma aba pra outra — nunca aparece nas duas. O aviso no rodapé
// existe pra que ninguém some as duas de cabeça.

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })

const brlShort = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000) return `R$ ${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

const nf = (n: number) => n.toLocaleString('pt-BR')
const pipefyUrl = (id: string) => `https://app.pipefy.com/open-cards/${id}`
const brDate = (iso: string) => iso.split('-').reverse().join('/')

// A ordem importa: é a leitura natural do CEO (o que já atrasou primeiro, depois o
// que vem chegando).
const WINDOWS: Array<{ key: CeoProjecaoWindow; label: string; short: string }> = [
  { key: 'vencida', label: 'Vencidas', short: 'Vencidas' },
  { key: 'ate30', label: 'Vencem em até 30 dias', short: '≤ 30d' },
  { key: 'd31a90', label: 'Vencem em 31–90 dias', short: '31–90d' },
  { key: 'mais90', label: 'Vencem em mais de 90 dias', short: '> 90d' },
]

// De onde a projeção saiu. O CEO não precisa saber o field-id, mas precisa saber se
// aquilo é um pagamento combinado agora ou uma parcela antiga da venda.
const SIGNAL_LABEL: Record<string, string> = {
  fase: 'Pagamento agendado',
  parcela2: '2ª parcela da venda',
  plano: 'Plano de pagamento',
}

function windowTone(key: CeoProjecaoWindow): string {
  return key === 'vencida' ? 'text-destructive' : 'text-foreground'
}

export function CeoProjecoes() {
  const [mode, setMode] = useState<CeoPeriodMode>('mes')
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCivilMonth())
  const [data, setData] = useState<CeoProjecaoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<CeoProjecaoWindow | 'todas'>('todas')
  const ct = useChartTheme()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getCeoProjecoes(period)
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
  }, [period])

  const chartData = useMemo(
    () =>
      WINDOWS.map((w) => ({
        windowKey: w.key,
        label: w.short,
        total: data?.byWindow?.[w.key]?.total ?? 0,
        count: data?.byWindow?.[w.key]?.count ?? 0,
      })),
    [data],
  )

  const items = useMemo<CeoProjecaoItem[]>(() => {
    const all = data?.items ?? []
    return filter === 'todas' ? all : all.filter((i) => i.window === filter)
  }, [data, filter])

  const total = data?.total ?? 0
  const count = data?.count ?? 0
  const vencidas = data?.byWindow?.vencida
  const proximas = data?.byWindow?.ate30
  const negTotal = data?.negociacao?.total ?? 0
  const csTotal = data?.cs?.total ?? 0
  const csCount = data?.cs?.count ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Pagamentos a receber</h2>
          <p className="text-xs text-muted-foreground">
            Dinheiro que ainda <strong>não entrou</strong>, das fases de espera de pagamento de
            Negociação e CS. Quando o cliente paga, o valor sai daqui e aparece no Financeiro.
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

      {/* Duas datas convivem nesta aba e confundir uma com a outra inverte a leitura:
          o PERÍODO recorta por vencimento; as FAIXAS abaixo (vencidas / ≤30d / …) são
          contadas contra HOJE. Por isso a posição fica escrita junto do filtro. */}
      {data && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Mostrando o que vence no período escolhido. As faixas abaixo são relativas a{' '}
          <span className="tabular-nums text-foreground">{brDate(data.referenceDate)}</span>, não ao
          início do período — por isso algo pode aparecer como <strong>vencido</strong> dentro de um
          período futuro.
        </p>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-gradient-card py-16 text-sm text-muted-foreground shadow-card">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando projeções…
        </div>
      ) : (
        <>
          <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', loading && 'opacity-60')}>
            <KpiCard label="Total a receber" value={brl(total)} icon={CalendarClock} />
            {/* Vencidas em destaque negativo: é dinheiro que já era pra ter entrado. */}
            <KpiCard
              label="Vencidas"
              value={brl(vencidas?.total ?? 0)}
              delta={
                vencidas && vencidas.count > 0
                  ? { value: `${nf(vencidas.count)} em atraso`, positive: false }
                  : undefined
              }
              icon={AlarmClock}
            />
            <KpiCard
              label="Vencem em até 30 dias"
              value={brl(proximas?.total ?? 0)}
              icon={CalendarClock}
            />
            <KpiCard label="Pagamentos previstos" value={nf(count)} icon={Handshake} />
          </div>

          {/* Por janela + por fonte, lado a lado: o "quando" e o "de onde". */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated lg:col-span-2">
              <div className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
              <h3 className="mb-1 text-sm font-semibold text-foreground">Por janela de vencimento</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                Clique numa barra para filtrar a lista abaixo.
              </p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
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
                      cursor={{ fill: ct.series.primary, fillOpacity: 0.08 }}
                      formatter={(v: unknown) => [brl(Number(v ?? 0)), 'A receber'] as [string, string]}
                    />
                    {/* Clique alterna o filtro. Vai pelo ÍNDICE e não pelo payload: o
                        Recharts usa `key` como prop interna de React, então um campo `key`
                        no dado colide com ele. */}
                    <Bar
                      dataKey="total"
                      name="A receber"
                      radius={[6, 6, 0, 0]}
                      onClick={(_, index) => {
                        const w = chartData[index]?.windowKey
                        if (w) setFilter((f) => (f === w ? 'todas' : w))
                      }}
                      className="cursor-pointer"
                    >
                      {chartData.map((d) => (
                        <Cell
                          key={d.windowKey}
                          fill={d.windowKey === 'vencida' ? ct.series.danger : ct.series.primary}
                          fillOpacity={filter === 'todas' || filter === d.windowKey ? 1 : 0.35}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Por fonte. Enquanto o CS estiver zerado, é aqui que a causa aparece —
                em vez de o total só "parecer baixo" sem explicação. */}
            <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
              <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative mb-4 flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Por origem</h3>
              </div>
              <ul className="relative space-y-3 text-xs">
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-foreground">Negociação</span>
                  <span className="tabular-nums font-medium text-foreground">
                    {brl(negTotal)}
                    <span className="ml-1.5 text-muted-foreground">
                      ({nf(data?.negociacao?.count ?? 0)})
                    </span>
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-foreground">Customer Success</span>
                  <span className="tabular-nums font-medium text-foreground">
                    {brl(csTotal)}
                    <span className="ml-1.5 text-muted-foreground">({nf(csCount)})</span>
                  </span>
                </li>
              </ul>
              {csCount === 0 && (
                <p className="relative mt-4 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  O CS ainda não aparece aqui porque a fase{' '}
                  <strong className="text-foreground">Aguardando Pagamento</strong> do pipe de CS
                  não está sendo usada pela operação — não há plano de pagamento preenchido em
                  nenhum card. Assim que houver, entra sozinho.
                </p>
              )}
              {(data?.byProduct?.length ?? 0) > 0 && (
                <>
                  <div className="relative mt-5 mb-3 flex items-center gap-2">
                    <Tag className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">Por produto</h3>
                  </div>
                  <ul className="relative space-y-2 text-xs">
                    {(data?.byProduct ?? []).map((p) => (
                      <li key={p.key} className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-foreground" title={p.key}>
                          {p.key}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium text-foreground">
                          {brl(p.total)}
                          <span className="ml-1.5 text-muted-foreground">({nf(p.count)})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* A lista. É o que o CEO usa pra cobrar: nome, quanto, quando e o link do card. */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                Pagamentos previstos
                {filter !== 'todas' && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    · {WINDOWS.find((w) => w.key === filter)?.label}
                  </span>
                )}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {(['todas', ...WINDOWS.map((w) => w.key)] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      filter === k
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {k === 'todas' ? 'Todas' : WINDOWS.find((w) => w.key === k)?.short}
                  </button>
                ))}
              </div>
            </div>

            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum pagamento previsto nesta janela.
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((i) => (
                  <li
                    key={`${i.source}-${i.pipefyCardId}-${i.dueDate}-${i.value}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs"
                  >
                    <span className={cn('shrink-0 tabular-nums font-medium', windowTone(i.window))}>
                      {brl(i.value)}
                    </span>
                    <span className="truncate text-foreground" title={i.client}>
                      {i.client}
                    </span>
                    <span className="text-muted-foreground">{i.product}</span>
                    <span
                      className={cn('tabular-nums', windowTone(i.window))}
                      title={i.window === 'vencida' ? 'Vencida' : 'A vencer'}
                    >
                      {brDate(i.dueDate)}
                    </span>
                    {i.signal && SIGNAL_LABEL[i.signal] && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        {SIGNAL_LABEL[i.signal]}
                      </span>
                    )}
                    <a
                      href={pipefyUrl(i.pipefyCardId)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                    >
                      #{i.pipefyCardId}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Não é decoração: sem isto alguém soma as duas abas e reporta faturamento
              inflado. É a mesma regra que faz a RPC excluir card já pago. */}
          <p className="flex items-start gap-2 rounded-2xl border border-border bg-gradient-card px-5 py-4 text-xs text-muted-foreground shadow-card">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Este total <strong>não se soma</strong> ao da aba Financeiro. Lá é o dinheiro que já
              entrou; aqui é o que ainda não entrou. Quando um cliente paga, o card vira lançamento
              no Financeiro e sai desta lista — nunca aparece nos dois lugares.
            </span>
          </p>

          {count === 0 && (
            <p className="rounded-2xl border border-border bg-gradient-card px-5 py-4 text-xs text-muted-foreground shadow-card">
              Nenhuma projeção encontrada. Se a migration{' '}
              <code className="text-foreground">20260731b_negociacao_schema.sql</code> já foi
              aplicada, rode <code className="text-foreground">npm run import:negociacao</code> para
              a carga inicial.
            </p>
          )}
        </>
      )}
    </div>
  )
}
