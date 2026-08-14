import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Target } from 'lucide-react'
import { getSprintsWithStats, getBurndown } from '@/app/actions/monday-sprints'
import { getProjectMembers } from '@/app/actions/monday-projects'
import { SPRINT_STATUS_META } from '@/lib/monday/domain'
import { cn } from '@/lib/utils'
import type { MemberOption } from '@/components/monday/board/task-dialog'
import { CreateSprintDialog } from '@/components/monday/sprints/create-sprint-dialog'
import { SprintCardActions } from '@/components/monday/sprints/sprint-card-actions'
import { BurndownChart } from '@/components/monday/sprints/burndown-chart-lazy'
import { RichText } from '@/components/monday/rich-text'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { MondayBurndownPoint } from '@/lib/monday/types'

export default async function SprintsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  // members alimenta o "Responsável" das subtarefas do formulário de novo sprint.
  const [sprints, members] = await Promise.all([
    getSprintsWithStats(projectId),
    getProjectMembers(projectId),
  ])
  const memberOptions: MemberOption[] = members.map((m) => ({
    id: m.user_id,
    label: m.profile?.name || m.profile?.email || 'Membro',
  }))

  // Burndown apenas dos sprints ativos (calculo pesado no banco).
  const burndowns = new Map<string, MondayBurndownPoint[]>()
  await Promise.all(
    sprints
      .filter((s) => s.status === 'active')
      .map(async (s) => burndowns.set(s.id, await getBurndown(s.id))),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sprints</h2>
        <CreateSprintDialog projectId={projectId} members={memberOptions} />
      </div>

      {sprints.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhum sprint ainda. Crie o primeiro para planejar entregas.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sprints.map((s) => {
            const st = s.stats
            const totalPts = Number(st?.total_points ?? 0)
            const donePts = Number(st?.done_points ?? 0)
            const pct = totalPts ? Math.round((donePts / totalPts) * 100) : 0
            const meta = SPRINT_STATUS_META[s.status]
            const burndown = burndowns.get(s.id)

            return (
              <Card key={s.id}>
                <CardHeader className="gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.name}</p>
                      {s.goal && (
                        <div className="mt-1 flex gap-1.5 text-xs text-muted-foreground">
                          <Target className="mt-0.5 size-3.5 shrink-0" />
                          <RichText content={s.goal} />
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          meta.className,
                        )}
                      >
                        {meta.label}
                      </span>
                      <SprintCardActions sprint={s} projectId={projectId} />
                    </div>
                  </div>
                  {(s.start_date || s.end_date) && (
                    <p className="text-xs text-muted-foreground">
                      {s.start_date ? format(parseISO(s.start_date), 'dd MMM', { locale: ptBR }) : '?'}
                      {' – '}
                      {s.end_date ? format(parseISO(s.end_date), 'dd MMM', { locale: ptBR }) : '?'}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {donePts} / {totalPts} pts · {st?.done_tasks ?? 0}/{st?.total_tasks ?? 0} tarefas
                      </span>
                      <span className="font-medium">{pct}%</span>
                    </div>
                    <Progress value={pct} />
                  </div>

                  {burndown && (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Burndown</p>
                      <BurndownChart data={burndown} />
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
