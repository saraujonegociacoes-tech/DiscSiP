import Link from 'next/link'
import { redirect } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, CalendarClock, CheckCircle2, ChevronRight, ListTodo } from 'lucide-react'
import { getCurrentProfile } from '@/app/actions/auth'
import { getDailyReport } from '@/app/actions/monday-daily'
import { initials } from '@/lib/monday/domain'
import type { DailyPersonGroup, DailyTaskItem } from '@/lib/monday/types'
import { MondayShell } from '@/components/monday/monday-shell'
import { StatusBadge } from '@/components/monday/status-badge'
import { PriorityBadge } from '@/components/monday/priority-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function personLabel(g: DailyPersonGroup): string {
  return g.person?.name || g.person?.email || 'Sem responsável'
}

// Esta pagina e um Server Component (renderiza no runtime em UTC). Formatar o
// horario com date-fns usaria o fuso do servidor e mostraria 3h a mais; por isso
// convertemos explicitamente para America/Sao_Paulo na exibicao.
function formatBrtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

// Modulo Monday (Desenvolvimento / TI): so manager/admin acessam. Segmento estatico
// `daily` tem precedencia sobre [projectId], entao esta pagina nao usa o layout de projeto.
export default async function DailyPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/')

  const { groups } = await getDailyReport()

  return (
    <MondayShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Todos os projetos
        </Link>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Daily</h1>
          <p className="text-sm capitalize text-muted-foreground">
            {format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR })}
            <span className="lowercase"> · {groups.length} pessoa{groups.length === 1 ? '' : 's'}</span>
          </p>
        </div>

        {groups.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <CheckCircle2 className="size-6" />
              </span>
              <div>
                <p className="font-medium">Nada por aqui ainda</p>
                <p className="text-sm text-muted-foreground">
                  Quando houver tarefas concluídas ou pendentes, elas aparecem aqui por pessoa.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <PersonFolder key={g.assigneeId ?? '__none__'} group={g} />
            ))}
          </div>
        )}
      </div>
    </MondayShell>
  )
}

function PersonFolder({ group: g }: { group: DailyPersonGroup }) {
  return (
    <details open className="group rounded-xl border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <Avatar className="size-7">
          <AvatarFallback className="text-[11px]">
            {initials(g.person?.name, g.person?.email)}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium">{personLabel(g)}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {g.doneToday.length} hoje · {g.doneYesterday.length} ontem · {g.toDeliver.length} a entregar
        </span>
      </summary>

      <div className="grid gap-4 border-t border-border p-3 md:grid-cols-3">
        <Bucket title="Feito hoje" icon={<CheckCircle2 className="size-4 text-status-done" />} items={g.doneToday} variant="done" />
        <Bucket title="Feito ontem" icon={<CheckCircle2 className="size-4 text-muted-foreground" />} items={g.doneYesterday} variant="done" />
        <Bucket title="A entregar" icon={<ListTodo className="size-4 text-muted-foreground" />} items={g.toDeliver} variant="deliver" />
      </div>
    </details>
  )
}

function Bucket({
  title,
  icon,
  items,
  variant,
}: {
  title: string
  icon: React.ReactNode
  items: DailyTaskItem[]
  variant: 'done' | 'deliver'
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
        {icon}
        {title}
        <span className="text-muted-foreground/70">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground/70">—</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((t) => (
            <TaskRow key={t.id} task={t} variant={variant} />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskRow({ task: t, variant }: { task: DailyTaskItem; variant: 'done' | 'deliver' }) {
  const due = t.due_date ? parseISO(t.due_date) : null
  return (
    <Link
      href={`/projects/${t.projectId}`}
      className="block rounded-md border border-border bg-card p-2 transition-colors hover:border-primary/50"
    >
      <p className={cn('text-sm leading-snug', variant === 'done' && 'text-muted-foreground')}>
        {t.title}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
          style={{ backgroundColor: t.projectColor }}
          title={t.projectName}
        >
          {t.projectKey}
        </span>
        <span className="max-w-[160px] truncate text-[10px] font-medium text-muted-foreground" title={t.projectName}>
          {t.projectName}
        </span>

        {variant === 'deliver' && <StatusBadge status={t.status} className="text-[10px]" />}
        {variant === 'deliver' && <PriorityBadge priority={t.priority} className="text-[10px]" />}

        {variant === 'deliver' && due && (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[10px]',
              t.overdue ? 'font-medium text-status-stuck' : 'text-muted-foreground',
            )}
          >
            <CalendarClock className="size-3" />
            {format(due, 'dd MMM', { locale: ptBR })}
            {t.overdue && ' · atrasada'}
          </span>
        )}

        {variant === 'done' && t.completed_at && (
          <span className="text-[10px] text-muted-foreground">
            {formatBrtTime(t.completed_at)}
          </span>
        )}
      </div>
    </Link>
  )
}
