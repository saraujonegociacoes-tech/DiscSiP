import { cn } from '@/lib/utils'
import { PRIORITY_META } from '@/lib/monday/domain'
import type { MondayTaskPriority } from '@/lib/monday/types'

export function PriorityBadge({
  priority,
  className,
}: {
  priority: MondayTaskPriority
  className?: string
}) {
  const meta = PRIORITY_META[priority]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium',
        meta.text,
        className,
      )}
    >
      <span className={cn('size-2 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )
}
