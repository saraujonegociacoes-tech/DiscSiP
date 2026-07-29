import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { getCurrentProfile } from '@/app/actions/auth'
import {
  getProject,
  getProjectMembers,
  getAssignableUsers,
} from '@/app/actions/monday-projects'
import { MondayShell } from '@/components/monday/monday-shell'
import { ProjectTabs } from '@/components/monday/project-tabs'
import { ProjectName } from '@/components/monday/projects/project-name'
import { ProjectDescription } from '@/components/monday/projects/project-description'
import { DeleteProjectButton } from '@/components/monday/projects/delete-project-button'
import { ManageMembersButton } from '@/components/monday/projects/manage-members-dialog'

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

  const [project, members, assignableUsers] = await Promise.all([
    getProject(projectId),
    getProjectMembers(projectId),
    getAssignableUsers(),
  ])
  if (!project) notFound()

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

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: project.color }}
            >
              {project.key.slice(0, 2)}
            </span>
            <div>
              <ProjectName projectId={projectId} initialName={project.name} />
              <p className="text-xs text-muted-foreground">{project.key}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ManageMembersButton
                projectId={projectId}
                ownerId={project.owner_id}
                currentUserId={profile.id}
                initialMembers={members}
                assignableUsers={assignableUsers}
              />
              {profile.id === project.owner_id && (
                <DeleteProjectButton projectId={projectId} projectName={project.name} />
              )}
            </div>
          </div>
          <ProjectDescription projectId={projectId} initialDescription={project.description} />
        </div>

        <div className="border-b border-border">
          <ProjectTabs projectId={projectId} />
        </div>

        <div>{children}</div>
      </div>
    </MondayShell>
  )
}
