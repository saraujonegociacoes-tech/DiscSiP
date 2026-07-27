'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { moveTask } from '@/app/actions/monday-tasks'
import { STATUS_ORDER, STATUS_META } from '@/lib/monday/domain'
import type { MondayTaskStatus, MondayTaskWithTags } from '@/lib/monday/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TaskCard } from './task-card'
import { TaskDialog, type MemberOption } from './task-dialog'
import { TaskDetailDialog } from './task-detail-dialog'

type Props = {
  projectId: string
  boardId: string
  members: MemberOption[]
  initialTasks: MondayTaskWithTags[]
  currentUserId: string
}

export function BoardView({ projectId, boardId, members, initialTasks, currentUserId }: Props) {
  const [tasks, setTasks] = useState<MondayTaskWithTags[]>(initialTasks)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<MondayTaskWithTags | null>(null)
  const [createStatus, setCreateStatus] = useState<MondayTaskStatus>('todo')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTask, setDetailTask] = useState<MondayTaskWithTags | null>(null)
  const [mounted, setMounted] = useState(false)

  // O DragOverlay e portado para o body: o <main class="fade-up"> mantem um
  // transform (translateY(0), fill-mode both), o que o tornaria o bloco de contencao
  // do position:fixed do overlay e deslocaria o card do cursor. Portar p/ body evita.
  useEffect(() => setMounted(true), [])

  // Reflete atualizacoes vindas do servidor (revalidate).
  useEffect(() => setTasks(initialTasks), [initialTasks])

  const memberLabel = useMemo(
    () => new Map(members.map((m) => [m.id, m.label])),
    [members],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const byStatus = useMemo(() => {
    const map = new Map<MondayTaskStatus, MondayTaskWithTags[]>()
    for (const s of STATUS_ORDER) map.set(s, [])
    for (const t of tasks) map.get(t.status)?.push(t)
    for (const s of STATUS_ORDER) {
      map.get(s)!.sort((a, b) => a.position - b.position)
    }
    return map
  }, [tasks])

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const taskId = String(e.active.id)
    const overStatus = e.over?.id as MondayTaskStatus | undefined
    if (!overStatus) return

    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === overStatus) return

    const prev = tasks
    setTasks((cur) =>
      cur.map((t) =>
        t.id === taskId ? { ...t, status: overStatus, position: Date.now() } : t,
      ),
    )

    moveTask(taskId, { status: overStatus, position: Date.now() }, projectId).then((res) => {
      if (res.error) {
        setTasks(prev)
        toast.error(res.error)
      }
    })
  }

  function openCreate(status: MondayTaskStatus) {
    setEditingTask(null)
    setCreateStatus(status)
    setDialogOpen(true)
  }

  // Clique no card abre a VISUALIZACAO (com comentarios); a edicao sai de dentro dela.
  function openDetail(task: MondayTaskWithTags) {
    setDetailTask(task)
    setDetailOpen(true)
  }

  function openEditFromDetail() {
    setDetailOpen(false)
    if (detailTask) {
      setEditingTask(detailTask)
      setDialogOpen(true)
    }
  }

  // Mantem o detalhe em sincronia com o servidor (ex.: apos comentar/editar).
  const detailTaskCurrent = detailTask
    ? tasks.find((t) => t.id === detailTask.id) ?? detailTask
    : null
  const detailAssigneeName = detailTaskCurrent?.assignee_id
    ? memberLabel.get(detailTaskCurrent.assignee_id) ?? null
    : null

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STATUS_ORDER.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={byStatus.get(status) ?? []}
              memberLabel={memberLabel}
              onAdd={() => openCreate(status)}
              onCardClick={openDetail}
            />
          ))}
        </div>

        {mounted &&
          createPortal(
            <DragOverlay dropAnimation={null}>
              {activeTask ? (
                <div className="w-72 rotate-2">
                  <TaskCard task={activeTask} memberLabel={memberLabel} />
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>

      <TaskDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        task={detailTaskCurrent}
        assigneeName={detailAssigneeName}
        currentUserId={currentUserId}
        projectId={projectId}
        onEdit={openEditFromDetail}
      />

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        boardId={boardId}
        members={members}
        task={editingTask}
        defaultStatus={createStatus}
      />
    </>
  )
}

function Column({
  status,
  tasks,
  memberLabel,
  onAdd,
  onCardClick,
}: {
  status: MondayTaskStatus
  tasks: MondayTaskWithTags[]
  memberLabel: Map<string, string>
  onAdd: () => void
  onCardClick: (task: MondayTaskWithTags) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const meta = STATUS_META[status]

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={cn('size-2.5 rounded-full', meta.dot)} />
          <span className="text-sm font-semibold">{meta.label}</span>
          <span className="text-xs text-muted-foreground">{tasks.length}</span>
        </div>
        <Button variant="ghost" size="icon" className="size-6" onClick={onAdd}>
          <Plus className="size-4" />
        </Button>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors',
          isOver ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/40',
        )}
      >
        {tasks.map((task) => (
          <DraggableCard key={task.id} task={task} memberLabel={memberLabel} onClick={onCardClick} />
        ))}
        {tasks.length === 0 && (
          <button
            onClick={onAdd}
            className="rounded-md border border-dashed py-6 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            + Adicionar tarefa
          </button>
        )}
      </div>
    </div>
  )
}

function DraggableCard({
  task,
  memberLabel,
  onClick,
}: {
  task: MondayTaskWithTags
  memberLabel: Map<string, string>
  onClick: (task: MondayTaskWithTags) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn('touch-none', isDragging && 'opacity-40')}
    >
      <TaskCard task={task} memberLabel={memberLabel} onClick={() => onClick(task)} />
    </div>
  )
}
