import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: LucideIcon
}

export function MetricCard({ label, value, sub, icon: Icon }: MetricCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-card p-5 shadow-card lift">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/15 blur-3xl transition-opacity group-hover:bg-primary/25" />
      <div className="relative flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className="rounded-xl bg-gradient-primary p-2 text-primary-foreground shadow-glow">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="relative mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      {sub && <div className="relative mt-1 text-xs text-muted-foreground">{sub}</div>}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-60" />
    </div>
  )
}
