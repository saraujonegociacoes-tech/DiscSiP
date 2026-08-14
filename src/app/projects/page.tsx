import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarCheck, CalendarDays, LayoutGrid } from 'lucide-react'
import { getCurrentProfile } from '@/app/actions/auth'
import { getProjectsWithStats } from '@/app/actions/monday-projects'
import { MondayShell } from '@/components/monday/monday-shell'
import { CreateProjectDialog } from '@/components/monday/projects/create-project-dialog'
import { ProjectsList } from '@/components/monday/projects/projects-list'
import { SeedDemoButton } from '@/components/monday/projects/seed-demo-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Modulo Monday (Desenvolvimento / TI): so manager/admin acessam. O gate por papel
// e feito aqui (a sidebar ja esconde o item); o escopo de DADOS e do RLS (membership).
export default async function ProjectsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'manager' && profile.role !== 'admin' && profile.role !== 'tester') redirect('/')

  const projects = await getProjectsWithStats()
  const ownerCount = new Set(projects.map((p) => p.owner_id)).size

  return (
    <MondayShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
            <p className="text-sm text-muted-foreground">
              {projects.length} projeto{projects.length === 1 ? '' : 's'}
              {ownerCount > 1 && ` · ${ownerCount} pessoas`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/projects/daily">
                <CalendarCheck className="size-4" />
                Daily
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/projects/calendar">
                <CalendarDays className="size-4" />
                Calendário
              </Link>
            </Button>
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
          <ProjectsList projects={projects} />
        )}
      </div>
    </MondayShell>
  )
}
