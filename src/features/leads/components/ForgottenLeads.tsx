'use client'

import { useMemo, useState } from 'react'
import { AlarmClock, CheckCircle2 } from 'lucide-react'
import type { ForgottenLead } from '@/app/actions/leads'

// Alerta — leads sem acionamento (S3). Estado ATUAL: leads abertos em Recebidos/1°
// Acionamento, sem 1º contato registrado, parados há mais que o limite. É o "lead
// esquecido" — nunca foi tocado. Lista os mais antigos primeiro (a action já ordena e
// limita); `total` é quantos existem ao todo. Diferente de "parado" (que é SLA de fase):
// aqui o lead nunca teve nenhum contato. Filtro por responsável age sobre a lista carregada
// (capada em FORGOTTEN_LIMIT mais antigos na action).

const ALL = '__all__'
const NO_RESP = 'Sem responsável'

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
  const [responsible, setResponsible] = useState<string>(ALL)

  // Responsáveis distintos presentes na lista carregada (para o filtro).
  const responsibles = useMemo(() => {
    const s = new Set<string>()
    for (const l of leads) s.add(l.responsible ?? NO_RESP)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [leads])

  const shown =
    responsible === ALL ? leads : leads.filter((l) => (l.responsible ?? NO_RESP) === responsible)

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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/20 px-5 py-4">
        <div className="flex items-center gap-2">
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
        {responsibles.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="sr-only sm:not-sr-only">Responsável</span>
            <select
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              className="rounded-lg border border-border bg-background/60 px-2 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value={ALL}>Todos</option>
              {responsibles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-4 text-xs text-muted-foreground">
          Nenhum lead esquecido para este responsável (na lista carregada).
        </p>
      ) : (
        <ul className="max-h-[24rem] divide-y divide-border overflow-auto">
          {shown.map((r) => (
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
              <span className="shrink-0 text-xs text-muted-foreground">
                {r.responsible ?? NO_RESP}
              </span>
              <span
                className="shrink-0 tabular-nums text-xs font-medium text-destructive"
                title="Aberto há"
              >
                {ageLabel(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
