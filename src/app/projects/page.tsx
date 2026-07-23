import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, LayoutGrid, AlertTriangle } from 'lucide-react'
import { getCurrentProfile } from '@/app/actions/auth'
import { getProjectsWithStats } from '@/app/actions/monday-projects'
import { MondayShell } from '@/components/monday/monday-shell'
import { CreateProjectDialog } from '@/components/monday/projects/create-project-dialog'
import { SeedDemoButton } from '@/components/monday/projects/seed-demo-button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

// Modulo Monday (Desenvolvimento / TI): so manager/admin acessam. O gate por papel
// e feito aqui (a sidebar ja esconde o item); o escopo de DADOS e do RLS (membership).
export default async function ProjectsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/')

  const projects = await getProjectsWithStats()

  return (
    <MondayShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
            <p className="text-sm text-muted-foreground">
              {projects.length} projeto{projects.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex gap-2">
            {projects.length === 0 && <SeedDemoButton />}
            <CreateProjectDialog />
          </div>
        </div>

        {projects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <LayoutGrid className="size-6" />
              </span>
              <div>
                <p className="font-medium">Nenhum projeto ainda</p>
                <p className="text-sm text-muted-foreground">
                  Crie um projeto ou gere um demo para explorar o board.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const total = p.overview?.total_tasks ?? 0
              const done = p.overview?.done_tasks ?? 0
              const pct = total ? Math.round((done / total) * 100) : 0
              return (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardHeader className="gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
                          style={{ backgroundColor: p.color }}
                        >
                          {p.key.slice(0, 2)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.key}</p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progresso</span>
                        <span className="font-medium">{pct}%</span>
                      </div>
                      <Progress value={pct} />
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="size-3.5 text-status-done" />
                          {done}/{total}
                        </span>
                        {(p.overview?.stuck_tasks ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 text-status-stuck">
                            <AlertTriangle className="size-3.5" />
                            {p.overview?.stuck_tasks} travada(s)
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </MondayShell>
  )
}
