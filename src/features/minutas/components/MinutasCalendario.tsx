'use client'

import { useMemo, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { ProcMinutasData } from '@/lib/types/database'
import { brl, fmtDate, flattenRows, nomeCliente, todayBRT, STATUS_META, type MinutaRow } from '../shared'

// PÁGINA 2 — Calendário de vencimentos. Clone do delivery-calendar do módulo Monday (date-fns
// + ptBR, sem lib de calendário), adaptado a parcelas: um chip por parcela no dia do
// vencimento, cor por situação; clicar num dia abre a agenda daquele dia.

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_VISIBLE = 3

function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}
function statusBorder(status: MinutaRow['parcela']['status']): string {
  return status === 'pago' ? 'border-l-success' : status === 'vencida' ? 'border-l-status-stuck' : 'border-l-primary'
}

export function MinutasCalendario({ data }: { data: ProcMinutasData }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [hidePago, setHidePago] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string>(() => todayBRT())

  const todayKey = todayBRT()
  const rows = useMemo(() => flattenRows(data.acordos), [data])

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

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [cursor])

  const monthCount = useMemo(
    () =>
      [...byDay.entries()].reduce(
        (n, [key, list]) => n + (key.startsWith(format(cursor, 'yyyy-MM')) ? list.length : 0),
        0,
      ),
    [byDay, cursor],
  )

  const selectedRows = useMemo(() => byDay.get(selected) ?? [], [byDay, selected])
  const selectedTotal = useMemo(() => selectedRows.reduce((a, r) => a + (r.parcela.valor ?? 0), 0), [selectedRows])

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-card p-3 shadow-card">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor((c) => subMonths(c, 1))} aria-label="Mês anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-44 text-center text-lg font-semibold capitalize tracking-tight">
            {format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
          <Button variant="outline" size="icon" onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="Próximo mês">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Hoje
          </Button>
          <span className="ml-1 text-xs text-muted-foreground">
            {monthCount} parcela{monthCount === 1 ? '' : 's'} no mês
          </span>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={hidePago} onCheckedChange={setHidePago} />
          Ocultar pagas
        </label>
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
                const inMonth = isSameMonth(day, cursor)
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
                      !inMonth && 'bg-muted/30',
                      isSelected && 'bg-primary/5 outline outline-1 -outline-offset-1 outline-primary',
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between px-0.5">
                      <span
                        className={cn(
                          'grid size-6 place-items-center rounded-full text-xs',
                          today && 'bg-primary font-semibold text-primary-foreground',
                          !today && inMonth && 'text-foreground',
                          !today && !inMonth && 'text-muted-foreground/50',
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
              return (
                <div key={r.parcela.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{nomeCliente(r.acordo)}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      Parcela {r.parcela.num}/{r.acordo.parcelaTotal}
                      {r.acordo.numeroProcesso ? ` · ${r.acordo.numeroProcesso}` : ''}
                    </div>
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
