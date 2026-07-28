'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SprintDialog } from '@/components/monday/sprints/sprint-dialog'

export function CreateSprintDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Novo sprint
      </Button>
      <SprintDialog open={open} onOpenChange={setOpen} projectId={projectId} />
    </>
  )
}
