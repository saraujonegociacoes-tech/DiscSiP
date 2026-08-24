'use client'

import { useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import {
  recentCivilMonths,
  recentCycles,
  recentDays,
  customPeriod,
  periodBounds,
  type LeadPeriod,
} from '@/lib/period'
import { cn } from '@/lib/utils'
import { BrDateInput } from '@/components/bluedesk/BrDateInput'

// Seletor de período do painel do CEO. Diferente do PeriodPicker compartilhado
// (src/components/bluedesk/PeriodPicker.tsx), que só conhece o ciclo 11→10 da operação:
// aqui o dono pediu OS DOIS recortes.
//   • Mês civil (default) — 1º ao último dia. É como executivo lê faturamento e como bate
//     com extrato/contabilidade.
//   • Ciclo 11→10 — a convenção da operação, pra comparar com os outros painéis.
// Réplica local em vez de estender o compartilhado: o toggle só faz sentido neste domínio,
// e mexer no PeriodPicker afetaria leads e discadora (mesma decisão de domínio separado que
// CS tomou em relação a Leads).

export type CeoPeriodMode = 'mes' | 'ciclo'

export function CeoPeriodPicker({
  value,
  mode,
  onChange,
  disabled,
}: {
  value: LeadPeriod
  mode: CeoPeriodMode
  onChange: (p: LeadPeriod, mode: CeoPeriodMode) => void
  disabled?: boolean
}) {
  const days = useMemo(() => recentDays(), [])
  const months = useMemo(() => recentCivilMonths(12), [])
  const cycles = useMemo(() => recentCycles(12), [])
  // Hoje/ontem valem nos dois recortes — o dia não pertence a mês nem a ciclo.
  const options = useMemo(
    () => [...days, ...(mode === 'mes' ? months : cycles)],
    [days, months, cycles, mode],
  )

  const [custom, setCustom] = useState(!options.some((o) => o.key === value.key))
  const bounds = periodBounds(value)
  const [start, setStart] = useState(bounds.startDate)
  const [end, setEnd] = useState(bounds.endDate)

  const selectValue = custom ? 'custom' : value.key

  const inputCls =
    'rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-card outline-none focus:border-primary disabled:opacity-50'

  // Trocar de recorte reposiciona no período CORRENTE daquele modo — manter a chave antiga
  // não faria sentido (a chave de um ciclo não existe na lista de meses).
  function switchMode(next: CeoPeriodMode) {
    if (next === mode) return
    setCustom(false)
    onChange(next === 'mes' ? months[0] : cycles[0], next)
  }

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value
    if (v === 'custom') {
      setCustom(true)
      return
    }
    setCustom(false)
    const found = options.find((o) => o.key === v)
    if (found) onChange(found, mode)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Toggle do recorte */}
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
            disabled={disabled}
            onClick={() => switchMode(m.key)}
            aria-pressed={mode === m.key}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              mode === m.key
                ? 'bg-gradient-primary text-primary-foreground shadow-glow'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <CalendarRange className="h-4 w-4 text-muted-foreground" />
      <select
        value={selectValue}
        onChange={handleSelect}
        disabled={disabled}
        className={inputCls}
        aria-label="Período"
      >
        <optgroup label="Dia">
          {days.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </optgroup>
        <optgroup label={mode === 'mes' ? 'Mês civil' : 'Ciclo 11→10'}>
          {(mode === 'mes' ? months : cycles).map((o, i) => (
            <option key={o.key} value={o.key}>
              {o.label}
              {i === 0 ? (mode === 'mes' ? ' (mês atual)' : ' (ciclo atual)') : ''}
            </option>
          ))}
        </optgroup>
        <option value="custom">Personalizado…</option>
      </select>

      {custom && (
        <>
          {/* BrDateInput, não <input type="date">: o nativo renderiza no locale do
              SISTEMA e num Windows em inglês vira MM/DD. Mesmo contrato (ISO). */}
          <BrDateInput
            value={start}
            max={end}
            onChange={setStart}
            disabled={disabled}
            aria-label="Data inicial"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <BrDateInput
            value={end}
            min={start}
            onChange={setEnd}
            disabled={disabled}
            aria-label="Data final"
          />
          <button
            type="button"
            disabled={disabled || !start || !end || start > end}
            onClick={() => onChange(customPeriod(start, end), mode)}
            className="rounded-lg bg-gradient-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
          >
            Aplicar
          </button>
        </>
      )}
    </div>
  )
}
