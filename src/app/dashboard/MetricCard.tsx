interface MetricCardProps {
  label: string
  value: string | number
  sub?: string
}

export function MetricCard({ label, value, sub }: MetricCardProps) {
  return (
    <div className="bg-[#1e293b] rounded-xl px-5 py-4 flex flex-col gap-1">
      <span className="text-slate-400 text-xs uppercase tracking-wide">{label}</span>
      <span className="text-white text-3xl font-bold">{value}</span>
      {sub && <span className="text-slate-500 text-xs">{sub}</span>}
    </div>
  )
}
