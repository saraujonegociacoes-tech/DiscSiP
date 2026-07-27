import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/app/actions/auth'
import { getPrimaryBoardData } from '@/app/actions/monday-board'
import { getProjectMembers } from '@/app/actions/monday-projects'
import { BoardView } from '@/components/monday/board/board-view'
import type { MemberOption } from '@/components/monday/board/task-dialog'

export default async function BoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  const [profile, boardData, members] = await Promise.all([
    getCurrentProfile(),
    getPrimaryBoardData(projectId),
    getProjectMembers(projectId),
  ])
  if (!profile) redirect('/login')

  const memberOptions: MemberOption[] = members.map((m) => ({
    id: m.user_id,
    label: m.profile?.name || m.profile?.email || 'Membro',
  }))

  if (!boardData.board) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Este projeto ainda não tem um board.
      </div>
    )
  }

  return (
    <BoardView
      projectId={projectId}
      boardId={boardData.board.id}
      members={memberOptions}
      initialTasks={boardData.tasks}
      currentUserId={profile.id}
    />
  )
}
