import { Suspense } from 'react'
import { getCurrentProfile } from '@/app/actions/auth'
import {
  getLeadsData,
  getDuplicateAlerts,
  getAgentLeads,
  getSupervisorMetrics,
  getLeadsTimeseries,
  getLeadsTrend,
  getLeadsFunnelDepth,
  getLeadsActivity,
  type DuplicateAlert,
  type AgentLeadRow,
  type SupervisorMetrics,
  type TrendPoint,
} from '@/app/actions/leads'
import { currentCycle } from '@/lib/period'
import type { Role } from '@/lib/types/database'
import { LeadsClient } from './LeadsClient'
import { LeadsComingSoon } from './LeadsComingSoon'

// Dashboard de Leads (Pipefy) — domínio SEPARADO do discador. Server component: descobre o
// papel, calcula o ciclo de meta corrente (11→10) e busca os dados iniciais. O RLS das views
// já escopa: agente vê o próprio, supervisor+ vê tudo. Os painéis gerenciais (ranking,
// alerta de duplicados) só são buscados/exibidos para supervisor+; a tabela pessoal do
// agente (getAgentLeads) só é buscada para o próprio agente (fila enxuta; supervisor puxaria
// a base toda — isso é S3).
const MANAGER_ROLES: Role[] = ['supervisor', 'manager', 'admin']

// Gate de lançamento: enquanto o dashboard de leads não é liberado publicamente, /leads
// mostra "Em breve". O early return acontece ANTES de qualquer busca no banco, então em
// produção (flag desligada) nenhuma query de leads roda. Para trabalhar nele localmente,
// defina NEXT_PUBLIC_LEADS_ENABLED=1 no .env.local.
const LEADS_ENABLED =
  process.env.NEXT_PUBLIC_LEADS_ENABLED === '1' ||
  process.env.NEXT_PUBLIC_LEADS_ENABLED === 'true'

export default async function LeadsPage() {
  if (!LEADS_ENABLED) return <LeadsComingSoon />

  const profile = await getCurrentProfile()
  const role: Role = profile?.role ?? 'agent'
  const isManager = MANAGER_ROLES.includes(role)
  const cycle = currentCycle()

  const [data, duplicates, agentLeads, supervisor, timeseries, trend, funnelDepth, activity] =
    await Promise.all([
      getLeadsData(cycle),
      isManager ? getDuplicateAlerts() : Promise.resolve([] as DuplicateAlert[]),
      isManager ? Promise.resolve([] as AgentLeadRow[]) : getAgentLeads(cycle),
      isManager ? getSupervisorMetrics(cycle) : Promise.resolve(null as SupervisorMetrics | null),
      getLeadsTimeseries(cycle), // evolução diária (Visão Geral) — todos os papéis
      isManager ? getLeadsTrend() : Promise.resolve([] as TrendPoint[]), // tendência (Performance) — só gestor
      getLeadsFunnelDepth(cycle), // tempo médio por etapa (Funil) — todos os papéis
      getLeadsActivity(cycle), // funil geral por updated_at (Funil) — todos os papéis
    ])

  return (
    // Suspense: o LeadsClient usa useSearchParams (aba ativa em ?aba=), que exige um limite
    // de Suspense no App Router. Os dados já vêm prontos por props, então não há gap real.
    <Suspense fallback={null}>
      <LeadsClient
        initialPeriod={cycle}
        initialData={data}
        initialAgentLeads={agentLeads}
        duplicates={duplicates}
        initialSupervisor={supervisor}
        initialTimeseries={timeseries}
        initialTrend={trend}
        initialFunnelDepth={funnelDepth}
        initialActivity={activity}
        isManager={isManager}
      />
    </Suspense>
  )
}
