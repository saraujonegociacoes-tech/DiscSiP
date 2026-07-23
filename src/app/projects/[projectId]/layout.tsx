import { notFound, redirect } from 'next/navigation'
import { getCurrentProfile } from '@/app/actions/auth'
import { getProject } from '@/app/actions/monday-projects'
import { MondayShell } from '@/components/monday/monday-shell'
import { ProjectTabs } from '@/components/monday/project-tabs'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/')

  const project = await getProject(projectId)
  if (!project) notFound()

  return (
    <MondayShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: project.color }}
          >
            {project.key.slice(0, 2)}
          </span>
          <div>
            <h1 className="font-semibold leading-tight">{project.name}</h1>
            <p className="text-xs text-muted-foreground">{project.key}</p>
          </div>
        </div>

        <div className="border-b border-border">
          <ProjectTabs projectId={projectId} />
        </div>

        <div>{children}</div>
      </div>
    </MondayShell>
  )
}
