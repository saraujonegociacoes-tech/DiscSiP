'use client'

import { useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import {
  recentCycles,
  customPeriod,
  periodBounds,
  type LeadPeriod,
} from '@/lib/period'
import { BrDateInput } from './BrDateInput'

// Seletor de período genérico (ciclo de meta 11→10 + intervalo livre). Default = ciclo
// corrente. Usado pelo dashboard de leads e pelo histórico da discadora.
export function PeriodPicker({
  value,
  onChange,
  disabled,
}: {
  value: LeadPeriod
  onChange: (p: LeadPeriod) => void
  disabled?: boolean
}) {
  const cycles = useMemo(() => recentCycles(6), [])
  const inCycles = cycles.some((c) => c.key === value.key)
  const [custom, setCustom] = useState(!inCycles)
  const bounds = periodBounds(value)
  const [start, setStart] = useState(bounds.startDate)
  const [end, setEnd] = useState(bounds.endDate)

  const selectValue = custom ? 'custom' : value.key

  const inputCls =
    'rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-card outline-none focus:border-primary disabled:opacity-50'

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value
    if (v === 'custom') {
      setCustom(true)
      return
    }
    setCustom(false)
    const cycle = cycles.find((c) => c.key === v)
    if (cycle) onChange(cycle)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarRange className="h-4 w-4 text-muted-foreground" />
      <select
        value={selectValue}
        onChange={handleSelect}
        disabled={disabled}
        className={inputCls}
        aria-label="Período"
      >
        {cycles.map((c, i) => (
          <option key={c.key} value={c.key}>
            {c.label}
            {i === 0 ? ' (ciclo atual)' : ''}
          </option>
        ))}
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
            onClick={() => onChange(customPeriod(start, end))}
            className="rounded-lg bg-gradient-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
          >
            Aplicar
          </button>
        </>
      )}
    </div>
  )
}
