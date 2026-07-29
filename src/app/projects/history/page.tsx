import Link from 'next/link'
import { redirect } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { getCurrentProfile } from '@/app/actions/auth'
import { getCompletedHistory } from '@/app/actions/monday-daily'
import { formatBrtTime } from '@/lib/monday/domain'
import type { HistoryDay, HistoryTaskItem } from '@/lib/monday/types'
import { MondayShell } from '@/components/monday/monday-shell'
import { Card, CardContent } from '@/components/ui/card'

const TZ = 'America/Sao_Paulo'

/** Rotulo amigavel do dia (Hoje/Ontem, senao a data por extenso). */
function dayLabel(day: string): string {
  const now = new Date()
  const todayBRT = now.toLocaleDateString('en-CA', { timeZone: TZ })
  const yesterdayBRT = new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', {
    timeZone: TZ,
  })
  if (day === todayBRT) return 'Hoje'
  if (day === yesterdayBRT) return 'Ontem'
  return format(parseISO(day), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })
}

// Modulo Monday (Desenvolvimento / TI): so manager/admin acessam. Segmento estatico
// `history` tem precedencia sobre [projectId], entao esta pagina nao usa o layout de projeto.
export default async function HistoryPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/')

  const { days, total, capped } = await getCompletedHistory()

  return (
    <MondayShell>
      <div className="mx-auto max-w-4xl space-y-6">
        <Link
          href="/projects/daily"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Voltar para a Daily
        </Link>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Histórico de concluídas</h1>
          <p className="text-sm text-muted-foreground">
            {total} tarefa{total === 1 ? '' : 's'} concluída{total === 1 ? '' : 's'}
            {capped && ' · mostrando as 500 mais recentes'}
          </p>
        </div>

        {days.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <CheckCircle2 className="size-6" />
              </span>
              <div>
                <p className="font-medium">Nenhuma tarefa concluída ainda</p>
                <p className="text-sm text-muted-foreground">
                  Quando tarefas forem marcadas como feitas, elas aparecem aqui.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {days.map((d) => (
              <DaySection key={d.day} day={d} />
            ))}
          </div>
        )}
      </div>
    </MondayShell>
  )
}

function DaySection({ day: d }: { day: HistoryDay }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold capitalize">{dayLabel(d.day)}</h2>
        <span className="text-xs text-muted-foreground">
          {d.items.length} concluída{d.items.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-1.5">
        {d.items.map((t) => (
          <HistoryRow key={t.id} task={t} />
        ))}
      </div>
    </div>
  )
}

function HistoryRow({ task: t }: { task: HistoryTaskItem }) {
  return (
    <Link
      href={`/projects/${t.projectId}`}
      className="flex items-center gap-3 rounded-md border border-border bg-card p-2.5 transition-colors hover:border-primary/50"
    >
      <CheckCircle2 className="size-4 shrink-0 text-status-done" />
      <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
      <span
        className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white sm:inline-flex"
        style={{ backgroundColor: t.projectColor }}
        title={t.projectName}
      >
        {t.projectKey}
      </span>
      {t.assigneeName && (
        <span className="hidden max-w-[140px] shrink-0 truncate text-xs text-muted-foreground md:inline">
          {t.assigneeName}
        </span>
      )}
      {t.completed_at && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatBrtTime(t.completed_at)}
        </span>
      )}
    </Link>
  )
}
