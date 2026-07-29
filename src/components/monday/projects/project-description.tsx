'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { updateProjectDescription } from '@/app/actions/monday-projects'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * Descricao do projeto com edicao inline. Exibida no cabecalho do projeto; qualquer
 * gerente/admin abre o editor, e a RLS (can_manage_monday_project) e o backstop real
 * — se o update voltar sem permissao, a action devolve erro e mostramos um toast.
 */
export function ProjectDescription({
  projectId,
  initialDescription,
}: {
  projectId: string
  initialDescription: string | null
}) {
  const [description, setDescription] = useState(initialDescription)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(initialDescription ?? '')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function startEditing() {
    setDraft(description ?? '')
    setEditing(true)
  }

  function save() {
    startTransition(async () => {
      const res = await updateProjectDescription(projectId, draft)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setDescription(res.description ?? null)
      setEditing(false)
      toast.success('Descrição atualizada')
      router.refresh()
    })
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Descreva o objetivo, escopo ou contexto do projeto…"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  if (!description) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={startEditing}
        className="h-auto px-2 py-1 text-muted-foreground"
      >
        <Plus className="size-3.5" />
        Adicionar descrição
      </Button>
    )
  }

  return (
    <div className="group/desc">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? 'Clique para recolher' : 'Clique para ver a descrição'}
          className="inline-flex items-center gap-1 rounded text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
          Descrição
        </button>
        <button
          type="button"
          onClick={startEditing}
          aria-label="Editar descrição"
          className="shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/desc:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
      {expanded && (
        <p className="mt-1.5 whitespace-pre-wrap pl-[1.125rem] text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}
