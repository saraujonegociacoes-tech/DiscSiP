'use client'

import { useMemo, useState } from 'react'
import { eachDayOfInterval, endOfWeek, format, startOfWeek } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  civilMonthStartingAt,
  currentCivilMonth,
  currentCycle,
  periodBounds,
  shiftCycle,
  type LeadPeriod,
} from '@/lib/period'
import type { ProcMinutasData } from '@/lib/types/database'
import { brl, fmtDate, flattenRows, nf, nomeCliente, todayBRT, STATUS_META, type MinutaRow } from '../shared'

// PÁGINA 2 — Calendário de vencimentos. Clone do delivery-calendar do módulo Monday (date-fns
// + ptBR, sem lib de calendário), adaptado a parcelas: um chip por parcela no dia do
// vencimento, cor por situação; clicar num dia abre a agenda daquele dia.
//
// A JANELA não é mais o mês civil fixo: o dono pediu os dois recortes que o resto do painel já
// usa — MÊS CIVIL (bate com extrato e contabilidade) e CICLO 11→10 (a convenção da operação).
// Como o ciclo atravessa dois meses civis, a grade é montada a partir dos limites da janela
// (`periodBounds`) em vez de `startOfMonth`/`endOfMonth`, e os dias de fora ficam esmaecidos.
//
// ⚠️ Tudo aqui é ancorado no VENCIMENTO — inclusive o "Pago". Este calendário responde "o que
// está lançado para vencer nesta janela e quanto disso já foi quitado", não "quanto saiu do
// caixa neste mês" (essa leitura é a da Visão Geral, que recorta a parcela paga pela data de
// pagamento). Misturar as duas âncoras num painel só faria os números não fecharem entre si.

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_VISIBLE = 3

type CalendarioMode = 'mes' | 'ciclo'

function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

// 'YYYY-MM-DD' → Date na meia-noite LOCAL. `new Date('2026-08-01')` seria interpretado como
// UTC e, em BRT (UTC−3), cairia no dia 31/07 — a grade começaria um dia antes.
function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Desloca a janela em `delta` unidades do recorte corrente (−1 = anterior, +1 = próxima).
function shiftPeriod(period: LeadPeriod, mode: CalendarioMode, delta: number): LeadPeriod {
  if (mode === 'ciclo') return shiftCycle(period, delta)
  const [y, m] = periodBounds(period).startDate.split('-').map(Number)
  return civilMonthStartingAt(y, m + delta)
}

function statusBorder(status: MinutaRow['parcela']['status']): string {
  return status === 'pago' ? 'border-l-success' : status === 'vencida' ? 'border-l-status-stuck' : 'border-l-primary'
}

function Total({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums tracking-tight text-foreground', tone)}>{value}</div>
      <div className="text-[11px] tabular-nums text-muted-foreground">{sub}</div>
    </div>
  )
}

export function MinutasCalendario({ data }: { data: ProcMinutasData }) {
  const [mode, setMode] = useState<CalendarioMode>('mes')
  const [period, setPeriod] = useState<LeadPeriod>(() => currentCivilMonth())
  const [hidePago, setHidePago] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string>(() => todayBRT())

  const todayKey = todayBRT()
  const rows = useMemo(() => flattenRows(data.acordos), [data])
  const bounds = useMemo(() => periodBounds(period), [period])

  // Parcelas por dia de vencimento (aplica o filtro de pagas antes de agrupar).
  const byDay = useMemo(() => {
    const map = new Map<string, MinutaRow[]>()
    for (const r of rows) {
      if (!r.parcela.vencimento) continue
      if (hidePago && r.parcela.status === 'pago') continue
      const list = map.get(r.parcela.vencimento)
      if (list) list.push(r)
      else map.set(r.parcela.vencimento, [r])
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.parcela.status === 'pago') - Number(b.parcela.status === 'pago'))
    return map
  }, [rows, hidePago])

  // Grade: da semana que contém o 1º dia da janela até a que contém o último. No recorte de
  // ciclo isso atravessa dois meses civis (11/ago → 10/set), que é exatamente o esperado.
  const days = useMemo(() => {
    const gridStart = startOfWeek(ymdToLocalDate(bounds.startDate), { weekStartsOn: 0 })
    const gridEnd = endOfWeek(ymdToLocalDate(bounds.endDate), { weekStartsOn: 0 })
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [bounds])

  // TOTAL LANÇADO NA JANELA + a quebra por situação. Sai de `rows` (não de `byDay`): "Ocultar
  // pagas" é um filtro VISUAL da grade; se ele mexesse no total, o número deixaria de responder
  // "quanto foi lançado" e viraria "quanto sobrou na tela".
  const totais = useMemo(() => {
    const acc = {
      lancado: { count: 0, valor: 0 },
      pago: { count: 0, valor: 0 },
      aPagar: { count: 0, valor: 0 },
      vencido: { count: 0, valor: 0 },
    }
    for (const { parcela: p } of rows) {
      if (!p.vencimento || p.vencimento < bounds.startDate || p.vencimento > bounds.endDate) continue
      const v = p.valor ?? 0
      acc.lancado.count++
      acc.lancado.valor += v
      const alvo = p.status === 'pago' ? acc.pago : p.status === 'vencida' ? acc.vencido : acc.aPagar
      alvo.count++
      alvo.valor += v
    }
    return acc
  }, [rows, bounds])

  const selectedRows = useMemo(() => byDay.get(selected) ?? [], [byDay, selected])
  const selectedTotal = useMemo(() => selectedRows.reduce((a, r) => a + (r.parcela.valor ?? 0), 0), [selectedRows])

  // Trocar de recorte reposiciona na janela CORRENTE daquele modo — a chave de um ciclo não
  // existe na lista de meses, então manter a posição não faria sentido. Mesma decisão do
  // CeoPeriodPicker.
  function switchMode(next: CalendarioMode) {
    if (next === mode) return
    setMode(next)
    setPeriod(next === 'mes' ? currentCivilMonth() : currentCycle())
  }

  function irParaHoje() {
    setPeriod(mode === 'mes' ? currentCivilMonth() : currentCycle())
    setSelected(todayKey)
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPeriod((p) => shiftPeriod(p, mode, -1))}
              aria-label={mode === 'mes' ? 'Mês anterior' : 'Ciclo anterior'}
            >
              <ChevronLeft className="size-4" />
            </Button>
            {/* Sem `capitalize`: o rótulo vem pronto de lib/period ("ago/2026", "11 ago – 10
                set") e é o MESMO texto dos seletores das outras abas — capitalizar aqui faria
                a mesma janela aparecer escrita de dois jeitos no painel. */}
            <h2 className="min-w-44 text-center text-lg font-semibold tracking-tight">
              {period.label}
            </h2>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPeriod((p) => shiftPeriod(p, mode, 1))}
              aria-label={mode === 'mes' ? 'Próximo mês' : 'Próximo ciclo'}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={irParaHoje}>
              Hoje
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Toggle do recorte — os mesmos dois do resto do painel. */}
            <div className="inline-flex rounded-lg border border-border bg-background p-0.5 shadow-card">
              {(
                [
                  { key: 'mes', label: 'Mês civil' },
                  { key: 'ciclo', label: 'Ciclo 11→10' },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => switchMode(m.key)}
                  aria-pressed={mode === m.key}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    mode === m.key
                      ? 'bg-gradient-primary text-primary-foreground shadow-glow'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={hidePago} onCheckedChange={setHidePago} />
              Ocultar pagas
            </label>
          </div>
        </div>

        {/* Total lançado na janela + quebra por situação. */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Total
            label="Total lançado"
            value={brl(totais.lancado.valor)}
            sub={`${nf(totais.lancado.count)} parcela(s)`}
          />
          <Total
            label="Pago"
            value={brl(totais.pago.valor)}
            sub={`${nf(totais.pago.count)} parcela(s)`}
            tone="text-success"
          />
          <Total
            label="A pagar"
            value={brl(totais.aPagar.valor)}
            sub={`${nf(totais.aPagar.count)} parcela(s)`}
            tone="text-primary"
          />
          <Total
            label="Vencido"
            value={brl(totais.vencido.valor)}
            sub={`${nf(totais.vencido.count)} parcela(s)`}
            tone={totais.vencido.count > 0 ? 'text-status-stuck' : undefined}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {mode === 'mes' ? 'Mês civil' : 'Ciclo 11→10'} de{' '}
          <span className="text-foreground">
            {fmtDate(bounds.startDate)} a {fmtDate(bounds.endDate)}
          </span>
          . Os totais somam as parcelas que <span className="text-foreground">vencem</span> na
          janela — “Ocultar pagas” esconde os chips da grade, mas não muda os números.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-7 border-b border-border">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = dayKey(day)
                const items = byDay.get(key) ?? []
                const inWindow = key >= bounds.startDate && key <= bounds.endDate
                const today = key === todayKey
                const isSelected = key === selected
                const isExpanded = expanded.has(key)
                const visible = isExpanded ? items : items.slice(0, MAX_VISIBLE)
                const hidden = items.length - visible.length

                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setSelected(key)}
                    className={cn(
                      'min-h-28 border-b border-r border-border p-1.5 text-left [&:nth-child(7n)]:border-r-0',
                      !inWindow && 'bg-muted/30',
                      isSelected && 'bg-primary/5 outline outline-1 -outline-offset-1 outline-primary',
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between px-0.5">
                      <span
                        className={cn(
                          'grid size-6 place-items-center rounded-full text-xs',
                          today && 'bg-primary font-semibold text-primary-foreground',
                          !today && inWindow && 'text-foreground',
                          !today && !inWindow && 'text-muted-foreground/50',
                        )}
                      >
                        {format(day, 'd')}
                      </span>
                      {items.length > 0 && <span className="text-[10px] font-medium text-muted-foreground/70">{items.length}</span>}
                    </div>

                    <div className="space-y-1">
                      {visible.map((r) => (
                        <span
                          key={r.parcela.id}
                          title={`${nomeCliente(r.acordo)} · ${r.parcela.valor == null ? '—' : brl(r.parcela.valor)} · ${STATUS_META[r.parcela.status].label}`}
                          className={cn(
                            'flex items-center gap-1 rounded border-l-2 bg-card px-1.5 py-0.5 text-[11px] leading-tight',
                            statusBorder(r.parcela.status),
                          )}
                        >
                          <span className={cn('truncate', r.parcela.status === 'pago' && 'text-muted-foreground line-through')}>
                            {nomeCliente(r.acordo)}
                          </span>
                        </span>
                      ))}
                      {hidden > 0 && (
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleExpand(key)
                          }}
                          className="block w-full rounded px-1 py-0.5 text-left text-[10px] font-medium text-muted-foreground hover:bg-muted"
                        >
                          + {hidden} mais
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {rows.every((r) => !r.parcela.vencimento) && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="size-6" />
            </span>
            <div>
              <p className="font-medium">Nenhuma parcela com vencimento</p>
              <p className="text-sm text-muted-foreground">Cadastre minutas com data de vencimento para vê-las aqui.</p>
            </div>
          </div>
        )}
      </div>

      {/* Agenda do dia selecionado */}
      <div className="rounded-2xl border border-border bg-gradient-card p-4 shadow-card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Agenda de {fmtDate(selected)}
            {selected === todayKey && <span className="ml-1 text-xs font-normal text-primary">(hoje)</span>}
          </h3>
          {selectedRows.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {selectedRows.length} parcela(s) · {brl(selectedTotal)}
            </span>
          )}
        </div>
        {selectedRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma parcela vence neste dia.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {selectedRows.map((r) => {
              const s = STATUS_META[r.parcela.status]
              // Dados de pagamento na agenda: é aqui que se olha "o que pago hoje".
              const pagamento = [r.acordo.pix?.trim() && `PIX: ${r.acordo.pix.trim()}`, r.acordo.dadosBancarios?.trim()]
                .filter(Boolean)
                .join(' · ')
              return (
                <div key={r.parcela.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{nomeCliente(r.acordo)}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      Parcela {r.parcela.num}/{r.acordo.parcelaTotal}
                      {r.acordo.numeroProcesso ? ` · ${r.acordo.numeroProcesso}` : ''}
                    </div>
                    {pagamento && (
                      <div className="truncate text-[11px] text-muted-foreground/80" title={pagamento}>
                        {pagamento}
                      </div>
                    )}
                    {r.parcela.dataPagamento && (
                      <div className="text-[11px] text-success">Pago em {fmtDate(r.parcela.dataPagamento)}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm tabular-nums text-foreground">{r.parcela.valor == null ? '—' : brl(r.parcela.valor)}</span>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', s.chip)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                      {s.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
