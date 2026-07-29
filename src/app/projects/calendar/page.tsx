import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentProfile } from '@/app/actions/auth'
import { getDeliveryCalendar } from '@/app/actions/monday-calendar'
import { MondayShell } from '@/components/monday/monday-shell'
import { DeliveryCalendar } from '@/components/monday/calendar/delivery-calendar'

// Modulo Monday (Desenvolvimento / TI): so manager/admin acessam. Segmento estatico
// `calendar` tem precedencia sobre [projectId], entao esta pagina nao usa o layout de projeto.
export default async function CalendarPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/')

  const { tasks } = await getDeliveryCalendar()

  return (
    <MondayShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Todos os projetos
        </Link>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendário de entregas</h1>
          <p className="text-sm text-muted-foreground">
            Tarefas com prazo, por dia — de todos os projetos que você acessa.
          </p>
        </div>

        <DeliveryCalendar tasks={tasks} />
      </div>
    </MondayShell>
  )
}
