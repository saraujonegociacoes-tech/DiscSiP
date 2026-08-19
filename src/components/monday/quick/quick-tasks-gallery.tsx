'use client'

import { memo, useCallback, useMemo, useState, useTransition } from 'react'
import { CalendarDays, Check, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteQuickTask, setQuickTaskStatus } from '@/app/actions/monday-quick-tasks'
import { StatusBadge } from '@/components/monday/status-badge'
import { PriorityBadge } from '@/components/monday/priority-badge'
import { AccordionGallery, type AccordionGalleryItem } from '@/components/ui/accordion-gallery'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { STATUS_META } from '@/lib/monday/domain'
import { cn } from '@/lib/utils'
import type {
  MondayAssignableUser,
  MondayQuickTaskWithAssignee,
  MondayTaskStatus,
} from '@/lib/monday/types'
import { EditQuickTaskDialog } from './quick-task-dialog'

/**
 * Acima disso o accordion horizontal vira um pente de faixas ilegiveis (cada
 * painel fechado fica com poucos pixels). Passando do teto, a lista cai para uma
 * grade de cards — mesma informacao, sem a animacao.
 */
const MAX_PANELS = 10

/** Altura do trilho. Baixa de proposito: painel alto com tarefa curta vira vazio. */
const TRACK_HEIGHT = 340

const STATUS_ACCENT: Record<MondayTaskStatus, string> = {
  todo: 'var(--status-todo)',
  working: 'var(--status-working)',
  review: 'var(--status-review)',
  done: 'var(--status-done)',
  stuck: 'var(--status-stuck)',
}

const TZ = 'America/Sao_Paulo'

/**
 * Formatadores criados UMA vez. `toLocaleDateString` monta um Intl.DateTimeFormat
 * novo a cada chamada, e aqui a chamada acontece por card a cada render.
 */
const BR_DATE = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ })
const ISO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' (data pura: nada de `new Date`, que desloca o fuso). */
function brDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** 'YYYY-MM-DD' -> 'DD/MM', para a linha estreita do painel fechado. */
function brDayMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}` : iso
}

/** Par rotulo/valor da ficha do painel aberto. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  )
}

type TaskDetailsProps = {
  task: MondayQuickTaskWithAssignee
  /** Hoje em BRT (YYYY-MM-DD), para marcar atraso sem recalcular por card. */
  today: string
  pending: boolean
  onAdvance: (task: MondayQuickTaskWithAssignee, status: MondayTaskStatus) => void
  onEdit: (task: MondayQuickTaskWithAssignee) => void
  onRemove: (task: MondayQuickTaskWithAssignee) => void
}

/**
 * Conteudo do painel aberto.
 *
 * Vive no modulo, nao dentro de QuickTasksGallery: um componente declarado no corpo
 * de outro ganha identidade nova a cada render do pai, e o React desmonta e remonta
 * a arvore inteira em vez de reconciliar — dez paineis refeitos do zero a cada
 * clique em filtro. Com a identidade estavel, o `memo` abaixo ainda corta o render
 * dos cards que nao mudaram.
 */
const TaskDetails = memo(function TaskDetails({
  task,
  today,
  pending,
  onAdvance,
  onEdit,
  onRemove,
}: TaskDetailsProps) {
  const overdue = task.status !== 'done' && !!task.due_date && task.due_date < today

  return (
    <div className="flex h-full min-w-[17rem] flex-col gap-3.5">
      {/* Sobrancelha: o que se le de relance. Fica acima do titulo e em corpo
          pequeno — classifica a tarefa sem competir com ela. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <StatusBadge status={task.status} />
        <span className="text-border" aria-hidden="true">
          |
        </span>
        <PriorityBadge priority={task.priority} />
        {task.category && (
          <>
            <span className="text-border" aria-hidden="true">
              |
            </span>
            <span className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {task.category}
            </span>
          </>
        )}
        {overdue && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/12 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-destructive">
            <CalendarDays className="size-3" />
            Atrasada
          </span>
        )}
      </div>

      <h3 className="text-[1.375rem] font-semibold leading-tight tracking-tight text-balance">
        {task.title}
      </h3>

      {/* A descricao absorve a sobra vertical: sem isso, tarefa curta deixava um
          buraco entre o titulo e a ficha. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {task.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {task.description}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground/60">Sem detalhes.</p>
        )}
      </div>

      {/* Ficha enxuta: so o que muda de tarefa para tarefa e importa na decisao.
          Categoria subiu para a sobrancelha e "criada em" desceu para o rodape. */}
      <dl className="grid grid-cols-2 gap-x-4 border-t border-border/70 pt-3">
        <Field label="Prazo">
          {task.due_date ? (
            <span className={cn('tabular-nums', overdue && 'font-medium text-destructive')}>
              {brDate(task.due_date)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Field>
        <Field label="Responsável">
          {task.assignee ? (
            (task.assignee.name ?? task.assignee.email)
          ) : (
            <span className="text-muted-foreground">Minha</span>
          )}
        </Field>
      </dl>

      <div className="flex items-center gap-1.5">
        {task.status !== 'done' ? (
          <Button size="sm" disabled={pending} onClick={() => onAdvance(task, 'done')}>
            <Check className="size-4" />
            Concluir
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onAdvance(task, 'todo')}
          >
            Reabrir
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(task)}
        >
          <Pencil className="size-4" />
          Editar
        </Button>

        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {BR_DATE.format(new Date(task.created_at))}
        </span>

        {/* Excluir sai da fila de texto e vira icone: continua a um clique, mas
            deixa de ter o mesmo peso visual de "Concluir". */}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Excluir "${task.title}"`}
          title="Excluir"
          className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={pending}
          onClick={() => onRemove(task)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
})

export function QuickTasksGallery({
  tasks,
  categories,
  assignableUsers,
}: {
  tasks: MondayQuickTaskWithAssignee[]
  categories: string[]
  assignableUsers: MondayAssignableUser[]
}) {
  const [hideDone, setHideDone] = useState(true)
  const [category, setCategory] = useState<string>('')
  const [editing, setEditing] = useState<MondayQuickTaskWithAssignee | null>(null)
  const [pending, startTransition] = useTransition()

  const today = useMemo(() => ISO_DAY.format(new Date()), [])

  const visible = useMemo(
    () =>
      tasks.filter(
        (t) => (!hideDone || t.status !== 'done') && (!category || t.category === category),
      ),
    [tasks, hideDone, category],
  )

  // Estaveis para o `memo` do TaskDetails valer alguma coisa.
  const advance = useCallback((task: MondayQuickTaskWithAssignee, status: MondayTaskStatus) => {
    startTransition(async () => {
      const res = await setQuickTaskStatus(task.id, status)
      if (res.error) toast.error(res.error)
      else toast.success(`"${task.title}" → ${STATUS_META[status].label}`)
    })
  }, [])

  const remove = useCallback((task: MondayQuickTaskWithAssignee) => {
    startTransition(async () => {
      const res = await deleteQuickTask(task.id)
      if (res.error) toast.error(res.error)
      else toast.success('Tarefa excluída')
    })
  }, [])

  const edit = useCallback((task: MondayQuickTaskWithAssignee) => setEditing(task), [])

  const panelTasks = visible.slice(0, MAX_PANELS)
  const overflowTasks = visible.slice(MAX_PANELS)

  const items: AccordionGalleryItem[] = useMemo(
    () =>
      panelTasks.map((task) => ({
        id: task.id,
        label: task.title,
        accent: STATUS_ACCENT[task.status],
        meta: task.due_date ? brDayMonth(task.due_date) : undefined,
        content: (
          <TaskDetails
            task={task}
            today={today}
            pending={pending}
            onAdvance={advance}
            onEdit={edit}
            onRemove={remove}
          />
        ),
      })),
    // `panelTasks` e derivado de `visible`; depender do array fatiado criaria
    // identidade nova a cada render e anularia o memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, today, pending, advance, edit, remove],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Filtro em `outline`, nao em `default`: o botao cheio da barra competia
            com "Concluir", que e a acao principal do card. */}
        <Button size="sm" variant="outline" onClick={() => setHideDone((v) => !v)}>
          <Check className={cn('size-3.5', !hideDone && 'opacity-25')} />
          {hideDone ? 'Ocultando concluídas' : 'Mostrando concluídas'}
        </Button>

        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={category ? 'ghost' : 'secondary'}
              onClick={() => setCategory('')}
            >
              Todas
            </Button>
            {categories.map((c) => (
              <Button
                key={c}
                size="sm"
                variant={category === c ? 'secondary' : 'ghost'}
                onClick={() => setCategory(category === c ? '' : c)}
              >
                {c}
              </Button>
            ))}
          </div>
        )}

        <span className="ml-auto text-sm text-muted-foreground">
          {visible.length} tarefa{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      {visible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="font-medium">Nada por aqui</p>
            <p className="text-sm text-muted-foreground">
              {tasks.length === 0
                ? 'Crie a primeira tarefa rápida — sem projeto, sem board, sem cerimônia.'
                : 'Nenhuma tarefa bate com o filtro atual.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <AccordionGallery
          items={items}
          height={TRACK_HEIGHT}
          trigger="click"
          expandRatio={expandRatioFor(items.length)}
        />
      )}

      {overflowTasks.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {overflowTasks.map((task) => (
            <Card key={task.id}>
              <CardContent className="h-[19rem] p-4">
                <TaskDetails
                  task={task}
                  today={today}
                  pending={pending}
                  onAdvance={advance}
                  onEdit={edit}
                  onRemove={remove}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Montado so quando ha tarefa em edicao: o dialogo carrega o formulario
          inteiro (BorderGlow, selects, BrDateInput) e nao precisa existir antes. */}
      {editing && (
        <EditQuickTaskDialog
          task={editing}
          categories={categories}
          assignableUsers={assignableUsers}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </div>
  )
}

/**
 * Fatia da largura que o painel aberto ocupa. Com POUCAS tarefas ela precisa ser
 * grande: com duas em 52%, a fechada fica com 48% do trilho — uma lapide larga e
 * vazia ao lado do conteudo. Com muitas, as fechadas ja sao estreitas sozinhas, e
 * o exagero so espremeria as outras a nada.
 */
function expandRatioFor(count: number): number {
  if (count <= 2) return 0.78
  if (count <= 3) return 0.68
  if (count <= 5) return 0.58
  return 0.5
}
