'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { updateProjectName } from '@/app/actions/monday-projects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Nome do projeto com edicao inline (Enter salva, Esc cancela). Como a descricao,
 * a RLS (can_manage_monday_project) e o backstop real: sem permissao o update volta
 * 0 linhas e a action devolve erro.
 */
export function ProjectName({
  projectId,
  initialName,
}: {
  projectId: string
  initialName: string
}) {
  const [name, setName] = useState(initialName)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialName)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function startEditing() {
    setDraft(name)
    setEditing(true)
  }

  function save() {
    const trimmed = draft.trim()
    if (!trimmed) {
      toast.error('Nome obrigatório.')
      return
    }
    if (trimmed === name) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      const res = await updateProjectName(projectId, trimmed)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setName(res.name ?? trimmed)
      setEditing(false)
      toast.success('Nome atualizado')
      router.refresh()
    })
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          disabled={pending}
          className="h-8 w-64"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              setEditing(false)
            }
          }}
        />
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    )
  }

  return (
    <div className="group/name flex items-center gap-1.5">
      <h1 className="font-semibold leading-tight">{name}</h1>
      <button
        type="button"
        onClick={startEditing}
        aria-label="Editar nome"
        className="shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/name:opacity-100"
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  )
}
