import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/app/actions/auth'
import { getAssignableUsers } from '@/app/actions/monday-projects'
import { getQuickTasks } from '@/app/actions/monday-quick-tasks'
import { quickTaskCategories } from '@/lib/monday/domain'
import { MondayShell } from '@/components/monday/monday-shell'
import { ProjectsTabs } from '@/components/monday/projects-tabs'
import { CreateQuickTaskDialog } from '@/components/monday/quick/quick-task-dialog'
import { QuickTasksGallery } from '@/components/monday/quick/quick-tasks-gallery'

// Tarefas rapidas: trabalho curto e avulso, sem projeto/board/group. Mesmo gate de
// papel de /projects (a sidebar ja esconde o item); o escopo de DADOS e do RLS de
// monday_quick_tasks (dono, responsavel ou gerencia).
export default async function QuickTasksPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'manager' && profile.role !== 'admin' && profile.role !== 'tester') {
    redirect('/')
  }

  const [tasks, assignableUsers] = await Promise.all([getQuickTasks(), getAssignableUsers()])
  // Categorias saem da lista ja carregada — nao vale uma segunda varredura da tabela.
  const categories = quickTaskCategories(tasks)

  const open = tasks.filter((t) => t.status !== 'done').length

  return (
    <MondayShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <ProjectsTabs />

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tarefas rápidas</h1>
            <p className="text-sm text-muted-foreground">
              {open} em aberto · {tasks.length} no total · aparecem na Daily e no Calendário
            </p>
          </div>
          <CreateQuickTaskDialog categories={categories} assignableUsers={assignableUsers} />
        </div>

        <QuickTasksGallery
          tasks={tasks}
          categories={categories}
          assignableUsers={assignableUsers}
        />
      </div>
    </MondayShell>
  )
}
