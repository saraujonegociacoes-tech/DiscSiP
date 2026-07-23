import { getPrimaryBoardData } from '@/app/actions/monday-board'
import { getSprintsWithStats } from '@/app/actions/monday-sprints'
import { BacklogTable } from '@/components/monday/backlog/backlog-table'

export default async function BacklogPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  const [boardData, sprints] = await Promise.all([
    getPrimaryBoardData(projectId),
    getSprintsWithStats(projectId),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Backlog</h2>
        <p className="text-sm text-muted-foreground">
          {boardData.tasks.length} tarefa{boardData.tasks.length === 1 ? '' : 's'}
        </p>
      </div>
      <BacklogTable
        projectId={projectId}
        tasks={boardData.tasks}
        sprints={sprints.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  )
}
