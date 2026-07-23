'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { seedDemo } from '@/app/actions/monday-projects'
import { Button } from '@/components/ui/button'

export function SeedDemoButton() {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await seedDemo()
          if (res.id) {
            toast.success('Projeto demo criado')
            router.push(`/projects/${res.id}`)
          } else {
            toast.error(res.error)
          }
        })
      }
    >
      <Sparkles className="size-4" />
      {pending ? 'Gerando…' : 'Gerar projeto demo'}
    </Button>
  )
}
