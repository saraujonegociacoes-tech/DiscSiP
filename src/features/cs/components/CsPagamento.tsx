'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Wallet,
  Download,
  ExternalLink,
  Loader2,
  Info,
  ChevronDown,
  X,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  ReceiptText,
} from 'lucide-react'
import { PeriodPicker } from '@/components/bluedesk/PeriodPicker'
import { currentCycle, type LeadPeriod } from '@/lib/period'
import { BRT_TZ } from '@/lib/timezone'
import { getCsPagamentoProjecao, getCsPagamentoHistorico } from '@/app/actions/cs'
import { downloadCsv, type CsvValue } from '@/lib/csv'
import { cn } from '@/lib/utils'
import type {
  CsPagamentoProjecaoData,
  CsPagamentoCard,
  CsPagamentoHistoricoData,
} from '@/lib/types/database'

// PÁGINA 4 do painel de CS — PAGAMENTO + INSIGHTS. Modelo híbrido (ver migration
// 20260730b_cs_pagamento.sql e docs/painelcs-docs/updates/painel-sucesso-cliente-cs.md):
//   · PROJEÇÃO ("quando/quanto vão pagar") = plano por parcela criado na fase "Aguardando
//     Pagamento" do SC (snapshot, sem período). É o esperado. Só vale ENQUANTO o card está
//     na fase: a RPC manda `plano: []` pra quem saiu (migration 20260811) — os campos ficam
//     no metadata pra sempre, mas fora da fase eles são histórico, não previsão.
//   · REALIZADO/HISTÓRICO ("quanto já pagaram") = conexão com o pipe do Financeiro (cada card
//     conectado = 1 pagamento de 1 parcela). Esse NÃO tem filtro de fase — dinheiro que entrou
//     conta sempre. Por isso a lista tem cards "Fora da fase": entram só pelo realizado.
//     O histórico é filtrável por período.
// A reconciliação prevista×paga (por número de parcela), os KPIs de carteira, o calendário de
// recebimento e o status moram aqui no cliente. Nasce ~vazio: enche conforme os cards entram na
// fase com o plano preenchido e as conexões de pagamento sobem.

const nf = (n: number) => n.toLocaleString('pt-BR')
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pipefyUrl = (id: string) => `https://app.pipefy.com/open-cards/${id}`

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: BRT_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
function monthKey(iso: string): string {
  return iso.slice(0, 7) // YYYY-MM
}
function fmtMonth(key: string): string {
  const [y, m] = key.split('-')
  return `${MONTHS[Number(m) - 1] ?? m}/${(y ?? '').slice(2)}`
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

type StatusFilter = 'ativos' | 'inativos' | 'todos'
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ativos', label: 'Ativos' },
  { key: 'inativos', label: 'Inativos' },
  { key: 'todos', label: 'Todos' },
]

type CardStatus = 'quitado' | 'atrasado' | 'em_dia' | 'sem_plano' | 'fora_fase'
const STATUS_META: Record<CardStatus, { label: string; tone: string; dot: string }> = {
  quitado: { label: 'Quitado', tone: 'text-success', dot: 'bg-success' },
  em_dia: { label: 'Em dia', tone: 'text-primary', dot: 'bg-primary' },
  atrasado: { label: 'Atrasado', tone: 'text-destructive', dot: 'bg-destructive' },
  sem_plano: { label: 'Sem plano', tone: 'text-muted-foreground', dot: 'bg-muted-foreground/60' },
  // Card que já saiu de "Aguardando Pagamento": está na lista só porque tem pagamento
  // conectado. Não tem projeção (a RPC manda `plano: []` desde a 20260811) — e não deve
  // ter: o dinheiro que entrou continua contando, o previsto não.
  fora_fase: { label: 'Fora da fase', tone: 'text-muted-foreground', dot: 'bg-muted-foreground/40' },
}

// Reconciliação de uma parcela: o previsto (plano do SC) casado com o pago (conexão), pelo número.
interface DerivedParcela {
  num: number
  valorPrevisto: number | null
  dataPrevista: string | null
  valorPago: number | null
  dataPagamento: string | null
  comprovanteUrl: string | null
  paga: boolean
  atrasada: boolean
}
interface DerivedCard {
  card: CsPagamentoCard
  parcelas: DerivedParcela[]
  totalPrevisto: number
  totalPago: number
  emAberto: number
  parcelasPrevistas: number
  parcelasPagas: number
  proxima: DerivedParcela | null
  status: CardStatus
}

function derive(card: CsPagamentoCard, today: string): DerivedCard {
  // Une os números de parcela do plano e dos pagamentos.
  const nums = new Set<number>()
  for (const p of card.plano) nums.add(p.num)
  for (const pg of card.pagamentos) if (pg.parcelaNum != null) nums.add(pg.parcelaNum)
  const sortedNums = [...nums].sort((a, b) => a - b)

  const parcelas: DerivedParcela[] = sortedNums.map((num) => {
    const plano = card.plano.find((p) => p.num === num) ?? null
    const pgs = card.pagamentos.filter((p) => p.parcelaNum === num)
    const paga = pgs.length > 0
    const valorPago = paga ? pgs.reduce((a, p) => a + (p.valorPago ?? 0), 0) : null
    const dataPagamento =
      pgs
        .map((p) => p.dataPagamento)
        .filter((d): d is string => !!d)
        .sort()
        .slice(-1)[0] ?? null
    const comprovanteUrl = pgs.map((p) => p.comprovanteUrl).find((u): u is string => !!u) ?? null
    const dataPrevista = plano?.dataPrevista ?? null
    const atrasada = !paga && dataPrevista != null && dataPrevista < today
    return {
      num,
      valorPrevisto: plano?.valorPrevisto ?? null,
      dataPrevista,
      valorPago,
      dataPagamento,
      comprovanteUrl,
      paga,
      atrasada,
    }
  })

  const totalPrevisto = card.plano.reduce((a, p) => a + (p.valorPrevisto ?? 0), 0)
  const totalPago = card.pagamentos.reduce((a, p) => a + (p.valorPago ?? 0), 0)
  const emAberto = Math.max(totalPrevisto - totalPago, 0)
  const parcelasPrevistas = card.plano.length
  const parcelasPagas = parcelas.filter((p) => p.paga).length
  const proxima =
    parcelas.find((p) => !p.paga && (p.valorPrevisto != null || p.dataPrevista != null)) ?? null

  let status: CardStatus
  if (!card.naFase) status = 'fora_fase'
  else if (parcelasPrevistas === 0) status = 'sem_plano'
  else if (totalPrevisto > 0 && totalPago >= totalPrevisto - 0.005) status = 'quitado'
  else if (parcelas.some((p) => p.atrasada)) status = 'atrasado'
  else status = 'em_dia'

  return {
    card,
    parcelas,
    totalPrevisto,
    totalPago,
    emAberto,
    parcelasPrevistas,
    parcelasPagas,
    proxima,
    status,
  }
}

function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: typeof Wallet
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

// Cada insight carrega os cards que cita (drill ao clicar) + como resumir cada um.
interface InsightItem {
  id: string
  tone: string
  text: string
  cards: DerivedCard[]
  detail: (d: DerivedCard) => string
}

export function CsPagamento() {
  const today = useMemo(() => todayISO(), [])

  // PROJEÇÃO (snapshot) — carrega uma vez.
  const [proj, setProj] = useState<CsPagamentoProjecaoData | null>(null)
  const [loadingProj, setLoadingProj] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ativos')
  const [cardSel, setCardSel] = useState<string | null>(null)
  const [insightSel, setInsightSel] = useState<string | null>(null)

  // HISTÓRICO (série) — recarrega por período.
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCycle())
  const [hist, setHist] = useState<CsPagamentoHistoricoData | null>(null)
  const [loadingHist, setLoadingHist] = useState(true)

  useEffect(() => {
    let cancelled = false
    getCsPagamentoProjecao()
      .then((d) => {
        if (!cancelled) setProj(d)
      })
      .catch(() => {
        /* action já degrada pra vazio */
      })
      .finally(() => {
        if (!cancelled) setLoadingProj(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadingHist(true)
    getCsPagamentoHistorico(period)
      .then((d) => {
        if (!cancelled) setHist(d)
      })
      .catch(() => {
        /* action já degrada pra vazio */
      })
      .finally(() => {
        if (!cancelled) setLoadingHist(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  const derived = useMemo<DerivedCard[]>(
    () => (proj?.cards ?? []).map((c) => derive(c, today)),
    [proj, today],
  )

  const filtered = useMemo(() => {
    if (statusFilter === 'ativos') return derived.filter((d) => d.card.active)
    if (statusFilter === 'inativos') return derived.filter((d) => !d.card.active)
    return derived
  }, [derived, statusFilter])

  // KPIs de carteira (sobre o recorte de situação).
  const kpis = useMemo(() => {
    const aReceber = filtered.reduce((a, d) => a + d.emAberto, 0)
    const recebido = filtered.reduce((a, d) => a + d.totalPago, 0)
    const previsto = filtered.reduce((a, d) => a + d.totalPrevisto, 0)
    const quitados = filtered.filter((d) => d.status === 'quitado').length
    const atrasados = filtered.filter((d) => d.status === 'atrasado').length
    // Na fase = quem gera projeção. O resto está na lista só pelo pagamento realizado.
    const naFase = filtered.filter((d) => d.card.naFase).length
    return { aReceber, recebido, previsto, quitados, atrasados, naFase, count: filtered.length }
  }, [filtered])

  // Calendário de recebimento: previsto (parcelas não pagas, por vencimento) × recebido (parcelas
  // pagas, por data de pagamento), agrupados por mês.
  const calendario = useMemo(() => {
    const map = new Map<string, { previsto: number; recebido: number }>()
    for (const d of filtered) {
      for (const p of d.parcelas) {
        if (!p.paga && p.dataPrevista) {
          const k = monthKey(p.dataPrevista)
          const e = map.get(k) ?? { previsto: 0, recebido: 0 }
          e.previsto += p.valorPrevisto ?? 0
          map.set(k, e)
        }
        if (p.paga && p.dataPagamento) {
          const k = monthKey(p.dataPagamento)
          const e = map.get(k) ?? { previsto: 0, recebido: 0 }
          e.recebido += p.valorPago ?? 0
          map.set(k, e)
        }
      }
    }
    const rows = [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ key, ...v }))
    const max = rows.reduce((m, r) => Math.max(m, r.previsto, r.recebido), 0)
    return { rows, max }
  }, [filtered])

  const insights = useMemo<InsightItem[]>(() => {
    const out: InsightItem[] = []
    const sumOpen = (arr: DerivedCard[]) => arr.reduce((a, d) => a + d.emAberto, 0)

    const atrasados = filtered.filter((d) => d.status === 'atrasado')
    if (atrasados.length > 0)
      out.push({
        id: 'atrasados',
        tone: 'text-destructive',
        text: `${nf(atrasados.length)} card(s) com parcela atrasada (${brl(sumOpen(atrasados))} em aberto).`,
        cards: atrasados,
        detail: (d) => {
          const atrasada = d.parcelas.find((p) => p.atrasada)
          return atrasada
            ? `parcela ${atrasada.num} venceu ${atrasada.dataPrevista ? fmtDate(atrasada.dataPrevista) : '—'} · ${brl(d.emAberto)} em aberto`
            : `${brl(d.emAberto)} em aberto`
        },
      })

    const vence30 = filtered.filter((d) =>
      d.parcelas.some((p) => !p.paga && p.dataPrevista && p.dataPrevista >= today && daysBetween(today, p.dataPrevista) <= 30),
    )
    if (vence30.length > 0)
      out.push({
        id: 'vence30',
        tone: 'text-warning',
        text: `${nf(vence30.length)} card(s) com parcela vencendo em até 30 dias.`,
        cards: vence30,
        detail: (d) => {
          const prox = d.proxima
          return prox?.dataPrevista
            ? `próxima ${fmtDate(prox.dataPrevista)} · ${prox.valorPrevisto == null ? '—' : brl(prox.valorPrevisto)}`
            : `${brl(d.emAberto)} em aberto`
        },
      })

    const quitados = filtered.filter((d) => d.status === 'quitado')
    if (quitados.length > 0)
      out.push({
        id: 'quitados',
        tone: 'text-success',
        text: `${nf(quitados.length)} card(s) quitado(s) — pagamento concluído.`,
        cards: quitados,
        detail: (d) => `${brl(d.totalPago)} pagos em ${nf(d.parcelasPagas)} parcela(s)`,
      })

    let maior: DerivedCard | null = null
    for (const d of filtered) if (d.emAberto > 0 && (maior === null || d.emAberto > maior.emAberto)) maior = d
    if (maior)
      out.push({
        id: 'maior',
        tone: 'text-muted-foreground',
        text: `Maior saldo em aberto: ${brl(maior.emAberto)} — ${maior.card.title || `card ${maior.card.pipefyCardId}`}.`,
        cards: [maior],
        detail: (d) => `${brl(d.totalPago)} de ${brl(d.totalPrevisto)} pagos`,
      })

    return out
  }, [filtered, today])

  const insightDrill = useMemo(
    () => insights.find((i) => i.id === insightSel) ?? null,
    [insights, insightSel],
  )

  const selectedCard = useMemo(
    () => filtered.find((d) => d.card.pipefyCardId === cardSel) ?? null,
    [filtered, cardSel],
  )

  function changeStatus(next: StatusFilter) {
    setStatusFilter(next)
    setCardSel(null)
    setInsightSel(null)
  }

  // Exportação da PROJEÇÃO: uma linha por card, com o resumo da carteira + o cronograma
  // parcela a parcela aberto em colunas (o que a tela só mostra no drill). A URL do card
  // é a PRIMEIRA coluna — o CSV existe pra virar plano de cobrança, e sem o link a
  // planilha não leva a lugar nenhum.
  //
  // Nº de parcelas é dinâmico: o plano tem teto 3, mas o Financeiro pode conectar um
  // pagamento com parcela 4+ (o campo é livre). Fixar em 3 comeria dado em silêncio.
  function exportCsv() {
    const maxParcela = filtered.reduce(
      (m, d) => d.parcelas.reduce((mm, p) => Math.max(mm, p.num), m),
      0,
    )
    const head = [
      'URL do card', 'ID', 'Cliente', 'Responsável', 'Fase', 'Na fase Aguardando Pagamento',
      'Situação', 'Status', 'Forma', 'Total previsto', 'Total pago', 'Em aberto',
      'Parcelas previstas', 'Parcelas pagas', 'Próxima parcela (venc.)', 'Próxima parcela (valor)',
      ...Array.from({ length: maxParcela }, (_, i) => [
        `P${i + 1} previsto`, `P${i + 1} vencimento`, `P${i + 1} pago`, `P${i + 1} pago em`,
        `P${i + 1} situação`, `P${i + 1} comprovante`,
      ]).flat(),
    ]
    const rows: CsvValue[][] = filtered.map((d) => [
      pipefyUrl(d.card.pipefyCardId),
      d.card.pipefyCardId,
      d.card.title ?? '',
      d.card.agentName,
      d.card.phase,
      d.card.naFase ? 'Sim' : 'Não',
      d.card.active ? 'Ativo' : 'Inativo',
      STATUS_META[d.status].label,
      d.card.forma ?? '',
      d.totalPrevisto || '',
      d.totalPago || '',
      d.emAberto || '',
      d.parcelasPrevistas,
      d.parcelasPagas,
      d.proxima?.dataPrevista ? fmtDate(d.proxima.dataPrevista) : '',
      d.proxima?.valorPrevisto ?? '',
      ...Array.from({ length: maxParcela }, (_, i) => {
        const p = d.parcelas.find((x) => x.num === i + 1)
        if (!p) return ['', '', '', '', '', '']
        return [
          p.valorPrevisto ?? '',
          p.dataPrevista ? fmtDate(p.dataPrevista) : '',
          p.valorPago ?? '',
          p.dataPagamento ? fmtDate(p.dataPagamento) : '',
          p.paga ? 'Paga' : p.atrasada ? 'Atrasada' : 'A vencer',
          p.comprovanteUrl ?? '',
        ]
      }).flat(),
    ])
    downloadCsv(
      `cs-pagamento-${proj ? fmtStamp(proj.referenceAt).replace(/\s/g, '') : 'export'}`,
      head,
      rows,
    )
  }

  // Exportação do REALIZADO: a outra metade da aba (pagamentos confirmados no período,
  // vindos do pipe do Financeiro). Sai com a URL do card do SC e a do comprovante.
  function exportHistoricoCsv() {
    const head = [
      'URL do card', 'ID do card (SC)', 'ID do pagamento (Financeiro)', 'Cliente',
      'Responsável', 'Parcela', 'Valor pago', 'Data do pagamento', 'Comprovante',
    ]
    const rows: CsvValue[][] = (hist?.payments ?? []).map((p) => [
      pipefyUrl(p.pipefyCardId),
      p.pipefyCardId,
      p.paymentCardId,
      p.title ?? '',
      p.agentName,
      p.parcelaNum ?? '',
      p.valorPago ?? '',
      p.dataPagamento ? fmtDate(p.dataPagamento) : '',
      p.comprovanteUrl ?? '',
    ])
    downloadCsv(`cs-pagamento-recebido-${period.key}`, head, rows)
  }

  if (proj === null) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-border bg-gradient-card text-sm text-muted-foreground shadow-card">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    )
  }

  const hasCards = derived.length > 0

  return (
    <div className="flex flex-col gap-4">
      {/* ── Barra de controle: situação ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="h-4 w-4 text-primary" />
          <span>
            Projeção e recebimento · foto de{' '}
            <span className="font-medium text-foreground">{fmtStamp(proj.referenceAt)}</span>.
          </span>
          {loadingProj && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
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
              aria-selected={statusFilter === t.key}
              onClick={() => changeStatus(t.key)}
              className={
                statusFilter === t.key
                  ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-glow'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!hasCards ? (
        <div className="rounded-2xl border border-border bg-gradient-card p-10 text-center shadow-card">
          <Wallet className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Nenhum card em pagamento ainda. Esta página preenche conforme os cards entram na fase{' '}
            <span className="text-foreground">Aguardando Pagamento</span> com o plano de parcelas e a
            conexão de pagamento sobe do Financeiro.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPIs de carteira ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Em pagamento"
              value={nf(kpis.naFase)}
              sub={`na fase · ${nf(kpis.count - kpis.naFase)} fora (só realizado)`}
              icon={Wallet}
            />
            <Stat label="A receber" value={brl(kpis.aReceber)} sub={`de ${brl(kpis.previsto)} previstos`} icon={CalendarClock} />
            <Stat label="Já recebido" value={brl(kpis.recebido)} sub="total pago na carteira" icon={CheckCircle2} />
            <Stat label="Atrasados" value={nf(kpis.atrasados)} sub="com parcela vencida" icon={AlertTriangle} />
          </div>

          {/* ── Tabela por card + trilho (calendário/insights) ──────────────── */}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Cards em pagamento</h2>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{nf(filtered.length)} card(s)</span>
                    <button
                      type="button"
                      onClick={exportCsv}
                      disabled={filtered.length === 0}
                      title="CSV com URL do card, cliente, responsável, fase, totais e o cronograma parcela a parcela"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Exportar
                    </button>
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Sem cards neste recorte de situação.
                  </p>
                ) : (
                  <div className="scrollbar-slim max-h-[560px] overflow-auto rounded-xl border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-background/95 backdrop-blur">
                          <th scope="col" className="sticky left-0 z-20 bg-background/95 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Cliente
                          </th>
                          <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Responsável</th>
                          <th scope="col" className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Forma</th>
                          <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Previsto</th>
                          <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pago</th>
                          <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Em aberto</th>
                          <th scope="col" className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Próxima</th>
                          <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((d) => {
                          const sel = cardSel === d.card.pipefyCardId
                          const sm = STATUS_META[d.status]
                          return (
                            <tr
                              key={d.card.pipefyCardId}
                              onClick={() => setCardSel((cur) => (cur === d.card.pipefyCardId ? null : d.card.pipefyCardId))}
                              className={cn(
                                'cursor-pointer border-t border-border/60 hover:bg-primary/5',
                                sel && 'bg-primary/10',
                              )}
                            >
                              <th scope="row" className="sticky left-0 z-10 max-w-[180px] bg-gradient-card px-3 py-1.5 text-left font-medium">
                                <span className="flex items-center gap-1 text-xs text-foreground">
                                  <span className="max-w-[150px] truncate" title={d.card.title ?? undefined}>
                                    {d.card.title || `Card ${d.card.pipefyCardId}`}
                                  </span>
                                  <ChevronDown className={cn('h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform', sel && 'rotate-180')} />
                                </span>
                              </th>
                              <td className="max-w-[150px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={d.card.agentName}>
                                {d.card.agentName}
                              </td>
                              <td className="px-3 py-1.5 text-center text-[11px] text-muted-foreground">
                                {d.card.forma ?? '—'}
                              </td>
                              <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                                {d.totalPrevisto ? brl(d.totalPrevisto) : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-right text-xs tabular-nums text-foreground">
                                {d.totalPago ? brl(d.totalPago) : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                                {d.emAberto ? brl(d.emAberto) : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-center text-[11px] tabular-nums text-muted-foreground">
                                {d.proxima?.dataPrevista ? fmtDate(d.proxima.dataPrevista) : d.status === 'quitado' ? '✓' : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-left">
                                <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', sm.tone)}>
                                  <span className={cn('h-1.5 w-1.5 rounded-full', sm.dot)} />
                                  {sm.label}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Previsto = plano de parcelas, contado <span className="text-foreground">só enquanto o
                  card está na fase Aguardando Pagamento</span> · Pago = pagamentos reais (conexão com o
                  Financeiro), que contam em qualquer fase — por isso cards que já saíram aparecem como{' '}
                  <span className="text-foreground">Fora da fase</span>, sem previsto · clique num card
                  para ver o cronograma parcela a parcela.
                </p>
              </div>

              {/* Drill do card selecionado: cronograma prevista × paga */}
              {selectedCard && (
                <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <a
                        href={pipefyUrl(selectedCard.card.pipefyCardId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 text-sm font-semibold text-foreground"
                      >
                        <span className="max-w-[280px] truncate">
                          {selectedCard.card.title || `Card ${selectedCard.card.pipefyCardId}`}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                      </a>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {selectedCard.card.forma ?? 'Forma não informada'} ·{' '}
                        {nf(selectedCard.parcelasPagas)}/{nf(selectedCard.parcelasPrevistas || selectedCard.parcelas.length)} parcela(s) paga(s)
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCardSel(null)}
                      className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Fechar cronograma"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-background/60">
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Parcela</th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Previsto</th>
                          <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vencimento</th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pago</th>
                          <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pago em</th>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCard.parcelas.map((p) => (
                          <tr key={p.num} className="border-t border-border/60">
                            <td className="px-3 py-1.5 text-xs font-medium text-foreground">{p.num}ª</td>
                            <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                              {p.valorPrevisto == null ? '—' : brl(p.valorPrevisto)}
                            </td>
                            <td className="px-3 py-1.5 text-center text-[11px] tabular-nums text-muted-foreground">
                              {p.dataPrevista ? fmtDate(p.dataPrevista) : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right text-xs tabular-nums text-foreground">
                              {p.valorPago == null ? '—' : brl(p.valorPago)}
                            </td>
                            <td className="px-3 py-1.5 text-center text-[11px] tabular-nums text-muted-foreground">
                              {p.dataPagamento ? fmtDate(p.dataPagamento) : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-left text-[11px] font-medium">
                              {p.paga ? (
                                <span className="inline-flex items-center gap-1 text-success">
                                  <CheckCircle2 className="h-3 w-3" /> Paga
                                  {p.comprovanteUrl && (
                                    <a
                                      href={p.comprovanteUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ml-1 inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ReceiptText className="h-3 w-3" />
                                    </a>
                                  )}
                                </span>
                              ) : p.atrasada ? (
                                <span className="text-destructive">Atrasada</span>
                              ) : (
                                <span className="text-muted-foreground">A vencer</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Trilho: calendário + export + insights */}
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <CalendarClock className="h-4 w-4 text-primary" /> Calendário de recebimento
                </h3>
                {calendario.rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem datas de parcela neste recorte.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {calendario.rows.map((r) => (
                      <li key={r.key} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtMonth(r.key)}</span>
                        <div className="relative h-4 flex-1 overflow-hidden rounded bg-background/60">
                          {r.recebido > 0 && (
                            <div
                              className="absolute inset-y-0 left-0 bg-success/70"
                              style={{ width: `${calendario.max ? (r.recebido / calendario.max) * 100 : 0}%` }}
                            />
                          )}
                          {r.previsto > 0 && (
                            <div
                              className="absolute inset-y-0 bg-primary/40"
                              style={{
                                left: `${calendario.max ? (r.recebido / calendario.max) * 100 : 0}%`,
                                width: `${calendario.max ? (r.previsto / calendario.max) * 100 : 0}%`,
                              }}
                            />
                          )}
                        </div>
                        <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                          {brl(r.previsto + r.recebido)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-success/70" /> recebido</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/40" /> previsto</span>
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Info className="h-4 w-4 text-primary" /> Insights
                </h3>
                {insights.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem alertas de pagamento neste recorte.</p>
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
                              <ChevronDown className={cn('mt-0.5 h-3 w-3 shrink-0 transition-transform', active && 'rotate-180')} />
                            </button>
                          </li>
                        )
                      })}
                    </ul>

                    {insightDrill && (
                      <div className="mt-3 border-t border-border/60 pt-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {nf(insightDrill.cards.length)} card(s)
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
                          {insightDrill.cards.map((d) => (
                            <a
                              key={d.card.pipefyCardId}
                              href={pipefyUrl(d.card.pipefyCardId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 transition-colors hover:bg-background"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-foreground" title={d.card.title ?? undefined}>
                                  {d.card.title || `Card ${d.card.pipefyCardId}`}
                                </div>
                                <div className="truncate text-[10px] tabular-nums text-muted-foreground">
                                  {insightDrill.detail(d)}
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

      {/* ── Histórico de recebimento (série, por período) ─────────────────── */}
      <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-elevated">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ReceiptText className="h-4 w-4 text-primary" /> Histórico de recebimento
              {loadingHist && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pagamentos confirmados no período (fonte: pipe do Financeiro).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportHistoricoCsv}
              disabled={(hist?.payments.length ?? 0) === 0}
              title="CSV dos pagamentos do período, com URL do card e do comprovante"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar
            </button>
            <PeriodPicker value={period} onChange={setPeriod} disabled={loadingHist} />
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-background/50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recebido no período</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{brl(hist?.totalRecebido ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-border bg-background/50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pagamentos</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{nf(hist?.count ?? 0)}</div>
          </div>
        </div>

        {(hist?.payments.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum pagamento confirmado neste período.
          </p>
        ) : (
          <div className="scrollbar-slim max-h-[360px] overflow-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-background/95 backdrop-blur">
                  <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</th>
                  <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Responsável</th>
                  <th scope="col" className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Parcela</th>
                  <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Valor</th>
                  <th scope="col" className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Data</th>
                  <th scope="col" className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Comprov.</th>
                </tr>
              </thead>
              <tbody>
                {(hist?.payments ?? []).map((p) => (
                  <tr key={p.paymentCardId} className="border-t border-border/60 hover:bg-primary/5">
                    <th scope="row" className="max-w-[180px] px-3 py-1.5 text-left font-medium">
                      <a
                        href={pipefyUrl(p.pipefyCardId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 text-xs text-foreground"
                        title={p.title ?? undefined}
                      >
                        <span className="max-w-[150px] truncate">{p.title || `Card ${p.pipefyCardId}`}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                      </a>
                    </th>
                    <td className="max-w-[150px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={p.agentName}>{p.agentName}</td>
                    <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">{p.parcelaNum ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-foreground">{p.valorPago == null ? '—' : brl(p.valorPago)}</td>
                    <td className="px-3 py-1.5 text-center text-[11px] tabular-nums text-muted-foreground">{p.dataPagamento ? fmtDate(p.dataPagamento) : '—'}</td>
                    <td className="px-3 py-1.5 text-center">
                      {p.comprovanteUrl ? (
                        <a href={p.comprovanteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-muted-foreground hover:text-primary">
                          <ReceiptText className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// Dias entre duas datas ISO (a → b), inteiro. Usado só pra "vence em ≤30d".
function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00Z').getTime()
  const b = new Date(bIso + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000)
}
