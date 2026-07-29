'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
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
import type { CalendarTaskItem } from '@/lib/monday/types'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_VISIBLE = 3

/** Chave YYYY-MM-DD de um Date local — casa com o due_date (data pura, sem fuso). */
function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function DeliveryCalendar({ tasks }: { tasks: CalendarTaskItem[] }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [hideDone, setHideDone] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const todayKey = dayKey(new Date())

  // Tarefas por dia (aplica o filtro de concluidas antes de agrupar).
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarTaskItem[]>()
    for (const t of tasks) {
      if (hideDone && t.status === 'done') continue
      const list = map.get(t.due_date)
      if (list) list.push(t)
      else map.set(t.due_date, [t])
    }
    // Concluidas por ultimo dentro do dia; abertas mantem a ordem original.
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))
    }
    return map
  }, [tasks, hideDone])

  // Grade do mes: preenche semanas completas (Dom→Sab).
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [cursor])

  const monthCount = useMemo(
    () => [...byDay.entries()].reduce((n, [key, list]) => n + (isSameMonthKey(key, cursor) ? list.length : 0), 0),
    [byDay, cursor],
  )

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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            {monthCount} entrega{monthCount === 1 ? '' : 's'} no mês
          </span>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={hideDone} onCheckedChange={setHideDone} />
          Ocultar concluídas
        </label>
      </div>

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
              const isExpanded = expanded.has(key)
              const visible = isExpanded ? items : items.slice(0, MAX_VISIBLE)
              const hidden = items.length - visible.length

              return (
                <div
                  key={key}
                  className={cn(
                    'min-h-28 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0',
                    !inMonth && 'bg-muted/30',
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
                    {items.length > 0 && (
                      <span className="text-[10px] font-medium text-muted-foreground/70">{items.length}</span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {visible.map((t) => (
                      <TaskChip key={t.id} task={t} overdue={t.status !== 'done' && t.due_date < todayKey} />
                    ))}
                    {hidden > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(key)}
                        className="w-full rounded px-1 py-0.5 text-left text-[10px] font-medium text-muted-foreground hover:bg-muted"
                      >
                        + {hidden} mais
                      </button>
                    )}
                    {isExpanded && items.length > MAX_VISIBLE && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(key)}
                        className="w-full rounded px-1 py-0.5 text-left text-[10px] font-medium text-muted-foreground hover:bg-muted"
                      >
                        recolher
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {tasks.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <CalendarDays className="size-6" />
          </span>
          <div>
            <p className="font-medium">Nenhuma entrega com prazo</p>
            <p className="text-sm text-muted-foreground">
              Defina uma data de entrega nas tarefas para vê-las no calendário.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskChip({ task: t, overdue }: { task: CalendarTaskItem; overdue: boolean }) {
  const done = t.status === 'done'
  return (
    <Link
      href={`/projects/${t.projectId}`}
      title={`${t.title} · ${t.projectName}${t.assigneeName ? ` · ${t.assigneeName}` : ''}`}
      className={cn(
        'flex items-center gap-1.5 rounded border-l-2 bg-card px-1.5 py-0.5 text-[11px] leading-tight transition-colors hover:bg-muted',
        overdue && 'bg-status-stuck/10',
      )}
      style={{ borderLeftColor: t.projectColor }}
    >
      <span
        className={cn(
          'truncate',
          done && 'text-muted-foreground line-through',
          overdue && 'font-medium text-status-stuck',
        )}
      >
        {t.title}
      </span>
    </Link>
  )
}

function isSameMonthKey(key: string, cursor: Date): boolean {
  return key.startsWith(format(cursor, 'yyyy-MM'))
}
