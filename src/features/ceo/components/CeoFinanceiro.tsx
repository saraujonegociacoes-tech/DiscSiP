'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Target,
  CalendarDays,
  Trophy,
} from 'lucide-react'
import { KpiCard } from '@/components/bluedesk/KpiCard'
import { useChartTheme } from '@/components/bluedesk/useChartTheme'
import { CeoPeriodPicker, type CeoPeriodMode } from './CeoPeriodPicker'
import { ValorEditavel } from './ValorEditavel'
import { businessDaysLeft, currentCivilMonth, type LeadPeriod } from '@/lib/period'
import { getCeoFinanceiro, getCeoMeta, setCeoMeta } from '@/app/actions/ceo'
import { cn } from '@/lib/utils'
import type {
  CeoFinanceiroData,
  CeoFinanceiroBucket,
  CeoMetaConfig,
} from '@/lib/types/database'

// ABA 1 do painel do CEO — FINANCEIRO (entradas do mês), o carro-chefe.
// Fonte: get_ceo_financeiro (20260731_financeiro_schema.sql →
// 20260810_financeiro_valor_liquido.sql), que soma sobre `fin_entries` — uma linha por
// CARD, valendo o "Valor do Pagamento Líquido". Ver
// docs/projetopainelceo-docs/updates/introspeccao-pipefy-financeiro.md.
//
// Card com o líquido vazio fica FORA da soma de propósito (o painel mostra o líquido, não
// um substituto) — e por isso ganha o bloco de aviso lá embaixo: o dinheiro não some da
// tela, só sai do total até alguém preencher o campo no Pipefy.
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

// Nome do departamento como o CEO fala dele: o Pipefy grava "Departamento - Negociação".
// Mesmo enxugamento que a aba Saúde da Equipe já fazia — o prefixo se repete em toda
// linha e não distingue nada.
const deptoCurto = (nome: string) => nome.replace(/^Departamento - /, '')

// ── Card DIÁRIA — o número que a operação persegue hoje ─────────────────────
// Existe por um pedido que se repete no grupo toda manhã: a supervisão manda a projeção
// do dia por departamento e o CEO responde "atualiza os números aqui, junto com a
// diária". Isso saía de três prints (realizado, quebra por departamento, meta) montados
// à mão. Com este card, a aba inteira vira UM print.
//
// A conta, exatamente como o dono a define:
//     meta_atual  = meta_esperada − realizado no período
//     diária      = meta_atual ÷ dias úteis restantes no período
//
// Três decisões que o código toma e a tela precisa deixar visíveis:
//
//  · HOJE CONTA como dia útil restante (ver businessDaysLeft em lib/period.ts). Ainda dá
//    para faturar hoje; tirar o dia corrente inflaria a diária justo na hora em que ela
//    é pedida.
//  · Dia útil é SEG–SEX, sem tabela de feriados (o repo não tem uma). Num mês com
//    feriado a diária sai um pouco otimista, e é melhor isso do que uma lista incompleta
//    errando em silêncio.
//  · Sem dia útil restante (período encerrado, ou só fim de semana até o fim dele) NÃO se
//    divide por zero: o card troca de assunto e mostra o que faltou, não uma diária
//    impossível.
function MetaDiaria({
  meta,
  atingido,
  period,
  mode,
  byDepartment,
  onSave,
}: {
  meta: number
  /** O realizado do período — o mesmo `total` dos KPIs, com sinal. */
  atingido: number
  period: LeadPeriod
  mode: CeoPeriodMode
  byDepartment: CeoFinanceiroBucket[]
  onSave: (v: number | null) => Promise<void>
}) {
  const dias = useMemo(() => businessDaysLeft(period), [period])

  // `Math.max(…, 0)`: passou da meta, falta zero — não "falta negativo".
  const falta = Math.max(meta - atingido, 0)
  const batida = meta > 0 && falta === 0
  const diaria = dias.restantes > 0 ? falta / dias.restantes : 0
  const pct = meta > 0 ? (atingido / meta) * 100 : 0

  // Rateio da diária pelos departamentos, na proporção do que CADA UM já fez no período.
  // É o que reproduz o "Negociação: X · SC: Y · Comercial: Z" da mensagem do grupo sem
  // pedir três metas separadas ao dono.
  //
  // ⚠️ É DERIVADO, não cadastrado: nenhum departamento tem meta própria no banco. Só
  // aparece quando há diária a distribuir e realizado positivo para dar proporção — e a
  // tela diz de onde veio, logo abaixo, para ninguém ler como alvo oficial.
  const rateio = useMemo(() => {
    if (diaria <= 0) return []
    const positivos = byDepartment.filter((d) => d.total > 0)
    const soma = positivos.reduce((acc, d) => acc + d.total, 0)
    if (soma <= 0) return []
    return positivos.slice(0, 4).map((d) => ({
      key: deptoCurto(d.key),
      valor: diaria * (d.total / soma),
    }))
  }, [byDepartment, diaria])

  const recorte = mode === 'ciclo' ? 'ciclo' : 'mês'

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-elevated">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />

      <div className="relative mb-4 flex flex-wrap items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Diária para bater a meta</h3>
        <span className="text-xs text-muted-foreground">
          o que falta ÷ dias úteis restantes do {recorte}
        </span>
      </div>

      {meta <= 0 ? (
        // Meta nunca cadastrada. Sem alvo não existe diária — o card vira o convite para
        // definir, em vez de mostrar R$ 0,00 e parecer quebrado.
        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-muted-foreground">Defina a meta esperada do período:</span>
          <ValorEditavel valor={0} destaque ariaLabel="Meta esperada do período" onSave={onSave} />
          <p className="w-full text-xs text-muted-foreground">
            Um número só, válido para o mês civil e para o ciclo 11→10. Ele fica salvo e vale para
            os dois recortes do seletor.
          </p>
        </div>
      ) : (
        <div className="relative grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          {/* Esquerda — o alvo, o quanto já entrou e o quanto falta. */}
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Meta esperada
              </span>
              {/* O mesmo campo editável da Saúde da Equipe: clica no número, digita, Enter. */}
              <ValorEditavel valor={meta} destaque ariaLabel="Meta esperada do período" onSave={onSave} />
            </div>

            {/* Barra sobre a META (não sobre o maior item, como nos breakdowns): aqui o
                100% existe e é ele que interessa. Passar da meta trava visualmente em
                100% — o excedente é dito em texto, não estourando a barra. */}
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/60">
              <div
                className={cn('h-full rounded-full', batida ? 'bg-success' : 'bg-gradient-primary')}
                style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
              />
            </div>

            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">
                Atingido <strong className="tabular-nums text-foreground">{brl(atingido)}</strong> (
                {pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)
              </span>
              <span className={cn('tabular-nums', batida ? 'text-success' : 'text-muted-foreground')}>
                {batida ? (
                  <>
                    <Trophy className="mr-1 inline h-3.5 w-3.5" />
                    Meta batida — <strong>{brl(atingido - meta)}</strong> acima
                  </>
                ) : (
                  <>
                    Falta <strong className="text-foreground">{brl(falta)}</strong>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Direita — a diária, que é o número pedido no grupo. */}
          <div className="rounded-xl border border-border/60 bg-background/40 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              Precisa entrar por dia útil
            </div>

            <div
              className={cn(
                'mt-1 text-3xl font-semibold tracking-tight tabular-nums',
                batida ? 'text-success' : 'text-foreground',
              )}
            >
              {batida ? brl(0) : dias.restantes > 0 ? brl(diaria) : '—'}
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              {batida ? (
                <>Meta já alcançada — o que entrar daqui em diante é excedente.</>
              ) : dias.restantes > 0 ? (
                <>
                  <strong className="text-foreground">{dias.restantes}</strong> de {dias.totais} dias
                  úteis {dias.futuro ? 'do' : 'restantes no'} {recorte} (hoje conta)
                </>
              ) : (
                <>
                  Sem dia útil restante no {recorte}: faltaram{' '}
                  <strong className="text-foreground">{brl(falta)}</strong> para a meta.
                </>
              )}
            </p>

            {rateio.length > 0 && (
              <>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-xs">
                  {rateio.map((r) => (
                    <span key={r.key} className="text-muted-foreground">
                      {r.key} <strong className="tabular-nums text-foreground">{brl(r.valor)}</strong>
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Rateio da diária no ritmo que cada departamento já teve no período — não é meta
                  cadastrada por departamento.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function CeoFinanceiro() {
  const [mode, setMode] = useState<CeoPeriodMode>('mes')
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCivilMonth())
  const [data, setData] = useState<CeoFinanceiroData | null>(null)
  const [meta, setMeta] = useState<CeoMetaConfig | null>(null)
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

  // A meta é buscada UMA VEZ, em efeito próprio, e não junto com o período: ela é um
  // singleton no banco (o mesmo alvo para mês civil e ciclo), então refazer a chamada a
  // cada clique no seletor seria round-trip jogado fora. Os dois efeitos disparam no
  // mesmo mount, em paralelo — a meta não atrasa a aba.
  useEffect(() => {
    let cancelled = false
    getCeoMeta()
      .then((m) => {
        if (!cancelled) setMeta(m)
      })
      .catch(() => {
        // A action já degrada pra meta 0; aqui só evitamos rejeição solta.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Grava e atualiza o card na hora, sem recarregar o período: a meta não entra em
  // nenhum número que vem da RPC do Financeiro — só na conta que a tela faz. Recarregar
  // aqui piscaria a aba inteira à toa.
  const salvarMeta = useCallback(async (v: number | null) => {
    const valor = v ?? 0
    const r = await setCeoMeta(valor)
    if (r.ok) setMeta((m) => ({ meta: valor, updatedAt: m?.updatedAt ?? null }))
  }, [])

  const chartData = useMemo(
    () => (data?.monthly ?? []).map((m) => ({ ...m, label: bucketLabel(m.month, mode) })),
    [data, mode],
  )

  const total = data?.total ?? 0
  const count = data?.count ?? 0
  const ticket = count > 0 ? total / count : 0
  const topCategory = data?.byCategory?.[0]
  const missingNet = data?.missingNet ?? []
  const hasData = count > 0 || chartData.some((m) => m.count > 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Entradas do período</h2>
          <p className="text-xs text-muted-foreground">
            Valor do Pagamento Líquido dos cards do Financeiro, sem a fase de cancelados.
            Devoluções e descontos entram como valor negativo.
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

          {/* ── O QUE O CEO PEDE TODA MANHÃ, JUNTO ─────────────────────────────
              Diária + quebra por categoria/departamento/forma subiram para CIMA do
              gráfico em 02/set. A ordem antiga (KPIs → gráfico de 12 ciclos → quebras)
              vinha da Sprint 1, quando a série era o assunto da aba. Na prática o pedido
              diário do grupo é "projeção por departamento + diária", e essas duas coisas
              ficavam abaixo da dobra: virava print de três telas. Agora o gráfico é o
              contexto histórico, que vem DEPOIS do que se persegue hoje. */}
          <MetaDiaria
            meta={meta?.meta ?? 0}
            atingido={total}
            period={period}
            mode={mode}
            byDepartment={data?.byDepartment ?? []}
            onSave={salvarMeta}
          />

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

          {/* Contrapeso da regra "sem líquido, sem entrada": estes cards NÃO estão nos
              KPIs acima. O valor mostrado é o que o card declara em outro campo (valor
              pago ou parcelas) — é a pista de quanto falta preencher, não uma segunda
              contabilidade. */}
          {missingNet.length > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-warning/30 bg-warning/5 p-5 shadow-card">
              <div className="relative mb-1 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h3 className="text-sm font-semibold text-foreground">
                  {missingNet.length === 1
                    ? '1 card sem o valor líquido preenchido'
                    : `${nf(missingNet.length)} cards sem o valor líquido preenchido`}
                </h3>
              </div>
              <p className="relative mb-4 text-xs text-muted-foreground">
                A aba conta o <strong>Valor do Pagamento Líquido</strong> do card. Nestes o campo
                está vazio ou zerado, então eles ficam <strong>fora</strong> dos números acima —
                são {brl(data?.missingNetTotal ?? 0)} declarados em outro campo. Preencha o líquido
                no Pipefy e eles entram sozinhos na próxima sincronização.
              </p>
              <ul className="relative space-y-2">
                {missingNet.map((m) => (
                  <li
                    key={m.cardId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs"
                  >
                    <span className="font-medium tabular-nums text-foreground">{brl(m.value)}</span>
                    <span className="truncate text-foreground" title={m.title ?? undefined}>
                      {m.title ?? 'Sem título'}
                    </span>
                    <span className="text-muted-foreground">{m.category ?? 'Sem categoria'}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {m.paidDate.split('-').reverse().join('/')}
                    </span>
                    <span className="text-muted-foreground">{m.department}</span>
                    <a
                      href={pipefyUrl(m.cardId)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      #{m.cardId}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasData && (
            <p className="rounded-2xl border border-border bg-gradient-card px-5 py-4 text-xs text-muted-foreground shadow-card">
              Nenhuma entrada encontrada. Se a migration{' '}
              <code className="text-foreground">20260810_financeiro_valor_liquido.sql</code> já foi
              aplicada, rode <code className="text-foreground">npm run import:financeiro</code> para
              a carga histórica.
            </p>
          )}
        </>
      )}
    </div>
  )
}
