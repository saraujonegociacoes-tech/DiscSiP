'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MemberOption } from '@/components/monday/board/task-dialog'
import { SprintDialog } from '@/components/monday/sprints/sprint-dialog'

export function CreateSprintDialog({
  projectId,
  members,
}: {
  projectId: string
  members: MemberOption[]
}) {
  const [open, setOpen] = useState(false)
  const [instance, setInstance] = useState(0)

  // O SprintDialog fica montado o tempo todo (so o conteudo do Radix desmonta), entao
  // sem remontar ele guardaria os campos do sprint anterior — e reenviar as subtarefas
  // que ja viraram tarefas duplicaria o board. Trocar a key a cada abertura zera o
  // formulario; fechar nao remonta, preservando a animacao de saida.
  function openDialog() {
    setInstance((n) => n + 1)
    setOpen(true)
  }

  return (
    <>
      <Button onClick={openDialog}>
        <Plus className="size-4" /> Novo sprint
      </Button>
      <SprintDialog
        key={instance}
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        members={members}
      />
    </>
  )
}
