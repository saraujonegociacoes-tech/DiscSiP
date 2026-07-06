import { AlarmClock, CheckCircle2 } from 'lucide-react'
import type { ForgottenLead } from '@/app/actions/leads'

// Alerta — leads sem acionamento (S3). Estado ATUAL: leads abertos em Recebidos/1°
// Acionamento, sem 1º contato registrado, parados há mais que o limite. É o "lead
// esquecido" — nunca foi tocado. Lista os mais antigos primeiro (a action já ordena e
// limita); `total` é quantos existem ao todo. Diferente de "parado" (que é SLA de fase):
// aqui o lead nunca teve nenhum contato.

// Idade humana desde created_at (agora − criado).
function ageLabel(createdAt: string | null): string {
  if (!createdAt) return '—'
  const h = (Date.now() - Date.parse(createdAt)) / 3_600_000
  if (!Number.isFinite(h)) return '—'
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} d`
}

export function ForgottenLeads({
  leads,
  total,
  thresholdHours,
}: {
  leads: ForgottenLead[]
  total: number
  thresholdHours: number
}) {
  if (total === 0) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/5 px-5 py-4 shadow-card">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Sem leads esquecidos</h2>
          <p className="text-xs text-muted-foreground">
            Nenhum lead aberto sem 1º contato há mais de {thresholdHours}h.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5 shadow-elevated">
      <div className="flex items-center gap-2 border-b border-destructive/20 px-5 py-4">
        <AlarmClock className="h-4 w-4 shrink-0 text-destructive" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Leads sem acionamento</h2>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? 'lead aberto' : 'leads abertos'} sem 1º contato há mais de{' '}
            {thresholdHours}h
            {total > leads.length ? ` — mostrando os ${leads.length} mais antigos` : ''}
          </p>
        </div>
      </div>
      <ul className="max-h-[24rem] divide-y divide-border overflow-auto">
        {leads.map((r) => (
          <li key={r.leadId} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span
              className="min-w-0 flex-1 truncate text-sm text-foreground"
              title={r.title ?? undefined}
            >
              {r.title ?? 'Sem título'}
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {r.currentPhase ?? '—'}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{r.responsible ?? 'Sem responsável'}</span>
            <span
              className="shrink-0 tabular-nums text-xs font-medium text-destructive"
              title="Aberto há"
            >
              {ageLabel(r.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
