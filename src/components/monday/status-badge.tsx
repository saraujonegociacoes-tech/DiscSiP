import { cn } from '@/lib/utils'
import { STATUS_META } from '@/lib/monday/domain'
import type { MondayTaskStatus } from '@/lib/monday/types'

export function StatusBadge({
  status,
  className,
}: {
  status: MondayTaskStatus
  className?: string
}) {
  const meta = STATUS_META[status]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        meta.bg,
        meta.fg,
        className,
      )}
    >
      {meta.label}
    </span>
  )
}
